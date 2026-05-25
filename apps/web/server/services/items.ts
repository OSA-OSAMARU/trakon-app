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

async function nextSortOrder(projectId: string): Promise<number> {
  const last = await prisma.projectItem.findFirst({
    where: { projectId, deletedAt: null },
    orderBy: { sortOrder: 'desc' },
    select: { sortOrder: true },
  });
  return (last?.sortOrder ?? -1) + 1;
}
