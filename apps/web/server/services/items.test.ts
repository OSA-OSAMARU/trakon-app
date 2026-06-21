import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  listItems as ListItemsType,
  getItem as GetItemType,
  createItem as CreateItemType,
  updateItem as UpdateItemType,
  deleteItem as DeleteItemType,
} from './items.js';

// =============================================================================
// Mocks
// =============================================================================

// projectItem 行のインメモリ表現。実際の Prisma モデルと同じ形に揃える。
type MockItem = {
  id: string;
  projectId: string;
  name: string;
  sortOrder: number;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
};

const itemStore: MockItem[] = [];
let nextId = 1;
const newId = (prefix: string) => `${prefix}-${nextId++}`;

// where 句を満たす (削除されていない) 行を返すヘルパ。
function matches(
  it: MockItem,
  where: { id?: string; projectId?: string; deletedAt?: null; id_not?: string },
): boolean {
  if (where.id !== undefined && it.id !== where.id) return false;
  if (where.projectId !== undefined && it.projectId !== where.projectId) return false;
  if (where.deletedAt === null && it.deletedAt !== null) return false;
  if (where.id_not !== undefined && it.id === where.id_not) return false;
  return true;
}

const prismaMock = {
  projectItem: {
    findMany: vi.fn(
      async ({ where }: { where: { projectId: string; deletedAt: null } }) => {
        // listItems の orderBy [{ sortOrder: 'asc' }, { createdAt: 'asc' }] を再現。
        return itemStore
          .filter((it) => matches(it, where))
          .sort(
            (a, b) =>
              a.sortOrder - b.sortOrder || a.createdAt.getTime() - b.createdAt.getTime(),
          );
      },
    ),
    findFirst: vi.fn(
      async ({
        where,
        orderBy,
      }: {
        where: { id?: string | { not: string }; projectId?: string; deletedAt: null };
        orderBy?: { sortOrder: 'desc' };
      }) => {
        // where.id が { not } 形式で来るケース (nextSortOrder では無いが汎用化のため吸収)。
        const flat = {
          id: typeof where.id === 'object' ? undefined : where.id,
          id_not: typeof where.id === 'object' ? where.id.not : undefined,
          projectId: where.projectId,
          deletedAt: where.deletedAt,
        };
        const found = itemStore.filter((it) => matches(it, flat));
        if (orderBy?.sortOrder === 'desc') {
          // nextSortOrder: sortOrder 降順の先頭を返す。
          found.sort((a, b) => b.sortOrder - a.sortOrder);
        }
        return found[0] ?? null;
      },
    ),
    create: vi.fn(
      async ({ data }: { data: { projectId: string; name: string; sortOrder: number } }) => {
        const it: MockItem = {
          id: newId('it'),
          projectId: data.projectId,
          name: data.name,
          sortOrder: data.sortOrder,
          startDate: null,
          endDate: null,
          createdAt: new Date('2026-05-25T00:00:00Z'),
          updatedAt: new Date('2026-05-25T00:00:00Z'),
          deletedAt: null,
        };
        itemStore.push(it);
        return it;
      },
    ),
    update: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { name?: string; sortOrder?: number };
      }) => {
        const it = itemStore.find((row) => row.id === where.id);
        if (!it) throw new Error('not found in mock update');
        if (data.name !== undefined) it.name = data.name;
        if (data.sortOrder !== undefined) it.sortOrder = data.sortOrder;
        it.updatedAt = new Date('2026-05-26T00:00:00Z');
        return it;
      },
    ),
    count: vi.fn(
      async ({
        where,
      }: {
        where: { projectId: string; deletedAt: null; id: { not: string } };
      }) => {
        return itemStore.filter((it) =>
          matches(it, {
            projectId: where.projectId,
            deletedAt: where.deletedAt,
            id_not: where.id.not,
          }),
        ).length;
      },
    ),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const idx = itemStore.findIndex((it) => it.id === where.id);
      if (idx === -1) throw new Error('not found in mock delete');
      const [removed] = itemStore.splice(idx, 1);
      return removed;
    }),
  },
};

vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// =============================================================================
// Helpers
// =============================================================================

// テスト用に行を直接投入する。
function seed(partial: Partial<MockItem> & { projectId: string }): MockItem {
  const it: MockItem = {
    id: partial.id ?? newId('it'),
    projectId: partial.projectId,
    name: partial.name ?? 'Item',
    sortOrder: partial.sortOrder ?? 0,
    startDate: partial.startDate ?? null,
    endDate: partial.endDate ?? null,
    createdAt: partial.createdAt ?? new Date('2026-05-01T00:00:00Z'),
    updatedAt: partial.updatedAt ?? new Date('2026-05-01T00:00:00Z'),
    deletedAt: partial.deletedAt ?? null,
  };
  itemStore.push(it);
  return it;
}

// =============================================================================
// Tests
// =============================================================================

let listItems: typeof ListItemsType;
let getItem: typeof GetItemType;
let createItem: typeof CreateItemType;
let updateItem: typeof UpdateItemType;
let deleteItem: typeof DeleteItemType;

beforeAll(async () => {
  ({ listItems, getItem, createItem, updateItem, deleteItem } = await import('./items.js'));
});

afterEach(() => {
  itemStore.length = 0;
  vi.clearAllMocks();
});

describe('listItems', () => {
  it('returns DTOs sorted by sortOrder then createdAt, scoped to the project, excluding soft-deleted', async () => {
    seed({ id: 'it-b', projectId: 'p1', name: 'B', sortOrder: 1 });
    seed({ id: 'it-a', projectId: 'p1', name: 'A', sortOrder: 0 });
    // 同 sortOrder は createdAt 昇順で安定ソート。
    seed({
      id: 'it-c',
      projectId: 'p1',
      name: 'C',
      sortOrder: 0,
      createdAt: new Date('2026-05-02T00:00:00Z'),
    });
    // 別プロジェクト・ソフト削除済みは除外される。
    seed({ id: 'it-other', projectId: 'p2', name: 'Other', sortOrder: 0 });
    seed({ id: 'it-del', projectId: 'p1', name: 'Del', sortOrder: 0, deletedAt: new Date() });

    const res = await listItems('p1');
    expect(res.map((r) => r.id)).toEqual(['it-a', 'it-c', 'it-b']);
    expect(res[0]).toMatchObject({
      id: 'it-a',
      projectId: 'p1',
      name: 'A',
      sortOrder: 0,
      startDate: null,
      endDate: null,
      counts: { activePlanCount: 0, completedPlanCount: 0 },
    });
  });

  it('serializes dates: startDate/endDate as YYYY-MM-DD, timestamps as ISO', async () => {
    seed({
      id: 'it-d',
      projectId: 'p1',
      name: 'D',
      startDate: new Date('2026-06-10T12:00:00Z'),
      endDate: new Date('2026-06-20T00:00:00Z'),
      createdAt: new Date('2026-05-01T03:04:05Z'),
      updatedAt: new Date('2026-05-02T03:04:05Z'),
    });
    const [dto] = await listItems('p1');
    expect(dto!.startDate).toBe('2026-06-10');
    expect(dto!.endDate).toBe('2026-06-20');
    expect(dto!.createdAt).toBe('2026-05-01T03:04:05.000Z');
    expect(dto!.updatedAt).toBe('2026-05-02T03:04:05.000Z');
  });

  it('returns an empty array when no items', async () => {
    expect(await listItems('p1')).toEqual([]);
  });
});

describe('getItem', () => {
  it('returns the DTO for an existing item', async () => {
    seed({ id: 'it-1', projectId: 'p1', name: 'One', sortOrder: 3 });
    const res = await getItem('it-1', 'p1');
    expect(res).toMatchObject({ id: 'it-1', projectId: 'p1', name: 'One', sortOrder: 3 });
  });

  it('throws 404 NOT_FOUND when the item does not exist', async () => {
    await expect(getItem('missing', 'p1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws 404 NOT_FOUND when the item belongs to another project', async () => {
    seed({ id: 'it-1', projectId: 'p2' });
    await expect(getItem('it-1', 'p1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws 404 NOT_FOUND for a soft-deleted item', async () => {
    seed({ id: 'it-1', projectId: 'p1', deletedAt: new Date() });
    await expect(getItem('it-1', 'p1')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });
});

describe('createItem', () => {
  it('uses an explicit sortOrder when provided', async () => {
    const res = await createItem({ projectId: 'p1', body: { name: 'X', sortOrder: 5 } });
    expect(res).toMatchObject({ projectId: 'p1', name: 'X', sortOrder: 5 });
    // findFirst (nextSortOrder) は呼ばれない。
    expect(prismaMock.projectItem.findFirst).not.toHaveBeenCalled();
    expect(itemStore).toHaveLength(1);
  });

  it('computes the tail sortOrder (last + 1) when omitted', async () => {
    seed({ projectId: 'p1', sortOrder: 0 });
    seed({ projectId: 'p1', sortOrder: 7 });
    const res = await createItem({ projectId: 'p1', body: { name: 'Tail' } });
    expect(res.sortOrder).toBe(8);
    expect(prismaMock.projectItem.findFirst).toHaveBeenCalledTimes(1);
  });

  it('starts at sortOrder 0 for the first item in a project when omitted', async () => {
    const res = await createItem({ projectId: 'p1', body: { name: 'First' } });
    expect(res.sortOrder).toBe(0);
  });

  it('ignores soft-deleted/other-project rows when computing the tail sortOrder', async () => {
    seed({ projectId: 'p1', sortOrder: 2 });
    seed({ projectId: 'p1', sortOrder: 9, deletedAt: new Date() });
    seed({ projectId: 'p2', sortOrder: 50 });
    const res = await createItem({ projectId: 'p1', body: { name: 'Tail' } });
    expect(res.sortOrder).toBe(3);
  });
});

describe('updateItem', () => {
  it('updates name and sortOrder', async () => {
    seed({ id: 'it-1', projectId: 'p1', name: 'Old', sortOrder: 1 });
    const res = await updateItem({
      itemId: 'it-1',
      projectId: 'p1',
      body: { name: 'New', sortOrder: 9 },
    });
    expect(res).toMatchObject({ id: 'it-1', name: 'New', sortOrder: 9 });
  });

  it('leaves fields untouched when the body omits them (undefined passthrough)', async () => {
    seed({ id: 'it-1', projectId: 'p1', name: 'Keep', sortOrder: 4 });
    const res = await updateItem({ itemId: 'it-1', projectId: 'p1', body: {} });
    expect(res).toMatchObject({ name: 'Keep', sortOrder: 4 });
    expect(prismaMock.projectItem.update).toHaveBeenCalledWith({
      where: { id: 'it-1' },
      data: { name: undefined, sortOrder: undefined },
    });
  });

  it('throws 404 NOT_FOUND when the item does not exist', async () => {
    await expect(
      updateItem({ itemId: 'missing', projectId: 'p1', body: { name: 'X' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    // 存在確認で弾かれるため update は呼ばれない。
    expect(prismaMock.projectItem.update).not.toHaveBeenCalled();
  });

  it('throws 404 NOT_FOUND for an item in another project', async () => {
    seed({ id: 'it-1', projectId: 'p2' });
    await expect(
      updateItem({ itemId: 'it-1', projectId: 'p1', body: { name: 'X' } }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});

describe('deleteItem', () => {
  it('hard-deletes an item when others remain in the project', async () => {
    seed({ id: 'it-1', projectId: 'p1' });
    seed({ id: 'it-2', projectId: 'p1' });
    await expect(deleteItem({ itemId: 'it-1', projectId: 'p1' })).resolves.toBeUndefined();
    expect(prismaMock.projectItem.delete).toHaveBeenCalledWith({ where: { id: 'it-1' } });
    expect(itemStore.find((it) => it.id === 'it-1')).toBeUndefined();
    expect(itemStore.find((it) => it.id === 'it-2')).toBeDefined();
  });

  it('throws 404 NOT_FOUND when the item does not exist', async () => {
    await expect(deleteItem({ itemId: 'missing', projectId: 'p1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
    expect(prismaMock.projectItem.delete).not.toHaveBeenCalled();
  });

  it('throws 404 NOT_FOUND for an item in another project', async () => {
    seed({ id: 'it-1', projectId: 'p2' });
    await expect(deleteItem({ itemId: 'it-1', projectId: 'p1' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
      status: 404,
    });
  });

  it('throws 409 LAST_ITEM_CANNOT_BE_DELETED when it is the only remaining item', async () => {
    seed({ id: 'it-1', projectId: 'p1' });
    // 別プロジェクト・削除済みは「残り」に数えない。
    seed({ id: 'it-other', projectId: 'p2' });
    seed({ id: 'it-del', projectId: 'p1', deletedAt: new Date() });
    await expect(deleteItem({ itemId: 'it-1', projectId: 'p1' })).rejects.toMatchObject({
      code: 'LAST_ITEM_CANNOT_BE_DELETED',
      status: 409,
    });
    // ガードに掛かるため delete は呼ばれない。
    expect(prismaMock.projectItem.delete).not.toHaveBeenCalled();
  });
});
