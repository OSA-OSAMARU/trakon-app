import { prisma } from '@trakon/db';
import {
  deriveBallHolder,
  pickLatestBallEvent,
  type BallEventType,
  type PlanState,
} from '@trakon/shared';

import type { DashboardQuery } from '../schemas/dashboard.js';

export type DashboardTaskDTO = {
  planId: string;
  projectId: string;
  itemId: string;
  itemName: string;
  title: string;
  category: 'wireframe' | 'design' | 'coding' | 'review' | 'meeting' | 'other';
  scheduledDate: string;
  dueDate: string | null;
  ballState: PlanState;
  isOverdue: boolean;
  /** カンバンのカードに出す進行責任者 (Figma node 57:505) */
  progressManager: { id: string; name: string } | null;
};

export type DashboardMemberSectionDTO = {
  member: {
    id: string;
    name: string;
    organizationName: string;
    memberType: 'client' | 'production';
    /** このメンバーがリクエスト元ユーザー自身か (「要対応のみ」の絞り込みに使う) */
    isMe: boolean;
  };
  tasks: DashboardTaskDTO[];
};

export type DashboardProjectGroupDTO = {
  id: string;
  name: string;
  memberSections: DashboardMemberSectionDTO[];
};

export type DashboardDTO = {
  today: string;
  summary: {
    todayTaskCount: number;
    overdueCount: number;
  };
  projects: DashboardProjectGroupDTO[];
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function todayInJst(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return jst.toISOString().slice(0, 10);
}

function toDateOnly(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

/**
 * SC-09 ダッシュボード: 自分が参加するプロジェクト × メンバー × 今日アクティブな予定 の階層集計。
 * 設計書 §3.6 GET /users/me/dashboard / §4.4 SC-09
 */
export async function getDashboard(input: {
  currentUserId: string;
  query: DashboardQuery;
}): Promise<DashboardDTO> {
  const today = input.query.today ?? todayInJst();
  const todayDate = new Date(`${today}T00:00:00Z`);

  // 1) 自分が参加するプロジェクト一覧
  const projects = await prisma.project.findMany({
    where: {
      deletedAt: null,
      members: { some: { userId: input.currentUserId, deletedAt: null } },
    },
    orderBy: [{ updatedAt: 'desc' }],
    include: {
      members: {
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      },
      items: { where: { deletedAt: null }, select: { id: true, name: true } },
    },
  });

  if (projects.length === 0) {
    return {
      today,
      summary: { todayTaskCount: 0, overdueCount: 0 },
      projects: [],
    };
  }

  // 2) 全プロジェクトの今日アクティブな予定をまとめて取得 (active かつ scheduled <= today)
  const itemIds = projects.flatMap((p) => p.items.map((it) => it.id));

  const plans = itemIds.length
    ? await prisma.plan.findMany({
        where: {
          itemId: { in: itemIds },
          deletedAt: null,
          status: 'active',
          // 今日以前に scheduled かつ未完了
          scheduledDate: { lte: todayDate },
        },
        include: {
          ballEvents: {
            orderBy: { occurredAt: 'desc' },
            take: 1,
          },
        },
      })
    : [];

  // itemId -> itemName / projectId のマッピング
  const itemMap = new Map<string, { name: string; projectId: string }>();
  for (const p of projects) {
    for (const it of p.items) itemMap.set(it.id, { name: it.name, projectId: p.id });
  }

  // memberId -> 表示名 (進行責任者をカードに出すため)
  const memberNameById = new Map<string, string>();
  for (const p of projects) {
    for (const m of p.members) memberNameById.set(m.id, m.name);
  }

  let todayTaskCount = 0;
  let overdueCount = 0;

  // memberId -> tasks
  const tasksByMember = new Map<string, DashboardTaskDTO[]>();
  for (const plan of plans) {
    const item = itemMap.get(plan.itemId);
    if (!item) continue;
    const latest = pickLatestBallEvent(
      plan.ballEvents.map((e) => ({
        eventType: e.eventType as BallEventType,
        source: e.source as 'human' | 'auto_chain',
        occurredAt: e.occurredAt,
      })),
    );
    const holder = deriveBallHolder(
      {
        executorMemberId: plan.executorMemberId,
        approverMemberId: plan.approverMemberId,
        progressManagerMemberId: plan.progressManagerMemberId,
        toMemberId: plan.toMemberId,
        status: plan.status as 'active' | 'completed' | 'canceled',
      },
      latest,
    );
    // completed は対象外。tossed も「後続予定の実施者にボールが渡った」状態であり、
    // その後続予定自体が別のカードとして出るため二重計上になる (#146)。
    if (!holder.memberId || holder.state === 'completed' || holder.state === 'tossed') continue;

    const dueDate = toDateOnly(plan.dueDate);
    const isOverdue = !!dueDate && dueDate < today;
    if (isOverdue) overdueCount += 1;
    todayTaskCount += 1;

    const task: DashboardTaskDTO = {
      planId: plan.id,
      projectId: item.projectId,
      itemId: plan.itemId,
      itemName: item.name,
      title: plan.title,
      category: plan.category as DashboardTaskDTO['category'],
      scheduledDate: toDateOnly(plan.scheduledDate)!,
      dueDate,
      ballState: holder.state,
      isOverdue,
      progressManager: plan.progressManagerMemberId
        ? {
            id: plan.progressManagerMemberId,
            name: memberNameById.get(plan.progressManagerMemberId) ?? '',
          }
        : null,
    };
    const arr = tasksByMember.get(holder.memberId) ?? [];
    arr.push(task);
    tasksByMember.set(holder.memberId, arr);
  }

  // 3) プロジェクト → メンバー → 予定 の階層を組み立て
  const projectGroups: DashboardProjectGroupDTO[] = projects
    .map((p) => {
      const memberSections: DashboardMemberSectionDTO[] = p.members
        .map((m) => ({
          member: {
            id: m.id,
            name: m.name,
            organizationName: m.organizationName,
            memberType: m.memberType as 'client' | 'production',
            isMe: m.userId === input.currentUserId,
          },
          tasks: tasksByMember.get(m.id) ?? [],
        }))
        .filter((s) => s.tasks.length > 0);
      return { id: p.id, name: p.name, memberSections };
    })
    .filter((g) => g.memberSections.length > 0);

  return {
    today,
    summary: { todayTaskCount, overdueCount },
    projects: projectGroups,
  };
}
