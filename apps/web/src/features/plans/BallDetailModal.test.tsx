import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import type { ProjectRole } from '@trakon/shared';

import type { ProjectMember } from '@/features/projects/membersApi';
import { BallDetailModal } from './BallDetailModal';
import type { BallEvent, Plan, PlanDetail } from './api';

// supabase はモックして getSession / onAuthStateChange を制御する
// (実 env / 実クライアント生成と実ネットワークを回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'u-me' } } } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  },
}));

// Radix (Sheet / AlertDialog) が jsdom に存在しない API を呼ぶため、最低限のシムを当てる。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
});

// =============================================================================
// 固定 ID / テストデータ
// =============================================================================
const PROJECT_ID = 'proj-1';
const ITEM_ID = 'item-1';
const PLAN_ID = 'plan-1';
const ME_USER_ID = 'u-me';

// 現在のユーザー (= m-me)。これを ballHolder にすると本人=保持者の分岐になる。
const meMember: ProjectMember = {
  id: 'm-me',
  userId: ME_USER_ID,
  name: '自分 太郎',
  email: 'me@example.com',
  organizationName: 'Acme',
  memberType: 'production',
  jobTitle: null,
  roleType: 'editor',
  sortOrder: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// 他人 (= m-other)。これを ballHolder にすると本人でない分岐になる。
const otherMember: ProjectMember = {
  ...meMember,
  id: 'm-other',
  userId: 'u-other',
  name: '他人 花子',
  email: 'other@example.com',
  sortOrder: 1,
};

const MEMBERS: ProjectMember[] = [meMember, otherMember];

function memberRef(m: ProjectMember) {
  return {
    id: m.id,
    name: m.name,
    organizationName: m.organizationName,
    memberType: m.memberType,
  };
}

/**
 * Plan を組み立てる。ball 状態は ballState / ballHolder / status で表現する。
 * 役割の既定: 実施者=自分, 承認者=他人, 進行責任者=自分 (#131)。
 */
function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: PLAN_ID,
    itemId: ITEM_ID,
    planType: 'toss',
    title: 'デザインカンプ作成',
    category: 'design',    colorTheme: null,

    scheduledDate: '2026-06-21',
    dueDate: null,
    executor: memberRef(meMember),
    approver: memberRef(otherMember),
    progressManager: memberRef(meMember),
    fromMember: memberRef(meMember),
    toMember: memberRef(otherMember),
    successorPlanId: null,
    status: 'active',
    memo: null,
    ballHolder: memberRef(meMember),
    ballState: 'in_progress',
    latestEvent: null,
    completedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<BallEvent> = {}): BallEvent {
  return {
    id: 'ev-1',
    eventType: 'tossed',
    source: 'human',
    actor: memberRef(meMember),
    occurredAt: '2026-06-10T01:23:00.000Z',
    note: null,
    ...overrides,
  };
}

// =============================================================================
// MSW 共通ハンドラ登録
// =============================================================================
type SyncOpts = { role?: ProjectRole };

/**
 * sync(本人) / project(role) / plan detail をまとめて登録する。
 * action 系 (toss/complete/...) は各テストで個別に server.use する。
 */
function setupReads(detail: PlanDetail, opts: SyncOpts = {}) {
  const role = opts.role ?? 'editor';
  server.use(
    http.post('*/api/v1/auth/me/sync', () =>
      HttpResponse.json({
        data: {
          user: {
            id: ME_USER_ID,
            email: 'me@example.com',
            fullName: '自分 太郎',
            displayName: '自分 太郎',
            primaryAuthMethod: 'password',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
          requiresProfileCompletion: false,
        },
      }),
    ),
    http.get(`*/api/v1/projects/${PROJECT_ID}`, () =>
      HttpResponse.json({
        data: {
          id: PROJECT_ID,
          name: 'テスト案件',
          startDate: '2026-06-01',
          endDate: '2026-12-31',
          status: 'active',
          archivedAt: null,
          role,
          createdBy: 'u-creator',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          counts: { memberCount: 2, itemCount: 1 },
        },
      }),
    ),
    http.get(`*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}`, () =>
      HttpResponse.json({ data: detail }),
    ),
  );
}

function renderModal(extra: Partial<React.ComponentProps<typeof BallDetailModal>> = {}) {
  const onClose = vi.fn();
  const onEdit = vi.fn();
  const onCopied = vi.fn();
  const utils = renderWithProviders(
    <BallDetailModal
      projectId={PROJECT_ID}
      itemId={ITEM_ID}
      planId={PLAN_ID}
      members={MEMBERS}
      plans={[]}
      onClose={onClose}
      onEdit={onEdit}
      onCopied={onCopied}
      {...extra}
    />,
  );
  return { ...utils, onClose, onEdit, onCopied };
}

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * 取り消し系・前工程への差し戻し・削除はヘッダーの「⋯」メニューに移動した
 * (Figma node 37:16)。メニューを開いて項目を返す。
 */
async function openMoreMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'その他の操作' }));
}

describe('BallDetailModal (integration)', () => {
  // ---------------------------------------------------------------------------
  // 基本表示
  // ---------------------------------------------------------------------------
  it('詳細取得に成功するとタイトル・実施者/承認者・履歴を描画する', async () => {
    setupReads({
      plan: makePlan({ ballState: 'tossed' }),
      events: [makeEvent()],
    });
    renderModal();

    expect(await screen.findByText('デザインカンプ作成')).toBeInTheDocument();
    // 実施者=自分 太郎 / 承認者=他人 花子 (進行責任者・TOSS履歴でも名前が重複しうるため getAllByText)
    expect(screen.getAllByText('自分 太郎').length).toBeGreaterThan(0);
    expect(screen.getAllByText('他人 花子').length).toBeGreaterThan(0);
    // 役割ラベル
    expect(screen.getByText('実施者')).toBeInTheDocument();
    expect(screen.getByText('承認者')).toBeInTheDocument();
    expect(screen.getByText('進行責任者')).toBeInTheDocument();
    // 概要タブの「最近の履歴」は 1 行の文で出す
    expect(screen.getByText('自分 太郎がTOSSしました')).toBeInTheDocument();
    // 履歴タブに切り替えるとイベント名と担当者が分かれて出る
    await userEvent.click(screen.getByRole('tab', { name: /履歴/ }));
    expect(await screen.findByText('TOSS')).toBeInTheDocument();
  });

  it('概要タブのカードは履歴タブの一覧と同じ枠・行の作りを使う', async () => {
    setupReads({
      plan: makePlan({ ballState: 'tossed' }),
      events: [makeEvent()],
    });
    renderModal();

    await screen.findByText('デザインカンプ作成');

    // 概要タブ: 見出しの隣に置くカードは「枠 + 罫線区切りの行」で組む
    const cards = ['担当', 'スケジュール'].map(
      (title) => screen.getByText(title).closest('section')!.lastElementChild!,
    );
    for (const card of cards) {
      expect(card.className).toContain('rounded-xl');
      expect(card.className).toContain('divide-y');
      expect(card.firstElementChild!.className).toContain('px-4 py-3');
    }

    // 履歴タブの一覧も同じ枠・行の余白であること (両タブで見た目が揃う)
    await userEvent.click(screen.getByRole('tab', { name: /履歴/ }));
    const list = await screen.findByRole('list');
    expect(list.className).toContain('rounded-xl');
    expect(list.className).toContain('divide-y');
    expect(list.firstElementChild!.className).toContain('px-4 py-3');
  });

  it('タブは選択中も枠を持たず、下線を罫線と同じ太さ・位置に重ねる', async () => {
    setupReads({
      plan: makePlan({ ballState: 'tossed' }),
      events: [makeEvent()],
    });
    renderModal();

    const overview = await screen.findByRole('tab', { name: '概要' });
    const history = screen.getByRole('tab', { name: /履歴/ });

    // TabsTrigger の基底は全辺 1px の枠を持つ。border-foreground だと 4 辺が着色されて
    // 選択中のタブが黒枠で囲まれてしまうため、幅を落として下辺だけに色を当てる。
    expect(overview.className).toContain('border-0');
    expect(overview.className).not.toContain('data-[state=active]:border-foreground');
    expect(overview.className).toContain('data-[state=active]:border-b-text-secondary');
    // 下線は TabsList の罫線 (1px) と同じ太さ・位置に重ねる
    expect(overview.className).toContain('border-b');
    expect(overview.className).toContain('-mb-px');
    // 選択中でも文字色は変えず、太字だけで示す (両タブのクラスは完全に同一)
    expect(overview.className).toBe(history.className);
    expect(overview.className).not.toContain('data-[state=active]:text-foreground');

    // タブ行の左右余白はヘッダー・本文と同じ 24px (p-0 を後ろに置くと px-6 が消える)
    const list = overview.parentElement!;
    expect(list.className).toContain('px-6');
    expect(list.className).not.toContain('p-0');
  });

  it('履歴: 自動連鎖バッジと完了の取り消し/完了イベントを描画する', async () => {
    // ballHolder を他人にして完了/TOSS ボタンを出さず、履歴ラベルの衝突を避ける。
    setupReads({
      plan: makePlan({ ballState: 'tossed', ballHolder: memberRef(otherMember) }),
      events: [
        makeEvent({ id: 'ev-a', eventType: 'tossed', source: 'auto_chain', actor: null }),
        makeEvent({ id: 'ev-b', eventType: 'completed' }),
        makeEvent({ id: 'ev-c', eventType: 'completion_undone' }),
      ],
    });
    renderModal();

    await userEvent.click(await screen.findByRole('tab', { name: /履歴/ }));
    expect(await screen.findByText('自動連鎖')).toBeInTheDocument();
    // 各イベントラベル
    expect(screen.getByText('完了')).toBeInTheDocument();
    expect(screen.getByText('完了の取り消し')).toBeInTheDocument();
    // actor が null のイベントは system 表記
    expect(screen.getAllByText('システム').length).toBeGreaterThan(0);
  });

  it('詳細取得に失敗するとエラーメッセージを表示する', async () => {
    server.use(
      http.post('*/api/v1/auth/me/sync', () =>
        HttpResponse.json({
          data: {
            user: {
              id: ME_USER_ID,
              email: 'me@example.com',
              fullName: '自分 太郎',
              displayName: '自分 太郎',
              primaryAuthMethod: 'password',
              createdAt: '2026-01-01T00:00:00.000Z',
            },
            requiresProfileCompletion: false,
          },
        }),
      ),
      http.get(`*/api/v1/projects/${PROJECT_ID}`, () =>
        HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 }),
      ),
      http.get(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}`,
        () => HttpResponse.json({ error: { code: 'NOT_FOUND', message: 'x' } }, { status: 404 }),
      ),
    );
    renderModal();

    expect(await screen.findByText('取得に失敗しました')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // ボール状態ごとの表示差分
  // ---------------------------------------------------------------------------
  it('approved 状態: TOSS 待ちバナーと TOSS ボタンを表示する (進行責任者=本人)', async () => {
    setupReads(
      {
        plan: makePlan({ ballState: 'approved', successorPlanId: 'plan-2' }),
        events: [makeEvent({ eventType: 'approved' })],
      },
      { role: 'admin' }, // TOSS は管理者のみ (FR-ROLE-02)
    );
    renderModal();

    // 状態バッジ (承認済み・TOSS待ち)。
    expect(await screen.findByText('承認済み・TOSS待ち')).toBeInTheDocument();
    // 進行責任者 (=本人) なので TOSS ボタンが出る。
    expect(screen.getByRole('button', { name: '次の工程へトス' })).toBeInTheDocument();
  });

  it('completed 状態: 完了済みバナーを表示し TOSS/完了ボタンを出さない', async () => {
    setupReads({
      plan: makePlan({ ballState: 'completed', status: 'completed' }),
      events: [makeEvent({ eventType: 'completed' })],
    });
    renderModal();

    expect(await screen.findByText('完了済み')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^TOSS/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /完了$/ })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 認可分岐
  // ---------------------------------------------------------------------------
  it('認可: 編集者には TOSS ボタンを無効化して理由を出す (隠さない)', async () => {
    // TOSS は管理者のみ (FR-ROLE-02)。ただし中心動線なので黙って消すと壊れたと
    // 誤解されるため、無効化 + 理由テキストで示す (設計書 §4.5.2)。
    setupReads({
      plan: makePlan({
        ballState: 'approved',
        successorPlanId: 'plan-2',
        progressManager: memberRef(otherMember),
        approver: memberRef(otherMember),
        ballHolder: memberRef(otherMember),
      }),
      events: [makeEvent({ eventType: 'approved' })],
    });
    renderModal();

    // 詳細が描画されるまで待つ
    expect(await screen.findByText('承認済み・TOSS待ち')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '次の工程へトス' })).toBeDisabled();
    expect(screen.getByText('TOSS は管理者のみが実行できます')).toBeInTheDocument();
  });

  it('認可: 進行責任者でなくてもディレクターなら TOSS できる', async () => {
    setupReads(
      {
        plan: makePlan({
          ballState: 'approved',
          successorPlanId: 'plan-2',
          progressManager: memberRef(otherMember),
          ballHolder: memberRef(otherMember),
        }),
        events: [makeEvent({ eventType: 'approved' })],
      },
      { role: 'admin' },
    );
    renderModal();

    expect(await screen.findByRole('button', { name: '次の工程へトス' })).toBeInTheDocument();
  });

  it('認可: 実施者が未設定なら操作の代わりに案内文を表示する (director)', async () => {
    setupReads(
      {
        plan: makePlan({ ballState: 'in_progress', executor: null, approver: null }),
        events: [],
      },
      { role: 'admin' },
    );
    renderModal();

    expect(await screen.findByText('実施者を設定すると操作できます')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // TOSS mutation
  // ---------------------------------------------------------------------------
  it('TOSS 成功: toss エンドポイントへ POST する', async () => {
    setupReads(
      {
        plan: makePlan({ ballState: 'approved', successorPlanId: 'plan-2' }),
        events: [makeEvent({ eventType: 'approved' })],
      },
      { role: 'admin' },
    );
    const tossed = makePlan({ ballState: 'tossed', ballHolder: memberRef(otherMember) });
    let tossCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/toss`,
        () => {
          tossCalled = true;
          return HttpResponse.json({ data: { plan: tossed, autoTossed: null } });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    const btn = await screen.findByRole('button', { name: '次の工程へトス' });
    await user.click(btn);

    await waitFor(() => expect(tossCalled).toBe(true));
  });

  it('TOSS 失敗: サーバ 4xx でも例外で落ちずに描画が保たれる', async () => {
    setupReads(
      {
        plan: makePlan({ ballState: 'approved', successorPlanId: 'plan-2' }),
        events: [makeEvent({ eventType: 'approved' })],
      },
      { role: 'admin' },
    );
    let tossCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/toss`,
        () => {
          tossCalled = true;
          return HttpResponse.json(
            { error: { code: 'CONFLICT', message: 'TOSS できません' } },
            { status: 409 },
          );
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    const btn = await screen.findByRole('button', { name: '次の工程へトス' });
    await user.click(btn);

    // mutation が呼ばれ、onError でトースト表示 (UI は維持される)
    await waitFor(() => expect(tossCalled).toBe(true));
    expect(screen.getByText('デザインカンプ作成')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 前工程へ差し戻し (§13)
  // ---------------------------------------------------------------------------
  it('前工程がある実施中の予定に「前工程へ差し戻す」を表示し、クリックでAPIを呼ぶ', async () => {
    setupReads({ plan: makePlan({ ballState: 'in_progress' }), events: [] });
    let called = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/send-back-to-predecessor`,
        () => {
          called = true;
          return HttpResponse.json({
            data: { plan: makePlan(), predecessor: makePlan({ id: 'pred-1' }) },
          });
        },
      ),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    // 先行予定 = この予定を後続に指す予定
    renderModal({ plans: [makePlan({ id: 'pred-1', successorPlanId: PLAN_ID })] });

    await openMoreMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: '前工程へ差し戻す' }));
    await waitFor(() => expect(called).toBe(true));
  });

  it('前工程が無ければ「前工程へ差し戻す」は表示しない', async () => {
    setupReads({ plan: makePlan({ ballState: 'in_progress' }), events: [] });
    renderModal({ plans: [] });
    // 詳細描画を待つ
    expect(await screen.findByText('デザインカンプ作成')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '前工程へ差し戻す' })).not.toBeInTheDocument();
  });

  it('確認待ちでは前工程があっても「前工程へ差し戻す」は表示しない (確認依頼前のみ)', async () => {
    setupReads({
      plan: makePlan({ ballState: 'review_pending', approver: memberRef(meMember) }),
      events: [makeEvent({ eventType: 'review_requested' })],
    });
    renderModal({ plans: [makePlan({ id: 'pred-1', successorPlanId: PLAN_ID })] });
    expect(await screen.findByText('デザインカンプ作成')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '前工程へ差し戻す' })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 承認 mutation (承認者なし → 実施者が承認 = 完了)
  // ---------------------------------------------------------------------------
  it('承認 成功: 承認者なしの実施中で「完了」ボタンを押すと approve へ POST する', async () => {
    setupReads({
      plan: makePlan({ ballState: 'in_progress', approver: null }),
      events: [],
    });
    let approveCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/approve`,
        () => {
          approveCalled = true;
          return HttpResponse.json({
            data: { plan: makePlan({ ballState: 'approved', status: 'completed' }), autoTossed: null },
          });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    const btn = await screen.findByRole('button', { name: '承認して完了' });
    await user.click(btn);

    await waitFor(() => expect(approveCalled).toBe(true));
  });

  it('承認 失敗: approve が 4xx を返してもクラッシュしない', async () => {
    setupReads({
      plan: makePlan({ ballState: 'in_progress', approver: null }),
      events: [],
    });
    let approveCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/approve`,
        () => {
          approveCalled = true;
          return HttpResponse.json(
            { error: { code: 'CONFLICT', message: '承認できません' } },
            { status: 409 },
          );
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    const btn = await screen.findByRole('button', { name: '承認して完了' });
    await user.click(btn);

    await waitFor(() => expect(approveCalled).toBe(true));
    expect(screen.getByText('デザインカンプ作成')).toBeInTheDocument();
  });

  it('後続あり・承認者なしの実施中: ボタンが「承認」表記になり後続名を表示する', async () => {
    const successor = makePlan({ id: 'plan-2', title: '後続タスク' });
    setupReads({
      plan: makePlan({
        ballState: 'in_progress',
        approver: null,
        successorPlanId: 'plan-2',
      }),
      events: [],
    });
    renderModal({ plans: [successor] });

    expect(await screen.findByRole('button', { name: '承認' })).toBeInTheDocument();
    // 後続タスク名がバナーに表示される
    expect(screen.getByText('後続タスク')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 差し戻し集約: 確認待ちでは「差し戻す」を廃止し「確認依頼を取り消す」に集約
  // ---------------------------------------------------------------------------
  it('確認待ち: 承認者=本人でも「差し戻す」は表示せず「確認依頼を取り消す」で request-review-undo へ POST する', async () => {
    // 承認者=本人。確認待ちで承認者/実施者/director が実施者へ戻せる (集約後)。
    setupReads({
      plan: makePlan({
        ballState: 'review_pending',
        approver: memberRef(meMember),
        ballHolder: memberRef(meMember),
      }),
      events: [makeEvent({ eventType: 'review_requested' })],
    });
    let undoCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/request-review-undo`,
        () => {
          undoCalled = true;
          return HttpResponse.json({ data: { plan: makePlan({ ballState: 'in_progress' }) } });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    const btn = await screen.findByRole('button', { name: 'ボールを戻す' });
    // 「差し戻す」ボタンは廃止済み。
    expect(screen.queryByRole('button', { name: '差し戻す' })).not.toBeInTheDocument();
    await user.click(btn);

    await waitFor(() => expect(undoCalled).toBe(true));
  });

  // ---------------------------------------------------------------------------
  // TOSS の取り消し (toss-undo)
  // ---------------------------------------------------------------------------
  it('TOSS の取り消し: tossed 状態は管理者が toss-undo できる', async () => {
    // 管理者はボール保持者が他人でも取り消せる (#50 の救済は管理者が行う)。
    setupReads(
      {
        plan: makePlan({ ballState: 'tossed', ballHolder: memberRef(otherMember) }),
        events: [makeEvent()],
      },
      { role: 'admin' },
    );
    let undoCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/toss-undo`,
        () => {
          undoCalled = true;
          return HttpResponse.json({ data: { plan: makePlan({ ballState: 'approved' }) } });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    await openMoreMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'TOSS を取り消す' }));

    await waitFor(() => expect(undoCalled).toBe(true));
  });

  // ---------------------------------------------------------------------------
  // 完了の取り消し (approve-undo) : 承認=完了 (後続なし) を取り消す
  // ---------------------------------------------------------------------------
  it('完了の取り消し: completed + 進行責任者/承認者で approve-undo へ POST する', async () => {
    setupReads({
      plan: makePlan({
        ballState: 'approved',
        status: 'completed',
        ballHolder: memberRef(meMember),
      }),
      events: [makeEvent({ eventType: 'approved' })],
    });
    let undoApproveCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/approve-undo`,
        () => {
          undoApproveCalled = true;
          return HttpResponse.json({ data: { plan: makePlan({ ballState: 'in_progress', status: 'active' }) } });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    await openMoreMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: '完了を取り消す' }));

    await waitFor(() => expect(undoApproveCalled).toBe(true));
  });

  it('完了の取り消し: 承認者/進行責任者でもディレクターでもなければボタンを出さない', async () => {
    setupReads({
      plan: makePlan({
        ballState: 'approved',
        status: 'completed',
        approver: memberRef(otherMember),
        progressManager: memberRef(otherMember),
        ballHolder: memberRef(otherMember),
      }),
      events: [makeEvent({ eventType: 'approved' })],
    });
    renderModal();

    expect(await screen.findByText('完了済み')).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: '完了を取り消す' })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 複製 / 削除 / 編集 / 閉じる
  // ---------------------------------------------------------------------------
  it('複製: コピーアイコンで copy へ POST し onCopied を呼ぶ', async () => {
    setupReads({ plan: makePlan({ ballState: 'in_progress' }), events: [] });
    let copyCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/copy`,
        () => {
          copyCalled = true;
          return HttpResponse.json({ data: makePlan({ id: 'plan-copy' }) });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onCopied } = renderModal();

    const btn = await screen.findByRole('button', { name: '複製' });
    await user.click(btn);

    await waitFor(() => expect(copyCalled).toBe(true));
    await waitFor(() => expect(onCopied).toHaveBeenCalledWith('plan-copy'));
  });

  it('削除: イベントなし active で削除確認→DELETE→onClose', async () => {
    setupReads({ plan: makePlan({ ballState: 'in_progress' }), events: [] });
    let deleteCalled = false;
    server.use(
      http.delete(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}`,
        () => {
          deleteCalled = true;
          return new HttpResponse(null, { status: 204 });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onClose } = renderModal();

    // 削除はヘッダーの「⋯」メニューへ移動した
    await openMoreMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: '削除' }));

    // 確認ダイアログの「削除」アクションを押す
    await user.click(await screen.findByRole('button', { name: '削除' }));

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('編集: active なら編集アイコンで onEdit を呼ぶ', async () => {
    setupReads({ plan: makePlan({ ballState: 'in_progress' }), events: [] });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onEdit } = renderModal();

    const btn = await screen.findByRole('button', { name: '編集' });
    await user.click(btn);

    expect(onEdit).toHaveBeenCalled();
  });
});
