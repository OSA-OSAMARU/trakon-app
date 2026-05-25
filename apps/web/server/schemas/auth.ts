import { z } from 'zod';

export const completeSignupBodySchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(50),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters.')
    .max(128)
    .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v) && /[^\w\s]/.test(v), {
      message: 'Password must include letters, digits, and a symbol.',
    }),
});

export type CompleteSignupBody = z.infer<typeof completeSignupBodySchema>;
