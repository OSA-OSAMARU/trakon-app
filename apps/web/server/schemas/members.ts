import { z } from 'zod';

// メールは任意 (スケジュール担当者としての登録)。空文字は「未登録」= undefined に正規化。
const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? undefined : v),
  z.string().trim().toLowerCase().email().max(320).optional(),
);

export const memberInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: optionalEmail,
  organizationName: z.string().trim().max(255).default(''),
  memberType: z.enum(['client', 'production']),
});
export type MemberInput = z.infer<typeof memberInputSchema>;

export const addMembersBodySchema = z.object({
  members: z.array(memberInputSchema).min(1).max(20),
});
export type AddMembersBody = z.infer<typeof addMembersBodySchema>;

export const updateMemberBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  organizationName: z.string().trim().max(255).optional(),
  memberType: z.enum(['client', 'production']).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type UpdateMemberBody = z.infer<typeof updateMemberBodySchema>;

/** 参加者の一括並び替え (#111)。並び順どおりの id 配列。 */
export const reorderMembersBodySchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(200),
});
export type ReorderMembersBody = z.infer<typeof reorderMembersBodySchema>;
