import { beforeAll, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import type { MemberRef, Plan } from '@/features/plans/api';
import { ShareSchedule } from './ShareSchedule';

// supabase はモックして実 env / 実クライアント生成を回避する
// (ShareSchedule 自体は使わないが import 経路で参照され得るため)。
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

// Radix / jsdom が未実装の API を shim する。
beforeAll(() => {
  const p = window.HTMLElement.prototype;
  p.scrollIntoView = vi.fn();
  p.hasPointerCapture = vi.fn();
  p.releasePointerCapture = vi.fn();
  p.setPointerCapture = vi.fn();
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

// -----------------------------------------------------------------------------
// テストデータ
// -----------------------------------------------------------------------------

const memberRef = (over: Partial<MemberRef> = {}): MemberRef => ({
  id: 'm1',
  name: '山田 太郎',
  organizationName: 'Acme',
  memberType: 'production',
  ...over,
});

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'plan-1',
  itemId: 'it1',
  planType: 'toss',
  title: 'デザイン作成',
  category: 'design',
  scheduledDate: '2026-06-10',
  dueDate: null,
  executor: memberRef(),
  approver: memberRef({ id: 'm2', name: '鈴木 花子', memberType: 'client' }),
  progressManager: memberRef(),
  fromMember: memberRef(),
  toMember: memberRef({ id: 'm2', name: '鈴木 花子', memberType: 'client' }),
  successorPlanId: null,
  status: 'active',
  memo: null,
  ballHolder: memberRef(),
  ballState: 'in_progress',
  latestEvent: null,
  completedAt: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
  ...over,
});

const project = { startDate: '2026-06-01', endDate: '2026-06-30' };
const items = [
  { id: 'it1', name: 'LP制作' },
  { id: 'it2', name: 'バナー' },
];

// -----------------------------------------------------------------------------

describe('ShareSchedule (閲覧専用)', () => {
  it('プロジェクト期間が未設定 (start=end でない不正) なら期間メッセージを表示する', () => {
    // endDate < startDate で count = 0 になる。
    renderWithProviders(
      <ShareSchedule
        project={{ startDate: '2026-06-30', endDate: '2026-06-01' }}
        items={items}
        plans={[]}
      />,
    );
    expect(
      screen.getByText('プロジェクト期間が設定されていません。'),
    ).toBeInTheDocument();
  });

  it('制作物が無い場合は専用メッセージを表示する', () => {
    renderWithProviders(<ShareSchedule project={project} items={[]} plans={[]} />);
    expect(screen.getByText('表示できる制作物がありません。')).toBeInTheDocument();
  });

  it('日付軸と制作物列ヘッダ (名前 / 件数 / ボール保持者) を描画する', () => {
    const p = plan({
      id: 'p1',
      itemId: 'it1',
      ballHolder: memberRef({ name: '山田 太郎', organizationName: 'Acme' }),
    });
    renderWithProviders(<ShareSchedule project={project} items={items} plans={[p]} />);

    // 制作物名。
    expect(screen.getByText('LP制作')).toBeInTheDocument();
    expect(screen.getByText('バナー')).toBeInTheDocument();
    // 件数バッジ (it1 は 1 件, it2 は 0 件)。
    expect(screen.getByText('1件')).toBeInTheDocument();
    expect(screen.getByText('0件')).toBeInTheDocument();
    // ボール保持者 (organizationName あり → "組織 氏名")。
    expect(screen.getByText('Acme 山田 太郎')).toBeInTheDocument();
    // ボール保持ラベルが各列に出る。
    expect(screen.getAllByText('ボール保持:').length).toBe(2);
    // 保持者が居ない列は "—"。
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('organizationName が空のボール保持者は氏名のみ表示する', () => {
    const p = plan({
      id: 'p1',
      ballHolder: memberRef({ name: '田中 一郎', organizationName: '' }),
    });
    renderWithProviders(<ShareSchedule project={project} items={[items[0]!]} plans={[p]} />);
    expect(screen.getByText('田中 一郎')).toBeInTheDocument();
  });

  it('normal tier (長期間) のボールは実施者 / 保持者を表示する', () => {
    // rowHeight=40, 4日span → height=157 ≥ 120 → normal tier。
    // #131: FROM/TO は TOSS 履歴のため、カード表示は 実施者(executor) + 保持者(ballHolder)。
    const p = plan({
      id: 'p1',
      title: '長期タスク',
      scheduledDate: '2026-06-10',
      dueDate: '2026-06-13',
      executor: memberRef({ name: '実施 太郎' }),
      ballHolder: memberRef({ id: 'm2', name: '確認 花子' }),
      ballState: 'in_progress',
    });
    renderWithProviders(<ShareSchedule project={project} items={[items[0]!]} plans={[p]} />);

    expect(screen.getByText('長期タスク')).toBeInTheDocument();
    expect(screen.getByText('実施者')).toBeInTheDocument();
    expect(screen.getByText('保持者')).toBeInTheDocument();
    expect(screen.getByText('実施 太郎')).toBeInTheDocument();
    // 保持者名 (カード内 + 列ヘッダーのボール保持) で複数出る。
    expect(screen.getAllByText('確認 花子').length).toBeGreaterThanOrEqual(1);
    // カテゴリラベル (normal/compact tier で表示)。
    expect(screen.getByText('デザイン')).toBeInTheDocument();
  });

  it('mini tier (1日) のボールはタイトルのみでカテゴリ詳細を描画しない', () => {
    // rowHeight=40, 1日span → height=37 < 80 → mini tier (詳細非表示)。
    const p = plan({ id: 'p1', title: '短期タスク', category: 'coding' });
    renderWithProviders(<ShareSchedule project={project} items={[items[0]!]} plans={[p]} />);

    expect(screen.getByText('短期タスク')).toBeInTheDocument();
    // mini ではカテゴリラベルや実施者表記が出ない。
    expect(screen.queryByText('コーディング')).not.toBeInTheDocument();
    expect(screen.queryByText('実施者')).not.toBeInTheDocument();
  });

  it('完了 / tossed / overdue のボール状態でスタイル分岐を網羅する', () => {
    const completed = plan({
      id: 'done',
      title: '完了ボール',
      status: 'completed',
      ballState: 'completed',
      scheduledDate: '2026-06-05',
      dueDate: '2026-06-08',
    });
    const tossed = plan({
      id: 'toss',
      title: 'トス済ボール',
      ballState: 'tossed',
      scheduledDate: '2026-06-12',
      dueDate: '2026-06-15',
    });
    const overdue = plan({
      id: 'od',
      title: '期限切れボール',
      ballState: 'in_progress',
      scheduledDate: '2026-06-02',
      dueDate: '2026-06-02', // 過去 (today=2026-06-21 以降想定) → overdue
    });
    renderWithProviders(
      <ShareSchedule project={project} items={[items[0]!]} plans={[completed, tossed, overdue]} />,
    );

    expect(screen.getByText('完了ボール')).toBeInTheDocument();
    expect(screen.getByText('トス済ボール')).toBeInTheDocument();
    expect(screen.getByText('期限切れボール')).toBeInTheDocument();
    // 完了チェックアイコンが描画される (svg)。
    const completedTitle = screen.getByText('完了ボール');
    const card = completedTitle.closest('div')?.parentElement;
    expect(card?.querySelector('svg')).toBeTruthy();
  });

  it('後続リンク (successorPlanId) を SVG パスとして描画する', () => {
    const a = plan({
      id: 'a',
      itemId: 'it1',
      title: '前工程',
      scheduledDate: '2026-06-03',
      dueDate: '2026-06-04',
      successorPlanId: 'b',
    });
    const b = plan({
      id: 'b',
      itemId: 'it1',
      title: '後工程',
      scheduledDate: '2026-06-10',
      dueDate: '2026-06-11',
    });
    const { container } = renderWithProviders(
      <ShareSchedule project={project} items={[items[0]!]} plans={[a, b]} />,
    );

    // LinkLayer の SVG marker (share-succ-arrow) が定義され、path が描画される。
    expect(container.querySelector('#share-succ-arrow')).toBeTruthy();
    expect(container.querySelector('path[marker-end]')).toBeTruthy();
  });

  it('別制作物 / 未ロードの successor はリンクを描画しない', () => {
    const a = plan({
      id: 'a',
      itemId: 'it1',
      successorPlanId: 'missing', // 存在しない後続
      scheduledDate: '2026-06-03',
    });
    const { container } = renderWithProviders(
      <ShareSchedule project={project} items={[items[0]!]} plans={[a]} />,
    );
    // links が空なので LinkLayer は null を返し、矢印 marker は描画されない。
    expect(container.querySelector('#share-succ-arrow')).toBeFalsy();
  });

  it('ズームコントロールで行の高さを拡大 / 縮小できる', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 });
    renderWithProviders(<ShareSchedule project={project} items={[items[0]!]} plans={[]} />);

    // 既定 40px。
    expect(screen.getByText('40px')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '拡大' }));
    expect(screen.getByText('45px')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '縮小' }));
    await user.click(screen.getByRole('button', { name: '縮小' }));
    expect(screen.getByText('35px')).toBeInTheDocument();
  });

  it('range スライダーで行の高さを直接変更できる', () => {
    renderWithProviders(<ShareSchedule project={project} items={[items[0]!]} plans={[]} />);
    const slider = screen.getByRole('slider', { name: '行の高さ' });
    // fireEvent 相当: input の change を発火。
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    set.call(slider, '20');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(screen.getByText('20px')).toBeInTheDocument();
  });

  it('rowHeight が小さい (<30) と日付軸の曜日ラベルを省略する', () => {
    renderWithProviders(<ShareSchedule project={project} items={[items[0]!]} plans={[]} />);
    const slider = screen.getByRole('slider', { name: '行の高さ' });
    const set = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    // 最小 20px に縮小 → 曜日ラベル (rowHeight>=30) 非表示分岐へ。
    set.call(slider, '20');
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(screen.getByText('20px')).toBeInTheDocument();
    // 6/1 の日付ラベルは残る。
    expect(screen.getByText('6/1')).toBeInTheDocument();
  });

  it('複数制作物にまたがる plans を制作物ごとに振り分ける', () => {
    const p1 = plan({ id: 'p1', itemId: 'it1', title: 'LPの予定' });
    const p2 = plan({ id: 'p2', itemId: 'it2', title: 'バナーの予定' });
    renderWithProviders(<ShareSchedule project={project} items={items} plans={[p1, p2]} />);

    const lp = screen.getByText('LP制作').closest('div')!.parentElement!.parentElement!;
    expect(within(lp).getByText('LPの予定')).toBeInTheDocument();
  });
});
