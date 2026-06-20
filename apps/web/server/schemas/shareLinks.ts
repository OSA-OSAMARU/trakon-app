import { z } from 'zod';

export const shareScopeValues = ['project', 'item', 'plan'] as const;
export const shareScopeSchema = z.enum(shareScopeValues);
export type ShareScope = z.infer<typeof shareScopeSchema>;

export const createShareLinkBodySchema = z
  .object({
    scopeType: shareScopeSchema,
    scopeTargetId: z.string().uuid().optional(),
    // null = 無期限 (有効期限なし)。デフォルト 168h(1週間)、上限 720h(30日)
    expiresInHours: z.number().int().min(1).max(24 * 30).nullable().default(168),
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
