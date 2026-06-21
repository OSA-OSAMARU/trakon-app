import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { getDashboard as GetDashboardType } from './dashboard.js';

// =============================================================================
// Mocks
// =============================================================================
// Prisma を in-memory ストアでモックする。getDashboard は
//   - prisma.project.findMany (members[] / items[] を include)
//   - prisma.plan.findMany (ballEvents[] を include)
// のみ呼ぶため、その 2 つだけ実装すればよい。
// deriveBallHolder / pickLatestBallEvent は @trakon/shared の実物を使う (モックしない)。

type MockMember = {
  id: string;
  name: string;
  organizationName: string;
  memberType: string;
};

type MockItem = { id: string; name: string };

type MockProject = {
  id: string;
  name: string;
  members: MockMember[];
  items: MockItem[];
};

type MockBallEvent = {
  eventType: string;
  source: string;
  occurredAt: Date;
};

type MockPlan = {
  id: string;
  itemId: string;
  title: string;
  category: string;
  status: string;
  fromMemberId: string | null;
  toMemberId: string | null;
  scheduledDate: Date | null;
  dueDate: Date | null;
  ballEvents: MockBallEvent[];
};

// テストごとに差し替えるストア。
let projectStore: MockProject[] = [];
let planStore: MockPlan[] = [];

const prismaMock = {
  project: {
    findMany: vi.fn(async () => projectStore),
  },
  plan: {
    // include.ballEvents は occurredAt desc / take:1 だが、サービスは
    // pickLatestBallEvent で最新を選び直すため、ストアの ballEvents をそのまま返す。
    findMany: vi.fn(async () => planStore),
  },
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// =============================================================================
// Helpers
// =============================================================================

const member = (over: Partial<MockMember> & { id: string }): MockMember => ({
  name: `member-${over.id}`,
  organizationName: `org-${over.id}`,
  memberType: 'production',
  ...over,
});

const project = (over: Partial<MockProject> & { id: string }): MockProject => ({
  name: `project-${over.id}`,
  members: [],
  items: [],
  ...over,
});

const plan = (over: Partial<MockPlan> & { id: string; itemId: string }): MockPlan => ({
  title: `plan-${over.id}`,
  category: 'design',
  status: 'active',
  fromMemberId: null,
  toMemberId: null,
  scheduledDate: new Date('2026-06-20T00:00:00Z'),
  dueDate: null,
  ballEvents: [],
  ...over,
});

// =============================================================================
// Tests
// =============================================================================

let getDashboard: typeof GetDashboardType;

beforeAll(async () => {
  ({ getDashboard } = await import('./dashboard.js'));
});

afterEach(() => {
  projectStore = [];
  planStore = [];
  vi.clearAllMocks();
});

describe('getDashboard', () => {
  it('プロジェクトが無い場合は空サマリを返す (plan.findMany は呼ばない)', async () => {
    projectStore = [];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: { today: '2026-06-21' },
    });

    expect(res).toEqual({
      today: '2026-06-21',
      summary: { todayTaskCount: 0, overdueCount: 0 },
      projects: [],
    });
    // 早期 return のため plan は問い合わせない。
    expect(prismaMock.plan.findMany).not.toHaveBeenCalled();
  });

  it('item が無いプロジェクトのみだと plan.findMany を呼ばず空 projects を返す', async () => {
    projectStore = [project({ id: 'p-1', members: [member({ id: 'm-1' })], items: [] })];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: { today: '2026-06-21' },
    });

    expect(res.projects).toEqual([]);
    expect(res.summary).toEqual({ todayTaskCount: 0, overdueCount: 0 });
    // itemIds が空なので plan は問い合わせない。
    expect(prismaMock.plan.findMany).not.toHaveBeenCalled();
  });

  it('item はあるが該当 plan が無い場合は空 projects を返す', async () => {
    projectStore = [
      project({
        id: 'p-1',
        members: [member({ id: 'm-1' })],
        items: [{ id: 'it-1', name: 'Top' }],
      }),
    ];
    planStore = [];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: { today: '2026-06-21' },
    });

    expect(prismaMock.plan.findMany).toHaveBeenCalledTimes(1);
    expect(res.projects).toEqual([]);
    expect(res.summary).toEqual({ todayTaskCount: 0, overdueCount: 0 });
  });

  it('ball 状態 (ready / tossed) を導出し、completed と holder=null は除外する', async () => {
    projectStore = [
      project({
        id: 'p-1',
        members: [
          member({ id: 'm-from', name: 'From太郎', memberType: 'client' }),
          member({ id: 'm-to', name: 'To花子', memberType: 'production' }),
        ],
        items: [{ id: 'it-1', name: '制作物1' }],
      }),
    ];
    planStore = [
      // ready: イベント未発生 → from が holder
      plan({
        id: 'pl-ready',
        itemId: 'it-1',
        fromMemberId: 'm-from',
        toMemberId: 'm-to',
        category: 'coding',
      }),
      // tossed: 最新 tossed → to が holder
      plan({
        id: 'pl-tossed',
        itemId: 'it-1',
        fromMemberId: 'm-from',
        toMemberId: 'm-to',
        ballEvents: [
          { eventType: 'tossed', source: 'human', occurredAt: new Date('2026-06-19T01:00:00Z') },
        ],
      }),
      // completed: 最新 completed → 除外される
      plan({
        id: 'pl-completed',
        itemId: 'it-1',
        fromMemberId: 'm-from',
        toMemberId: 'm-to',
        ballEvents: [
          { eventType: 'completed', source: 'human', occurredAt: new Date('2026-06-19T02:00:00Z') },
        ],
      }),
      // holder=null: from も to も null → 除外される (ready だが memberId が null)
      plan({
        id: 'pl-nullholder',
        itemId: 'it-1',
        fromMemberId: null,
        toMemberId: null,
      }),
    ];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: { today: '2026-06-21' },
    });

    // ready は m-from、tossed は m-to に振り分けられ、completed と null は消える。
    expect(res.summary.todayTaskCount).toBe(2);
    expect(res.projects).toHaveLength(1);
    const sections = res.projects[0]!.memberSections;
    // タスクを持つ member のみ。members 配列順 (m-from, m-to) を維持。
    expect(sections.map((s) => s.member.id)).toEqual(['m-from', 'm-to']);

    const fromSection = sections.find((s) => s.member.id === 'm-from')!;
    expect(fromSection.tasks).toHaveLength(1);
    expect(fromSection.tasks[0]).toMatchObject({
      planId: 'pl-ready',
      ballState: 'ready',
      itemName: '制作物1',
      itemId: 'it-1',
      projectId: 'p-1',
      category: 'coding',
      scheduledDate: '2026-06-20',
      isOverdue: false,
    });
    expect(fromSection.member).toMatchObject({ name: 'From太郎', memberType: 'client' });

    const toSection = sections.find((s) => s.member.id === 'm-to')!;
    expect(toSection.tasks[0]).toMatchObject({ planId: 'pl-tossed', ballState: 'tossed' });
  });

  it('pickLatestBallEvent: 最新イベントで状態が決まる (toss_undone → ready)', async () => {
    projectStore = [
      project({
        id: 'p-1',
        members: [member({ id: 'm-from' }), member({ id: 'm-to' })],
        items: [{ id: 'it-1', name: 'I' }],
      }),
    ];
    planStore = [
      plan({
        id: 'pl-undone',
        itemId: 'it-1',
        fromMemberId: 'm-from',
        toMemberId: 'm-to',
        // 順序を入れ替えても occurredAt で最新 (toss_undone) が選ばれる。
        ballEvents: [
          { eventType: 'toss_undone', source: 'human', occurredAt: new Date('2026-06-19T05:00:00Z') },
          { eventType: 'tossed', source: 'human', occurredAt: new Date('2026-06-19T03:00:00Z') },
        ],
      }),
    ];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: { today: '2026-06-21' },
    });

    const section = res.projects[0]!.memberSections[0]!;
    // toss_undone が最新 → from に戻り ready
    expect(section.member.id).toBe('m-from');
    expect(section.tasks[0]!.ballState).toBe('ready');
  });

  it('dueDate < today の予定を overdue として数える', async () => {
    projectStore = [
      project({
        id: 'p-1',
        members: [member({ id: 'm-1' })],
        items: [{ id: 'it-1', name: 'I' }],
      }),
    ];
    planStore = [
      // overdue: dueDate が today より前
      plan({
        id: 'pl-overdue',
        itemId: 'it-1',
        fromMemberId: 'm-1',
        dueDate: new Date('2026-06-20T00:00:00Z'),
      }),
      // not overdue: dueDate == today
      plan({
        id: 'pl-due-today',
        itemId: 'it-1',
        fromMemberId: 'm-1',
        dueDate: new Date('2026-06-21T00:00:00Z'),
      }),
      // dueDate なし → overdue でない
      plan({
        id: 'pl-no-due',
        itemId: 'it-1',
        fromMemberId: 'm-1',
        dueDate: null,
      }),
    ];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: { today: '2026-06-21' },
    });

    expect(res.summary.todayTaskCount).toBe(3);
    expect(res.summary.overdueCount).toBe(1);
    const tasks = res.projects[0]!.memberSections[0]!.tasks;
    expect(tasks.find((t) => t.planId === 'pl-overdue')).toMatchObject({
      isOverdue: true,
      dueDate: '2026-06-20',
    });
    expect(tasks.find((t) => t.planId === 'pl-due-today')).toMatchObject({
      isOverdue: false,
      dueDate: '2026-06-21',
    });
    expect(tasks.find((t) => t.planId === 'pl-no-due')).toMatchObject({
      isOverdue: false,
      dueDate: null,
    });
  });

  it('query.today 省略時は JST の今日を today に使う', async () => {
    // JST 現在日付を計算 (サービスと同じロジック)。
    const jstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

    projectStore = [];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: {},
    });

    expect(res.today).toBe(jstToday);
  });

  it('別 item に属する plan を持つ複数プロジェクトを正しく振り分ける', async () => {
    projectStore = [
      project({
        id: 'p-1',
        members: [member({ id: 'm-1' })],
        items: [{ id: 'it-1', name: 'I1' }],
      }),
      // タスクの無いプロジェクトは projects から除外される。
      project({
        id: 'p-2',
        members: [member({ id: 'm-2' })],
        items: [{ id: 'it-2', name: 'I2' }],
      }),
    ];
    planStore = [
      plan({ id: 'pl-1', itemId: 'it-1', fromMemberId: 'm-1' }),
      // 存在しない item を参照する plan は itemMap に無いためスキップされる。
      plan({ id: 'pl-orphan', itemId: 'it-missing', fromMemberId: 'm-1' }),
    ];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: { today: '2026-06-21' },
    });

    // p-2 はタスクが無いので除外、orphan plan は集計されない。
    expect(res.projects.map((p) => p.id)).toEqual(['p-1']);
    expect(res.summary.todayTaskCount).toBe(1);
  });
});
