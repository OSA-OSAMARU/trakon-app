import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format.');

const uuid = z.string().uuid();

export const planCategoryValues = [
  'wireframe',
  'design',
  'coding',
  'review',
  'meeting',
  'other',
] as const;
export const planCategorySchema = z.enum(planCategoryValues);
export type PlanCategory = z.infer<typeof planCategorySchema>;

export const createPlanBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    category: planCategorySchema,
    scheduledDate: isoDate,
    dueDate: isoDate.optional(),
    fromMemberId: uuid,
    toMemberId: uuid,
    successorPlanId: uuid.optional(),
    memo: z.string().max(2000).optional(),
  })
  .refine((v) => v.fromMemberId !== v.toMemberId, {
    path: ['toMemberId'],
    message: 'fromMemberId and toMemberId must differ.',
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.scheduledDate, {
    path: ['dueDate'],
    message: 'dueDate must be on or after scheduledDate.',
  });
export type CreatePlanBody = z.infer<typeof createPlanBodySchema>;

export const updatePlanBodySchema = z
  .object({
    title: z.string().trim().min(1).max(255).optional(),
    category: planCategorySchema.optional(),
    scheduledDate: isoDate.optional(),
    dueDate: isoDate.nullable().optional(),
    memo: z.string().max(2000).nullable().optional(),
  })
  .refine(
    (v) => {
      if (v.scheduledDate && v.dueDate) return v.dueDate >= v.scheduledDate;
      return true;
    },
    { path: ['dueDate'], message: 'dueDate must be on or after scheduledDate.' },
  );
export type UpdatePlanBody = z.infer<typeof updatePlanBodySchema>;

export const setSuccessorBodySchema = z.object({
  successorPlanId: uuid.nullable(),
});
export type SetSuccessorBody = z.infer<typeof setSuccessorBodySchema>;

export const listPlansQuerySchema = z.object({
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type ListPlansQuery = z.infer<typeof listPlansQuerySchema>;

export const tossBodySchema = z.object({
  toMemberId: uuid.optional(),
});
export type TossBody = z.infer<typeof tossBodySchema>;
