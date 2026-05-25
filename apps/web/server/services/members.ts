import { prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';
import { getServerEnv } from '../lib/env.js';
import { getMailer } from '../lib/mailer.js';
import {
  defaultInvitationExpiresAt,
  generateInvitationToken,
} from '../lib/tokens.js';
import type { AddMembersBody, UpdateMemberBody } from '../schemas/members.js';

export type MemberDTO = {
  id: string;
  userId: string | null;
  name: string;
  email: string;
  organizationName: string;
  memberType: 'client' | 'production';
  sortOrder: number;
  inviteStatus: 'accepted' | 'pending' | 'expired';
  createdAt: string;
  updatedAt: string;
};

function inviteStatusOf(
  m: {
    userId: string | null;
    invitations: Array<{ acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }>;
  },
  now: Date,
): MemberDTO['inviteStatus'] {
  if (m.userId) return 'accepted';
  // 未受諾 → 有効な招待があるか確認
  const active = m.invitations.find(
    (i) => !i.acceptedAt && !i.revokedAt && i.expiresAt > now,
  );
  return active ? 'pending' : 'expired';
}

function toDTO(
  m: {
    id: string;
    userId: string | null;
    name: string;
    email: string;
    organizationName: string;
    memberType: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    invitations: Array<{ acceptedAt: Date | null; revokedAt: Date | null; expiresAt: Date }>;
  },
  now: Date,
): MemberDTO {
  return {
    id: m.id,
    userId: m.userId,
    name: m.name,
    email: m.email,
    organizationName: m.organizationName,
    memberType: m.memberType as MemberDTO['memberType'],
    sortOrder: m.sortOrder,
    inviteStatus: inviteStatusOf(m, now),
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

export async function listMembers(projectId: string): Promise<MemberDTO[]> {
  const rows = await prisma.projectMember.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: {
      invitations: {
        select: { acceptedAt: true, revokedAt: true, expiresAt: true },
      },
    },
  });
  const now = new Date();
  return rows.map((m) => toDTO(m, now));
}

/**
 * 参加者を追加。仮メンバー + 招待トークン INSERT + メール送信を 1 トランザクションで。
 * メール送信失敗時はトランザクション全体をロールバック (Phase 1 で Inngest 非同期化検討)。
 */
export async function addMembers(input: {
  projectId: string;
  projectName: string;
  inviterDisplayName: string;
  body: AddMembersBody;
}): Promise<MemberDTO[]> {
  const env = getServerEnv();
  const mailer = getMailer();

  // 既存メンバーのメールと重複しないかチェック
  const existing = await prisma.projectMember.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    select: { email: true },
  });
  const taken = new Set(existing.map((m) => m.email.toLowerCase()));
  for (const m of input.body.members) {
    if (taken.has(m.email)) {
      throw new ApiException(
        'MEMBER_EMAIL_TAKEN',
        409,
        `Email already exists in this project: ${m.email}`,
        { email: m.email },
      );
    }
  }

  // 招待トークンとメール内容を生成
  const expiresAt = defaultInvitationExpiresAt();
  const prepared = input.body.members.map((m, idx) => {
    const { raw, hash } = generateInvitationToken();
    return { member: m, raw, hash, idx };
  });

  // 末尾の sortOrder を取得して採番
  const last = await prisma.projectMember.findFirst({
    where: { projectId: input.projectId, deletedAt: null },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  const baseOrder = (last?.sortOrder ?? -1) + 1;

  const created = await prisma.$transaction(async (tx) => {
    const result: MemberDTO[] = [];
    for (const p of prepared) {
      const member = await tx.projectMember.create({
        data: {
          projectId: input.projectId,
          userId: null,
          name: p.member.name,
          email: p.member.email,
          organizationName: p.member.organizationName,
          memberType: p.member.memberType,
          sortOrder: baseOrder + p.idx,
        },
      });
      await tx.invitation.create({
        data: {
          projectId: input.projectId,
          invitedMemberId: member.id,
          email: p.member.email,
          tokenHash: p.hash,
          expiresAt,
        },
      });
      const acceptUrl = `${env.PUBLIC_APP_URL}/invitations/${p.raw}`;
      // メール送信は同期、失敗時 tx は throw でロールバックされる
      await mailer.sendInvitation({
        to: p.member.email,
        projectName: input.projectName,
        inviterName: input.inviterDisplayName,
        acceptUrl,
        expiresAt,
      });
      result.push({
        id: member.id,
        userId: null,
        name: member.name,
        email: member.email,
        organizationName: member.organizationName,
        memberType: member.memberType as MemberDTO['memberType'],
        sortOrder: member.sortOrder,
        inviteStatus: 'pending',
        createdAt: member.createdAt.toISOString(),
        updatedAt: member.updatedAt.toISOString(),
      });
    }
    return result;
  });
  return created;
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
    include: {
      invitations: { select: { acceptedAt: true, revokedAt: true, expiresAt: true } },
    },
  });
  return toDTO(updated, new Date());
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
