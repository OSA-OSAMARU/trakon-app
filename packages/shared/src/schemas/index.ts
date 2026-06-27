import { z } from 'zod';

import { WITHDRAWAL_REASONS, type WithdrawalReason } from '../constants/index.js';

export const healthSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number(),
  timestamp: z.string(),
});

export type Health = z.infer<typeof healthSchema>;

/** 退会理由 (issue #95)。WITHDRAWAL_REASONS の value 集合に限定する。 */
export const withdrawalReasonSchema = z.enum(
  WITHDRAWAL_REASONS.map((r) => r.value) as [WithdrawalReason, ...WithdrawalReason[]],
);
