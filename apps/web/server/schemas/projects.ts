import { z } from 'zod';

import { JOB_TITLES, MEMBER_TYPES, PROJECT_ROLES } from '@trakon/shared';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

// メールは任意 (スケジュール担当者としての登録)。空文字は「未登録」= undefined に正規化。
const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().toLowerCase().email().max(320).optional(),
);

// 空文字は「未設定」= undefined に正規化する (フォームの未選択が '' で届くため)。
const optionalJobTitle = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.enum(JOB_TITLES).optional(),
);

const memberInput = z.object({
  name: z.string().trim().min(1).max(100),
  /** 通知先メール。確認TOSS / コメントRETURN など対応が必要なときにだけ送る (#147) */
  email: optionalEmail,
  organizationName: z.string().trim().max(255).default(''),
  memberType: z.enum(MEMBER_TYPES),
  jobTitle: optionalJobTitle,
  /** 権限ロール (FR-ROLE-01)。未指定は編集者 */
  roleType: z.enum(PROJECT_ROLES).default('editor'),
});

const itemInput = z.object({
  name: z.string().trim().min(1).max(255),
});

export const createProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    clientName: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
      z.string().trim().max(255).optional(),
    ),
    startDate: isoDate,
    endDate: isoDate,
    items: z.array(itemInput).min(1).max(50),
    members: z.array(memberInput).max(50).default([]),
    /**
     * 進行責任者に据える参加者。members 配列のインデックスで指す (#147)。
     * 作成時点では参加者の id が無いため、id ではなく入力順で受ける。
     * 省略時は作成者本人が進行責任者になる。
     */
    progressManagerIndex: z.number().int().min(0).max(49).optional(),
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
  )
  .refine((v) => v.progressManagerIndex === undefined || v.progressManagerIndex < v.members.length, {
    path: ['progressManagerIndex'],
    message: 'progressManagerIndex must point to a member.',
  });

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;

export const updateProjectBodySchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    // null で明示的にクリアできる
    clientName: z.string().trim().max(255).nullable().optional(),
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
