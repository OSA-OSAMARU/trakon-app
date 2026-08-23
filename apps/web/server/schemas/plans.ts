import { z } from 'zod';

import { SCHEDULE_THEMES } from '@trakon/shared';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

const uuid = z.string().uuid();

export const planCategoryValues = [
  'wireframe',
  'design',
  'coding',
  'review',
  'meeting',
  'other',
] as const;
export const planCategorySchema = z.enum(planCategoryValues);
export type PlanCategory = z.infer<typeof planCategorySchema>;

export const createPlanBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    category: planCategorySchema,
    /** 未指定ならカテゴリ由来の既定色になる (#149) */
    colorTheme: z.enum(SCHEDULE_THEMES).optional(),
    scheduledDate: isoDate,
    dueDate: isoDate.optional(),
    // 役割 (#131)。実施者は実質必須だが後から設定も可のため任意。承認者は任意。
    // 進行責任者は未指定ならプロジェクト既定値をサーバで解決する。
    executorMemberId: uuid.optional(),
    approverMemberId: uuid.optional(),
    progressManagerMemberId: uuid.optional(),
    successorPlanId: uuid.optional(),
    memo: z.string().max(2000).optional(),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.scheduledDate, {
    path: ['dueDate'],
    message: 'dueDate must be on or after scheduledDate.',
  });
export type CreatePlanBody = z.infer<typeof createPlanBodySchema>;

export const updatePlanBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    category: planCategorySchema.optional(),
    // null を送るとカテゴリ由来の既定色に戻せる (#149)
    colorTheme: z.enum(SCHEDULE_THEMES).nullable().optional(),
    scheduledDate: isoDate.optional(),
    dueDate: isoDate.nullable().optional(),
    // null を送ると担当者を未設定に戻せる (#114)。undefined は変更なし。
    executorMemberId: uuid.nullable().optional(),
    approverMemberId: uuid.nullable().optional(),
    progressManagerMemberId: uuid.nullable().optional(),
    // 別制作物への移動 (#52)。同一プロジェクト内の item への付け替え。
    itemId: uuid.optional(),
    successorPlanId: uuid.nullable().optional(),
    memo: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) => {
      if (v.scheduledDate && v.dueDate) return v.dueDate >= v.scheduledDate;
      return true;
    },
    { path: ['dueDate'], message: 'dueDate must be on or after scheduledDate.' },
  );
export type UpdatePlanBody = z.infer<typeof updatePlanBodySchema>;

export const setSuccessorBodySchema = z.object({
  successorPlanId: uuid.nullable(),
});
export type SetSuccessorBody = z.infer<typeof setSuccessorBodySchema>;

export const listPlansQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;

// #131: TOSS 先は後続予定の実施者に固定されるため、TOSS 先の上書きは廃止。
// 本文は不要だが、既存ルートとの互換のため空オブジェクトを受け付ける。
export const tossBodySchema = z.object({}).optional();
export type TossBody = z.infer<typeof tossBodySchema>;

// 差し戻し理由 (#131 §13。履歴として先行/実施側へ引き継ぐ)。
export const sendBackBodySchema = z
  .object({ note: z.string().max(2000).optional() })
  .optional();
export type SendBackBody = z.infer<typeof sendBackBodySchema>;
