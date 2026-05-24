import { z } from 'zod';

export const healthSchema = z.object({
  status: z.literal('ok'),
  uptime: z.number(),
  timestamp: z.string(),
});

export type Health = z.infer<typeof healthSchema>;
