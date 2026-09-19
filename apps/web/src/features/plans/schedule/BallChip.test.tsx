import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addDays, format } from 'date-fns';

import type { MemberRef, Plan } from '../api';
import type { ProjectMember } from '@/features/projects/membersApi';
import { BallChip } from './BallChip';

beforeAll(() => {
  const el = window.HTMLElement.prototype;
  el.scrollIntoView = vi.fn();
  el.hasPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const TODAY = new Date('2026-07-01T00:00:00.000Z');
const DAYS = Array.from({ length: 7 }, (_, i) => addDays(TODAY, i));
const iso = (offset: number) => format(addDays(TODAY, offset), 'yyyy-MM-dd');

const member: MemberRef = {
  id: 'm1',
  name: '杉野 遥',
  organizationName: '余白デザイン室',
  memberType: 'production',
};

const plan = (scheduledDate: string, dueDate: string | null): Plan => ({
  id: 'p1',
  itemId: 'i1',
  title: '予定',
  planType: 'toss',
  category: 'design',
  colorTheme: null,
  scheduledDate,
  dueDate,
  executor: member,
  approver: null,
  progressManager: null,
  fromMember: null,
  toMember: null,
  successorPlanId: null,
  status: 'active',
  memo: null,
  ballHolder: member,
  ballState: 'in_progress',
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
});

function chipOf(p: Plan) {
  const { container } = render(
    <BallChip plan={p} days={DAYS} rowHeight={40} laneWidth={240} lane={0} today={TODAY} />,
  );
  const el = container.querySelector('[data-plan-id="p1"]');
  if (!el) throw new Error('chip not rendered');
  return el;
}

describe('BallChip の上下パディング', () => {
  it('単日の予定はパディングを畳んでタイトルを上下中央に置く', () => {
    // 高さ = 1日 * 40 - インセット 8 = 32px。Figma の 11/12px を入れると
    // タイトル 1 行 (20px) が収まらず下端へ押し出されるため中央寄せに切り替える。
    const el = chipOf(plan(iso(0), iso(0)));
    expect(el.className).toContain('justify-center');
    expect(el.className).not.toContain('pt-[11px]');
  });

  it('高さが足りる予定は Figma どおりの上下パディングを保つ', () => {
    // 高さ = 3日 * 40 - 8 = 112px。
    const el = chipOf(plan(iso(0), iso(2)));
    expect(el.className).toContain('pt-[11px]');
    expect(el.className).not.toContain('justify-center');
  });
});

// =============================================================================
// 担当者のホバープロフィール (#159)
// =============================================================================

const profile: ProjectMember = {
  id: 'm1',
  userId: 'u1',
  name: '杉野 遥',
  email: 'sugino@example.jp',
  organizationName: '余白デザイン室',
  memberType: 'production',
  jobTitle: 'designer',
  avatarUrl: null,
  roleType: 'editor',
  sortOrder: 0,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

/** 役割行が出る高さ (tier=normal) の予定。 */
const tallPlan = () => plan(iso(0), iso(4));

describe('担当者のホバープロフィール (#159)', () => {
  it('memberById を渡すとホバーでプロフィールが出る', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <BallChip
        plan={tallPlan()}
        days={DAYS}
        rowHeight={40}
        laneWidth={240}
        lane={0}
        today={TODAY}
        memberById={new Map([[profile.id, profile]])}
      />,
    );

    await user.hover(screen.getByText('杉野 遥'));
    expect(await screen.findByText('sugino@example.jp')).toBeInTheDocument();
  });

  it('memberById が無ければホバーしても何も出ない (共有リンク画面の経路)', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    render(
      <BallChip
        plan={tallPlan()}
        days={DAYS}
        rowHeight={40}
        laneWidth={240}
        lane={0}
        today={TODAY}
      />,
    );

    await user.hover(screen.getByText('杉野 遥'));
    expect(screen.queryByText('sugino@example.jp')).not.toBeInTheDocument();
  });
});

// =============================================================================
// サイズ別の表示項目 (Figma「05 Schedule Card」node 308:90)
// =============================================================================

function renderChip(p: Plan, withMembers = false) {
  return render(
    <BallChip
      plan={p}
      days={DAYS}
      rowHeight={40}
      laneWidth={240}
      lane={0}
      today={TODAY}
      memberById={withMembers ? new Map([[profile.id, profile]]) : undefined}
    />,
  );
}

describe('サイズ別の表示項目 (node 308:90)', () => {
  it('small は タイトル + 姓 だけを出す', () => {
    // 高さ = 1日 * 40 - 8 = 32px → small。
    renderChip(plan(iso(0), iso(0)));

    expect(screen.getByText('予定')).toBeInTheDocument();
    expect(screen.getByText('杉野')).toBeInTheDocument(); // 姓のみ
    expect(screen.queryByText('杉野 遥')).not.toBeInTheDocument();
    expect(screen.queryByText('デザイン')).not.toBeInTheDocument(); // 工程は出さない
  });

  it('medium は 工程・日付 と 氏名 を出すが権限区分は出さない', () => {
    // 高さ = 5日 * 40 - 8 = 192px → medium。
    renderChip(plan(iso(0), iso(4)), true);

    expect(screen.getByText('デザイン')).toBeInTheDocument();
    expect(screen.getByText('杉野 遥')).toBeInTheDocument();
    expect(screen.queryByText('編集者')).not.toBeInTheDocument();
    expect(screen.queryByText('BALL HOLDER')).not.toBeInTheDocument();
  });

  it('large は BALL HOLDER ラベルと権限区分まで出す', () => {
    // 高さ = 6日 * 40 - 8 = 232px → large。
    renderChip(plan(iso(0), iso(5)), true);

    expect(screen.getByText('BALL HOLDER')).toBeInTheDocument();
    expect(screen.getByText('杉野 遥')).toBeInTheDocument();
    expect(screen.getByText('編集者')).toBeInTheDocument();
  });

  it('FIX は Ball Holder 表示を「FIX」の文字へ差し替える', () => {
    renderChip({ ...plan(iso(0), iso(4)), status: 'completed', ballState: 'completed' }, true);

    expect(screen.getByText('FIX')).toBeInTheDocument();
    expect(screen.queryByText('杉野 遥')).not.toBeInTheDocument();
  });

  it('進行状態のアイコンと pill はカードに出さない', () => {
    // ガイドの「ICON：進行状態ICONは使用しない」「Pill：原則不使用」。
    renderChip(plan(iso(0), iso(4)));

    expect(screen.queryByText('実施中')).not.toBeInTheDocument();
    expect(screen.queryByText('確認待ち')).not.toBeInTheDocument();
  });
});
