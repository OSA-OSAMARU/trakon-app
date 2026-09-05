import { randomUUID } from 'node:crypto';

import { prisma } from '@trakon/db';

import { signTestJwt } from './auth.js';

// =============================================================================
// 統合テスト用ファクトリ — Prisma で直接レコードを投入する。
// 既定値で必須カラムを満たし、overrides で個別に上書きできる。
// =============================================================================

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${seq++}`;

/**
 * ユーザーを作る。本番の登録フロー (complete-signup / OAuth sync) と同じく
 * 個人組織 + オーナーの会員行も同時に作る (§7.3.1)。
 * これを作らないと projects.organization_id (NOT NULL) を満たせない。
 */
export async function createUser(overrides: Partial<{
  authUserId: string;
  email: string;
  fullName: string;
  displayName: string;
  primaryAuthMethod: string;
  withOrganization: boolean;
}> = {}) {
  const tag = uniq();
  const user = await prisma.user.create({
    data: {
      authUserId: overrides.authUserId ?? randomUUID(),
      email: overrides.email ?? `user-${tag}@example.test`,
      fullName: overrides.fullName ?? `User ${tag}`,
      displayName: overrides.displayName ?? `user-${tag}`,
      primaryAuthMethod: overrides.primaryAuthMethod ?? 'password',
    },
  });
  if (overrides.withOrganization !== false) {
    await createOrganization({ ownerUserId: user.id, name: `${user.displayName} の組織` });
  }
  return user;
}

/** 組織 + オーナーの会員行を作る。 */
export async function createOrganization(args: { ownerUserId: string; name?: string }) {
  const organization = await prisma.organization.create({
    data: {
      name: args.name ?? `Org ${uniq()}`,
      ownerUserId: args.ownerUserId,
    },
  });
  await prisma.organizationMember.create({
    data: {
      organizationId: organization.id,
      userId: args.ownerUserId,
      orgRole: 'owner',
      isPrimary: true,
    },
  });
  // 組織と契約行は 1:1。行が無い状態を作らず判定側の分岐を減らす (§2.4.12)
  await prisma.billingSubscription.create({
    data: { organizationId: organization.id, planCode: 'free', status: 'none' },
  });
  return organization;
}

/** 契約状態を上書きする (プラン別の上限・権限判定の検証用)。 */
export async function setBillingSubscription(args: {
  organizationId: string;
  planCode?: 'free' | 'personal' | 'team' | 'enterprise';
  status?: string;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: Date | null;
  gracePeriodEndsAt?: Date | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  pendingPlanCode?: string | null;
}) {
  return prisma.billingSubscription.update({
    where: { organizationId: args.organizationId },
    data: {
      ...(args.planCode ? { planCode: args.planCode } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.cancelAtPeriodEnd !== undefined
        ? { cancelAtPeriodEnd: args.cancelAtPeriodEnd }
        : {}),
      ...(args.currentPeriodEnd !== undefined ? { currentPeriodEnd: args.currentPeriodEnd } : {}),
      ...(args.gracePeriodEndsAt !== undefined
        ? { gracePeriodEndsAt: args.gracePeriodEndsAt }
        : {}),
      ...(args.stripeCustomerId !== undefined ? { stripeCustomerId: args.stripeCustomerId } : {}),
      ...(args.stripeSubscriptionId !== undefined
        ? { stripeSubscriptionId: args.stripeSubscriptionId }
        : {}),
      ...(args.pendingPlanCode !== undefined ? { pendingPlanCode: args.pendingPlanCode } : {}),
    },
  });
}

/** 既存組織に会員 (座席) を追加する。 */
export async function createOrgMember(args: {
  organizationId: string;
  userId: string;
  orgRole?: 'owner' | 'admin' | 'member';
  isPrimary?: boolean;
}) {
  return prisma.organizationMember.create({
    data: {
      organizationId: args.organizationId,
      userId: args.userId,
      orgRole: args.orgRole ?? 'member',
      isPrimary: args.isPrimary ?? false,
    },
  });
}

/** ユーザーの既定の所属組織 ID を引く。 */
export async function primaryOrganizationId(userId: string): Promise<string> {
  const row = await prisma.organizationMember.findFirst({
    where: { userId, deletedAt: null },
    orderBy: [{ isPrimary: 'desc' }, { joinedAt: 'asc' }],
    select: { organizationId: true },
  });
  if (!row) throw new Error(`no organization for user ${userId}`);
  return row.organizationId;
}

/**
 * プロジェクトを作る。organizationId 未指定なら作成者の既定の所属組織を使う
 * (projects.organization_id は NOT NULL)。
 */
export async function createProject(args: {
  createdBy: string;
  organizationId?: string;
  name?: string;
  startDate?: Date;
  endDate?: Date;
  status?: string;
  archivedAt?: Date | null;
  retainedAt?: Date | null;
}) {
  const organizationId = args.organizationId ?? (await primaryOrganizationId(args.createdBy));
  return prisma.project.create({
    data: {
      organizationId,
      name: args.name ?? `Project ${uniq()}`,
      startDate: args.startDate ?? new Date('2026-01-01'),
      endDate: args.endDate ?? new Date('2026-12-31'),
      status: args.status ?? 'active',
      archivedAt: args.archivedAt ?? null,
      retainedAt: args.retainedAt ?? null,
      createdBy: args.createdBy,
    },
  });
}

export async function createMember(args: {
  projectId: string;
  userId?: string | null;
  name?: string;
  email?: string;
  organizationName?: string;
  memberType?: 'client' | 'production' | 'partner';
  roleType?: 'admin' | 'editor' | 'viewer';
  sortOrder?: number;
}) {
  const tag = uniq();
  return prisma.projectMember.create({
    data: {
      projectId: args.projectId,
      userId: args.userId ?? null,
      name: args.name ?? `Member ${tag}`,
      email: args.email ?? `member-${tag}@example.test`,
      organizationName: args.organizationName ?? 'Acme',
      memberType: args.memberType ?? 'production',
      roleType: args.roleType ?? 'editor',
      sortOrder: args.sortOrder ?? 0,
    },
  });
}

export async function createItem(args: {
  projectId: string;
  name?: string;
  sortOrder?: number;
}) {
  return prisma.projectItem.create({
    data: {
      projectId: args.projectId,
      name: args.name ?? `Item ${uniq()}`,
      sortOrder: args.sortOrder ?? 0,
    },
  });
}

export async function createPlan(args: {
  itemId: string;
  title?: string;
  category?: string;
  scheduledDate?: Date;
  dueDate?: Date | null;
  // 役割 (#131)
  executorMemberId?: string | null;
  approverMemberId?: string | null;
  progressManagerMemberId?: string | null;
  // TOSS 履歴スナップショット
  fromMemberId?: string | null;
  toMemberId?: string | null;
  successorPlanId?: string | null;
  status?: string;
}) {
  return prisma.plan.create({
    data: {
      itemId: args.itemId,
      title: args.title ?? `Plan ${uniq()}`,
      category: args.category ?? 'design',
      scheduledDate: args.scheduledDate ?? new Date('2026-06-01'),
      dueDate: args.dueDate ?? null,
      executorMemberId: args.executorMemberId ?? null,
      approverMemberId: args.approverMemberId ?? null,
      progressManagerMemberId: args.progressManagerMemberId ?? null,
      fromMemberId: args.fromMemberId ?? null,
      toMemberId: args.toMemberId ?? null,
      successorPlanId: args.successorPlanId ?? null,
      status: args.status ?? 'active',
    },
  });
}

export async function createBallEvent(args: {
  planId: string;
  eventType:
    | 'tossed'
    | 'completed'
    | 'toss_undone'
    | 'completion_undone'
    | 'review_requested'
    | 'approved'
    | 'sent_back'
    | 'review_request_undone'
    | 'approval_undone';
  source?: 'human' | 'auto_chain';
  actorMemberId?: string | null;
  actorUserId?: string | null;
}) {
  return prisma.ballEvent.create({
    data: {
      planId: args.planId,
      eventType: args.eventType,
      source: args.source ?? 'human',
      actorMemberId: args.actorMemberId ?? null,
      actorUserId: args.actorUserId ?? null,
    },
  });
}

/**
 * 既存ユーザーをオーナー(管理者)とするプロジェクトを作る。
 *
 * `createProject` はプロジェクト行しか作らないため、そのままでは
 * `requireProjectMember` が通らず 404 になる。同じユーザーで複数の
 * プロジェクトを作りたい場合はこちらを使う。
 */
export async function createProjectWithAdmin(args: {
  user: { id: string; fullName: string; email: string };
  name?: string;
  archivedAt?: Date | null;
  retainedAt?: Date | null;
  organizationId?: string;
}) {
  const project = await createProject({
    createdBy: args.user.id,
    ...(args.name ? { name: args.name } : {}),
    ...(args.organizationId ? { organizationId: args.organizationId } : {}),
    archivedAt: args.archivedAt ?? null,
    retainedAt: args.retainedAt ?? null,
  });
  const member = await createMember({
    projectId: project.id,
    userId: args.user.id,
    name: args.user.fullName,
    email: args.user.email,
    memberType: 'production',
    roleType: 'admin',
  });
  return { project, member };
}

/**
 * ユーザー + プロジェクト + そのユーザーをディレクター(=createdBy)として
 * 紐づけた production メンバー + 認証トークンをまとめて用意する。
 */
export async function setupProjectWithDirector(opts: {
  memberType?: 'client' | 'production';
} = {}) {
  const user = await createUser();
  const project = await createProject({ createdBy: user.id });
  const member = await createMember({
    projectId: project.id,
    userId: user.id,
    name: user.fullName,
    email: user.email,
    memberType: opts.memberType ?? 'production',
    // 作成者は常に管理者 (FR-ROLE-04)。列にも明示しておく
    roleType: 'admin',
  });
  const token = await signTestJwt({
    authUserId: user.authUserId,
    email: user.email,
  });
  return { user, project, member, token };
}

/**
 * 既存プロジェクトに、指定ロールの参加者を 1 人追加してトークンまで用意する。
 * ロール別の認可を網羅的に検証するために使う。
 */
export async function addProjectMemberWithRole(args: {
  projectId: string;
  roleType: 'admin' | 'editor' | 'viewer';
  memberType?: 'client' | 'production' | 'partner';
}) {
  const user = await createUser();
  const member = await createMember({
    projectId: args.projectId,
    userId: user.id,
    name: user.fullName,
    email: user.email,
    memberType: args.memberType ?? 'production',
    roleType: args.roleType,
    sortOrder: 1,
  });
  const token = await signTestJwt({ authUserId: user.authUserId, email: user.email });
  return { user, member, token };
}

/** プロジェクトに参加していない別ユーザー + そのトークンを用意する。 */
export async function createOutsider() {
  const user = await createUser();
  const token = await signTestJwt({
    authUserId: user.authUserId,
    email: user.email,
  });
  return { user, token };
}
