import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { MemberRef, Plan, PlanState } from '@/features/plans/api';
import { SharePlanDetailSheet } from './SharePlanDetailSheet';

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
  colorTheme: null,
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

describe('SharePlanDetailSheet', () => {
  it('予定の内容と担当を閲覧できる', () => {
    render(<SharePlanDetailSheet plan={plan({ memo: '入稿データ待ち' })} onClose={() => {}} />);

    expect(screen.getByText('デザイン確認')).toBeInTheDocument();
    expect(screen.getByText('実施者 (Acme)')).toBeInTheDocument();
    expect(screen.getByText('承認者 (Acme)')).toBeInTheDocument();
    expect(screen.getByText('進行 (Acme)')).toBeInTheDocument();
    expect(screen.getByText('入稿データ待ち')).toBeInTheDocument();
    expect(screen.getByText('実施中')).toBeInTheDocument();
  });

  it('データを変える操作は 1 つも出さない (#257)', () => {
    render(<SharePlanDetailSheet plan={plan({ ballState: 'review_pending' })} onClose={() => {}} />);

    // #131 で出していた確認依頼 / 承認 / 差し戻しは全プランで廃止
    for (const label of ['確認依頼', '承認', '差し戻す', 'TOSS']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.getByText(/この共有リンクは閲覧専用です/)).toBeInTheDocument();
  });

  it('確認待ちでも状態を表示するだけ', () => {
    render(<SharePlanDetailSheet plan={plan({ ballState: 'review_pending' })} onClose={() => {}} />);

    expect(screen.getByText('確認待ち')).toBeInTheDocument();
  });

  it('閉じる操作で onClose が呼ばれる', async () => {
    const onClose = vi.fn();
    const userEvent = (await import('@testing-library/user-event')).default;
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(<SharePlanDetailSheet plan={plan()} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '閉じる' }));
    expect(onClose).toHaveBeenCalled();
  });
});
