import { z } from 'zod';

import { JOB_TITLES, MEMBER_TYPES, PROJECT_ROLES } from '@trakon/shared';

/**
 * 招待の作成 (§7.12.5)。
 *
 * 2 モードある:
 *   - memberId 指定あり … 既存の担当者行 (userId が NULL) にメールを付けて招待する
 *   - memberId 指定なし … 参加者行を新規に作って招待する
 */
export const createInvitationBodySchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  roleType: z.enum(PROJECT_ROLES).default('editor'),
  memberId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(100).optional(),
  organizationName: z.string().trim().max(255).optional(),
  memberType: z.enum(MEMBER_TYPES).optional(),
  jobTitle: z.enum(JOB_TITLES).nullable().optional(),
});
export type CreateInvitationBody = z.infer<typeof createInvitationBodySchema>;
