import { z } from 'zod';

import { JOB_TITLES, MEMBER_TYPES, PROJECT_ROLES } from '@trakon/shared';

/**
 * プロジェクト参加者の指定 (#202)。
 *
 * **参加者は「メンバー管理」の組織メンバー一覧から選ぶ。** 氏名・メール・所属を
 * ここで手入力していた頃は、同じ人が案件ごとに別人として登録され、表記ゆれや
 * 「アカウントに紐づかない参加者」が量産されていた。アカウントを唯一の起点にする。
 *
 * 氏名・メール・所属・職種は users 側が正 (#156) なのでここでは受け取らない。
 * 受け取るのは**プロジェクトごとに変わるもの**だけ。
 */
export const memberInputSchema = z.object({
  /** 組織メンバーの users.id */
  userId: z.string().uuid(),
  /** 区分 (production / client / partner)。表示専用で権限には影響しない */
  memberType: z.enum(MEMBER_TYPES),
  /** 権限ロール (FR-ROLE-01)。未指定は組織で設定された既定ロール */
  roleType: z.enum(PROJECT_ROLES).optional(),
});
export type MemberInput = z.infer<typeof memberInputSchema>;

export const addMembersBodySchema = z.object({
  members: z.array(memberInputSchema).min(1).max(20),
});
export type AddMembersBody = z.infer<typeof addMembersBodySchema>;

export const updateMemberBodySchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  organizationName: z.string().trim().max(255).optional(),
  memberType: z.enum(MEMBER_TYPES).optional(),
  // null で明示的にクリアできる
  jobTitle: z.enum(JOB_TITLES).nullable().optional(),
  /** 権限ロールの変更 (FR-ROLE-03)。最後の管理者は降格できない */
  roleType: z.enum(PROJECT_ROLES).optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
});
export type UpdateMemberBody = z.infer<typeof updateMemberBodySchema>;

/** 参加者の一括並び替え (#111)。並び順どおりの id 配列。 */
export const reorderMembersBodySchema = z.object({
  orderedIds: z.array(z.string().uuid()).min(1).max(200),
});
export type ReorderMembersBody = z.infer<typeof reorderMembersBodySchema>;
