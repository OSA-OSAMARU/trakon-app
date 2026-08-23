import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { CreatePlanModal } from './CreatePlanModal';
import type { ProjectMember } from '@/features/projects/membersApi';
import type { ProjectItem } from '@/features/projects/api';
import type { Plan } from './api';

// supabase はモックして getSession を制御する (実 env / 実クライアント生成を回避)。
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 't' } } }),
    },
  },
}));

// sonner の toast を spy する (テスト DOM 上に Toaster を置かず副作用だけ検証)。
const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

// Radix Select は jsdom に無い API を使うためシムを入れる。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
});

// =============================================================================
// テスト用データ
// =============================================================================

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '22222222-2222-2222-2222-222222222222';
const MEMBER_FROM = '33333333-3333-3333-3333-333333333333';
const MEMBER_TO = '44444444-4444-4444-4444-444444444444';

const members: ProjectMember[] = [
  {
    id: MEMBER_FROM,
    userId: null,
    name: '山田 太郎',
    email: 'taro@example.com',
    organizationName: 'Acme',
    memberType: 'production',
    jobTitle: null,
    sortOrder: 0,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: MEMBER_TO,
    userId: null,
    name: '鈴木 花子',
    email: 'hanako@example.com',
    organizationName: 'Client Co',
    memberType: 'client',
    jobTitle: null,
    sortOrder: 1,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
];

const items: ProjectItem[] = [
  {
    id: ITEM_ID,
    projectId: PROJECT_ID,
    name: 'LP',
    sortOrder: 0,
    startDate: null,
    endDate: null,
    counts: { activePlanCount: 0, completedPlanCount: 0 },
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  },
];

const plans: Plan[] = [];

function baseProps(overrides: Partial<React.ComponentProps<typeof CreatePlanModal>> = {}) {
  return {
    projectId: PROJECT_ID,
    itemId: ITEM_ID,
    members,
    plans,
    items,
    mode: 'create' as const,
    defaultDate: '2026-06-21',
    onClose: vi.fn(),
    ...overrides,
  } satisfies React.ComponentProps<typeof CreatePlanModal>;
}

/** POST create-plan を捕捉するハンドラを設定し、捕捉したボディを参照できる関数を返す。 */
function stubCreate(status = 201, body?: unknown) {
  const captured: { body: unknown } = { body: undefined };
  server.use(
    http.post('*/api/v1/projects/:projectId/items/:itemId/plans', async ({ request }) => {
      captured.body = await request.json();
      if (status >= 400) {
        return HttpResponse.json(
          { error: { code: 'UNPROCESSABLE_ENTITY', message: '入力が不正です' } },
          { status },
        );
      }
      return HttpResponse.json({ data: body ?? { id: 'new-plan' } }, { status });
    }),
  );
  return captured;
}

// Radix の Select トリガーには aria-label が無いため DOM 出現順で参照する。
// create モード: 0=カテゴリ, 1=実施者, 2=承認者, 3=進行責任者, 4=後続の予定
const SELECT_INDEX = {
  category: 0,
  executor: 1,
  approver: 2,
  progressManager: 3,
  successor: 4,
} as const;

/** Radix Select: index 指定でトリガーを開いて指定ラベルの option を選択する。 */
async function selectOption(
  user: ReturnType<typeof userEvent.setup>,
  index: number,
  optionName: string | RegExp,
) {
  const trigger = screen.getAllByRole('combobox')[index]!;
  await user.click(trigger);
  const option = await screen.findByRole('option', { name: optionName });
  await user.click(option);
}

beforeEach(() => {
  toastSuccess.mockClear();
  toastError.mockClear();
});

describe('CreatePlanModal (integration)', () => {
  it('初期表示で「予定を追加」見出しとフォームが描画される', () => {
    renderWithProviders(<CreatePlanModal {...baseProps()} />);
    expect(screen.getByText('予定を追加')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '追加' })).toBeInTheDocument();
  });

  it('実施者と承認者に同一メンバーを選んでも許容され送信される (相違制約なし #131)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const captured = stubCreate(201);
    const onClose = vi.fn();
    renderWithProviders(
      <CreatePlanModal {...baseProps({ onClose, defaultDate: '2026-06-21' })} />,
    );

    await user.type(screen.getByPlaceholderText('例: トップページ構成'), 'テスト予定');
    // 実施者と承認者に同じメンバーを選択 (1 人が複数役割を兼ねられる)
    await selectOption(user, SELECT_INDEX.executor, /山田 太郎/);
    await selectOption(user, SELECT_INDEX.approver, /山田 太郎/);

    await user.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(captured.body).toEqual({
      title: 'テスト予定',
      category: 'other',
      scheduledDate: '2026-06-21',
      executorMemberId: MEMBER_FROM,
      approverMemberId: MEMBER_FROM,
    });
  });

  it('期日が開始日より前だと検証エラーになり送信されない', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const captured = stubCreate();
    const onClose = vi.fn();
    renderWithProviders(
      <CreatePlanModal {...baseProps({ onClose, defaultDate: '2026-06-21' })} />,
    );

    await user.type(screen.getByPlaceholderText('例: トップページ構成'), 'テスト予定');
    // 終了日 (2 番目の date input) を開始日より前に設定
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const dueInput = dateInputs[1] as HTMLInputElement;
    await user.clear(dueInput);
    await user.type(dueInput, '2026-06-20');

    await user.click(screen.getByRole('button', { name: '追加' }));

    expect(await screen.findByText('期日は開始日以降にしてください')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(captured.body).toBeUndefined();
  });

  it('正常系: 有効な値を埋めて送信すると POST ボディを正しく送り onClose/成功トーストが呼ばれる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const captured = stubCreate(201);
    const onClose = vi.fn();
    renderWithProviders(
      <CreatePlanModal {...baseProps({ onClose, defaultDate: '2026-06-21' })} />,
    );

    await user.type(screen.getByPlaceholderText('例: トップページ構成'), '新しい予定');
    // カテゴリを「デザイン」に変更
    await selectOption(user, SELECT_INDEX.category, 'デザイン');
    // 実施者 / 承認者 / 進行責任者を選択
    await selectOption(user, SELECT_INDEX.executor, /山田 太郎/);
    await selectOption(user, SELECT_INDEX.approver, /鈴木 花子/);
    await selectOption(user, SELECT_INDEX.progressManager, /山田 太郎/);
    // 終了日を設定
    const dateInputs = document.querySelectorAll('input[type="date"]');
    const dueInput = dateInputs[1] as HTMLInputElement;
    await user.clear(dueInput);
    await user.type(dueInput, '2026-06-25');

    await user.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toastSuccess).toHaveBeenCalledWith('予定を作成しました');
    expect(captured.body).toEqual({
      title: '新しい予定',
      category: 'design',
      scheduledDate: '2026-06-21',
      dueDate: '2026-06-25',
      executorMemberId: MEMBER_FROM,
      approverMemberId: MEMBER_TO,
      progressManagerMemberId: MEMBER_FROM,
    });
  });

  it('正常系: 終了日・役割 省略でも最小ボディで送信できる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const captured = stubCreate(201);
    const onClose = vi.fn();
    renderWithProviders(
      <CreatePlanModal {...baseProps({ onClose, defaultDate: '2026-06-21' })} />,
    );

    await user.type(screen.getByPlaceholderText('例: トップページ構成'), '最小予定');
    await user.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    // 任意項目は undefined となり JSON では省略される
    expect(captured.body).toEqual({
      title: '最小予定',
      category: 'other',
      scheduledDate: '2026-06-21',
    });
  });

  it('サーバが 422 を返すとエラートーストを表示し onClose を呼ばない', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubCreate(422);
    const onClose = vi.fn();
    renderWithProviders(
      <CreatePlanModal {...baseProps({ onClose, defaultDate: '2026-06-21' })} />,
    );

    await user.type(screen.getByPlaceholderText('例: トップページ構成'), 'エラー予定');
    await user.click(screen.getByRole('button', { name: '追加' }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith('入力が不正です'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('予定名が空のまま送信すると必須エラーになり送信されない', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const captured = stubCreate();
    const onClose = vi.fn();
    renderWithProviders(<CreatePlanModal {...baseProps({ onClose })} />);

    await user.click(screen.getByRole('button', { name: '追加' }));

    expect(await screen.findByText('予定名は必須')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(captured.body).toBeUndefined();
  });

  it('Sheet を閉じる (Escape) と onClose が呼ばれる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const onClose = vi.fn();
    renderWithProviders(<CreatePlanModal {...baseProps({ onClose })} />);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('mode=edit では「予定を編集」見出しと「保存」ボタンを描画する', () => {
    const editingPlan: Plan = {
      id: 'plan-1',
      itemId: ITEM_ID,
      planType: 'toss',
      title: '既存予定',
      category: 'review',
      colorTheme: null,
      scheduledDate: '2026-06-21',
      dueDate: '2026-06-22',
      executor: null,
      approver: null,
      progressManager: null,
      fromMember: null,
      toMember: null,
      successorPlanId: null,
      status: 'active',
      memo: 'メモ本文',
      ballHolder: null,
      ballState: 'in_progress',
      latestEvent: null,
      completedAt: null,
      createdAt: '2026-06-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };
    renderWithProviders(
      <CreatePlanModal
        {...baseProps({ mode: 'edit', planId: 'plan-1', plans: [editingPlan] })}
      />,
    );
    expect(screen.getByText('予定を編集')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
    // edit 時は editingPlan の値でフォームが初期化される
    expect(screen.getByDisplayValue('既存予定')).toBeInTheDocument();
  });
});
