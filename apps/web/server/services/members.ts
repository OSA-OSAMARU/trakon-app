import { prisma } from '@trakon/db';

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
  memberType: 'client' | 'production';
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
    memberType: m.memberType as MemberDTO['memberType'],
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

  const updated = await prisma.projectMember.update({
    where: { id: input.memberId },
    data: {
      name: input.body.name ?? undefined,
      organizationName: input.body.organizationName ?? undefined,
      memberType: input.body.memberType ?? undefined,
      sortOrder: input.body.sortOrder ?? undefined,
    },
  });
  return toDTO(updated);
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

  // plans 連動 (MEMBER_HAS_ACTIVE_PLANS) は Sub-Phase 0.3 で plans 追加後に実装
  await prisma.projectMember.delete({ where: { id: input.memberId } });
}
