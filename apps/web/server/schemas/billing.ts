import { z } from 'zod';

/** Checkout / プラン変更の対象は Personal と Team のみ (Free と Enterprise は対象外)。 */
export const checkoutablePlanSchema = z.enum(['personal', 'team']);

export const createCheckoutSessionBodySchema = z.object({
  planCode: checkoutablePlanSchema,
});
export type CreateCheckoutSessionBody = z.infer<typeof createCheckoutSessionBodySchema>;

export const changePlanBodySchema = z.object({
  planCode: checkoutablePlanSchema,
});
export type ChangePlanBody = z.infer<typeof changePlanBodySchema>;

/** 上限超過時に維持するプロジェクトの選択 (FR-BILL-11)。 */
export const retainedProjectsBodySchema = z.object({
  projectIds: z.array(z.string().uuid()).max(100),
});
export type RetainedProjectsBody = z.infer<typeof retainedProjectsBodySchema>;
