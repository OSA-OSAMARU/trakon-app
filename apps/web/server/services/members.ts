import { prisma } from '@trakon/db';
import { resolveMemberProfile } from '@trakon/shared';

import { signAvatarUrls } from '../lib/avatarStorage.js';
import type { JobTitle, MemberType, ProjectRole } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import { assertExactIdSet } from './items.js';
import type { AddMembersBody, UpdateMemberBody } from '../schemas/members.js';

export type MemberDTO = {
  id: string;
  userId: string | null;
  name: string;
  /**
   * 表示用メール。アカウント紐付け済みなら users の通知先メール
   * (未設定ならログイン用メール)、未紐付けなら参加者行のメール (#156)
   */
  email: string | null;
  /** 所属名。アカウント紐付け済みなら users 側が正 (#156) */
  organizationName: string;
  memberType: MemberType;
  /** 職種 (#147)。アカウント紐付け済みなら users 側が正 (#156)。権限には影響しない */
  jobTitle: JobTitle | null;
  /**
   * プロフィール画像の表示 URL (#157)。非公開バケットの署名付き URL (1 時間有効)。
   * アカウント未紐付け・未設定・署名失敗は null。
   */
  avatarUrl: string | null;
  /** 権限ロール (FR-ROLE-01)。操作権限の唯一の根拠 */
  roleType: ProjectRole;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * 参加者行に紐付くアカウントの、プロフィール解決に必要な列だけ (#156)。
 * すべての findMany / update でこの include を使う。
 */
export const MEMBER_USER_SELECT = {
  select: {
    organizationName: true,
    jobTitle: true,
    notificationEmail: true,
    email: true,
    avatarPath: true,
  },
} as const;

type MemberUserRow = {
  organizationName: string | null;
  jobTitle: string | null;
  notificationEmail: string | null;
  email: string;
  avatarPath: string | null;
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
  user?: MemberUserRow | null;
}): MemberDTO {
  // 所属名 / 職種 / メール / アイコンは users を正とする (#156)。
  // アカウント未紐付けの表示専用メンバーは参加者行の値がそのまま使われる。
  const profile = resolveMemberProfile({
    member: {
      name: m.name,
      organizationName: m.organizationName,
      jobTitle: m.jobTitle,
      email: m.email,
    },
    user: m.user ?? null,
  });
  return {
    id: m.id,
    userId: m.userId,
    name: profile.name,
    email: profile.email,
    organizationName: profile.organizationName,
    memberType: m.memberType as MemberType,
    jobTitle: (profile.jobTitle as JobTitle | null) ?? null,
    // 署名は一覧全体でまとめて行う (attachSignedAvatars)。ここでは未署名の null にしておく
    avatarUrl: null,
    roleType: m.roleType as ProjectRole,
    sortOrder: m.sortOrder,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/**
 * 一覧のアイコン URL をまとめて署名する (#157)。
 * N 人分を 1 回の呼び出しで済ませるため、DTO 変換とは分けている。
 */
async function attachSignedAvatars<T extends { id: string; avatarUrl: string | null }>(
  dtos: T[],
  pathById: Map<string, string | null>,
): Promise<T[]> {
  const paths = [...pathById.values()].filter((p): p is string => !!p);
  if (paths.length === 0) return dtos;
  const signed = await signAvatarUrls(paths);
  return dtos.map((d) => {
    const path = pathById.get(d.id);
    return path ? { ...d, avatarUrl: signed.get(path) ?? null } : d;
  });
}

export async function listMembers(projectId: string): Promise<MemberDTO[]> {
  const rows = await prisma.projectMember.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    include: { user: MEMBER_USER_SELECT },
  });
  return attachSignedAvatars(
    rows.map((m) => toDTO(m)),
    new Map(rows.map((m) => [m.id, m.user?.avatarPath ?? null])),
  );
}

/**
 * 参加者を追加。参加者はスケジュール上の担当者として登録するもので、
 * メールは任意・自動招待やメール送信は行わない。
 * (メールは将来フェーズで「予定変更時の共有リンク自動送信」に使用予定)
 */
/**
 * 組織メンバーをプロジェクトへ追加する (#202)。
 *
 * 氏名・メール・所属・職種は `users` 側が正 (#156) なので、入力では受け取らず
 * アカウントから引く。`organization_name` / `job_title` はアカウント紐付け済みの
 * 参加者行では空にしておく (残すとプロジェクト別の上書きになり、マイページの
 * 編集が反映されなくなる — invitations.ts の受諾処理と同じ扱い)。
 */
export async function addMembers(input: {
  projectId: string;
  organizationId: string;
  body: AddMembersBody;
}): Promise<MemberDTO[]> {
  const userIds = input.body.members.map((m) => m.userId);
  if (new Set(userIds).size !== userIds.length) {
    throw new ApiException('DUPLICATE_MEMBER', 422, '同じメンバーが複数回指定されています。');
  }

  // 組織に所属していない相手は追加できない。組織外の人はまず
  // 「メンバー管理」から組織へ招待してもらう、という一本道にしている。
  const orgMembers = await prisma.organizationMember.findMany({
    where: { organizationId: input.organizationId, userId: { in: userIds }, deletedAt: null },
    select: {
      userId: true,
      defaultProjectRole: true,
      user: { select: { id: true, displayName: true, email: true, deletedAt: true } },
    },
  });
  const byUserId = new Map(
    orgMembers.filter((om) => om.user.deletedAt === null).map((om) => [om.userId, om]),
  );
  for (const id of userIds) {
    if (!byUserId.has(id)) {
      throw new ApiException(
        'NOT_ORGANIZATION_MEMBER',
        422,
        'この組織のメンバーではないため追加できません。',
        { userId: id },
      );
    }
  }

  // 既にこのプロジェクトに居る相手は弾く
  const existing = await prisma.projectMember.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    select: { userId: true, email: true },
  });
  const takenUserIds = new Set(existing.flatMap((m) => (m.userId ? [m.userId] : [])));
  const takenEmails = new Set(existing.flatMap((m) => (m.email ? [m.email.toLowerCase()] : [])));
  for (const id of userIds) {
    const om = byUserId.get(id)!;
    if (takenUserIds.has(id)) {
      throw new ApiException('ALREADY_MEMBER', 409, '既にこのプロジェクトの参加者です。', {
        userId: id,
      });
    }
    // アカウント紐付け前の参加者行がメールで残っている場合も重複になる
    if (takenEmails.has(om.user.email.toLowerCase())) {
      throw new ApiException(
        'MEMBER_EMAIL_TAKEN',
        409,
        `Email already exists in this project: ${om.user.email}`,
        { email: om.user.email },
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
      const om = byUserId.get(m.userId)!;
      const member = await tx.projectMember.create({
        data: {
          projectId: input.projectId,
          userId: om.user.id,
          name: om.user.displayName,
          email: om.user.email,
          // アカウント紐付け済みの行は users 側が正 (#156)
          organizationName: '',
          jobTitle: null,
          memberType: m.memberType,
          roleType: m.roleType ?? (om.defaultProjectRole as ProjectRole),
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
    include: { user: MEMBER_USER_SELECT },
  });
  const dto = toDTO(updated);
  const [withAvatar] = await attachSignedAvatars(
    [dto],
    new Map([[dto.id, updated.user?.avatarPath ?? null]]),
  );
  return withAvatar ?? dto;
}

/**
 * プロジェクトの管理者が 0 名にならないことを保証する (FR-ROLE-03)。
 *
 * 作成者は role_type によらず常に管理者として扱われる (FR-ROLE-04) ため、
 * 作成者の member 行が残っていれば管理者は必ず 1 名以上いる。
 */
export async function assertNotLastAdmin(projectId: string, excludeMemberId: string): Promise<void> {
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
