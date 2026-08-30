import { prisma } from '@trakon/db';
import type { ProjectRole } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import { hashToken } from '../lib/tokens.js';
import { ensureOrganizationMember } from './organizations.js';
import { getEntitlement } from './billing/entitlement.js';

export type InvitationVerifyDTO = {
  project: { id: string; name: string };
  invitedMember: {
    id: string;
    name: string;
    email: string;
    organizationName: string;
    memberType: 'client' | 'production';
  };
  expiresAt: string;
};

export type InvitationAcceptDTO = {
  project: { id: string; name: string };
  member: { id: string; memberType: 'client' | 'production'; roleType: ProjectRole };
};

/**
 * 招待を検証して状態を返す。期限切れ・受諾済・失効・未存在は全て 404 集約。
 */
export async function verifyInvitation(rawToken: string): Promise<InvitationVerifyDTO> {
  const inv = await findActiveInvitation(rawToken);
  return {
    project: { id: inv.project.id, name: inv.project.name },
    invitedMember: {
      id: inv.invitedMember.id,
      name: inv.invitedMember.name,
      // 招待先メールは invitations.email が正 (参加者行のメールは任意化され null 可)
      email: inv.email,
      organizationName: inv.invitedMember.organizationName,
      memberType: inv.invitedMember.memberType as 'client' | 'production',
    },
    expiresAt: inv.expiresAt.toISOString(),
  };
}

/**
 * 招待を受諾。同一トランザクションで:
 *  1. project_members.user_id をログインユーザーの users.id に設定
 *  2. invitations.accepted_at = now()
 *  3. audit_logs に invitation 受諾の login 相当を記録
 *
 * 招待されたメールアドレスと、受諾しようとしているユーザーのメールが一致しない場合は 403。
 */
export async function acceptInvitation(input: {
  rawToken: string;
  currentUserId: string;
}): Promise<InvitationAcceptDTO> {
  const inv = await findActiveInvitation(input.rawToken);

  const user = await prisma.user.findUnique({
    where: { id: input.currentUserId },
    select: { id: true, email: true },
  });
  if (!user) throw new ApiException('PROFILE_NOT_COMPLETED', 404, 'Profile is required.');

  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    throw new ApiException(
      'INVITATION_EMAIL_MISMATCH',
      403,
      'This invitation was sent to a different email address.',
    );
  }

  // 既にこのプロジェクトに別の member 行で参加していないか
  const dup = await prisma.projectMember.findFirst({
    where: {
      projectId: inv.project.id,
      userId: user.id,
      id: { not: inv.invitedMember.id },
      deletedAt: null,
    },
    select: { id: true },
  });
  if (dup) {
    throw new ApiException(
      'ALREADY_MEMBER',
      409,
      'You are already a member of this project.',
    );
  }

  // 招待作成時に空きがあっても、受諾までに満席になっている可能性がある (§7.11.1)。
  // この招待自体が 1 座席を消費しているので、受諾は「招待 1 → 会員 1」の振り替えに
  // すぎない。したがって自分の分を差し引いた消費数で判定する。
  const entitlement = await getEntitlement(prisma, inv.organizationId);
  const seatLimit = entitlement.limits.seatLimit;
  if (seatLimit !== null && entitlement.usage.seatCount - 1 >= seatLimit) {
    throw new ApiException(
      'SEAT_LIMIT_REACHED',
      409,
      '会員アカウントの上限に達しているため参加できません。招待元にご連絡ください。',
      { seatLimit, seatCount: entitlement.usage.seatCount },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    const updatedMember = await tx.projectMember.update({
      where: { id: inv.invitedMember.id },
      // 招待時に指定されたロールを付与する (FR-ROLE-03)
      data: { userId: user.id, roleType: inv.roleType },
    });
    await tx.invitation.update({
      where: { id: inv.id },
      data: { acceptedAt: new Date() },
    });
    // 組織の会員アカウントとして追加する (= 座席を 1 つ消費する)
    await ensureOrganizationMember(tx, {
      organizationId: inv.organizationId,
      userId: user.id,
      orgRole: 'member',
    });
    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'org_member_added',
        resourceType: 'invitation',
        resourceId: inv.id,
        result: 'success',
        extra: {
          projectId: inv.project.id,
          memberId: updatedMember.id,
          organizationId: inv.organizationId,
          roleType: inv.roleType,
        },
      },
    });
    return updatedMember;
  });

  return {
    project: { id: inv.project.id, name: inv.project.name },
    member: {
      id: result.id,
      memberType: result.memberType as 'client' | 'production',
      roleType: result.roleType as ProjectRole,
    },
  };
}



async function findActiveInvitation(rawToken: string) {
  const tokenHash = hashToken(rawToken);
  const inv = await prisma.invitation.findFirst({
    where: {
      tokenHash,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      project: { select: { id: true, name: true } },
      invitedMember: {
        select: {
          id: true,
          name: true,
          email: true,
          organizationName: true,
          memberType: true,
        },
      },
    },
  });
  if (!inv) {
    throw new ApiException(
      'INVITATION_NOT_FOUND_OR_EXPIRED',
      404,
      'Invitation not found, expired, accepted, or revoked.',
    );
  }
  return inv;
}
