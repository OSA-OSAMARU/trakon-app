import { prisma } from '@trakon/db';

import { ApiException } from '../lib/errors.js';
import type { CreateItemBody, UpdateItemBody } from '../schemas/projects.js';

export type ProjectItemDTO = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  startDate: string | null;
  endDate: string | null;
  counts: {
    activePlanCount: number;
    completedPlanCount: number;
  };
  createdAt: string;
  updatedAt: string;
};

function toDateOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}

function toItemDTO(it: {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): ProjectItemDTO {
  return {
    id: it.id,
    projectId: it.projectId,
    name: it.name,
    sortOrder: it.sortOrder,
    startDate: toDateOrNull(it.startDate),
    endDate: toDateOrNull(it.endDate),
    // plans テーブルは Sub-Phase 0.3 で追加するので Phase 0.2 では固定 0
    counts: { activePlanCount: 0, completedPlanCount: 0 },
    createdAt: it.createdAt.toISOString(),
    updatedAt: it.updatedAt.toISOString(),
  };
}

export async function listItems(projectId: string): Promise<ProjectItemDTO[]> {
  const items = await prisma.projectItem.findMany({
    where: { projectId, deletedAt: null },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return items.map(toItemDTO);
}

export async function getItem(itemId: string, projectId: string): Promise<ProjectItemDTO> {
  const it = await prisma.projectItem.findFirst({
    where: { id: itemId, projectId, deletedAt: null },
  });
  if (!it) {
    throw new ApiException('NOT_FOUND', 404, 'Item not found.');
  }
  return toItemDTO(it);
}

export async function createItem(input: {
  projectId: string;
  body: CreateItemBody;
}): Promise<ProjectItemDTO> {
  const sortOrder =
    input.body.sortOrder ?? (await nextSortOrder(input.projectId));
  const it = await prisma.projectItem.create({
    data: {
      projectId: input.projectId,
      name: input.body.name,
      sortOrder,
    },
  });
  return toItemDTO(it);
}

/**
 * 制作物を予定ごと複製する (#200)。
 *
 * スケジュールの「カラム」をまるごと写し取る操作。第 2 弾の撮影や、同じ工程を
 * 別の制作物でもう一度組むときに、1 枚ずつ作り直さなくて済むようにする。
 *
 * 複製するもの / しないものの切り分け:
 *   - **複製する**: 制作物の名前 (「〜 のコピー」) と期間、配下の全予定の
 *     日付・カテゴリ・色・担当 3 役割・メモ、そして**予定どうしの後続の紐付け**
 *   - **複製しない**: `ball_events` (ボールの履歴)、TOSS の FROM/TO スナップショット、
 *     完了状態。複製された予定はすべて「未着手」から始まる
 *
 * 履歴を写さないのは、ボールの流れが「実際に誰が何をしたか」の記録だからで、
 * コピーした瞬間に架空の履歴が生まれるのを避けている。
 */
export async function duplicateItem(input: {
  itemId: string;
  projectId: string;
}): Promise<ProjectItemDTO> {
  const source = await prisma.projectItem.findFirst({
    where: { id: input.itemId, projectId: input.projectId, deletedAt: null },
  });
  if (!source) throw new ApiException('NOT_FOUND', 404, 'Item not found.');

  const plans = await prisma.plan.findMany({
    where: { itemId: source.id, deletedAt: null },
    orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
  });

  const sortOrder = await nextSortOrder(input.projectId);

  const created = await prisma.$transaction(async (tx) => {
    const item = await tx.projectItem.create({
      data: {
        projectId: input.projectId,
        name: copyName(source.name),
        itemType: source.itemType,
        sortOrder,
        startDate: source.startDate,
        endDate: source.endDate,
      },
    });

    // 1 周目: 予定を作る。後続の紐付けは相手の新 ID が要るのでまだ張らない。
    const newIdBySourceId = new Map<string, string>();
    for (const p of plans) {
      const row = await tx.plan.create({
        data: {
          itemId: item.id,
          planType: p.planType,
          title: p.title,
          category: p.category,
          colorTheme: p.colorTheme,
          scheduledDate: p.scheduledDate,
          dueDate: p.dueDate,
          executorMemberId: p.executorMemberId,
          approverMemberId: p.approverMemberId,
          progressManagerMemberId: p.progressManagerMemberId,
          memo: p.memo,
          // ボールは引き継がない。複製直後はすべて未着手 (status='active')
        },
        select: { id: true },
      });
      newIdBySourceId.set(p.id, row.id);
    }

    // 2 周目: 後続の紐付けを新 ID へ張り替える。
    // **複製した集合の中で閉じている紐付けだけ**を写す。元の制作物の予定を
    // 指したままにすると、コピーが元のラインへ合流してしまう。
    for (const p of plans) {
      if (!p.successorPlanId) continue;
      const successorId = newIdBySourceId.get(p.successorPlanId);
      if (!successorId) continue;
      await tx.plan.update({
        where: { id: newIdBySourceId.get(p.id)! },
        data: { successorPlanId: successorId },
      });
    }

    return item;
  });

  return toItemDTO(created);
}

/** 「〜 のコピー」。既に付いていても重ねる (何度複製したか分かるほうが良い)。 */
function copyName(name: string): string {
  const suffix = ' のコピー';
  // カラム名は 255 文字上限。溢れる分は前を削って接尾辞を必ず残す
  const head = name.slice(0, 255 - suffix.length);
  return `${head}${suffix}`;
}

export async function updateItem(input: {
  itemId: string;
  projectId: string;
  body: UpdateItemBody;
}): Promise<ProjectItemDTO> {
  const existing = await prisma.projectItem.findFirst({
    where: { id: input.itemId, projectId: input.projectId, deletedAt: null },
  });
  if (!existing) {
    throw new ApiException('NOT_FOUND', 404, 'Item not found.');
  }
  const it = await prisma.projectItem.update({
    where: { id: input.itemId },
    data: {
      name: input.body.name ?? undefined,
      sortOrder: input.body.sortOrder ?? undefined,
    },
  });
  return toItemDTO(it);
}

export async function deleteItem(input: { itemId: string; projectId: string }): Promise<void> {
  const existing = await prisma.projectItem.findFirst({
    where: { id: input.itemId, projectId: input.projectId, deletedAt: null },
  });
  if (!existing) {
    throw new ApiException('NOT_FOUND', 404, 'Item not found.');
  }

  // 最後の 1 件は削除不可 (各プロジェクト最低 1 件 — 設計書 §2.4.4)
  const remaining = await prisma.projectItem.count({
    where: { projectId: input.projectId, deletedAt: null, id: { not: input.itemId } },
  });
  if (remaining === 0) {
    throw new ApiException(
      'LAST_ITEM_CANNOT_BE_DELETED',
      409,
      'A project must contain at least one item.',
    );
  }

  // plans 連動 (ITEM_HAS_ACTIVE_PLANS) は Sub-Phase 0.3 で追加
  await prisma.projectItem.delete({ where: { id: input.itemId } });
}

/**
 * 制作物の並び替え (#111)。orderedIds は現存する制作物 (アクティブ) と過不足なく
 * 一致している必要がある。並び順に sortOrder = 0..n-1 を振り直す。
 */
export async function reorderItems(input: {
  projectId: string;
  orderedIds: string[];
}): Promise<ProjectItemDTO[]> {
  const existing = await prisma.projectItem.findMany({
    where: { projectId: input.projectId, deletedAt: null },
    select: { id: true },
  });
  assertExactIdSet(input.orderedIds, existing.map((i) => i.id));

  await prisma.$transaction(
    input.orderedIds.map((id, idx) =>
      prisma.projectItem.update({ where: { id }, data: { sortOrder: idx } }),
    ),
  );
  return listItems(input.projectId);
}

/** orderedIds が対象集合と「重複なく・過不足なく」一致することを検証する。 */
export function assertExactIdSet(orderedIds: string[], currentIds: string[]): void {
  const current = new Set(currentIds);
  const unique = new Set(orderedIds);
  if (
    unique.size !== orderedIds.length ||
    orderedIds.length !== current.size ||
    orderedIds.some((id) => !current.has(id))
  ) {
    throw new ApiException(
      'INVALID_REORDER',
      422,
      'orderedIds must match the current items exactly (no missing, extra, or duplicate ids).',
    );
  }
}

async function nextSortOrder(projectId: string): Promise<number> {
  const last = await prisma.projectItem.findFirst({
    where: { projectId, deletedAt: null },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}
