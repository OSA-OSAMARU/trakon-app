import { prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';
import { getServerEnv } from '../lib/env.js';
import { decryptShareToken, encryptShareToken } from '../lib/tokenCipher.js';
import { generateInvitationToken, hashToken } from '../lib/tokens.js';
import type { CreateShareLinkBody, ShareScope } from '../schemas/shareLinks.js';

export type ShareLinkDTO = {
  id: string;
  projectId: string;
  scopeType: ShareScope;
  scopeTargetId: string | null;
  issuedByMemberId: string;
  issuedAt: string;
  /** null = 無期限 */
  expiresAt: string | null;
  revokedAt: string | null;
  lastAccessedAt: string | null;
  status: 'active' | 'revoked' | 'expired';
  /**
   * 共有 URL (#255)。発行後も一覧で確認・コピーできるようにするため、
   * 暗号化して保管した生トークンから組み立てて返す。
   *
   * null になるのは #255 以前に発行された行 (暗号文が無い) と、
   * 鍵が未設定 / 入れ替わった環境。**リンク自体は有効なまま**で、
   * 再表示だけができない状態を表す。
   */
  url: string | null;
};

export type CreateShareLinkResult = {
  shareLink: ShareLinkDTO;
  /** 発行時の生トークン */
  rawToken: string;
  /** FE 表示用の完全な共有 URL */
  url: string;
};

function statusOf(r: { revokedAt: Date | null; expiresAt: Date | null }): ShareLinkDTO['status'] {
  if (r.revokedAt) return 'revoked';
  if (r.expiresAt && r.expiresAt.getTime() <= Date.now()) return 'expired';
  return 'active'; // expiresAt が null なら無期限
}

function toDTO(
  r: {
    id: string;
    projectId: string;
    scopeType: string;
    scopeTargetId: string | null;
    issuedByMemberId: string;
    issuedAt: Date;
    expiresAt: Date | null;
    revokedAt: Date | null;
    lastAccessedAt: Date | null;
    tokenCipher?: string | null;
  },
  baseUrl?: string,
): ShareLinkDTO {
  const rawToken = decryptShareToken(r.tokenCipher);
  return {
    id: r.id,
    projectId: r.projectId,
    scopeType: r.scopeType as ShareScope,
    scopeTargetId: r.scopeTargetId,
    issuedByMemberId: r.issuedByMemberId,
    issuedAt: r.issuedAt.toISOString(),
    expiresAt: r.expiresAt?.toISOString() ?? null,
    revokedAt: r.revokedAt?.toISOString() ?? null,
    lastAccessedAt: r.lastAccessedAt?.toISOString() ?? null,
    status: statusOf(r),
    url: rawToken ? shareUrl(baseUrl, rawToken) : null,
  };
}

/** 共有 URL を組み立てる。baseUrl 未指定なら env の FE オリジンを使う。 */
function shareUrl(baseUrl: string | undefined, rawToken: string): string {
  return `${baseUrl ?? getServerEnv().PUBLIC_APP_URL}/share/${rawToken}`;
}

export async function listShareLinks(
  projectId: string,
  /** 共有 URL の基底オリジン。発行時と同じく、参照元と同一ドメインで組み立てる */
  baseUrl?: string,
): Promise<ShareLinkDTO[]> {
  const rows = await prisma.shareLink.findMany({
    where: { projectId },
    orderBy: { issuedAt: 'desc' },
  });
  return rows.map((r) => toDTO(r, baseUrl));
}

export async function createShareLink(input: {
  projectId: string;
  issuerMemberId: string;
  body: CreateShareLinkBody;
  /** 共有 URL の基底オリジン (発行元と同一ドメインにするため)。未指定なら env フォールバック。 */
  baseUrl?: string;
}): Promise<CreateShareLinkResult> {
  const { body } = input;

  // scope の対象が同じプロジェクト配下か確認
  if (body.scopeType === 'item') {
    const item = await prisma.projectItem.findFirst({
      where: { id: body.scopeTargetId!, projectId: input.projectId, deletedAt: null },
      select: { id: true },
    });
    if (!item) throw new ApiException('SCOPE_NOT_FOUND', 422, 'Item not found in this project.');
  } else if (body.scopeType === 'plan') {
    const plan = await prisma.plan.findFirst({
      where: { id: body.scopeTargetId!, deletedAt: null },
      include: { item: { select: { projectId: true } } },
    });
    if (!plan || plan.item.projectId !== input.projectId) {
      throw new ApiException('SCOPE_NOT_FOUND', 422, 'Plan not found in this project.');
    }
  }

  const { raw, hash } = generateInvitationToken();
  // expiresInHours が null の場合は無期限 (expiresAt = null)
  const expiresAt =
    body.expiresInHours == null
      ? null
      : new Date(Date.now() + body.expiresInHours * 60 * 60 * 1000);
  const created = await prisma.shareLink.create({
    data: {
      projectId: input.projectId,
      scopeType: body.scopeType,
      scopeTargetId: body.scopeType === 'project' ? null : body.scopeTargetId!,
      tokenHash: hash,
      // 一覧で URL を再表示するための暗号文 (#255)。鍵が無ければ NULL のまま
      tokenCipher: encryptShareToken(raw),
      issuedByMemberId: input.issuerMemberId,
      expiresAt,
    },
  });

  // 監査ログ (share_create)
  await prisma.auditLog.create({
    data: {
      shareLinkId: created.id,
      action: 'share_create',
      resourceType: 'share_link',
      resourceId: created.id,
      result: 'success',
    },
  });

  return {
    shareLink: toDTO(created, input.baseUrl),
    rawToken: raw,
    url: shareUrl(input.baseUrl, raw),
  };
}

export async function revokeShareLink(input: {
  projectId: string;
  shareLinkId: string;
  actorUserId: string;
}): Promise<void> {
  const existing = await prisma.shareLink.findFirst({
    where: { id: input.shareLinkId, projectId: input.projectId },
  });
  if (!existing) throw new ApiException('NOT_FOUND', 404, 'Share link not found.');
  if (existing.revokedAt) return;

  await prisma.$transaction([
    prisma.shareLink.update({
      where: { id: input.shareLinkId },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        shareLinkId: input.shareLinkId,
        action: 'share_revoke',
        resourceType: 'share_link',
        resourceId: input.shareLinkId,
        result: 'success',
      },
    }),
  ]);
}

/**
 * SHA-256 でハッシュ化して active な share_link を引く。
 * 期限切れ・revoked・未存在を 404 集約。
 */
export async function findActiveShareLinkByRawToken(rawToken: string) {
  const hash = hashToken(rawToken);
  const row = await prisma.shareLink.findFirst({
    where: {
      tokenHash: hash,
      revokedAt: null,
      // expiresAt が null (無期限) または未来日のものを有効とみなす
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (!row) {
    throw new ApiException(
      'SHARE_NOT_FOUND_OR_EXPIRED',
      404,
      'Share link not found, expired, or revoked.',
    );
  }
  return row;
}

export async function touchShareLinkAccess(shareLinkId: string): Promise<void> {
  await prisma.shareLink.update({
    where: { id: shareLinkId },
    data: { lastAccessedAt: new Date() },
  });
}
