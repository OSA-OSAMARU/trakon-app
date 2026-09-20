import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Plan } from '../api';
import { CalendarMonthView } from './CalendarMonthView';

const TODAY = new Date('2026-09-20T00:00:00');
const SEPTEMBER = new Date('2026-09-01T00:00:00');

function plan(over: Partial<Plan> & { id: string; scheduledDate: string }): Plan {
  return {
    itemId: 'item-1',
    planType: 'toss',
    title: `予定 ${over.id}`,
    category: 'design',
    colorTheme: null,
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
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    ...over,
  } as Plan;
}

function renderView(plans: Plan[], onSelectPlan = vi.fn()) {
  render(
    <CalendarMonthView
      plans={plans}
      itemNameById={new Map([['item-1', 'トップページ']])}
      today={TODAY}
      initialMonth={SEPTEMBER}
      onSelectPlan={onSelectPlan}
    />,
  );
  return { onSelectPlan };
}

describe('CalendarMonthView', () => {
  it('月と曜日の見出しを出す', () => {
    renderView([]);
    expect(screen.getByText('2026年9月')).toBeInTheDocument();
    for (const w of ['日', '月', '火', '水', '木', '金', '土']) {
      expect(screen.getByText(w)).toBeInTheDocument();
    }
  });

  it('予定が無い月はそう言う (読み込み中と区別する)', () => {
    renderView([]);
    expect(screen.getByText('この月に予定はありません。')).toBeInTheDocument();
  });

  it('予定を日付のセルに出す', () => {
    renderView([plan({ id: 'p1', title: 'Webデザイン', scheduledDate: '2026-09-08' })]);
    expect(
      screen.getByRole('button', { name: /9月8日 Webデザイン \/ トップページ/ }),
    ).toBeInTheDocument();
  });

  it('期間のある予定は跨る日すべてに出す', () => {
    renderView([
      plan({ id: 'p1', title: '撮影', scheduledDate: '2026-09-08', dueDate: '2026-09-10' }),
    ]);
    // 同じ予定が 3 日分出る
    expect(screen.getAllByRole('button', { name: /撮影/ })).toHaveLength(3);
  });

  it('押すと予定を返す (詳細は既存のドロワーへ委ねる)', async () => {
    const onSelect = vi.fn();
    renderView([plan({ id: 'p1', title: 'Webデザイン', scheduledDate: '2026-09-08' })], onSelect);

    await userEvent.click(screen.getByRole('button', { name: /Webデザイン/ }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }));
  });

  it('期限超過を月の合計として先に伝える', () => {
    // グリッドを走査しなくても「今月は滞っている」が分かるようにする
    renderView([
      plan({ id: 'late', scheduledDate: '2026-09-10', dueDate: '2026-09-12' }),
      plan({ id: 'ok', scheduledDate: '2026-09-22', dueDate: '2026-09-25' }),
    ]);

    expect(screen.getByText('期限超過 1 件')).toBeInTheDocument();
  });

  it('跨る予定を重複して数えない', () => {
    renderView([plan({ id: 'late', scheduledDate: '2026-09-10', dueDate: '2026-09-12' })]);
    // 3 日に跨っていても予定は 1 件
    expect(screen.getByText('期限超過 1 件')).toBeInTheDocument();
  });

  it('期限超過が無ければ警告を出さない', () => {
    renderView([plan({ id: 'ok', scheduledDate: '2026-09-22', dueDate: '2026-09-25' })]);
    expect(screen.queryByText(/期限超過/)).not.toBeInTheDocument();
  });

  it('期限超過の予定は読み上げにも印を付ける', () => {
    renderView([plan({ id: 'late', title: '遅延', scheduledDate: '2026-09-12' })]);
    expect(screen.getAllByRole('button', { name: /遅延 \/ トップページ \(期限超過\)/ }).length,
    ).toBeGreaterThan(0);
  });

  it('1 日に多すぎる予定は畳む (行の高さを揃えるため)', () => {
    renderView(
      Array.from({ length: 5 }, (_, i) =>
        plan({ id: `p${i}`, title: `予定${i}`, scheduledDate: '2026-09-08' }),
      ),
    );

    expect(screen.getByText('他 2 件')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /予定4/ })).not.toBeInTheDocument();
  });

  it('月を前後に送れる', async () => {
    const user = userEvent.setup();
    renderView([]);

    await user.click(screen.getByRole('button', { name: '次の月' }));
    expect(screen.getByText('2026年10月')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '前の月' }));
    await user.click(screen.getByRole('button', { name: '前の月' }));
    expect(screen.getByText('2026年8月')).toBeInTheDocument();
  });

  it('「今月」で今日の月へ戻れる', async () => {
    const user = userEvent.setup();
    renderView([]);

    await user.click(screen.getByRole('button', { name: '次の月' }));
    await user.click(screen.getByRole('button', { name: '今月' }));

    expect(screen.getByText('2026年9月')).toBeInTheDocument();
  });

  it('日程変更の操作は持たない (閲覧専用)', () => {
    // 同じ操作の実装が 2 系統になると片方だけ直る事故が起きる
    renderView([plan({ id: 'p1', title: 'Webデザイン', scheduledDate: '2026-09-08' })]);
    const chip = screen.getByRole('button', { name: /Webデザイン/ });
    expect(chip).not.toHaveAttribute('draggable', 'true');
  });
});
