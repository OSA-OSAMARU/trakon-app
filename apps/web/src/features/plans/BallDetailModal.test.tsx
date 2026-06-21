import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
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
  sortOrder: 0,
  inviteStatus: 'accepted',
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

/** Plan を組み立てる。ball 状態は ballState / ballHolder / status で表現する。 */
function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: PLAN_ID,
    itemId: ITEM_ID,
    planType: 'toss',
    title: 'デザインカンプ作成',
    category: 'design',
    scheduledDate: '2026-06-21',
    dueDate: null,
    fromMember: memberRef(meMember),
    toMember: memberRef(otherMember),
    successorPlanId: null,
    status: 'active',
    memo: null,
    ballHolder: memberRef(meMember),
    ballState: 'ready',
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
type SyncOpts = { role?: 'director' | 'member' };

/**
 * sync(本人) / project(role) / plan detail をまとめて登録する。
 * action 系 (toss/complete/...) は各テストで個別に server.use する。
 */
function setupReads(detail: PlanDetail, opts: SyncOpts = {}) {
  const role = opts.role ?? 'member';
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

describe('BallDetailModal (integration)', () => {
  // ---------------------------------------------------------------------------
  // 基本表示
  // ---------------------------------------------------------------------------
  it('詳細取得に成功するとタイトル・FROM/TO・履歴を描画する', async () => {
    setupReads({
      plan: makePlan({ ballState: 'tossed' }),
      events: [makeEvent()],
    });
    renderModal();

    expect(await screen.findByText('デザインカンプ作成')).toBeInTheDocument();
    // FROM / TO メンバー
    expect(screen.getByText('自分 太郎 (Acme)')).toBeInTheDocument();
    expect(screen.getByText('他人 花子 (Acme)')).toBeInTheDocument();
    // 履歴 (TOSS イベント)
    expect(screen.getByText('TOSS')).toBeInTheDocument();
    expect(screen.getByText('by 自分 太郎')).toBeInTheDocument();
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

    expect(await screen.findByText('自動連鎖')).toBeInTheDocument();
    // 各イベントラベル
    expect(screen.getByText('完了')).toBeInTheDocument();
    expect(screen.getByText('完了の取り消し')).toBeInTheDocument();
    // actor が null のイベントは system 表記
    expect(screen.getByText('by system')).toBeInTheDocument();
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
  it('ready 状態: TOSS 待ちバナーと TOSS ボタンを表示する (本人=保持者)', async () => {
    setupReads({ plan: makePlan({ ballState: 'ready' }), events: [] });
    renderModal();

    expect(await screen.findByText('TOSS 待ち')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /TOSS/ })).toBeInTheDocument();
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
  it('認可: 本人が保持者でないと TOSS ボタンを表示しない', async () => {
    // ballHolder を他人にする。role は member。
    setupReads({
      plan: makePlan({ ballState: 'ready', ballHolder: memberRef(otherMember) }),
      events: [],
    });
    renderModal();

    // 詳細が描画されるまで待つ
    expect(await screen.findByText('TOSS 待ち')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /TOSS/ })).not.toBeInTheDocument();
  });

  it('認可: 保持者でなくてもディレクターなら TOSS できる', async () => {
    setupReads(
      {
        plan: makePlan({ ballState: 'ready', ballHolder: memberRef(otherMember) }),
        events: [],
      },
      { role: 'director' },
    );
    renderModal();

    expect(await screen.findByRole('button', { name: /TOSS/ })).toBeInTheDocument();
  });

  it('認可: 実施者/確認者が未設定なら TOSS の代わりに案内文を表示する', async () => {
    setupReads({
      plan: makePlan({ ballState: 'ready', toMember: null }),
      events: [],
    });
    renderModal();

    expect(
      await screen.findByText('実施者・確認者を設定するとTOSSできます'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /TOSS/ })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // TOSS mutation
  // ---------------------------------------------------------------------------
  it('TOSS 成功: toss エンドポイントへ POST する', async () => {
    setupReads({ plan: makePlan({ ballState: 'ready' }), events: [] });
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

    const btn = await screen.findByRole('button', { name: /TOSS/ });
    await user.click(btn);

    await waitFor(() => expect(tossCalled).toBe(true));
  });

  it('TOSS 失敗: サーバ 4xx でも例外で落ちずに描画が保たれる', async () => {
    setupReads({ plan: makePlan({ ballState: 'ready' }), events: [] });
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

    const btn = await screen.findByRole('button', { name: /TOSS/ });
    await user.click(btn);

    // mutation が呼ばれ、onError でトースト表示 (UI は維持される)
    await waitFor(() => expect(tossCalled).toBe(true));
    expect(screen.getByText('デザインカンプ作成')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 完了 mutation
  // ---------------------------------------------------------------------------
  it('完了 成功: tossed 状態で完了ボタンを押すと complete へ POST する', async () => {
    setupReads({
      plan: makePlan({ ballState: 'tossed', ballHolder: memberRef(meMember) }),
      events: [makeEvent()],
    });
    let completeCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/complete`,
        () => {
          completeCalled = true;
          return HttpResponse.json({
            data: { plan: makePlan({ ballState: 'completed', status: 'completed' }), autoTossed: null },
          });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    const btn = await screen.findByRole('button', { name: '完了' });
    await user.click(btn);

    await waitFor(() => expect(completeCalled).toBe(true));
  });

  it('完了 失敗: complete が 4xx を返してもクラッシュしない', async () => {
    setupReads({
      plan: makePlan({ ballState: 'tossed', ballHolder: memberRef(meMember) }),
      events: [makeEvent()],
    });
    let completeCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/complete`,
        () => {
          completeCalled = true;
          return HttpResponse.json(
            { error: { code: 'CONFLICT', message: '完了できません' } },
            { status: 409 },
          );
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    const btn = await screen.findByRole('button', { name: '完了' });
    await user.click(btn);

    await waitFor(() => expect(completeCalled).toBe(true));
    expect(screen.getByText('デザインカンプ作成')).toBeInTheDocument();
  });

  it('後続あり tossed: 完了ボタンが「次のタスクへトス」表記になる', async () => {
    const successor = makePlan({ id: 'plan-2', title: '後続タスク' });
    setupReads({
      plan: makePlan({
        ballState: 'tossed',
        ballHolder: memberRef(meMember),
        successorPlanId: 'plan-2',
      }),
      events: [makeEvent()],
    });
    renderModal({ plans: [successor] });

    expect(await screen.findByRole('button', { name: '次のタスクへトス' })).toBeInTheDocument();
    // 後続タスク名がバナーに表示される
    expect(screen.getByText('後続タスク')).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 差し戻し (toss-undo)
  // ---------------------------------------------------------------------------
  it('差し戻し: tossed 状態の差し戻すボタンで toss-undo へ POST する', async () => {
    setupReads({ plan: makePlan({ ballState: 'tossed' }), events: [makeEvent()] });
    let undoCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/toss-undo`,
        () => {
          undoCalled = true;
          return HttpResponse.json({ data: { plan: makePlan({ ballState: 'ready' }) } });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    const btn = await screen.findByRole('button', { name: '差し戻す' });
    await user.click(btn);

    await waitFor(() => expect(undoCalled).toBe(true));
  });

  // ---------------------------------------------------------------------------
  // 完了の取り消し (complete-undo)
  // ---------------------------------------------------------------------------
  it('完了の取り消し: completed + 本人保持者で complete-undo へ POST する', async () => {
    setupReads({
      plan: makePlan({
        ballState: 'completed',
        status: 'completed',
        ballHolder: memberRef(meMember),
      }),
      events: [makeEvent({ eventType: 'completed' })],
    });
    let undoCompleteCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/${PLAN_ID}/complete-undo`,
        () => {
          undoCompleteCalled = true;
          return HttpResponse.json({ data: { plan: makePlan({ ballState: 'tossed', status: 'active' }) } });
        },
      ),
    );

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderModal();

    const btn = await screen.findByRole('button', { name: '完了を取り消す' });
    await user.click(btn);

    await waitFor(() => expect(undoCompleteCalled).toBe(true));
  });

  it('完了の取り消し: 本人でもディレクターでもなければボタンを出さない', async () => {
    setupReads({
      plan: makePlan({
        ballState: 'completed',
        status: 'completed',
        ballHolder: memberRef(otherMember),
      }),
      events: [makeEvent({ eventType: 'completed' })],
    });
    renderModal();

    expect(await screen.findByText('完了済み')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '完了を取り消す' })).not.toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // 複製 / 削除 / 編集 / 閉じる
  // ---------------------------------------------------------------------------
  it('複製: コピーアイコンで copy へ POST し onCopied を呼ぶ', async () => {
    setupReads({ plan: makePlan({ ballState: 'ready' }), events: [] });
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
    setupReads({ plan: makePlan({ ballState: 'ready' }), events: [] });
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

    const trash = await screen.findByRole('button', { name: '削除' });
    await user.click(trash);

    // 確認ダイアログの「削除」アクションを押す
    const confirm = await screen.findByRole('button', { name: '削除' });
    // ダイアログ内の確認ボタン (AlertDialogAction) を取得
    const confirmBtn = screen
      .getAllByRole('button', { name: '削除' })
      .find((b) => b !== trash) ?? confirm;
    await user.click(confirmBtn);

    await waitFor(() => expect(deleteCalled).toBe(true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('編集: active なら編集アイコンで onEdit を呼ぶ', async () => {
    setupReads({ plan: makePlan({ ballState: 'ready' }), events: [] });
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { onEdit } = renderModal();

    const btn = await screen.findByRole('button', { name: '編集' });
    await user.click(btn);

    expect(onEdit).toHaveBeenCalled();
  });
});
