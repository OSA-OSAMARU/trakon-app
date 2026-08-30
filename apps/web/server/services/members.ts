import { prisma } from '@trakon/db';
import type { JobTitle, MemberType, ProjectRole } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import { assertExactIdSet } from './items.js';
import type { AddMembersBody, UpdateMemberBody } from '../schemas/members.js';

export type MemberDTO = {
  id: string;
  userId: string | null;
  name: string;
  /** スケジュール担当者としての登録ではメールは任意 (未登録は null) */
  email: string | null;
  organizationName: string;
  memberType: MemberType;
  /** 職種 (#147)。表示用で権限には影響しない */
  jobTitle: JobTitle | null;
  /** 権限ロール (FR-ROLE-01)。操作権限の唯一の根拠 */
  roleType: ProjectRole;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

function toDTO(m: {
  id: string;
  userId: string | null;
  name: string;
  email: string | null;
  organizationName: string;
  memberType: string;
  jobTitle: string | null;
  roleType: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}): MemberDTO {
  return {
    id: m.id,
    userId: m.userId,
    name: m.name,
    email: m.email,
    organizationName: m.organizationName,
    memberType: m.memberType as MemberType,
    jobTitle: (m.jobTitle as JobTitle | null) ?? null,
    roleType: m.roleType as ProjectRole,
    sortOrder: m.sortOrder,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function listMembers(projectId: string): Promise<MemberDTO[]> {
  const rows = await prisma.projectMember.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((m) => toDTO(m));
}

/**
 * 参加者を追加。参加者はスケジュール上の担当者として登録するもので、
 * メールは任意・自動招待やメール送信は行わない。
 * (メールは将来フェーズで「予定変更時の共有リンク自動送信」に使用予定)
 */
export async function addMembers(input: {
  projectId: string;
  body: AddMembersBody;
}): Promise<MemberDTO[]> {
  // 既存メンバーのメールと重複しないかチェック (メール未登録は対象外)
  const existing = await prisma.projectMember.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    select: { email: true },
  });
  const taken = new Set(
    existing.flatMap((m) => (m.email ? [m.email.toLowerCase()] : [])),
  );
  for (const m of input.body.members) {
    if (m.email && taken.has(m.email)) {
      throw new ApiException(
        'MEMBER_EMAIL_TAKEN',
        409,
        `Email already exists in this project: ${m.email}`,
        { email: m.email },
      );
    }
  }

  // 末尾の sortOrder を取得して採番
  const last = await prisma.projectMember.findFirst({
    where: { projectId: input.projectId, deletedAt: null },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  const baseOrder = (last?.sortOrder ?? -1) + 1;

  const created = await prisma.$transaction(async (tx) => {
    const result: MemberDTO[] = [];
    for (const [idx, m] of input.body.members.entries()) {
      const member = await tx.projectMember.create({
        data: {
          projectId: input.projectId,
          userId: null,
          name: m.name,
          email: m.email ?? null,
          organizationName: m.organizationName,
          memberType: m.memberType,
          jobTitle: m.jobTitle ?? null,
          roleType: m.roleType,
          sortOrder: baseOrder + idx,
        },
      });
      result.push(toDTO(member));
    }
    return result;
  });
  return created;
}

/**
 * 参加者の並び替え (#111)。orderedIds は現存する参加者と過不足なく一致している
 * 必要がある。並び順に sortOrder = 0..n-1 を振り直す。
 */
export async function reorderMembers(input: {
  projectId: string;
  orderedIds: string[];
}): Promise<MemberDTO[]> {
  const existing = await prisma.projectMember.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    select: { id: true },
  });
  assertExactIdSet(input.orderedIds, existing.map((m) => m.id));

  await prisma.$transaction(
    input.orderedIds.map((id, idx) =>
      prisma.projectMember.update({ where: { id }, data: { sortOrder: idx } }),
    ),
  );
  return listMembers(input.projectId);
}

export async function updateMember(input: {
  memberId: string;
  projectId: string;
  body: UpdateMemberBody;
}): Promise<MemberDTO> {
  const existing = await prisma.projectMember.findFirst({
    where: { id: input.memberId, projectId: input.projectId, deletedAt: null },
  });
  if (!existing) throw new ApiException('NOT_FOUND', 404, 'Member not found.');

  // 管理者を 0 名にはできない (FR-ROLE-03)
  if (input.body.roleType && input.body.roleType !== 'admin' && existing.roleType === 'admin') {
    await assertNotLastAdmin(input.projectId, input.memberId);
  }

  const updated = await prisma.projectMember.update({
    where: { id: input.memberId },
    data: {
      name: input.body.name ?? undefined,
      organizationName: input.body.organizationName ?? undefined,
      memberType: input.body.memberType ?? undefined,
      // null は「クリアする」意味なのでそのまま渡す
      jobTitle: input.body.jobTitle === undefined ? undefined : input.body.jobTitle,
      roleType: input.body.roleType ?? undefined,
      sortOrder: input.body.sortOrder ?? undefined,
    },
  });
  return toDTO(updated);
}

/**
 * プロジェクトの管理者が 0 名にならないことを保証する (FR-ROLE-03)。
 *
 * 作成者は role_type によらず常に管理者として扱われる (FR-ROLE-04) ため、
 * 作成者の member 行が残っていれば管理者は必ず 1 名以上いる。
 */
async function assertNotLastAdmin(projectId: string, excludeMemberId: string): Promise<void> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { createdBy: true },
  });
  const remainingAdmins = await prisma.projectMember.count({
    where: {
      projectId,
      deletedAt: null,
      id: { not: excludeMemberId },
      OR: [
        { roleType: 'admin' },
        // 作成者は role_type によらず常に管理者 (FR-ROLE-04)
        ...(project ? [{ userId: project.createdBy }] : []),
      ],
    },
  });
  if (remainingAdmins === 0) {
    throw new ApiException(
      'LAST_ADMIN',
      409,
      'プロジェクトの管理者は 1 名以上必要です。先に他の参加者を管理者にしてください。',
    );
  }
}

export async function deleteMember(input: {
  memberId: string;
  projectId: string;
  currentUserId: string;
}): Promise<void> {
  const existing = await prisma.projectMember.findFirst({
    where: { id: input.memberId, projectId: input.projectId, deletedAt: null },
  });
  if (!existing) throw new ApiException('NOT_FOUND', 404, 'Member not found.');

  // ディレクター本人の自己削除は不可
  if (existing.userId === input.currentUserId) {
    throw new ApiException(
      'CANNOT_REMOVE_SELF',
      409,
      'Director cannot remove themselves from the project.',
    );
  }

  // 管理者を 0 名にはできない (FR-ROLE-03)
  if (existing.roleType === 'admin') {
    await assertNotLastAdmin(input.projectId, input.memberId);
  }

  // plans 連動 (MEMBER_HAS_ACTIVE_PLANS) は Sub-Phase 0.3 で plans 追加後に実装
  await prisma.projectMember.delete({ where: { id: input.memberId } });
}
