import { z } from 'zod';

export const shareScopeValues = ['project', 'item', 'plan'] as const;
export const shareScopeSchema = z.enum(shareScopeValues);
export type ShareScope = z.infer<typeof shareScopeSchema>;

export const createShareLinkBodySchema = z
  .object({
    scopeType: shareScopeSchema,
    scopeTargetId: z.string().uuid().optional(),
    expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
  })
  .superRefine((v, ctx) => {
    if (v.scopeType === 'project' && v.scopeTargetId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopeTargetId'],
        message: "scopeTargetId must be omitted when scopeType is 'project'.",
      });
    }
    if ((v.scopeType === 'item' || v.scopeType === 'plan') && !v.scopeTargetId) {
      ctx.addIssue({
        code: 'custom',
        path: ['scopeTargetId'],
        message: "scopeTargetId is required for 'item' or 'plan' scope.",
      });
    }
  });
export type CreateShareLinkBody = z.infer<typeof createShareLinkBodySchema>;
