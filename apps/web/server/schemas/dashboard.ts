import { z } from 'zod';

export const dashboardQuerySchema = z.object({
  today: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'today must be YYYY-MM-DD')
    .optional(),
});
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;
