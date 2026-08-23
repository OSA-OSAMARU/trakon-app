import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import { PlanModalsHost } from './PlanModalsHost';
import type { Plan, PlanDetail } from './api';
import type { ProjectMember } from '@/features/projects/membersApi';
import type { ProjectItem, ProjectDetail } from '@/features/projects/api';

// supabase をモック (BallDetailModal が useCurrentUser → getSession を辿るため)。
const getSession = vi.fn();
const onAuthStateChange = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: (...a: unknown[]) => getSession(...a),
      onAuthStateChange: (...a: unknown[]) => onAuthStateChange(...a),
    },
  },
}));

// sonner の toast を spy する。
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

// Radix Sheet/Select は jsdom に無い API を使うためシムを入れる。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
});

const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const ITEM_ID = '22222222-2222-2222-2222-222222222222';

const members: ProjectMember[] = [
  {
    id: '33333333-3333-3333-3333-333333333333',
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

const plan: Plan = {
  id: 'plan-1',
  itemId: ITEM_ID,
  planType: 'toss',
  title: '既存の予定',
  category: 'design',
  scheduledDate: '2026-06-21',
  dueDate: null,
  executor: null,
  approver: null,
  progressManager: null,
  fromMember: null,
  toMember: null,
  successorPlanId: null,
  status: 'active',
  memo: null,
  ballHolder: null,
  ballState: 'in_progress',
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
};

const plans: Plan[] = [plan];

function baseProps() {
  return {
    projectId: PROJECT_ID,
    members,
    plans,
    items,
    fallbackItemId: ITEM_ID,
  };
}

const projectDetail: ProjectDetail = {
  id: PROJECT_ID,
  name: '案件',
  startDate: '2026-06-01',
  endDate: '2026-07-01',
  status: 'active',
  archivedAt: null,
  role: 'director',
  clientName: null,
  progressManager: null,
  overdueCount: 0,
  createdBy: 'u1',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  counts: { memberCount: 1, itemCount: 1 },
};

function stubBallDetailEndpoints() {
  const detail: PlanDetail = { plan, events: [] };
  server.use(
    http.post('*/api/v1/auth/me/sync', () =>
      HttpResponse.json({
        data: {
          requiresProfileCompletion: false,
          user: {
            id: 'u1',
            email: 'taro@example.com',
            fullName: '山田 太郎',
            displayName: 'タロウ',
            primaryAuthMethod: 'password',
            createdAt: '2026-06-01T00:00:00.000Z',
          },
        },
      }),
    ),
    http.get(`*/api/v1/projects/${PROJECT_ID}`, () => HttpResponse.json({ data: projectDetail })),
    http.get(
      `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/plan-1`,
      () => HttpResponse.json({ data: detail }),
    ),
  );
}

beforeEach(() => {
  getSession.mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('PlanModalsHost', () => {
  it('modal パラメータが無ければ何も描画しない', () => {
    const { container } = renderWithProviders(<PlanModalsHost {...baseProps()} />, {
      route: '/projects/x',
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('modal=create-plan で CreatePlanModal (予定を追加) を描画する', async () => {
    renderWithProviders(<PlanModalsHost {...baseProps()} />, {
      route: `/projects/x?modal=create-plan&itemId=${ITEM_ID}`,
    });
    expect(await screen.findByText('予定を追加')).toBeInTheDocument();
  });

  it('modal=edit-plan + planId で CreatePlanModal (予定を編集) を対象 plan で初期化して描画する', async () => {
    renderWithProviders(<PlanModalsHost {...baseProps()} />, {
      route: '/projects/x?modal=edit-plan&planId=plan-1',
    });
    expect(await screen.findByText('予定を編集')).toBeInTheDocument();
    expect(screen.getByDisplayValue('既存の予定')).toBeInTheDocument();
  });

  it('modal=ball-detail + planId で BallDetailModal を描画し、対象 plan の詳細を取得して表示する', async () => {
    stubBallDetailEndpoints();
    renderWithProviders(<PlanModalsHost {...baseProps()} />, {
      route: '/projects/x?modal=ball-detail&planId=plan-1',
    });
    // SheetTitle に plan.title が出る
    expect(await screen.findByText('既存の予定')).toBeInTheDocument();
  });

  it('modal=ball-detail でも planId が無ければ何も描画しない', () => {
    const { container } = renderWithProviders(<PlanModalsHost {...baseProps()} />, {
      route: '/projects/x?modal=ball-detail',
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('ball-detail の「編集」を押すと onEdit で modal=edit-plan に切り替わり編集フォームを表示する', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubBallDetailEndpoints();
    renderWithProviders(<PlanModalsHost {...baseProps()} />, {
      route: '/projects/x?modal=ball-detail&planId=plan-1',
    });

    await screen.findByText('既存の予定');
    await user.click(screen.getByRole('button', { name: '編集' }));
    // onEdit が setParams で modal=edit-plan に切り替え、CreatePlanModal(編集) が出る
    expect(await screen.findByText('予定を編集')).toBeInTheDocument();
  });

  it('ball-detail の「複製」を押すと copy POST 後 onCopied で複製先の詳細へ切り替わる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    stubBallDetailEndpoints();
    const copied: Plan = { ...plan, id: 'plan-2', title: '複製された予定' };
    server.use(
      http.post(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/plan-1/copy`,
        () => HttpResponse.json({ data: copied }),
      ),
      http.get(
        `*/api/v1/projects/${PROJECT_ID}/items/${ITEM_ID}/plans/plan-2`,
        () => HttpResponse.json({ data: { plan: copied, events: [] } }),
      ),
    );

    renderWithProviders(<PlanModalsHost {...baseProps()} />, {
      route: '/projects/x?modal=ball-detail&planId=plan-1',
    });

    await screen.findByText('既存の予定');
    await user.click(screen.getByRole('button', { name: '複製' }));
    // onCopied が planId を複製先に差し替え、新しい詳細が描画される
    expect(await screen.findByText('複製された予定')).toBeInTheDocument();
  });

  it('CreatePlanModal を Escape で閉じると closeModal でクエリがクリアされ何も描画されなくなる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    const { container } = renderWithProviders(<PlanModalsHost {...baseProps()} />, {
      route: `/projects/x?modal=create-plan&itemId=${ITEM_ID}`,
    });

    await screen.findByText('予定を追加');
    await user.keyboard('{Escape}');
    // closeModal が modal パラメータを削除 → ホストは null を返す
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
