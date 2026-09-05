import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { ItemSchedulePage } from './ItemSchedulePage';
import type { Plan, MemberRef } from './api';
import type { ProjectMember } from '@/features/projects/membersApi';
import type { ProjectItem, ProjectDetail } from '@/features/projects/api';

// supabase をモック (useCurrentUser/useAuthSession が getSession を辿るため。user.id も含める)。
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { access_token: 't', user: { id: 'user-1' } } } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
    },
  },
}));

// sonner の toast を spy する (mutation の成功/失敗トーストで落ちないように)。
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

// Radix (Select / Sheet / AlertDialog) と SVG/DnD で jsdom に無い API を補う。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
  p.setPointerCapture = vi.fn();
  Range.prototype.getBoundingClientRect ??= () => ({
    x: 0,
    y: 0,
    width: 0,
    height: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    toJSON() {},
  });
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // jsdom には elementFromPoint が無い。ドラッグ中の列判定で呼ばれるため null を返すスタブを置く
  // (null = 同一制作物内移動の扱いになり commitMove へ流れる)。
  if (typeof document.elementFromPoint !== 'function') {
    document.elementFromPoint = vi.fn(() => null);
  }
  // jsdom には PointerEvent が無いので最小限ポリフィル (clientX/Y/button を保持)。
  if (typeof window.PointerEvent === 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
      }
    }
    // @ts-expect-error テスト用ポリフィル
    window.PointerEvent = PointerEventPolyfill;
    // @ts-expect-error テスト用ポリフィル
    globalThis.PointerEvent = PointerEventPolyfill;
  }
});

/**
 * ボールチップを縦ドラッグして dayDelta 分移動させる (pointerdown→move→up)。
 * pointerdown 後に effect が window リスナを登録するまで 1 tick 待ってから
 * pointermove/pointerup を発火する (同期発火だと取りこぼすため)。
 */
async function dragBall(ball: HTMLElement, fromY: number, toY: number) {
  await act(async () => {
    ball.dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, clientY: fromY, button: 0 }),
    );
  });
  await act(async () => {
    window.dispatchEvent(
      new window.PointerEvent('pointermove', { bubbles: true, clientX: 0, clientY: toY }),
    );
  });
  await act(async () => {
    window.dispatchEvent(new window.PointerEvent('pointerup', { bubbles: true }));
  });
}

// =============================================================================
// 固定 ID / テストデータ
// =============================================================================
const PROJECT_ID = 'p1';
const ITEM_ID = 'it1';
const ITEM_ID_2 = 'it2';

const meMember: ProjectMember = {
  id: 'm-1',
  userId: 'user-1',
  name: '山田 太郎',
  email: 'taro@example.com',
  organizationName: 'Acme',
  memberType: 'production',
  jobTitle: null,
  roleType: 'editor',
  sortOrder: 0,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const otherMember: ProjectMember = {
  ...meMember,
  id: 'm-2',
  userId: 'user-2',
  name: '鈴木 花子',
  email: 'hanako@example.com',
  organizationName: 'Beta',
  memberType: 'client',
  jobTitle: null,
  roleType: 'editor',
  sortOrder: 1,
};

const MEMBERS: ProjectMember[] = [meMember, otherMember];

function ref(m: ProjectMember): MemberRef {
  return {
    id: m.id,
    name: m.name,
    organizationName: m.organizationName,
    memberType: m.memberType,
  };
}

const projectDetail: ProjectDetail = {
  id: PROJECT_ID,
  name: 'サンプル制作案件',
  // 短めの期間 (描画する行数を抑える)。今日を含めて today バナーの分岐も通す。
  startDate: '2026-06-18',
  endDate: '2026-06-25',
  status: 'active',
  archivedAt: null,
  role: 'admin',
  clientName: null,
  progressManager: null,
  overdueCount: 0,
  createdBy: 'user-1',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  counts: { memberCount: 2, itemCount: 2 },
};

const items: ProjectItem[] = [
  {
    id: ITEM_ID,
    projectId: PROJECT_ID,
    name: 'トップページ',
    sortOrder: 0,
    startDate: null,
    endDate: null,
    counts: { activePlanCount: 2, completedPlanCount: 0 },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: ITEM_ID_2,
    projectId: PROJECT_ID,
    name: '問い合わせフォーム',
    sortOrder: 1,
    startDate: null,
    endDate: null,
    counts: { activePlanCount: 1, completedPlanCount: 0 },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
];

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: 'plan-1',
    itemId: ITEM_ID,
    planType: 'toss',
    title: 'デザインカンプ作成',
    category: 'design',    colorTheme: null,

    scheduledDate: '2026-06-19',
    dueDate: '2026-06-22',
    executor: ref(meMember),
    approver: ref(otherMember),
    progressManager: ref(meMember),
    fromMember: ref(meMember),
    toMember: ref(otherMember),
    successorPlanId: null,
    status: 'active',
    memo: null,
    ballHolder: ref(meMember),
    ballState: 'in_progress',
    latestEvent: null,
    completedAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

// 複数メンバー・複数 ball 状態 (ready/tossed/completed) を跨ぐ予定群。
// successorPlanId でチェーン (plan-1 → plan-2) を張りコネクト線の描画も通す。
const PLANS: Plan[] = [
  makePlan({
    id: 'plan-1',
    title: 'ワイヤーフレーム作成',
    category: 'wireframe',    colorTheme: null,

    scheduledDate: '2026-06-19',
    dueDate: '2026-06-22',
    ballState: 'in_progress',
    successorPlanId: 'plan-2',
  }),
  makePlan({
    id: 'plan-2',
    title: 'デザインカンプ作成',
    category: 'design',    colorTheme: null,

    scheduledDate: '2026-06-22',
    dueDate: '2026-06-24',
    ballState: 'tossed',
    ballHolder: ref(otherMember),
  }),
  makePlan({
    id: 'plan-3',
    title: 'コーディング',
    category: 'coding',    colorTheme: null,

    itemId: ITEM_ID_2,
    scheduledDate: '2026-06-20',
    dueDate: null,
    ballState: 'completed',
    status: 'completed',
    completedAt: '2026-06-20T10:00:00.000Z',
  }),
];

// =============================================================================
// MSW セットアップ
// =============================================================================
type SetupOpts = {
  project?: ProjectDetail | { status: number };
  itemsResp?: ProjectItem[] | { status: number };
  membersResp?: ProjectMember[] | { status: number };
  plansResp?: Plan[] | { status: number };
};

function ok<T>(data: T) {
  return HttpResponse.json({ data });
}
function err(status: number) {
  return HttpResponse.json({ error: { code: 'X', message: 'x' } }, { status });
}

function setupReads(opts: SetupOpts = {}) {
  const respond = <T,>(v: T | { status: number } | undefined, fallback: T) => {
    if (v && typeof v === 'object' && 'status' in v && typeof v.status === 'number') {
      return err(v.status);
    }
    return ok((v as T) ?? fallback);
  };

  server.use(
    http.get(`*/api/v1/projects/${PROJECT_ID}`, () =>
      respond(opts.project as ProjectDetail | { status: number } | undefined, projectDetail),
    ),
    http.get(`*/api/v1/projects/${PROJECT_ID}/items`, () =>
      respond(opts.itemsResp, items),
    ),
    http.get(`*/api/v1/projects/${PROJECT_ID}/members`, () =>
      respond(opts.membersResp, MEMBERS),
    ),
    http.get(`*/api/v1/projects/${PROJECT_ID}/plans`, () =>
      respond(opts.plansResp, PLANS),
    ),
  );
}

function renderPage(route = `/projects/${PROJECT_ID}/items/${ITEM_ID}`) {
  return renderWithProviders(
    <Routes>
      <Route path="/projects/:projectId/items/:itemId" element={<ItemSchedulePage />} />
    </Routes>,
    { route },
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('ItemSchedulePage (integration)', () => {
  // ---------------------------------------------------------------------------
  // ローディング → 正常描画
  // ---------------------------------------------------------------------------
  it('ローディング後に制作物列・予定・期間ヘッダを描画する', async () => {
    setupReads();
    renderPage();

    // ヘッダのプロジェクト名 (breadcrumb + title) が出る
    expect(await screen.findAllByText('サンプル制作案件')).not.toHaveLength(0);
    // 期間表示
    expect(screen.getByText(/期間: 2026\/6\/18 〜 2026\/6\/25/)).toBeInTheDocument();
    // 制作物列ヘッダ
    expect(screen.getByText('トップページ')).toBeInTheDocument();
    expect(screen.getByText('問い合わせフォーム')).toBeInTheDocument();
    // 予定 (ボール) のタイトル
    expect(screen.getByText('ワイヤーフレーム作成')).toBeInTheDocument();
    expect(screen.getByText('デザインカンプ作成')).toBeInTheDocument();
    expect(screen.getByText('コーディング')).toBeInTheDocument();
    // ボール保持ラベル (列ヘッダ)
    expect(screen.getAllByText('ボール：').length).toBeGreaterThan(0);
  });

  // #117 ケース3: ワイヤー完了・後続デザイン未TOSS の列ヘッダはデザインの実施者(FROM)を表示する
  it('#117 ケース3: 完了した先行の後続(未TOSS)の実施者を代表保持者に表示する', async () => {
    const dzFrom: ProjectMember = { ...meMember, id: 'm-dzfrom', name: 'デザイン実施', organizationName: '' };
    const dzTo: ProjectMember = { ...meMember, id: 'm-dzto', name: 'デザイン確認', organizationName: '' };
    const wire = makePlan({
      id: 'w',
      title: 'ワイヤー作成',
      category: 'wireframe',      colorTheme: null,

      scheduledDate: '2026-06-19',
      dueDate: '2026-06-20',
      fromMember: ref(meMember),
      toMember: ref(otherMember),
      status: 'completed',
      ballState: 'completed',
      successorPlanId: 'd',
    });
    const design = makePlan({
      id: 'd',
      title: 'デザイン作成',
      category: 'design',      colorTheme: null,

      scheduledDate: '2026-06-21',
      dueDate: '2026-06-22',
      executor: ref(dzFrom),
      approver: ref(dzTo),
      progressManager: ref(dzFrom),
      fromMember: ref(dzFrom),
      toMember: ref(dzTo),
      status: 'active',
      ballState: 'in_progress',
      successorPlanId: null,
    });
    setupReads({ itemsResp: [items[0]!], plansResp: [wire, design] });
    renderPage();

    await screen.findByText('ワイヤー作成');
    const holderRow = screen.getByText('ボール：').parentElement!;
    // 代表保持者はデザインの FROM (デザイン実施)。ワイヤーの FROM は表示されない。
    expect(holderRow.textContent).toContain('デザイン実施');
    expect(holderRow.textContent).not.toContain(meMember.name);
  });

  it('日付軸の日付セルとズームコントロールを描画する', async () => {
    setupReads();
    renderPage();

    await screen.findByText('トップページ');
    // 日付軸: 開始日 6/18 の「18」が出る (Figma の日付軸は日にちのみ)
    expect(screen.getAllByText('18').length).toBeGreaterThan(0);
    // ズームコントロール (行の高さスライダー)
    expect(screen.getByLabelText('行の高さ')).toBeInTheDocument();
    // 日付セル (クリックで作成) の aria-label
    expect(screen.getAllByLabelText(/に予定を作成$/).length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // 空 / エラー
  // ---------------------------------------------------------------------------
  it('メンバーが居ない場合は参加者追加の案内を表示する', async () => {
    setupReads({ membersResp: [] });
    renderPage();

    expect(await screen.findByText('まずは参加者を追加してください。')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '参加者管理を開く' })).toBeInTheDocument();
  });

  it('制作物が無い場合は focusedItem 不在で NotFound になる', async () => {
    setupReads({ itemsResp: [] });
    renderPage();

    expect(await screen.findByText('ページが見つかりませんでした。')).toBeInTheDocument();
  });

  it('対象 itemId が一覧に無い (focusedItem 不在) なら NotFound', async () => {
    setupReads();
    renderPage(`/projects/${PROJECT_ID}/items/missing-item`);

    expect(await screen.findByText('ページが見つかりませんでした。')).toBeInTheDocument();
  });

  it('プロジェクト取得が 500 ならエラー (NotFound) を表示する', async () => {
    setupReads({ project: { status: 500 } });
    renderPage();

    expect(await screen.findByText('ページが見つかりませんでした。')).toBeInTheDocument();
  });

  it('プロジェクト期間が空 (start=end でない無効データ) なら期間未設定メッセージ', async () => {
    // differenceInDays が負になるよう end < start にして days.length=0 を作る
    setupReads({
      project: { ...projectDetail, startDate: '2026-06-25', endDate: '2026-06-18' },
    });
    renderPage();

    expect(
      await screen.findByText('プロジェクト期間が設定されていません。'),
    ).toBeInTheDocument();
  });

  // ---------------------------------------------------------------------------
  // モーダル
  // ---------------------------------------------------------------------------
  it('「予定を追加」ボタンで CreatePlanModal が開く', async () => {
    setupReads();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    await screen.findByText('トップページ');
    await user.click(screen.getByRole('button', { name: /予定を追加/ }));

    // CreatePlanModal が開く (タイトル placeholder で一意に判定)
    expect(await screen.findByPlaceholderText('例: トップページ構成')).toBeInTheDocument();
  });

  it('日付セルを Enter で作成すると CreatePlanModal が開く', async () => {
    setupReads();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    await screen.findByText('トップページ');
    const cells = screen.getAllByLabelText(/に予定を作成$/);
    cells[0]!.focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByPlaceholderText('例: トップページ構成')).toBeInTheDocument();
  });

  it('ボールをクリック (ドラッグなし) すると BallDetailModal が開く', async () => {
    setupReads();
    // 詳細取得 (BallDetailModal が叩く plan detail) を返す
    server.use(
      http.get(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/plan-1`,
        () => ok({ plan: PLANS[0], events: [] }),
      ),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    const chip = await screen.findByText('ワイヤーフレーム作成');
    // role=button のボールチップ (data-plan-id を持つ親)
    const ball = chip.closest('[data-plan-id="plan-1"]') as HTMLElement;
    await user.click(ball);

    // Sheet (BallDetailModal) が plan のタイトルを SheetTitle に出す
    await waitFor(() => {
      expect(screen.getAllByText('ワイヤーフレーム作成').length).toBeGreaterThan(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 制作物フィルタ (Select)
  // ---------------------------------------------------------------------------
  it('制作物セレクトで単一制作物に絞り込むと他列が消える', async () => {
    setupReads();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    await screen.findByText('トップページ');
    expect(screen.getByText('問い合わせフォーム')).toBeInTheDocument();

    // Select トリガーを開く (placeholder '制作物' / 現在値 '全て')
    await user.click(screen.getByRole('combobox'));
    // メニューから 'トップページ' を選択
    const options = await screen.findAllByText('トップページ');
    // 列ヘッダとオプション両方に出るので、role=option を優先
    const option = screen.getByRole('option', { name: 'トップページ' });
    await user.click(option);

    // 問い合わせフォーム列が消える (絞り込み成功)
    await waitFor(() => {
      expect(screen.queryByText('問い合わせフォーム')).not.toBeInTheDocument();
    });
    expect(options.length).toBeGreaterThan(0);
  });

  // ---------------------------------------------------------------------------
  // ズーム操作
  // ---------------------------------------------------------------------------
  it('ズームの拡大/縮小ボタンとスライダーで rowHeight 表示が変わる', async () => {
    setupReads();
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    await screen.findByText('トップページ');
    // 行高はスライダーの値で確認する (Figma のズームコントロールに px 表記は無い)。
    const slider = () => screen.getByLabelText('行の高さ') as HTMLInputElement;
    expect(slider().value).toBe('40');

    await user.click(screen.getByRole('button', { name: '拡大' }));
    await waitFor(() => expect(slider().value).toBe('45'));

    await user.click(screen.getByRole('button', { name: '縮小' }));
    await waitFor(() => expect(slider().value).toBe('40'));

    // スライダー (range) の onChange で rowHeight を直接変更する
    fireEvent.change(slider(), { target: { value: '60' } });
    await waitFor(() => expect(slider().value).toBe('60'));
  });

  // ---------------------------------------------------------------------------
  // ヘッダのナビゲーションリンク
  // ---------------------------------------------------------------------------
  it('ヘッダにメンバーかんばん / プロジェクト情報リンクを描画する', async () => {
    setupReads();
    renderPage();

    await screen.findByText('トップページ');
    expect(screen.getByRole('link', { name: /メンバーかんばん/ })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}/members`,
    );
    expect(screen.getByRole('link', { name: /プロジェクト情報/ })).toHaveAttribute(
      'href',
      `/projects/${PROJECT_ID}/edit`,
    );
  });

  // ---------------------------------------------------------------------------
  // ドラッグ移動 → 日程変更確認ダイアログ
  // ---------------------------------------------------------------------------
  it('ボールを縦ドラッグすると日程変更の確認ダイアログが出る', async () => {
    setupReads();
    renderPage();

    const chip = await screen.findByText('ワイヤーフレーム作成');
    const ball = chip.closest('[data-plan-id="plan-1"]') as HTMLElement;

    // pointerdown → window pointermove (100px = 2.5日) → pointerup で move を再現。
    // userEvent はカードに対する低レベル pointer drag を rowHeight 換算しづらいので生イベントで。
    await dragBall(ball, 100, 200);

    // commitMove(dayDelta≠0) → pendingMove → DateChangeConfirmModal
    expect(await screen.findByText('日程を変更しますか？')).toBeInTheDocument();
    expect(
      screen.getByText(/「ワイヤーフレーム作成」の日程を変更します/),
    ).toBeInTheDocument();
  });

  it('日程変更ダイアログで「この予定のみ変更」を押すと PATCH が走る', async () => {
    setupReads();
    let patchCalled = false;
    server.use(
      http.patch(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/plan-1`,
        () => {
          patchCalled = true;
          return ok(makePlan({ id: 'plan-1' }));
        },
      ),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    const chip = await screen.findByText('ワイヤーフレーム作成');
    const ball = chip.closest('[data-plan-id="plan-1"]') as HTMLElement;
    await dragBall(ball, 100, 200);

    await screen.findByText('日程を変更しますか？');
    await user.click(screen.getByRole('button', { name: 'この予定のみ変更' }));

    await waitFor(() => expect(patchCalled).toBe(true));
  });

  it('日程変更ダイアログで「後続も一緒にずらす」を押すと後続も PATCH される', async () => {
    setupReads();
    const patchedIds: string[] = [];
    server.use(
      http.patch(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/:planId`,
        ({ params }) => {
          patchedIds.push(String(params.planId));
          return ok(makePlan({ id: String(params.planId) }));
        },
      ),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    const chip = await screen.findByText('ワイヤーフレーム作成');
    const ball = chip.closest('[data-plan-id="plan-1"]') as HTMLElement;
    await dragBall(ball, 100, 200);

    await screen.findByText('日程を変更しますか？');
    await user.click(
      screen.getByRole('button', { name: /後続チェーン.*も一緒にずらす/ }),
    );

    // plan-1 と successor の plan-2 が PATCH される
    await waitFor(() => expect(patchedIds).toContain('plan-1'));
    await waitFor(() => expect(patchedIds).toContain('plan-2'));
  });

  it('日程変更ダイアログをキャンセルすると PATCH せず閉じる', async () => {
    setupReads();
    renderPage();

    const chip = await screen.findByText('ワイヤーフレーム作成');
    const ball = chip.closest('[data-plan-id="plan-1"]') as HTMLElement;
    await dragBall(ball, 100, 200);

    const user = userEvent.setup({ pointerEventsCheck: 0 });
    await screen.findByText('日程を変更しますか？');
    await user.click(screen.getByRole('button', { name: 'キャンセル' }));

    await waitFor(() =>
      expect(screen.queryByText('日程を変更しますか？')).not.toBeInTheDocument(),
    );
  });

  // ---------------------------------------------------------------------------
  // 複製ボタン (ボール上ホバーで現れるコピー)
  // ---------------------------------------------------------------------------
  it('ボールの複製ボタンで copy POST が走る', async () => {
    setupReads();
    let copyCalled = false;
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/plan-1/copy`,
        () => {
          copyCalled = true;
          return ok(makePlan({ id: 'plan-copy' }));
        },
      ),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    const chip = await screen.findByText('ワイヤーフレーム作成');
    const ball = chip.closest('[data-plan-id="plan-1"]') as HTMLElement;
    const copyBtn = within(ball).getByRole('button', { name: '複製' });
    await user.click(copyBtn);

    await waitFor(() => expect(copyCalled).toBe(true));
  });

  // ---------------------------------------------------------------------------
  // ボールのキーボード操作 (Enter で詳細)
  // ---------------------------------------------------------------------------
  it('ボールに Enter キーで詳細モーダルが開く', async () => {
    setupReads();
    server.use(
      http.get(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/plan-2`,
        () => ok({ plan: PLANS[1], events: [] }),
      ),
    );
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderPage();

    const chip = await screen.findByText('デザインカンプ作成');
    const ball = chip.closest('[data-plan-id="plan-2"]') as HTMLElement;
    ball.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getAllByText('デザインカンプ作成').length).toBeGreaterThan(1);
    });
  });
});
