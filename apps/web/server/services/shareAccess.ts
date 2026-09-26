import { prisma, type Prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';
import { PLAN_INCLUDE, toPlanDTO, type PlanDTO } from './plans.js';
import { findActiveShareLinkByRawToken, touchShareLinkAccess } from './shareLinks.js';

export type ShareViewDTO = {
  share: {
    id: string;
    scopeType: 'project' | 'item' | 'plan';
    scopeTargetId: string | null;
    /** null = 無期限 */
    expiresAt: string | null;
  };
  project: { id: string; name: string; startDate: string; endDate: string };
  items: Array<{ id: string; name: string }>;
  plans: PlanDTO[];
};


/**
 * トークンを検証してスコープに応じた閲覧情報を返す。
 * 全アクセスを audit_logs に記録する。
 *
 * **このファイルが持つのは閲覧だけ** (#257)。#131 で追加した共有リンクからの
 * 確認依頼 / 承認 / 差し戻しは削除した。全プランで「共有リンクで訪れた人は
 * 閲覧のみ」という要件になったため (設計書 §3.6.10 / §5.4.5)。
 *
 * 承認や差し戻しをしてほしい相手は、閲覧者として組織へ招待する
 * (Free でも 5 名まで招待できる)。誰が操作したかが記録に残る点でも、
 * 匿名の共有リンクより招待の方が適している。
 */
export async function viewShare(input: {
  rawToken: string;
  ip?: string;
  userAgent?: string;
}): Promise<ShareViewDTO> {
  const share = await findActiveShareLinkByRawToken(input.rawToken);

  const project = await prisma.project.findFirst({
    where: { id: share.projectId, deletedAt: null },
    include: { items: { where: { deletedAt: null }, orderBy: { sortOrder: 'asc' } } },
  });
  if (!project) throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Project unavailable.');

  // scope に応じて見せるプランを絞り込む
  const planWhere: Prisma.PlanWhereInput = { deletedAt: null };
  let items = project.items;
  if (share.scopeType === 'project') {
    planWhere.itemId = { in: project.items.map((it) => it.id) };
  } else if (share.scopeType === 'item') {
    const itemId = share.scopeTargetId!;
    items = project.items.filter((it) => it.id === itemId);
    if (items.length === 0)
      throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Item unavailable.');
    planWhere.itemId = itemId;
  } else {
    planWhere.id = share.scopeTargetId!;
    // plan の所属 item を items に限定
    const plan = await prisma.plan.findFirst({
      where: { id: share.scopeTargetId!, deletedAt: null },
      select: { itemId: true },
    });
    if (!plan) throw new ApiException('SHARE_NOT_FOUND_OR_EXPIRED', 404, 'Plan unavailable.');
    items = project.items.filter((it) => it.id === plan.itemId);
  }

  const planRows = await prisma.plan.findMany({
    where: planWhere,
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
    include: PLAN_INCLUDE,
  });
  const plans = planRows.map((r) => toPlanDTO(r, []));

  // 監査ログ + last_accessed_at
  await Promise.all([
    touchShareLinkAccess(share.id),
    prisma.auditLog.create({
      data: {
        shareLinkId: share.id,
        action: 'share_access',
        resourceType: share.scopeType === 'plan' ? 'plan' : share.scopeType,
        resourceId: share.scopeTargetId ?? share.projectId,
        result: 'success',
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    }),
  ]);

  return {
    share: {
      id: share.id,
      scopeType: share.scopeType as 'project' | 'item' | 'plan',
      scopeTargetId: share.scopeTargetId,
      expiresAt: share.expiresAt?.toISOString() ?? null,
    },
    project: {
      id: project.id,
      name: project.name,
      // カレンダー日付軸の生成に使用 (YYYY-MM-DD)
      startDate: project.startDate.toISOString().slice(0, 10),
      endDate: project.endDate.toISOString().slice(0, 10),
    },
    items: items.map((it) => ({ id: it.id, name: it.name })),
    plans,
  };
}
