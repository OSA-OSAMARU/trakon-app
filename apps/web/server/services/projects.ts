import { prisma, type Prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';
import type { CreateProjectBody, UpdateProjectBody } from '../schemas/projects.js';

export type ProjectSummaryDTO = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'active' | 'closed';
  /// アーカイブ日時 (null = 未アーカイブ)
  archivedAt: string | null;
  role: 'director' | 'member';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
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

function toSummary(
  p: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    status: string;
    archivedAt: Date | null;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
  },
  currentUserId: string,
): ProjectSummaryDTO {
  return {
    id: p.id,
    name: p.name,
    startDate: toDateString(p.startDate),
    endDate: toDateString(p.endDate),
    status: p.status as 'active' | 'closed',
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    role: p.createdBy === currentUserId ? 'director' : 'member',
    createdBy: p.createdBy,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
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
    }),
    prisma.project.count({ where }),
  ]);
  return { items: rows.map((p) => toSummary(p, userId)), total };
}

export async function getProjectDetail(
  projectId: string,
  currentUserId: string,
): Promise<ProjectDetailDTO> {
  const p = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    include: {
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
  return {
    ...toSummary(p, currentUserId),
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

  // 作成者のメールがメンバー入力に被ると uq_pm_project_email 違反になるため除外
  // (メール未登録の参加者は衝突しないためそのまま残す)
  const filteredMembers = body.members.filter(
    (m) => !m.email || m.email.toLowerCase() !== creator.email.toLowerCase(),
  );

  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        name: body.name,
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
    await tx.projectMember.create({
      data: {
        projectId: project.id,
        userId: currentUserId,
        name: creator.displayName,
        email: creator.email,
        organizationName: '',
        memberType: 'production',
        sortOrder: 0,
      },
    });
    if (filteredMembers.length > 0) {
      await tx.projectMember.createMany({
        data: filteredMembers.map((m, idx) => ({
          projectId: project.id,
          userId: null,
          name: m.name,
          email: m.email ?? null,
          organizationName: m.organizationName,
          memberType: m.memberType,
          sortOrder: idx + 1,
        })),
      });
    }

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
