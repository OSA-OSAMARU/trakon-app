import { prisma } from '@trakon/db';
import { consumesSeat } from '@trakon/shared';
import type {
  InvitationAcceptDTO,
  InvitationSignupDTO,
  InvitationVerifyDTO,
  ProjectRole,
} from '@trakon/shared';
import { uuidv7 } from 'uuidv7';

import { ApiException } from '../lib/errors.js';
import { hashToken } from '../lib/tokens.js';
import { findAuthUserByEmail, getSupabaseAdmin } from '../lib/supabaseAdmin.js';
import { defaultOrganizationName, ensureOrganizationMember } from './organizations.js';
import { getEntitlement } from './billing/entitlement.js';

// 招待 API の応答型は FE と共有する (@trakon/shared)。
// ここで再宣言すると FE と二重定義になり、#228 の白画面を再発させる。
export type {
  InvitationAcceptDTO,
  InvitationScope,
  InvitationSignupDTO,
  InvitationVerifyDTO,
} from '@trakon/shared';

/**
 * 招待を検証して状態を返す。期限切れ・受諾済・失効・未存在は全て 404 集約。
 */
export async function verifyInvitation(rawToken: string): Promise<InvitationVerifyDTO> {
  const inv = await findActiveInvitation(rawToken);
  return {
    scope: inv.projectId ? 'project' : 'org',
    project: inv.project ? { id: inv.project.id, name: inv.project.name } : null,
    organizationName: inv.organization.name,
    invitee: {
      name: inv.invitedMember?.name ?? inv.invitedName ?? '',
      // 招待先メールは invitations.email が正 (参加者行のメールは任意化され null 可)
      email: inv.email,
      organizationName: inv.invitedMember?.organizationName || (inv.organizationName ?? ''),
      roleType: inv.roleType as ProjectRole,
    },
    expiresAt: inv.expiresAt.toISOString(),
  };
}

/**
 * 招待を受諾する (#160 で組織単位の招待に対応)。
 *
 * 共通:
 *   - 招待メールとログインメールの一致を確認する (不一致は 403)
 *   - 枠 (座席 or 閲覧者) の空きを確認する
 *   - 組織メンバーとして追加し、招待に指定されたロールを既定ロールにする
 *   - アカウント側の所属名 / 職種が空なら招待の値を引き継ぐ (#156)
 *
 * プロジェクト単位: 招待された参加者行にユーザーを紐づける。
 * 組織単位: 同じ組織のプロジェクトで、同じメールの**未紐付けの参加者行**をまとめて
 *   紐づける。招待時にプロジェクトを選んでいた場合も、招待中に管理者が追加した場合も、
 *   これ 1 つで拾える。
 */
export async function acceptInvitation(input: {
  rawToken: string;
  currentUserId: string;
}): Promise<InvitationAcceptDTO> {
  const inv = await findActiveInvitation(input.rawToken);
  const roleType = inv.roleType as ProjectRole;

  const user = await prisma.user.findUnique({
    where: { id: input.currentUserId },
    select: { id: true, email: true, organizationName: true, jobTitle: true },
  });
  if (!user) throw new ApiException('PROFILE_NOT_COMPLETED', 404, 'Profile is required.');

  if (user.email.toLowerCase() !== inv.email.toLowerCase()) {
    throw new ApiException(
      'INVITATION_EMAIL_MISMATCH',
      403,
      'This invitation was sent to a different email address.',
    );
  }

  // 既にこのプロジェクトに別の member 行で参加していないか (プロジェクト招待のみ)
  if (inv.projectId && inv.invitedMemberId) {
    const dup = await prisma.projectMember.findFirst({
      where: {
        projectId: inv.projectId,
        userId: user.id,
        id: { not: inv.invitedMemberId },
        deletedAt: null,
      },
      select: { id: true },
    });
    if (dup) {
      throw new ApiException('ALREADY_MEMBER', 409, 'You are already a member of this project.');
    }
  }

  await assertSeatAvailableForAccept(inv.organizationId, roleType);

  // 招待に入っていた氏名 / 所属名 / 職種を、アカウント側が空なら引き継ぐ (#156)。
  // 受諾後は users 側が正になるため、参加者行からは落とす。
  const invitedOrganizationName =
    inv.invitedMember?.organizationName || inv.organizationName || null;
  const invitedJobTitle = inv.invitedMember?.jobTitle ?? inv.jobTitle ?? null;
  const seedOrganizationName =
    !user.organizationName && invitedOrganizationName ? invitedOrganizationName : undefined;
  const seedJobTitle = !user.jobTitle && invitedJobTitle ? invitedJobTitle : undefined;

  const members = await prisma.$transaction(async (tx) => {
    if (seedOrganizationName !== undefined || seedJobTitle !== undefined) {
      await tx.user.update({
        where: { id: user.id },
        data: {
          ...(seedOrganizationName !== undefined && { organizationName: seedOrganizationName }),
          ...(seedJobTitle !== undefined && { jobTitle: seedJobTitle }),
        },
      });
    }

    // 紐づける参加者行を決める
    const targetIds = inv.invitedMemberId
      ? [inv.invitedMemberId]
      : (
          await tx.projectMember.findMany({
            where: {
              userId: null,
              deletedAt: null,
              email: inv.email,
              project: { organizationId: inv.organizationId, deletedAt: null },
            },
            select: { id: true },
          })
        ).map((m) => m.id);

    if (targetIds.length > 0) {
      await tx.projectMember.updateMany({
        where: { id: { in: targetIds } },
        data: {
          // 招待時に指定されたロールを付与する (FR-ROLE-03)
          userId: user.id,
          roleType,
          // アカウント紐付け後は users.organization_name / job_title が正 (#156)。
          // 参加者行に残すとプロジェクト別の上書きになり、マイページの編集が反映されない。
          organizationName: '',
          jobTitle: null,
        },
      });
    }

    await tx.invitation.update({ where: { id: inv.id }, data: { acceptedAt: new Date() } });

    // 組織の会員アカウントとして追加する。招待のロールを既定ロールにする (#160)
    await ensureOrganizationMember(tx, {
      organizationId: inv.organizationId,
      userId: user.id,
      orgRole: 'member',
      defaultProjectRole: roleType,
    });

    await tx.auditLog.create({
      data: {
        actorUserId: user.id,
        action: 'org_member_added',
        resourceType: 'invitation',
        resourceId: inv.id,
        result: 'success',
        extra: {
          scope: inv.projectId ? 'project' : 'org',
          projectId: inv.projectId,
          memberIds: targetIds,
          organizationId: inv.organizationId,
          roleType,
        },
      },
    });

    return tx.projectMember.findMany({
      where: { id: { in: targetIds } },
      select: { id: true, projectId: true, roleType: true },
    });
  });

  return {
    scope: inv.projectId ? 'project' : 'org',
    project: inv.project ? { id: inv.project.id, name: inv.project.name } : null,
    members: members.map((m) => ({
      id: m.id,
      projectId: m.projectId,
      roleType: m.roleType as ProjectRole,
    })),
  };
}

/**
 * 受諾時点での枠の空きを確認する。
 *
 * 招待作成時に空きがあっても、受諾までに満席になっている可能性がある (§7.11.1)。
 * この招待自体が既に 1 枠を押さえているので、受諾は「招待 1 → 会員 1」の振り替えに
 * すぎない。したがって自分の分を差し引いた消費数で判定する。
 */
async function assertSeatAvailableForAccept(
  organizationId: string,
  roleType: ProjectRole,
): Promise<void> {
  const entitlement = await getEntitlement(prisma, organizationId);
  if (consumesSeat(roleType)) {
    const limit = entitlement.limits.seatLimit;
    if (limit !== null && entitlement.usage.seatCount - 1 >= limit) {
      throw new ApiException(
        'SEAT_LIMIT_REACHED',
        409,
        '管理者・編集者の上限に達しているため参加できません。招待元にご連絡ください。',
        { seatLimit: limit, seatCount: entitlement.usage.seatCount },
      );
    }
    return;
  }
  const limit = entitlement.limits.viewerLimit;
  if (limit !== null && entitlement.usage.viewerCount - 1 >= limit) {
    throw new ApiException(
      'VIEWER_LIMIT_REACHED',
      409,
      '閲覧者の上限に達しているため参加できません。招待元にご連絡ください。',
      { viewerLimit: limit, viewerCount: entitlement.usage.viewerCount },
    );
  }
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
      organization: { select: { name: true } },
      invitedMember: {
        select: {
          id: true,
          name: true,
          email: true,
          organizationName: true,
          // 受諾時にアカウント側が空なら引き継ぐ (#156)
          jobTitle: true,
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

/**
 * 招待からそのままアカウントを作り、組織に参加させる (#233)。
 *
 * **確認メールを 2 通目として送らない**のがこの関数の存在理由。招待メールを
 * 受け取れている時点でそのアドレスの所有は確かめられているので、Supabase 側は
 * `email_confirm: true` で作る。従来はここでマジックリンクを送っており、
 * 招待された人は「招待メール → 確認メール」と 2 通を行き来させられていた。
 *
 * 手順と順序の理由:
 *   1. 招待の検証 → 2. 既存アカウントの確認 → 3. 枠の確認
 *      …作る前に落ちる条件を全部見る。auth 側だけ作られて宙に浮くのを避ける
 *   4. Supabase Auth のユーザーを作る (既に auth 側だけ居るならパスワードを設定)
 *   5. users / organizations の行を作る (completeSignup と同じ形)
 *   6. 招待を受諾する
 *
 * 5 以降で落ちたら、**4 でこちらが作った場合に限り** auth ユーザーを消して戻す。
 * 元から居た人の認証情報を巻き添えで消さないための区別。
 */
export async function signupWithInvitation(input: {
  rawToken: string;
  fullName: string;
  displayName: string;
  password: string;
}): Promise<InvitationSignupDTO> {
  const inv = await findActiveInvitation(input.rawToken);
  const email = inv.email.toLowerCase();

  // 既にアカウントがある人はこの経路を使わない (ログインして受諾する)
  const existingProfile = await prisma.user.findFirst({
    where: { email, deletedAt: null },
    select: { primaryAuthMethod: true },
  });
  if (existingProfile) {
    throw new ApiException(
      'EMAIL_ALREADY_REGISTERED',
      409,
      'このメールアドレスは登録済みです。ログインしてから招待を受けてください。',
      { primaryAuthMethod: existingProfile.primaryAuthMethod },
    );
  }

  // 満席なら作る前に断る。作ってから受諾で弾くと、宙に浮いたアカウントが残る
  await assertSeatAvailableForAccept(inv.organizationId, inv.roleType as ProjectRole);

  const supabase = getSupabaseAdmin();
  let authUserId: string;
  let createdAuthUser = false;

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email,
    password: input.password,
    // 招待メールが届いている = このアドレスの所有は確認済み
    email_confirm: true,
  });

  if (createError) {
    // マジックリンクだけ踏んでプロフィール登録まで進まなかった人は、
    // auth 側にだけ行が残っている。ここで行き止まりにすると
    // 「登録もログインもできない」状態になるため、拾ってパスワードを設定する。
    const existingAuthUser = await findAuthUserByEmail(email);
    if (!existingAuthUser) {
      throw new ApiException('SUPABASE_CREATE_FAILED', 500, createError.message);
    }
    const { error: updateError } = await supabase.auth.admin.updateUserById(existingAuthUser.id, {
      password: input.password,
      email_confirm: true,
    });
    if (updateError) {
      throw new ApiException('SUPABASE_UPDATE_FAILED', 500, updateError.message);
    }
    authUserId = existingAuthUser.id;
  } else {
    if (!created.user) {
      throw new ApiException('SUPABASE_CREATE_FAILED', 500, 'Auth user was not created.');
    }
    authUserId = created.user.id;
    createdAuthUser = true;
  }

  try {
    // completeSignup と同じ形で作る。招待された人にも個人組織を持たせるのは、
    // 招待元の組織から抜けたあとも自分の契約主体が要るため (§7.3.1)。
    const userId = uuidv7();
    const organizationId = uuidv7();
    await prisma.$transaction([
      prisma.user.create({
        data: {
          id: userId,
          authUserId,
          email,
          fullName: input.fullName,
          displayName: input.displayName,
          primaryAuthMethod: 'password',
        },
      }),
      prisma.organization.create({
        data: {
          id: organizationId,
          name: defaultOrganizationName(input.displayName),
          ownerUserId: userId,
        },
      }),
      prisma.organizationMember.create({
        data: { organizationId, userId, orgRole: 'owner', isPrimary: true },
      }),
      prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'complete_signup',
          resourceType: 'user',
          resourceId: userId,
          result: 'success',
          // 通常のサインアップと区別できるようにしておく (経路別の追跡用)
          extra: { source: 'invitation', invitationId: inv.id },
        },
      }),
    ]);

    // 所属名 / 職種の引き継ぎ・参加者行の紐付け・組織への追加はここが全部やる
    const accepted = await acceptInvitation({ rawToken: input.rawToken, currentUserId: userId });
    return { email, accepted };
  } catch (err) {
    if (createdAuthUser) {
      // 認証だけ作られてプロフィールが無い状態を残さない。
      // 消せなくても元の失敗を返す (握りつぶすと原因が分からなくなる)。
      const { error: deleteError } = await supabase.auth.admin.deleteUser(authUserId);
      if (deleteError) {
        console.error('[signupWithInvitation] failed to roll back auth user:', deleteError);
      }
    }
    throw err;
  }
}
