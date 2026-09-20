import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as AttachmentStorage from '../lib/attachmentStorage.js';
import type {
  createAttachment as CreateAttachmentType,
  deleteAttachment as DeleteAttachmentType,
  listAttachments as ListAttachmentsType,
} from './attachments.js';

// =============================================================================
// 予定への添付ファイル (#65)
//
// Storage は叩かず、「台帳に何を書き、誰に何を許すか」だけを固定する。
// =============================================================================

type MockAttachment = {
  id: string;
  planId: string;
  uploaderMemberId: string | null;
  storageKey: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  deletedAt: Date | null;
};

const attachmentStore: MockAttachment[] = [];
const planStore: { id: string; itemId: string; deletedAt: Date | null }[] = [];
let nextId = 1;

const MEMBER = {
  id: 'm-1',
  name: '杉野 遥',
  organizationName: '',
  jobTitle: null,
  email: 'sugino@example.test',
  user: {
    organizationName: 'Acme',
    jobTitle: null,
    notificationEmail: null,
    email: 'sugino@example.test',
    avatarPath: null,
  },
};

const prismaMock = {
  plan: {
    findFirst: vi.fn(async ({ where }: { where: { id: string; itemId: string } }) =>
      planStore.find(
        (p) => p.id === where.id && p.itemId === where.itemId && p.deletedAt === null,
      ) ?? null,
    ),
  },
  attachment: {
    findMany: vi.fn(async ({ where }: { where: { planId: string } }) =>
      attachmentStore
        .filter((a) => a.planId === where.planId && a.deletedAt === null)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((a) => ({ ...a, uploader: a.uploaderMemberId ? MEMBER : null })),
    ),
    findFirst: vi.fn(async ({ where }: { where: { id: string; planId: string } }) => {
      const found = attachmentStore.find(
        (a) => a.id === where.id && a.planId === where.planId && a.deletedAt === null,
      );
      return found ?? null;
    }),
    count: vi.fn(
      async ({ where }: { where: { planId: string } }) =>
        attachmentStore.filter((a) => a.planId === where.planId && a.deletedAt === null).length,
    ),
    create: vi.fn(async ({ data }: { data: Partial<MockAttachment> }) => {
      const row: MockAttachment = {
        id: `att-${nextId++}`,
        planId: data.planId!,
        uploaderMemberId: data.uploaderMemberId ?? null,
        storageKey: data.storageKey!,
        filename: data.filename!,
        mimeType: data.mimeType!,
        sizeBytes: data.sizeBytes!,
        createdAt: new Date(`2026-09-2${nextId}T00:00:00Z`),
        deletedAt: null,
      };
      attachmentStore.push(row);
      return { ...row, uploader: MEMBER };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { deletedAt: Date } }) => {
      const row = attachmentStore.find((a) => a.id === where.id)!;
      row.deletedAt = data.deletedAt;
      return row;
    }),
  },
};
vi.mock('@trakon/db', () => ({ prisma: prismaMock }));

// Storage は叩かない。署名 URL も固定値にする。
const uploaded: string[] = [];
const removed: string[] = [];
vi.mock('../lib/attachmentStorage.js', async (orig) => {
  const actual = (await orig()) as typeof AttachmentStorage;
  return {
    ...actual,
    uploadAttachmentObject: vi.fn(async ({ key }: { key: string }) => {
      uploaded.push(key);
    }),
    removeAttachmentObjects: vi.fn(async (keys: string[]) => {
      removed.push(...keys);
    }),
    signAttachmentUrls: vi.fn(
      async (items: { storageKey: string }[]) =>
        new Map(items.map((i) => [i.storageKey, `https://signed.test/${i.storageKey}`])),
    ),
  };
});

let listAttachments: typeof ListAttachmentsType;
let createAttachment: typeof CreateAttachmentType;
let deleteAttachment: typeof DeleteAttachmentType;

beforeAll(async () => {
  ({ listAttachments, createAttachment, deleteAttachment } = await import('./attachments.js'));
});

afterEach(() => {
  attachmentStore.length = 0;
  planStore.length = 0;
  uploaded.length = 0;
  removed.length = 0;
  vi.clearAllMocks();
});

const ITEM_ID = 'item-1';
const PLAN_ID = 'plan-1';

function seedPlan() {
  planStore.push({ id: PLAN_ID, itemId: ITEM_ID, deletedAt: null });
}

function file(filename: string, size = 100) {
  return { filename, mimeType: 'application/pdf', bytes: new Uint8Array(size) };
}

const baseCreate = {
  projectId: 'proj-1',
  itemId: ITEM_ID,
  planId: PLAN_ID,
  uploaderMemberId: 'm-1',
};

describe('createAttachment', () => {
  it('実体を置いてから台帳に載せ、署名付き URL を返す', async () => {
    seedPlan();

    const dto = await createAttachment({ ...baseCreate, file: file('入稿データ.pdf') });

    expect(uploaded).toHaveLength(1);
    expect(dto).toMatchObject({
      filename: '入稿データ.pdf',
      sizeBytes: 100,
      uploader: { id: 'm-1', name: '杉野 遥' },
    });
    // 直リンクは返さない。都度署名した URL を返す
    expect(dto.downloadUrl).toContain('https://signed.test/proj-1/plan-1/');
  });

  it('他の制作物の予定には添付できない (404)', async () => {
    planStore.push({ id: PLAN_ID, itemId: 'other-item', deletedAt: null });

    await expect(
      createAttachment({ ...baseCreate, file: file('a.pdf') }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    expect(uploaded).toHaveLength(0);
  });

  it('件数の上限を超えたら 409 で、実体も置かない', async () => {
    seedPlan();
    for (let i = 0; i < 20; i += 1) {
      attachmentStore.push({
        id: `seed-${i}`,
        planId: PLAN_ID,
        uploaderMemberId: 'm-1',
        storageKey: `k-${i}`,
        filename: `${i}.pdf`,
        mimeType: 'application/pdf',
        sizeBytes: 1,
        createdAt: new Date(),
        deletedAt: null,
      });
    }

    await expect(
      createAttachment({ ...baseCreate, file: file('over.pdf') }),
    ).rejects.toMatchObject({ code: 'ATTACHMENT_LIMIT_REACHED', status: 409 });
    expect(uploaded).toHaveLength(0);
  });

  it('台帳に載せられなければ置いた実体を片付ける', async () => {
    seedPlan();
    prismaMock.attachment.create.mockRejectedValueOnce(new Error('db down'));

    await expect(createAttachment({ ...baseCreate, file: file('a.pdf') })).rejects.toThrow();

    // 孤児オブジェクトを残さない
    expect(removed).toEqual(uploaded);
  });
});

describe('listAttachments', () => {
  it('追加した順に返す', async () => {
    seedPlan();
    await createAttachment({ ...baseCreate, file: file('1.pdf') });
    await createAttachment({ ...baseCreate, file: file('2.pdf') });

    const rows = await listAttachments({ itemId: ITEM_ID, planId: PLAN_ID });

    expect(rows.map((r) => r.filename)).toEqual(['1.pdf', '2.pdf']);
  });

  it('削除済みは返さない', async () => {
    seedPlan();
    const a = await createAttachment({ ...baseCreate, file: file('消す.pdf') });
    await createAttachment({ ...baseCreate, file: file('残す.pdf') });

    await deleteAttachment({
      itemId: ITEM_ID,
      planId: PLAN_ID,
      attachmentId: a.id,
      currentMemberId: 'm-1',
      role: 'editor',
    });

    const rows = await listAttachments({ itemId: ITEM_ID, planId: PLAN_ID });
    expect(rows.map((r) => r.filename)).toEqual(['残す.pdf']);
  });
});

describe('deleteAttachment', () => {
  it('自分が入れたファイルは削除でき、実体も消す', async () => {
    seedPlan();
    const a = await createAttachment({ ...baseCreate, file: file('a.pdf') });

    await deleteAttachment({
      itemId: ITEM_ID,
      planId: PLAN_ID,
      attachmentId: a.id,
      currentMemberId: 'm-1',
      role: 'editor',
    });

    // 台帳は論理削除、実体は消す
    expect(attachmentStore.find((r) => r.id === a.id)!.deletedAt).not.toBeNull();
    expect(removed).toHaveLength(1);
  });

  it('他人のファイルは削除できない (403)', async () => {
    // 他人の支給素材を誰でも消せると、消えた理由が分からないまま作業が止まる
    seedPlan();
    const a = await createAttachment({ ...baseCreate, file: file('a.pdf') });

    await expect(
      deleteAttachment({
        itemId: ITEM_ID,
        planId: PLAN_ID,
        attachmentId: a.id,
        currentMemberId: 'm-other',
        role: 'editor',
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN', status: 403 });
    expect(removed).toHaveLength(0);
  });

  it('管理者は他人のファイルも削除できる', async () => {
    seedPlan();
    const a = await createAttachment({ ...baseCreate, file: file('a.pdf') });

    await deleteAttachment({
      itemId: ITEM_ID,
      planId: PLAN_ID,
      attachmentId: a.id,
      currentMemberId: 'm-other',
      role: 'admin',
    });

    expect(attachmentStore.find((r) => r.id === a.id)!.deletedAt).not.toBeNull();
  });

  it('存在しない添付は 404', async () => {
    seedPlan();
    await expect(
      deleteAttachment({
        itemId: ITEM_ID,
        planId: PLAN_ID,
        attachmentId: 'nope',
        currentMemberId: 'm-1',
        role: 'admin',
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
  });
});
