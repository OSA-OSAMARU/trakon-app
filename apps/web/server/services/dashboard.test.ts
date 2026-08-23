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
  // 役割 (#131)
  executorMemberId: string | null;
  approverMemberId: string | null;
  progressManagerMemberId: string | null;
  // TOSS 履歴スナップショット
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
  executorMemberId: null,
  approverMemberId: null,
  progressManagerMemberId: null,
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

  it('ball 状態を導出し、completed / tossed / holder=null は除外する', async () => {
    projectStore = [
      project({
        id: 'p-1',
        members: [
          member({ id: 'm-exec', name: 'Exec太郎', memberType: 'client' }),
          member({ id: 'm-to', name: 'To花子', memberType: 'production' }),
        ],
        items: [{ id: 'it-1', name: '制作物1' }],
      }),
    ];
    planStore = [
      // in_progress: イベント未発生 → 実施者が holder
      plan({
        id: 'pl-inprogress',
        itemId: 'it-1',
        executorMemberId: 'm-exec',
        toMemberId: 'm-to',
        category: 'coding',
      }),
      // tossed: 最新 tossed → toMember が holder
      plan({
        id: 'pl-tossed',
        itemId: 'it-1',
        executorMemberId: 'm-exec',
        toMemberId: 'm-to',
        ballEvents: [
          { eventType: 'tossed', source: 'human', occurredAt: new Date('2026-06-19T01:00:00Z') },
        ],
      }),
      // completed: 最新 completed (レガシー) → 除外される
      plan({
        id: 'pl-completed',
        itemId: 'it-1',
        executorMemberId: 'm-exec',
        toMemberId: 'm-to',
        ballEvents: [
          { eventType: 'completed', source: 'human', occurredAt: new Date('2026-06-19T02:00:00Z') },
        ],
      }),
      // holder=null: 実施者も toMember も null → 除外される (in_progress だが memberId が null)
      plan({
        id: 'pl-nullholder',
        itemId: 'it-1',
        executorMemberId: null,
        toMemberId: null,
      }),
    ];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: { today: '2026-06-21' },
    });

    // in_progress だけが残る。completed / holder=null に加え、tossed も除外する。
    // tossed はボールが後続予定の実施者へ渡った状態で、その後続予定自体が別のカードとして
    // 出るため、ダッシュボードに並べると二重計上になる (#146)。
    expect(res.summary.todayTaskCount).toBe(1);
    expect(res.projects).toHaveLength(1);
    const sections = res.projects[0]!.memberSections;
    // タスクを持つ member のみ。
    expect(sections.map((s) => s.member.id)).toEqual(['m-exec']);

    const execSection = sections.find((s) => s.member.id === 'm-exec')!;
    expect(execSection.tasks).toHaveLength(1);
    expect(execSection.tasks[0]).toMatchObject({
      planId: 'pl-inprogress',
      ballState: 'in_progress',
      itemName: '制作物1',
      itemId: 'it-1',
      projectId: 'p-1',
      category: 'coding',
      scheduledDate: '2026-06-20',
      isOverdue: false,
    });
    expect(execSection.member).toMatchObject({ name: 'Exec太郎', memberType: 'client' });

    expect(sections.find((s) => s.member.id === 'm-to')).toBeUndefined();
  });

  it('pickLatestBallEvent: 最新イベントで状態が決まる (approved → 進行責任者)', async () => {
    projectStore = [
      project({
        id: 'p-1',
        members: [member({ id: 'm-exec' }), member({ id: 'm-pm' })],
        items: [{ id: 'it-1', name: 'I' }],
      }),
    ];
    planStore = [
      plan({
        id: 'pl-approved',
        itemId: 'it-1',
        executorMemberId: 'm-exec',
        progressManagerMemberId: 'm-pm',
        // 順序を入れ替えても occurredAt で最新 (approved) が選ばれる。
        ballEvents: [
          { eventType: 'approved', source: 'human', occurredAt: new Date('2026-06-19T05:00:00Z') },
          { eventType: 'review_requested', source: 'human', occurredAt: new Date('2026-06-19T03:00:00Z') },
        ],
      }),
    ];

    const res = await getDashboard({
      currentUserId: 'u-1',
      query: { today: '2026-06-21' },
    });

    const section = res.projects[0]!.memberSections[0]!;
    // approved が最新 → 進行責任者にボール
    expect(section.member.id).toBe('m-pm');
    expect(section.tasks[0]!.ballState).toBe('approved');
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
        executorMemberId: 'm-1',
        dueDate: new Date('2026-06-20T00:00:00Z'),
      }),
      // not overdue: dueDate == today
      plan({
        id: 'pl-due-today',
        itemId: 'it-1',
        executorMemberId: 'm-1',
        dueDate: new Date('2026-06-21T00:00:00Z'),
      }),
      // dueDate なし → overdue でない
      plan({
        id: 'pl-no-due',
        itemId: 'it-1',
        executorMemberId: 'm-1',
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
      plan({ id: 'pl-1', itemId: 'it-1', executorMemberId: 'm-1' }),
      // 存在しない item を参照する plan は itemMap に無いためスキップされる。
      plan({ id: 'pl-orphan', itemId: 'it-missing', executorMemberId: 'm-1' }),
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
