import { randomUUID } from 'node:crypto';

import { prisma } from '@trakon/db';

import { signTestJwt } from './auth.js';

// =============================================================================
// 統合テスト用ファクトリ — Prisma で直接レコードを投入する。
// 既定値で必須カラムを満たし、overrides で個別に上書きできる。
// =============================================================================

let seq = 0;
const uniq = () => `${Date.now().toString(36)}-${seq++}`;

export async function createUser(overrides: Partial<{
  authUserId: string;
  email: string;
  fullName: string;
  displayName: string;
  primaryAuthMethod: string;
}> = {}) {
  const tag = uniq();
  return prisma.user.create({
    data: {
      authUserId: overrides.authUserId ?? randomUUID(),
      email: overrides.email ?? `user-${tag}@example.test`,
      fullName: overrides.fullName ?? `User ${tag}`,
      displayName: overrides.displayName ?? `user-${tag}`,
      primaryAuthMethod: overrides.primaryAuthMethod ?? 'password',
    },
  });
}

export async function createProject(args: {
  createdBy: string;
  name?: string;
  startDate?: Date;
  endDate?: Date;
  status?: string;
  archivedAt?: Date | null;
}) {
  return prisma.project.create({
    data: {
      name: args.name ?? `Project ${uniq()}`,
      startDate: args.startDate ?? new Date('2026-01-01'),
      endDate: args.endDate ?? new Date('2026-12-31'),
      status: args.status ?? 'active',
      archivedAt: args.archivedAt ?? null,
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
  memberType?: 'client' | 'production';
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
  fromMemberId?: string | null;
  toMemberId?: string | null;
  status?: string;
}) {
  return prisma.plan.create({
    data: {
      itemId: args.itemId,
      title: args.title ?? `Plan ${uniq()}`,
      category: args.category ?? 'design',
      scheduledDate: args.scheduledDate ?? new Date('2026-06-01'),
      dueDate: args.dueDate ?? null,
      fromMemberId: args.fromMemberId ?? null,
      toMemberId: args.toMemberId ?? null,
      status: args.status ?? 'active',
    },
  });
}

export async function createBallEvent(args: {
  planId: string;
  eventType: 'tossed' | 'completed' | 'toss_undone' | 'completion_undone';
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
  });
  const token = await signTestJwt({
    authUserId: user.authUserId,
    email: user.email,
  });
  return { user, project, member, token };
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
