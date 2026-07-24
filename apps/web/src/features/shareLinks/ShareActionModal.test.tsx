import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { server } from '@/test/handlers';
import { renderWithProviders } from '@/test/render';
import type { MemberRef, Plan, PlanState } from '@/features/plans/api';

vi.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: vi.fn().mockResolvedValue({ data: { session: null } }) } },
}));

import { ShareActionModal } from './ShareActionModal';

beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
  p.setPointerCapture = vi.fn();
});

afterEach(() => vi.clearAllMocks());

const m = (over: Partial<MemberRef> = {}): MemberRef => ({
  id: 'm1',
  name: '山田',
  organizationName: 'Acme',
  memberType: 'production',
  ...over,
});

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'plan-1',
  itemId: 'it1',
  planType: 'toss',
  title: 'デザイン確認',
  category: 'review',
  scheduledDate: '2026-06-10',
  dueDate: null,
  executor: m({ id: 'ex', name: '実施者' }),
  approver: m({ id: 'ap', name: '承認者', memberType: 'client' }),
  progressManager: m({ id: 'pm', name: '進行' }),
  fromMember: null,
  toMember: null,
  successorPlanId: 'succ',
  status: 'active',
  memo: null,
  ballHolder: m({ id: 'ex', name: '実施者' }),
  ballState: 'in_progress' as PlanState,
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

describe('ShareActionModal', () => {
  it('実施中(承認者あり)は「確認依頼」を表示し、TOSSは出さない', () => {
    renderWithProviders(
      <ShareActionModal token="tok" plan={plan({ ballState: 'in_progress' })} onClose={() => {}} />,
    );
    expect(screen.getByRole('button', { name: '確認依頼' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TOSS' })).not.toBeInTheDocument();
  });

  it('確認待ちは「承認」「差し戻す」を表示する', () => {
    renderWithProviders(
      <ShareActionModal token="tok" plan={plan({ ballState: 'review_pending' })} onClose={() => {}} />,
    );
    expect(screen.getByRole('button', { name: '承認' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '差し戻す' })).toBeInTheDocument();
  });

  it('承認済み(TOSS待ち)はクライアントの操作を出さない', () => {
    renderWithProviders(
      <ShareActionModal token="tok" plan={plan({ ballState: 'approved' })} onClose={() => {}} />,
    );
    expect(
      screen.getByText('この予定に対してクライアントが行える操作はありません。'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'TOSS' })).not.toBeInTheDocument();
  });

  it('「承認」クリックで approve エンドポイントを呼び、onClose される', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    let called = false;
    server.use(
      http.post('*/api/v1/share/:token/plans/:planId/approve', () => {
        called = true;
        return HttpResponse.json({ data: { plan: plan({ ballState: 'approved' }) } });
      }),
    );
    const onClose = vi.fn();
    renderWithProviders(
      <ShareActionModal token="tok" plan={plan({ ballState: 'review_pending' })} onClose={onClose} />,
    );
    await user.click(screen.getByRole('button', { name: '承認' }));
    await waitFor(() => expect(called).toBe(true));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});
