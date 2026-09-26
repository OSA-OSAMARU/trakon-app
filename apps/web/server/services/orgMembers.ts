import { prisma } from '@trakon/db';
import {
  consumesSeat,
  deriveBallHolder,
  pickLatestBallEvent,
  resolveMemberProfile,
  type BallEventType,
  type JobTitle,
  type OrgRole,
  type ProjectRole,
} from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import { signAvatarUrls } from '../lib/avatarStorage.js';
import { getMailer } from '../lib/mailer.js';
import { defaultInvitationExpiresAt, generateInvitationToken } from '../lib/tokens.js';
import { getEntitlement } from './billing/entitlement.js';
import { assertNotLastAdmin } from './members.js';
import { assertInvitationAllowed } from './projectInvitations.js';

/**
 * 組織のメンバー管理 (#160) — Figma node 406:22
 *
 * この画面が扱うのは **「座席の台帳」**、つまり課金の枠を消費しているアカウントの一覧。
 * フリープランの「予定上に表示されるだけの参加者」(project_members.user_id IS NULL) は
 * アカウントを持たないので、ここには出てこない。これが #160 の言う
 * 「メンバー管理の概念の差別化」の実体になる。
 *
 * 一覧には**保留中の招待も混ぜる**。招待中も枠を押さえているので、
 * 「3 / 5 名 利用中」の内訳が画面で完結しないと利用者が数を合わせられない。
 */

export type OrgMemberDTO = {
  /** 受諾済みのメンバーのみ。招待中は null */
  userId: string | null;
  /** 招待中のみ。取り消しに使う */
  invitationId: string | null;
  status: 'active' | 'invited';
  name: string;
  organizationName: string | null;
  /** 通知先メール (未設定ならログイン用メール)。招待中は招待先メール */
  email: string;
  jobTitle: JobTitle | null;
  avatarUrl: string | null;
  /** 課金操作の可否。招待中は null */
  orgRole: OrgRole | null;
  /** 画面の「権限」列。招待中は招待時に指定されたロール */
  defaultProjectRole: ProjectRole;
  /** 参加しているプロジェクト数 (この組織のもののみ)。招待中は 0 */
  projectCount: number;
  /** 受諾日時。招待中は null */
  joinedAt: string | null;
  /** 招待の有効期限。受諾済みは null */
  expiresAt: string | null;
};

export async function listOrgMembers(organizationId: string): Promise<OrgMemberDTO[]> {
  const [members, invitations] = await Promise.all([
    prisma.organizationMember.findMany({
      where: { organizationId, deletedAt: null },
      orderBy: [{ joinedAt: 'asc' }],
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            displayName: true,
            organizationName: true,
            jobTitle: true,
            notificationEmail: true,
            email: true,
            avatarPath: true,
          },
        },
      },
    }),
    prisma.invitation.findMany({
      where: {
        organizationId,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      include: { invitedMember: { select: { name: true, organizationName: true } } },
    }),
  ]);

  // 参加プロジェクト数はまとめて 1 クエリで数える (人数分ループしない)
  const userIds = members.map((m) => m.userId);
  const projectCounts = new Map<string, number>();
  if (userIds.length > 0) {
    const rows = await prisma.projectMember.groupBy({
      by: ['userId'],
      where: {
        userId: { in: userIds },
        deletedAt: null,
        project: { organizationId, deletedAt: null },
      },
      _count: { _all: true },
    });
    for (const r of rows) {
      if (r.userId) projectCounts.set(r.userId, r._count._all);
    }
  }

  const signed = await signAvatarUrls(
    members.map((m) => m.user.avatarPath).filter((p): p is string => !!p),
  );

  const active: OrgMemberDTO[] = members.map((m) => {
    // 表示名・所属名・職種・メールの解決は参加者一覧と同じ関数を通す (#156 / #254)
    const profile = resolveMemberProfile({
      member: { name: m.user.fullName, organizationName: '', jobTitle: null, email: null },
      user: m.user,
    });
    return {
      userId: m.userId,
      invitationId: null,
      status: 'active',
      // 表示名を全画面で揃える (#254)。fullName は表示名が空のときの保険
      name: profile.name,
      organizationName: profile.organizationName || null,
      email: profile.email ?? m.user.email,
      jobTitle: profile.jobTitle as JobTitle | null,
      avatarUrl: m.user.avatarPath ? (signed.get(m.user.avatarPath) ?? null) : null,
      orgRole: m.orgRole as OrgRole,
      defaultProjectRole: m.defaultProjectRole as ProjectRole,
      projectCount: projectCounts.get(m.userId) ?? 0,
      joinedAt: m.joinedAt.toISOString(),
      expiresAt: null,
    };
  });

  const pending: OrgMemberDTO[] = invitations.map((inv) => ({
    userId: null,
    invitationId: inv.id,
    status: 'invited',
    name: inv.invitedMember?.name ?? inv.invitedName ?? inv.email,
    // 招待中は本人がまだ何も設定していないので「—」を出せるよう null にする
    organizationName: inv.invitedMember?.organizationName || inv.organizationName || null,
    email: inv.email,
    jobTitle: (inv.jobTitle as JobTitle | null) ?? null,
    avatarUrl: null,
    orgRole: null,
    defaultProjectRole: inv.roleType as ProjectRole,
    projectCount: 0,
    joinedAt: null,
    expiresAt: inv.expiresAt.toISOString(),
  }));

  return [...active, ...pending];
}

/**
 * 組織の既定ロールを変更し、**その人のプロジェクト参加者行にも反映する** (#160)。
 *
 * 反映まで行うのは、Figma の確認ダイアログ (node 418:22) が
 * 「管理者になると…TOSS などが行えるようになります」と実際の権限変更として説明しているため。
 * 既定値だけ変えて既存プロジェクトの権限が変わらないと、この説明が嘘になる。
 *
 * 副作用として、プロジェクトごとに意図して変えていた権限は上書きされる。
 * プロジェクト単位で個別に調整したい場合は参加者管理 (SC-11) 側で行う。
 */
export async function changeDefaultProjectRole(input: {
  organizationId: string;
  targetUserId: string;
  defaultProjectRole: ProjectRole;
  actorUserId: string;
}): Promise<{ userId: string; defaultProjectRole: ProjectRole; affectedProjectIds: string[] }> {
  const target = await prisma.organizationMember.findFirst({
    where: { organizationId: input.organizationId, userId: input.targetUserId, deletedAt: null },
    select: { id: true, orgRole: true, defaultProjectRole: true },
  });
  if (!target) throw new ApiException('NOT_FOUND', 404, 'Organization member not found.');

  const from = target.defaultProjectRole as ProjectRole;
  const to = input.defaultProjectRole;
  if (from === to) {
    return { userId: input.targetUserId, defaultProjectRole: to, affectedProjectIds: [] };
  }

  // オーナーは常に管理者。降格させると自分の組織から締め出される
  if (target.orgRole === 'owner' && to !== 'admin') {
    throw new ApiException('CANNOT_CHANGE_OWNER', 409, '組織のオーナーは常に管理者です。');
  }

  // 閲覧者 → 管理者/編集者 は座席を 1 つ消費する。空きが無ければ拒否する。
  // これが無いと「閲覧者で招待して後から昇格」で座席上限を回避できてしまう。
  if (!consumesSeat(from) && consumesSeat(to)) {
    const entitlement = await getEntitlement(prisma, input.organizationId);
    if (!entitlement.canInviteMember) {
      throw new ApiException(
        'SEAT_LIMIT_REACHED',
        409,
        `管理者・編集者の上限 (${entitlement.limits.seatLimit} 名) に達しているため昇格できません。`,
        {
          seatLimit: entitlement.limits.seatLimit,
          seatCount: entitlement.usage.seatCount,
        },
      );
    }
  }

  const memberRows = await prisma.projectMember.findMany({
    where: {
      userId: input.targetUserId,
      deletedAt: null,
      project: { organizationId: input.organizationId, deletedAt: null },
    },
    select: { id: true, projectId: true, roleType: true },
  });

  // 管理者を 0 名にしてしまうプロジェクトが無いか、先にすべて確かめる。
  // 途中まで書き換えてから失敗するのを防ぐため、更新の前に検証する。
  if (to !== 'admin') {
    for (const row of memberRows) {
      if (row.roleType === 'admin') await assertNotLastAdmin(row.projectId, row.id);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.organizationMember.update({
      where: { id: target.id },
      data: { defaultProjectRole: to },
    });
    if (memberRows.length > 0) {
      await tx.projectMember.updateMany({
        where: { id: { in: memberRows.map((r) => r.id) } },
        data: { roleType: to },
      });
    }
    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'project_role_changed',
        resourceType: 'organization',
        resourceId: input.organizationId,
        result: 'success',
        extra: {
          targetUserId: input.targetUserId,
          from,
          to,
          projectIds: memberRows.map((r) => r.projectId),
        },
      },
    });
  });

  return {
    userId: input.targetUserId,
    defaultProjectRole: to,
    affectedProjectIds: memberRows.map((r) => r.projectId),
  };
}

export type MemberProjectDTO = {
  projectId: string;
  projectName: string;
  /** その人のプロジェクト参加者行 id。「プロジェクトから外す」に使う */
  memberId: string;
  roleType: ProjectRole;
  /** その人がボールを持っている予定の数 */
  ballHolderCount: number;
};

/**
 * その人が参加しているプロジェクト一覧 (#160 の参加PJ ドロワー)。
 *
 * ボール保持数はダッシュボードと同じ導出 (deriveBallHolder) を使う。
 * 「外して大丈夫か」の判断材料なので、渡ったあと (tossed) と完了は数えない。
 */
export async function listMemberProjects(
  organizationId: string,
  userId: string,
): Promise<MemberProjectDTO[]> {
  const rows = await prisma.projectMember.findMany({
    where: {
      userId,
      deletedAt: null,
      project: { organizationId, deletedAt: null },
    },
    select: {
      id: true,
      roleType: true,
      project: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (rows.length === 0) return [];

  const memberIds = rows.map((r) => r.id);
  const plans = await prisma.plan.findMany({
    where: {
      deletedAt: null,
      status: 'active',
      item: { projectId: { in: rows.map((r) => r.project.id) }, deletedAt: null },
      OR: [
        { executorMemberId: { in: memberIds } },
        { approverMemberId: { in: memberIds } },
        { progressManagerMemberId: { in: memberIds } },
        { toMemberId: { in: memberIds } },
      ],
    },
    select: {
      executorMemberId: true,
      approverMemberId: true,
      progressManagerMemberId: true,
      toMemberId: true,
      status: true,
      item: { select: { projectId: true } },
      ballEvents: {
        orderBy: { occurredAt: 'desc' },
        take: 1,
        select: { eventType: true, source: true, occurredAt: true },
      },
    },
  });

  const holdingByProject = new Map<string, number>();
  for (const plan of plans) {
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
    // 渡したあと・完了は「対応待ち」ではない (dashboard と同じ扱い)
    if (!holder.memberId || holder.state === 'completed' || holder.state === 'tossed') continue;
    if (!memberIds.includes(holder.memberId)) continue;
    const projectId = plan.item.projectId;
    holdingByProject.set(projectId, (holdingByProject.get(projectId) ?? 0) + 1);
  }

  return rows.map((r) => ({
    projectId: r.project.id,
    projectName: r.project.name,
    memberId: r.id,
    roleType: r.roleType as ProjectRole,
    ballHolderCount: holdingByProject.get(r.project.id) ?? 0,
  }));
}


// -----------------------------------------------------------------------------
// 組織単位の招待 (#160)
// -----------------------------------------------------------------------------

export type CreateOrgInvitationInput = {
  organizationId: string;
  actorUserId: string;
  origin: string;
  body: {
    name: string;
    email: string;
    organizationName?: string;
    jobTitle?: JobTitle | null;
    roleType: ProjectRole;
    /** 任意。選ばれたプロジェクトには受諾前から参加者行を作る */
    projectIds?: string[];
  };
};

/**
 * 組織へ招待する (Figma node 409:22)。
 *
 * プロジェクトの選択は任意にしている。デザイン上は「組織に招く」だけだが、
 * 受諾した人が何も見えない状態で入ってくるのを避けたいので、招待時に
 * プロジェクトを選べるようにした (0 件でも成立する)。
 *
 * 選ばれたプロジェクトには**受諾前から参加者行を作る**。招待した側の画面に
 * 「招待中」として並び、受諾で user_id が埋まるだけになる (既存のプロジェクト招待と同じ形)。
 */
export async function createOrgInvitation(input: CreateOrgInvitationInput): Promise<{
  invitationId: string;
  warnings?: string[];
}> {
  const { body } = input;
  const email = body.email.trim().toLowerCase();

  const [organization, inviter] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
      select: { name: true },
    }),
    prisma.user.findUnique({
      where: { id: input.actorUserId },
      select: { displayName: true },
    }),
  ]);

  // 既に組織の会員なら招待し直す意味がない
  const existing = await prisma.organizationMember.findFirst({
    where: { organizationId: input.organizationId, deletedAt: null, user: { email } },
    select: { id: true },
  });
  if (existing) {
    throw new ApiException('ALREADY_MEMBER', 409, 'このメールアドレスは既に会員です。', { email });
  }

  const pending = await prisma.invitation.findFirst({
    where: {
      organizationId: input.organizationId,
      email,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true },
  });
  if (pending) {
    throw new ApiException('INVITATION_ALREADY_SENT', 409, 'このメールアドレスは招待中です。', {
      email,
    });
  }

  const { raw, hash } = generateInvitationToken();
  const expiresAt = defaultInvitationExpiresAt();

  const created = await prisma.$transaction(async (tx) => {
    // 枠の確認は重複チェックより後に置く。どちらも枠を増やさないケースで、
    // 「上限です」より「既に招待済みです」の方が具体的な案内になる。
    const entitlement = await getEntitlement(tx, input.organizationId);
    assertInvitationAllowed(entitlement, body.roleType);

    const invitation = await tx.invitation.create({
      data: {
        // 組織単位なので project_id / invited_member_id は NULL (ck_inv_scope)
        organizationId: input.organizationId,
        invitedByUserId: input.actorUserId,
        email,
        invitedName: body.name.trim(),
        organizationName: body.organizationName?.trim() || null,
        jobTitle: body.jobTitle ?? null,
        roleType: body.roleType,
        tokenHash: hash,
        expiresAt,
      },
      select: { id: true },
    });

    // 選ばれたプロジェクトへ、未紐付けの参加者行を用意する
    for (const projectId of body.projectIds ?? []) {
      const project = await tx.project.findFirst({
        where: { id: projectId, organizationId: input.organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!project) {
        throw new ApiException('NOT_FOUND', 404, 'Project not found.', { projectId });
      }
      const taken = await tx.projectMember.findFirst({
        where: { projectId, email, deletedAt: null },
        select: { id: true },
      });
      if (taken) continue; // 既にいるならそのまま (受諾時に紐づく)
      const last = await tx.projectMember.findFirst({
        where: { projectId, deletedAt: null },
        orderBy: { sortOrder: 'desc' },
        select: { sortOrder: true },
      });
      await tx.projectMember.create({
        data: {
          projectId,
          userId: null,
          name: body.name.trim() || email,
          email,
          // 所属名 / 職種はアカウント側 (users) を正とする (#156)。参加者行には持たせない
          organizationName: '',
          memberType: 'production',
          roleType: body.roleType,
          sortOrder: (last?.sortOrder ?? -1) + 1,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'invitation_created',
        resourceType: 'invitation',
        resourceId: invitation.id,
        result: 'success',
        extra: {
          scope: 'org',
          organizationId: input.organizationId,
          roleType: body.roleType,
          projectIds: body.projectIds ?? [],
        },
      },
    });

    return invitation;
  });

  // コミット後に送信する。失敗しても招待は残し、警告として返す
  // (送れなかったのに枠だけ埋まる状態より、再送できる方がまし)。
  const warnings: string[] = [];
  try {
    await getMailer().sendInvitation({
      to: email,
      projectName: organization.name,
      inviterName: inviter?.displayName ?? 'TRAKON',
      acceptUrl: `${input.origin}/invitations/${raw}`,
      expiresAt,
    });
  } catch (err) {
    console.error('[createOrgInvitation] failed to send invitation email:', err);
    warnings.push('招待は作成しましたが、メールの送信に失敗しました。');
  }

  return { invitationId: created.id, ...(warnings.length > 0 ? { warnings } : {}) };
}

/** 組織の招待を取り消す (枠を解放する)。 */
export async function revokeOrgInvitation(input: {
  organizationId: string;
  invitationId: string;
  actorUserId: string;
}): Promise<void> {
  const invitation = await prisma.invitation.findFirst({
    where: {
      id: input.invitationId,
      organizationId: input.organizationId,
      acceptedAt: null,
      revokedAt: null,
    },
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
        extra: { scope: 'org', organizationId: input.organizationId },
      },
    }),
  ]);
}

/**
 * 招待メールを再送する (#230)。
 *
 * 送信済みのトークンは復元できない (DB にはハッシュしか持たない) ので、
 * **新しいトークンを発行して差し替える**。したがって前のリンクは無効になる。
 * 期限も送り直した時点から数え直す。
 *
 * 監査ログの action は `invitation_created` を再利用し、`extra.resend` で区別する。
 * 許可値は DB の CHECK 制約と一致していなければならず、値を増やすには
 * マイグレーションが要る (#227)。再送は「招待を作り直す」ことそのものなので、
 * 専用の action を足すより既存の値で表すほうが実態に合う。
 */
export async function resendOrgInvitation(input: {
  organizationId: string;
  invitationId: string;
  actorUserId: string;
  origin: string;
}): Promise<{ expiresAt: string }> {
  const invitation = await prisma.invitation.findFirst({
    where: {
      id: input.invitationId,
      organizationId: input.organizationId,
      acceptedAt: null,
      revokedAt: null,
    },
    select: { id: true, email: true },
  });
  if (!invitation) throw new ApiException('NOT_FOUND', 404, 'Invitation not found.');

  const [organization, inviter] = await Promise.all([
    prisma.organization.findUniqueOrThrow({
      where: { id: input.organizationId },
      select: { name: true },
    }),
    prisma.user.findUnique({
      where: { id: input.actorUserId },
      select: { displayName: true },
    }),
  ]);

  const { raw, hash } = generateInvitationToken();
  const expiresAt = defaultInvitationExpiresAt();

  // 送信を先に試す。送れないのにトークンだけ差し替えると、
  // 手元に残っている前のリンクまで道連れで無効になってしまう。
  await getMailer().sendInvitation({
    to: invitation.email,
    projectName: organization.name,
    inviterName: inviter?.displayName ?? 'TRAKON',
    acceptUrl: `${input.origin}/invitations/${raw}`,
    expiresAt,
  });

  await prisma.$transaction([
    prisma.invitation.update({
      where: { id: invitation.id },
      data: { tokenHash: hash, expiresAt },
    }),
    prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: 'invitation_created',
        resourceType: 'invitation',
        resourceId: invitation.id,
        result: 'success',
        extra: { scope: 'org', organizationId: input.organizationId, resend: true },
      },
    }),
  ]);

  return { expiresAt: expiresAt.toISOString() };
}
