// -----------------------------------------------------------------------------
// 予定への添付ファイル (#65 / PRD §8.2)
//
// この層が持つのは「誰がどの予定に何を付けたか」の台帳だけ。実体の保存と
// 署名付き URL の発行は lib/attachmentStorage.ts に寄せている。
// -----------------------------------------------------------------------------
import { prisma } from '@trakon/db';
import { resolveMemberProfile, type ProjectRole } from '@trakon/shared';

import { ApiException } from '../lib/errors.js';
import {
  MEMBER_PROFILE_USER_SELECT,
  type MemberProfileUserRow,
} from '../lib/memberProfile.js';
import {
  ATTACHMENT_MAX_PER_PLAN,
  assertValidAttachment,
  buildAttachmentKey,
  removeAttachmentObjects,
  signAttachmentUrls,
  uploadAttachmentObject,
} from '../lib/attachmentStorage.js';

export type AttachmentDTO = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** アップロードした参加者。参加者が消えていても名前は残す */
  uploader: { id: string; name: string } | null;
  /** ダウンロード用の署名付き URL。発行できなければ null */
  downloadUrl: string | null;
  createdAt: string;
};

type AttachmentRow = {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
  createdAt: Date;
  uploader: {
    id: string;
    name: string;
    organizationName: string;
    jobTitle: string | null;
    email: string | null;
    user: MemberProfileUserRow | null;
  } | null;
};

const UPLOADER_SELECT = {
  select: {
    id: true,
    name: true,
    organizationName: true,
    jobTitle: true,
    email: true,
    user: MEMBER_PROFILE_USER_SELECT,
  },
} as const;

/** 表示名はアカウント側が正 (#156 / #254)。参加者行の名前はフォールバック。 */
function uploaderRef(row: AttachmentRow['uploader']): { id: string; name: string } | null {
  if (!row) return null;
  const profile = resolveMemberProfile({
    member: {
      name: row.name,
      organizationName: row.organizationName,
      jobTitle: row.jobTitle,
      email: row.email,
    },
    user: row.user,
  });
  return { id: row.id, name: profile.name };
}

async function toDTOs(rows: AttachmentRow[]): Promise<AttachmentDTO[]> {
  const urls = await signAttachmentUrls(
    rows.map((r) => ({ storageKey: r.storageKey, filename: r.filename })),
  );
  return rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    mimeType: r.mimeType,
    sizeBytes: r.sizeBytes,
    uploader: uploaderRef(r.uploader),
    downloadUrl: urls.get(r.storageKey) ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}

/** 予定がこのプロジェクトのものであることを確かめる (他プロジェクトの予定を触らせない)。 */
async function assertPlanInProject(planId: string, itemId: string): Promise<void> {
  const plan = await prisma.plan.findFirst({
    where: { id: planId, itemId, deletedAt: null },
    select: { id: true },
  });
  if (!plan) throw new ApiException('NOT_FOUND', 404, 'Plan not found.');
}

export async function listAttachments(input: {
  itemId: string;
  planId: string;
}): Promise<AttachmentDTO[]> {
  await assertPlanInProject(input.planId, input.itemId);
  const rows = await prisma.attachment.findMany({
    where: { planId: input.planId, deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      storageKey: true,
      createdAt: true,
      uploader: UPLOADER_SELECT,
    },
  });
  return toDTOs(rows);
}

export async function createAttachment(input: {
  projectId: string;
  itemId: string;
  planId: string;
  uploaderMemberId: string;
  file: { filename: string; mimeType: string; bytes: Uint8Array };
}): Promise<AttachmentDTO> {
  await assertPlanInProject(input.planId, input.itemId);
  assertValidAttachment({ filename: input.file.filename, size: input.file.bytes.byteLength });

  const count = await prisma.attachment.count({
    where: { planId: input.planId, deletedAt: null },
  });
  if (count >= ATTACHMENT_MAX_PER_PLAN) {
    throw new ApiException(
      'ATTACHMENT_LIMIT_REACHED',
      409,
      `1 つの予定に添付できるのは ${ATTACHMENT_MAX_PER_PLAN} 件までです。`,
      { limit: ATTACHMENT_MAX_PER_PLAN },
    );
  }

  const storageKey = buildAttachmentKey({
    projectId: input.projectId,
    planId: input.planId,
    filename: input.file.filename,
  });

  // 実体を先に置く。DB だけ残って実体が無い行を作らないため
  // (逆向きに失敗した場合は孤児オブジェクトが残るが、こちらの方が実害が小さい)。
  await uploadAttachmentObject({
    key: storageKey,
    bytes: input.file.bytes,
    mimeType: input.file.mimeType,
  });

  let row;
  try {
    row = await prisma.attachment.create({
      data: {
        planId: input.planId,
        uploaderMemberId: input.uploaderMemberId,
        storageKey,
        filename: input.file.filename,
        mimeType: input.file.mimeType,
        sizeBytes: input.file.bytes.byteLength,
      },
      select: {
        id: true,
        filename: true,
        mimeType: true,
        sizeBytes: true,
        storageKey: true,
        createdAt: true,
        uploader: UPLOADER_SELECT,
      },
    });
  } catch (err) {
    // 台帳に載せられなかった実体は残さない
    await removeAttachmentObjects([storageKey]);
    throw err;
  }

  const [dto] = await toDTOs([row]);
  return dto!;
}

/**
 * 添付を削除する。
 *
 * 台帳は論理削除にしつつ、**実体は消す**。誤削除の直後に「戻せますか」と
 * 聞かれたとき、行が残っていれば「いつ誰が消したか」は答えられる。
 * 一方で実体を残すと、削除したつもりのファイルが署名付き URL で読めてしまう。
 */
export async function deleteAttachment(input: {
  itemId: string;
  planId: string;
  attachmentId: string;
  currentMemberId: string;
  role: ProjectRole;
}): Promise<void> {
  await assertPlanInProject(input.planId, input.itemId);
  const existing = await prisma.attachment.findFirst({
    where: { id: input.attachmentId, planId: input.planId, deletedAt: null },
    select: { id: true, storageKey: true, uploaderMemberId: true },
  });
  if (!existing) throw new ApiException('NOT_FOUND', 404, 'Attachment not found.');

  // 消せるのは**自分が入れたファイル**だけ。管理者は他人のものも消せる
  // (ボール操作と同じ 2 段判定)。他人の支給素材を誰でも消せると、
  // 消えた理由が誰にも分からないまま作業が止まる。
  if (input.role !== 'admin' && existing.uploaderMemberId !== input.currentMemberId) {
    throw new ApiException(
      'FORBIDDEN',
      403,
      '自分が添付したファイルのみ削除できます。',
    );
  }

  await prisma.attachment.update({
    where: { id: existing.id },
    data: { deletedAt: new Date() },
  });
  await removeAttachmentObjects([existing.storageKey]);
}
