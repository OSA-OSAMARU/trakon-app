import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

// メールは任意 (スケジュール担当者としての登録)。空文字は「未登録」= undefined に正規化。
const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().toLowerCase().email().max(320).optional(),
);

const memberInput = z.object({
  name: z.string().trim().min(1).max(100),
  email: optionalEmail,
  organizationName: z.string().trim().max(255).default(''),
  memberType: z.enum(['client', 'production']),
});

const itemInput = z.object({
  name: z.string().trim().min(1).max(255),
});

export const createProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    startDate: isoDate,
    endDate: isoDate,
    items: z.array(itemInput).min(1).max(50),
    members: z.array(memberInput).max(50).default([]),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'endDate must be on or after startDate.',
  })
  .refine(
    (v) => {
      // メール未登録 (undefined) の参加者は重複チェック対象外
      const seen = new Set<string>();
      for (const m of v.members) {
        if (!m.email) continue;
        if (seen.has(m.email)) return false;
        seen.add(m.email);
      }
      return true;
    },
    { path: ['members'], message: 'members must have unique emails.' },
  );

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const updateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    startDate: isoDate.optional(),
    endDate: isoDate.optional(),
    status: z.enum(['active', 'closed']).optional(),
  })
  .refine(
    (v) => {
      if (v.startDate && v.endDate) return v.endDate >= v.startDate;
      return true;
    },
    { path: ['endDate'], message: 'endDate must be on or after startDate.' },
  );
export type UpdateProjectBody = z.infer<typeof updateProjectBodySchema>;

export const listProjectsQuerySchema = z.object({
  // 'true' のときのみアーカイブ済みを返す。未指定/'false' は未アーカイブのみ。
  // z.coerce.boolean() は 'false' も true になるため使わない。
  archived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

/** プロジェクト横断プラン取得 (制作物列スケジュール用) のクエリ。 */
export const listProjectPlansQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
});
export type ListProjectPlansQuery = z.infer<typeof listProjectPlansQuerySchema>;

export const createItemBodySchema = z.object({
  name: z.string().trim().min(1).max(255),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type CreateItemBody = z.infer<typeof createItemBodySchema>;

export const updateItemBodySchema = z.object({
  name: z.string().trim().min(1).max(255).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type UpdateItemBody = z.infer<typeof updateItemBodySchema>;

/** 制作物の一括並び替え (#111)。並び順どおりの id 配列。 */
export const reorderItemsBodySchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(200),
});
export type ReorderItemsBody = z.infer<typeof reorderItemsBodySchema>;
