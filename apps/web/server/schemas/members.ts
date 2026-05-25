import { z } from 'zod';

export const memberInputSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email().max(320),
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
