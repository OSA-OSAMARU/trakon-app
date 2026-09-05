import { prisma, type Prisma } from '@trakon/db';
import { pickLatestBallEvent, type BallEventType, type ProjectRole } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import { resolvePrimaryOrganization } from './organizations.js';
import type { CreateProjectBody, UpdateProjectBody } from '../schemas/projects.js';

export type ProjectSummaryDTO = {
  id: string;
  name: string;
  /** クライアント名 (#147)。一覧・ヘッダーの表示に使う */
  clientName: string | null;
  startDate: string;
  endDate: string;
  status: 'active' | 'closed';
  /// アーカイブ日時 (null = 未アーカイブ)
  archivedAt: string | null;
  /** 自分のプロジェクトロール。作成者は role_type によらず常に admin (FR-ROLE-04) */
  role: ProjectRole;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** 予定作成時の進行責任者の既定値 (#131)。一覧の「進行責任者」列に出す */
  progressManager: { id: string; name: string } | null;
  /**
   * 期限超過しているボールの数 (#147)。一覧で遅延しているプロジェクトを見分けるのに使う。
   * TOSS 済み・完了は「対応待ち」ではないため数えない (ダッシュボードの isOverdue と同じ判定)。
   */
  overdueCount: number;
};

export type ProjectDetailDTO = ProjectSummaryDTO & {
  counts: {
    memberCount: number;
    itemCount: number;
  };
};

function toDateString(d: Date): string {
  // YYYY-MM-DD in UTC (DATE 列は時刻なし)
  return d.toISOString().slice(0, 10);
}

/**
 * 自分のプロジェクトロールを解決する (設計書 §5.4.2)。
 *
 * 作成者は role_type の値によらず常に管理者として扱う。自分のプロジェクトから
 * 締め出されることを防ぐ最終防衛線 (PRD FR-ROLE-04)。ミドルウェア側の
 * requireProjectMember() と同じ規則にする。
 */
function resolveProjectRole(
  p: { createdBy: string; members?: { roleType: string }[] },
  currentUserId: string,
): ProjectRole {
  if (p.createdBy === currentUserId) return 'admin';
  return (p.members?.[0]?.roleType as ProjectRole | undefined) ?? 'editor';
}

function toSummary(
  p: {
    id: string;
    name: string;
    clientName: string | null;
    startDate: Date;
    endDate: Date;
    status: string;
    archivedAt: Date | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    progressManager?: { id: string; name: string } | null;
    members?: { roleType: string }[];
  },
  currentUserId: string,
  overdueCount = 0,
): ProjectSummaryDTO {
  return {
    id: p.id,
    name: p.name,
    clientName: p.clientName,
    startDate: toDateString(p.startDate),
    endDate: toDateString(p.endDate),
    status: p.status as 'active' | 'closed',
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    role: resolveProjectRole(p, currentUserId),
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
    progressManager: p.progressManager
      ? { id: p.progressManager.id, name: p.progressManager.name }
      : null,
    overdueCount,
  };
}

/**
 * 自分が参加しているプロジェクトのみ返す (project_members を join)
 * archived=true でアーカイブ済みのみ、それ以外は未アーカイブのみ返す。
 */
export async function listProjects(
  userId: string,
  q: { archived?: boolean; limit: number; offset: number },
): Promise<{ items: ProjectSummaryDTO[]; total: number }> {
  const where: Prisma.ProjectWhereInput = {
    deletedAt: null,
    archivedAt: q.archived ? { not: null } : null,
    members: { some: { userId, deletedAt: null } },
  };
  const [rows, total] = await Promise.all([
    prisma.project.findMany({
      where,
      // アーカイブ一覧はアーカイブした順、それ以外は更新順
      orderBy: q.archived ? { archivedAt: 'desc' } : { updatedAt: 'desc' },
      take: q.limit,
      skip: q.offset,
      include: {
        progressManager: { select: { id: true, name: true } },
        // 自分のロールを導出するための 1 行 (§5.4.2)
        members: { where: { userId, deletedAt: null }, select: { roleType: true }, take: 1 },
      },
    }),
    prisma.project.count({ where }),
  ]);
  const overdueByProject = await countOverdueBalls(rows.map((p) => p.id));
  return {
    items: rows.map((p) => toSummary(p, userId, overdueByProject.get(p.id) ?? 0)),
    total,
  };
}

/**
 * プロジェクトごとの期限超過ボール数を数える (#147)。
 *
 * 「期限超過」の判定はダッシュボードの isOverdue と揃える。
 *   - active な予定で 終了日 (due_date) が今日より前
 *   - ただし TOSS 済み・完了は「対応待ち」ではないため除外する
 * ボール状態は最新の ball_event から導出する。
 */
async function countOverdueBalls(projectIds: string[]): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (projectIds.length === 0) return result;

  const today = new Date(`${todayInJst()}T00:00:00Z`);
  const plans = await prisma.plan.findMany({
    where: {
      deletedAt: null,
      status: 'active',
      dueDate: { lt: today },
      item: { deletedAt: null, projectId: { in: projectIds } },
    },
    select: {
      item: { select: { projectId: true } },
      ballEvents: { orderBy: { occurredAt: 'desc' }, take: 1 },
    },
  });

  for (const plan of plans) {
    const latest = pickLatestBallEvent(
      plan.ballEvents.map((e) => ({
        eventType: e.eventType as BallEventType,
        source: e.source as 'human' | 'auto_chain',
        occurredAt: e.occurredAt,
      })),
    );
    const state = latest?.eventType;
    if (state === 'tossed' || state === 'completed') continue;
    const pid = plan.item.projectId;
    result.set(pid, (result.get(pid) ?? 0) + 1);
  }
  return result;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function todayInJst(): string {
  return new Date(Date.now() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

export async function getProjectDetail(
  projectId: string,
  currentUserId: string,
): Promise<ProjectDetailDTO> {
  const p = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: {
      progressManager: { select: { id: true, name: true } },
      // 自分のロールを導出するための 1 行 (§5.4.2)
      members: { where: { userId: currentUserId, deletedAt: null }, select: { roleType: true }, take: 1 },
      _count: {
        select: {
          members: { where: { deletedAt: null } },
          items: { where: { deletedAt: null } },
        },
      },
    },
  });
  if (!p) {
    throw new ApiException('NOT_FOUND', 404, 'Project not found.');
  }
  const overdue = await countOverdueBalls([p.id]);
  return {
    ...toSummary(p, currentUserId, overdue.get(p.id) ?? 0),
    counts: { memberCount: p._count.members, itemCount: p._count.items },
  };
}

/**
 * プロジェクト + 制作物 + 仮メンバー (作成者本人 + 招待先) を 1 トランザクションで作成。
 * 招待トークン発行とメール送信は PR B (Sub-Phase 0.2 後半) で追加。
 */
export async function createProject(input: {
  body: CreateProjectBody;
  currentUserId: string;
}): Promise<ProjectDetailDTO> {
  const { body, currentUserId } = input;

  // 作成者のプロフィール情報を読み込み (member 行の name / email に流用)
  const creator = await prisma.user.findUnique({
    where: { id: currentUserId },
    select: { displayName: true, email: true },
  });
  if (!creator) {
    throw new ApiException('PROFILE_NOT_COMPLETED', 404, 'Profile is required.');
  }

  // プロジェクトは必ずいずれかの組織に属する (§7.3.1)。プロジェクト数上限の判定単位。
  const { organizationId } = await resolvePrimaryOrganization(prisma, currentUserId);

  // 作成者のメールがメンバー入力に被ると uq_pm_project_email 違反になるため除外
  // (メール未登録の参加者は衝突しないためそのまま残す)。
  // 進行責任者は入力順 (index) で指されるため、元の位置も控えておく。
  const filteredMembers = body.members
    .map((m, index) => ({ m, index }))
    .filter(({ m }) => !m.email || m.email.toLowerCase() !== creator.email.toLowerCase());

  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        organizationId,
        name: body.name,
        clientName: body.clientName ?? null,
        startDate: new Date(`${body.startDate}T00:00:00Z`),
        endDate: new Date(`${body.endDate}T00:00:00Z`),
        createdBy: currentUserId,
      },
    });

    if (body.items.length > 0) {
      await tx.projectItem.createMany({
        data: body.items.map((item, idx) => ({
          projectId: project.id,
          name: item.name,
          sortOrder: idx,
        })),
      });
    }

    // 仮メンバー: 作成者本人 (受諾済み) + 招待先 (userId NULL)
    const creatorMember = await tx.projectMember.create({
      data: {
        projectId: project.id,
        userId: currentUserId,
        name: creator.displayName,
        email: creator.email,
        organizationName: '',
        memberType: 'production',
        // 作成者は常に管理者 (FR-ROLE-04)。列にも明示しておく
        roleType: 'admin',
        sortOrder: 0,
      },
    });
    // 進行責任者に据える参加者の id を拾うため 1 件ずつ作る (最大 50 件)
    let progressManagerMemberId: string | null = null;
    for (const [idx, { m, index }] of filteredMembers.entries()) {
      const row = await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId: null,
          name: m.name,
          email: m.email ?? null,
          organizationName: m.organizationName,
          memberType: m.memberType,
          jobTitle: m.jobTitle ?? null,
          roleType: m.roleType,
          sortOrder: idx + 1,
        },
      });
      if (body.progressManagerIndex === index) progressManagerMemberId = row.id;
    }

    // 進行責任者。未指定 (または除外された参加者を指していた) 場合は作成者本人にする。
    await tx.project.update({
      where: { id: project.id },
      data: { progressManagerMemberId: progressManagerMemberId ?? creatorMember.id },
    });

    return project;
  });

  return getProjectDetail(created.id, currentUserId);
}

export async function updateProject(input: {
  projectId: string;
  body: UpdateProjectBody;
  currentUserId: string;
}): Promise<{ project: ProjectDetailDTO; warnings: Array<{ code: string; message: string }> }> {
  const data: Prisma.ProjectUpdateInput = {};
  if (input.body.name !== undefined) data.name = input.body.name;
  if (input.body.clientName !== undefined) data.clientName = input.body.clientName;
  if (input.body.startDate !== undefined)
    data.startDate = new Date(`${input.body.startDate}T00:00:00Z`);
  if (input.body.endDate !== undefined)
    data.endDate = new Date(`${input.body.endDate}T00:00:00Z`);
  if (input.body.status !== undefined) data.status = input.body.status;

  const updated = await prisma.project.update({
    where: { id: input.projectId },
    data,
  });

  // 期間外予定 (plans) チェックは Sub-Phase 0.3 で plans テーブル追加後に実装
  // ここでは空 warnings を返す
  const warnings: Array<{ code: string; message: string }> = [];

  return {
    project: await getProjectDetail(updated.id, input.currentUserId),
    warnings,
  };
}

/**
 * プロジェクトをアーカイブする (archived_at を立てる)。
 * 既にアーカイブ済みでも冪等に成功する。
 */
export async function archiveProject(input: {
  projectId: string;
  currentUserId: string;
}): Promise<ProjectDetailDTO> {
  await prisma.project.update({
    where: { id: input.projectId },
    data: { archivedAt: new Date() },
  });
  return getProjectDetail(input.projectId, input.currentUserId);
}

/**
 * プロジェクトのアーカイブを解除する (復元)。
 * 未アーカイブでも冪等に成功する。
 */
export async function unarchiveProject(input: {
  projectId: string;
  currentUserId: string;
}): Promise<ProjectDetailDTO> {
  await prisma.project.update({
    where: { id: input.projectId },
    data: { archivedAt: null },
  });
  return getProjectDetail(input.projectId, input.currentUserId);
}
