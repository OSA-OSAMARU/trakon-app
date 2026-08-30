// -----------------------------------------------------------------------------
// 招待の作成・取り消し — 設計書 §7.12.5 / §3.4b
//
// Phase 0 では受諾側 (GET/POST /invitations/:token) だけが実装されており、
// 招待の作成とメール送信は未実装だった。lib/tokens.ts と lib/mailer.ts は
// 書かれたまま一度も使われていない。ここで初めて使う。
//
// 座席 (会員アカウント) の上限は「有効な組織メンバー + 未受諾かつ有効期限内の招待」で
// 判定する。招待中も座席を押さえないと、大量に招待してから一斉受諾で上限を超えられる。
// -----------------------------------------------------------------------------
import { prisma } from '@trakon/db';
import type { JobTitle, MemberType, ProjectRole } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import { getMailer } from '../lib/mailer.js';
import { defaultInvitationExpiresAt, generateInvitationToken } from '../lib/tokens.js';
import { getEntitlement } from './billing/entitlement.js';

export type InvitationDTO = {
  id: string;
  email: string;
  roleType: ProjectRole;
  memberId: string;
  memberName: string;
  invitedByUserId: string | null;
  expiresAt: string;
  createdAt: string;
};

export type CreateInvitationInput = {
  projectId: string;
  organizationId: string;
  actorUserId: string;
  origin: string;
  body: {
    email: string;
    roleType: ProjectRole;
    /** 既存の担当者行を招待する場合はその id。未指定なら新規に作る */
    memberId?: string;
    name?: string;
    organizationName?: string;
    memberType?: MemberType;
    jobTitle?: JobTitle | null;
  };
};

function toDTO(row: {
  id: string;
  email: string;
  roleType: string;
  invitedMemberId: string;
  invitedByUserId: string | null;
  expiresAt: Date;
  createdAt: Date;
  invitedMember: { name: string };
}): InvitationDTO {
  return {
    id: row.id,
    email: row.email,
    roleType: row.roleType as ProjectRole,
    memberId: row.invitedMemberId,
    memberName: row.invitedMember.name,
    invitedByUserId: row.invitedByUserId,
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** 未受諾かつ有効期限内の招待のみを返す (= 座席を消費している招待)。 */
export async function listPendingInvitations(projectId: string): Promise<InvitationDTO[]> {
  const rows = await prisma.invitation.findMany({
    where: { projectId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: 'desc' },
    include: { invitedMember: { select: { name: true } } },
  });
  return rows.map(toDTO);
}

/**
 * 招待を作成し、招待メールを送る。
 *
 * メール送信はトランザクションのコミット後に行う。送信失敗で招待自体を巻き戻すと
 * 「送れなかったのに座席だけ埋まる」より悪い状態 (再送手段がない) になるため、
 * 招待は残して警告を返す。
 */
export async function createInvitation(
  input: CreateInvitationInput,
): Promise<{ invitation: InvitationDTO; warnings?: string[] }> {
  const { body } = input;
  const email = body.email.trim().toLowerCase();

  const project = await prisma.project.findFirst({
    where: { id: input.projectId, deletedAt: null },
    select: { id: true, name: true },
  });
  if (!project) throw new ApiException('NOT_FOUND', 404, 'Project not found.');

  // 座席 (会員アカウント) の上限 (§7.11.1)。
  // 未受諾の招待も座席を消費するので countSeats に含まれている。
  const entitlement = await getEntitlement(prisma, input.organizationId);
  if (!entitlement.canInviteMember) {
    throw new ApiException(
      'SEAT_LIMIT_REACHED',
      409,
      `会員アカウントの上限 (${entitlement.limits.seatLimit} 名) に達しています。プランを変更するか、既存のメンバー・招待を整理してください。`,
      {
        planCode: entitlement.effectivePlanCode,
        seatLimit: entitlement.limits.seatLimit,
        seatCount: entitlement.usage.seatCount,
      },
    );
  }

  const inviter = await prisma.user.findUnique({
    where: { id: input.actorUserId },
    select: { displayName: true },
  });

  const { raw, hash } = generateInvitationToken();
  const expiresAt = defaultInvitationExpiresAt();

  const created = await prisma.$transaction(async (tx) => {
    // 招待先の参加者行を決める
    let memberId = body.memberId;
    if (memberId) {
      const member = await tx.projectMember.findFirst({
        where: { id: memberId, projectId: input.projectId, deletedAt: null },
        select: { id: true, userId: true, email: true },
      });
      if (!member) throw new ApiException('NOT_FOUND', 404, 'Member not found.');
      if (member.userId) {
        throw new ApiException('ALREADY_MEMBER', 409, 'This member has already joined.');
      }
      // メール未登録の担当者行に後からメールを付ける場合、同じメールの別行があると
      // uq_pm_project_email に抵触する。先に弾いて分かるエラーにする。
      if (member.email !== email) {
        await assertEmailAvailable(tx, input.projectId, email, member.id);
        await tx.projectMember.update({ where: { id: member.id }, data: { email } });
      }
      await tx.projectMember.update({ where: { id: member.id }, data: { roleType: body.roleType } });
    } else {
      await assertEmailAvailable(tx, input.projectId, email, null);
      const last = await tx.projectMember.findFirst({
        where: { projectId: input.projectId, deletedAt: null },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      const member = await tx.projectMember.create({
        data: {
          projectId: input.projectId,
          userId: null,
          name: body.name?.trim() || email,
          email,
          organizationName: body.organizationName ?? '',
          memberType: body.memberType ?? 'production',
          jobTitle: body.jobTitle ?? null,
          // 受諾前でも一覧にロールを出せるよう先置きする
          roleType: body.roleType,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
        select: { id: true },
      });
      memberId = member.id;
    }

    const invitation = await tx.invitation.create({
      data: {
        projectId: input.projectId,
        organizationId: input.organizationId,
        invitedMemberId: memberId,
        invitedByUserId: input.actorUserId,
        email,
        roleType: body.roleType,
        tokenHash: hash,
        expiresAt,
      },
      include: { invitedMember: { select: { name: true } } },
    });

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'invitation_created',
        resourceType: 'invitation',
        resourceId: invitation.id,
        result: 'success',
        extra: { projectId: input.projectId, roleType: body.roleType },
      },
    });

    return invitation;
  });

  // コミット後に送信する。失敗しても招待は残し、警告として返す。
  const warnings: string[] = [];
  try {
    await getMailer().sendInvitation({
      to: email,
      projectName: project.name,
      inviterName: inviter?.displayName ?? 'TRAKON',
      acceptUrl: `${input.origin}/invitations/${raw}`,
      expiresAt,
    });
  } catch (err) {
    console.error('[createInvitation] failed to send invitation email:', err);
    warnings.push('招待は作成しましたが、メールの送信に失敗しました。');
  }

  return { invitation: toDTO(created), ...(warnings.length > 0 ? { warnings } : {}) };
}

/** 招待を取り消す (座席を解放する)。 */
export async function revokeInvitation(input: {
  projectId: string;
  invitationId: string;
  actorUserId: string;
}): Promise<void> {
  const invitation = await prisma.invitation.findFirst({
    where: { id: input.invitationId, projectId: input.projectId, acceptedAt: null, revokedAt: null },
    select: { id: true },
  });
  if (!invitation) throw new ApiException('NOT_FOUND', 404, 'Invitation not found.');

  await prisma.$transaction([
    prisma.invitation.update({ where: { id: invitation.id }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'invitation_revoked',
        resourceType: 'invitation',
        resourceId: invitation.id,
        result: 'success',
        extra: { projectId: input.projectId },
      },
    }),
  ]);
}

async function assertEmailAvailable(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  projectId: string,
  email: string,
  excludeMemberId: string | null,
): Promise<void> {
  const taken = await tx.projectMember.findFirst({
    where: {
      projectId,
      email,
      deletedAt: null,
      ...(excludeMemberId ? { id: { not: excludeMemberId } } : {}),
    },
    select: { id: true },
  });
  if (taken) {
    throw new ApiException(
      'MEMBER_EMAIL_TAKEN',
      409,
      `Email already exists in this project: ${email}`,
      { email },
    );
  }
}
