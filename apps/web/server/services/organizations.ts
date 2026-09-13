// -----------------------------------------------------------------------------
// 組織 (課金の契約主体) — 設計書 §7.3 / §2.4.10 / §2.4.11
//
// ユーザー登録時に本人をオーナーとする「個人組織」を自動作成する。Personal も
// 「会員 1 名の組織」として扱い、Personal と Team でデータモデルを分けない。
//
// 座席 (会員アカウント数) のカウントは organization_members だけでは足りない。
// 未受諾かつ有効期限内の招待も 1 座席を消費する。そうしないと招待を大量に送って
// から一斉に受諾させることで上限を超えられてしまう (§7.3.2)。
// -----------------------------------------------------------------------------
import type { Prisma } from '@prisma/client';

import { SEAT_CONSUMING_PROJECT_ROLES } from '@trakon/shared';

import type { prisma } from '@trakon/db';
import type { OrgRole, ProjectRole } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';

/** Prisma のトランザクションクライアント、または通常のクライアント */
type Db = Prisma.TransactionClient | typeof prisma;

export type OrganizationMembership = {
  organizationId: string;
  orgRole: OrgRole;
};

/** 組織名の既定値。表示名が長い場合は列の長さ制限 (255) に収まるよう切り詰める */
export function defaultOrganizationName(displayName: string): string {
  return `${displayName.slice(0, 240)} の組織`;
}

/**
 * ユーザーの個人組織を作成する (存在すれば何もしない)。
 *
 * サインアップ経路が複数ある (complete-signup / OAuth sync) ため、
 * どちらからも同じ関数を呼ぶ。呼び出し元のトランザクションに参加できるよう
 * db を受け取る。
 */
export async function ensureOrganizationForUser(
  db: Db,
  input: { userId: string; displayName: string },
): Promise<{ organizationId: string }> {
  const existing = await db.organization.findUnique({
    where: { ownerUserId: input.userId },
    select: { id: true },
  });
  if (existing) {
    await ensureOrganizationMember(db, {
      organizationId: existing.id,
      userId: input.userId,
      orgRole: 'owner',
      // オーナーは常に管理者 (#160)。自分の組織から締め出されないための最終防衛線
      defaultProjectRole: 'admin',
      isPrimary: true,
    });
    return { organizationId: existing.id };
  }

  const organization = await db.organization.create({
    data: {
      name: defaultOrganizationName(input.displayName),
      ownerUserId: input.userId,
    },
    select: { id: true },
  });
  await db.organizationMember.create({
    data: {
      organizationId: organization.id,
      userId: input.userId,
      orgRole: 'owner',
      // オーナーは常に管理者 (#160)
      defaultProjectRole: 'admin',
      isPrimary: true,
    },
  });
  return { organizationId: organization.id };
}

/**
 * 組織へ会員を追加する。論理削除済みの行があれば復活させる。
 *
 * uq_om_org_user は deleted_at を含まないフル UNIQUE なので、再招待では
 * INSERT ではなく既存行の復活になる (uq_pm_project_email と同じ流儀)。
 */
export async function ensureOrganizationMember(
  db: Db,
  input: {
    organizationId: string;
    userId: string;
    orgRole?: OrgRole;
    /** 組織での既定のプロジェクト権限 (#160)。座席を消費するかを決める */
    defaultProjectRole?: ProjectRole;
    isPrimary?: boolean;
  },
): Promise<{ id: string; created: boolean }> {
  const existing = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: { organizationId: input.organizationId, userId: input.userId },
    },
    select: { id: true, deletedAt: true },
  });

  if (existing) {
    if (existing.deletedAt) {
      await db.organizationMember.update({
        where: { id: existing.id },
        data: {
          deletedAt: null,
          joinedAt: new Date(),
          ...(input.orgRole ? { orgRole: input.orgRole } : {}),
          ...(input.defaultProjectRole ? { defaultProjectRole: input.defaultProjectRole } : {}),
        },
      });
      return { id: existing.id, created: true };
    }
    return { id: existing.id, created: false };
  }

  const row = await db.organizationMember.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      orgRole: input.orgRole ?? 'member',
      defaultProjectRole: input.defaultProjectRole ?? 'editor',
      isPrimary: input.isPrimary ?? false,
    },
    select: { id: true },
  });
  return { id: row.id, created: true };
}

/**
 * ユーザーの既定の所属組織を解決する。
 *
 * is_primary が立っている行を優先し、無ければ最初に参加した組織を使う。
 * どこにも所属していない場合は 404 (プロフィール未完了と同じ扱い)。
 */
export async function resolvePrimaryOrganization(
  db: Db,
  userId: string,
): Promise<OrganizationMembership> {
  const membership = await db.organizationMember.findFirst({
    where: { userId, deletedAt: null, organization: { deletedAt: null } },
    orderBy: [{ isPrimary: 'desc' }, { joinedAt: 'asc' }],
    select: { organizationId: true, orgRole: true },
  });
  if (!membership) {
    throw new ApiException(
      'ORGANIZATION_NOT_FOUND',
      404,
      'No organization is associated with this user.',
    );
  }
  return {
    organizationId: membership.organizationId,
    orgRole: membership.orgRole as OrgRole,
  };
}

/**
 * 座席 (管理者・編集者) と閲覧者の消費数 (§7.3.2 / #160)。
 *
 * 有効な組織メンバー + **未受諾かつ有効期限内の招待**を数える。
 * 招待中も枠を押さえないと、大量に招待してから一斉受諾で上限を超えられる。
 *
 * **閲覧者は座席を消費しない** (Figma node 263:18)。編集を一切行えないため。
 * ただし無制限に増やせると「安いプランで閲覧アカウントを配り放題」になるので、
 * 閲覧者にも別枠の上限 (BillingPlanSpec.viewerLimit) を設けて数える。
 */
export async function countSeatUsage(
  db: Db,
  organizationId: string,
): Promise<{ seatCount: number; viewerCount: number }> {
  const seatRoles = [...SEAT_CONSUMING_PROJECT_ROLES];
  const pendingInvitation = {
    organizationId,
    acceptedAt: null,
    revokedAt: null,
    expiresAt: { gt: new Date() },
  } as const;

  const [seatMembers, seatInvitations, viewerMembers, viewerInvitations] = await Promise.all([
    db.organizationMember.count({
      where: { organizationId, deletedAt: null, defaultProjectRole: { in: seatRoles } },
    }),
    db.invitation.count({ where: { ...pendingInvitation, roleType: { in: seatRoles } } }),
    db.organizationMember.count({
      where: { organizationId, deletedAt: null, defaultProjectRole: 'viewer' },
    }),
    db.invitation.count({ where: { ...pendingInvitation, roleType: 'viewer' } }),
  ]);

  return {
    seatCount: seatMembers + seatInvitations,
    viewerCount: viewerMembers + viewerInvitations,
  };
}

/**
 * プロジェクト数。プランの上限判定に使う。
 * アーカイブ済みは対象外 (= 枠を空ける正規の動線、§7.11.2)。
 */
export async function countActiveProjects(db: Db, organizationId: string): Promise<number> {
  return db.project.count({
    where: { organizationId, deletedAt: null, archivedAt: null },
  });
}
