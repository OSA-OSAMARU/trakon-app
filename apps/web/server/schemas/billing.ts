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

/**
 * Checkout からの復帰時に行う契約状態の照合 (#209)。
 *
 * Checkout Session ID は Stripe が発行する `cs_` 始まりの不透明な文字列。
 * 値の正当性は Stripe API に問い合わせて metadata の組織 ID と突き合わせて確認するので、
 * ここでは形式と長さだけを見る。
 */
export const syncSubscriptionBodySchema = z.object({
  checkoutSessionId: z
    .string()
    .regex(/^cs_[A-Za-z0-9_]+$/, 'Invalid checkout session id.')
    .max(255)
    .optional(),
});
export type SyncSubscriptionBody = z.infer<typeof syncSubscriptionBodySchema>;
