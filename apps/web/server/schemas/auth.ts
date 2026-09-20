import { z } from 'zod';
import { JOB_TITLES, withdrawalReasonSchema } from '@trakon/shared';

/** パスワードの強度要件 (SC-01 のプロフィール登録と共通) */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v) && /[^\w\s]/.test(v), {
    message: 'Password must include letters, digits, and a symbol.',
  });

export const completeSignupBodySchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(50),
  password: passwordSchema,
});

/**
 * 招待からの直接登録 (#233)。メールは招待が持っているので受け取らない。
 * 利用者に入力させると招待先と別のアドレスを入れられ、確認していない
 * アドレスでアカウントが作れてしまう。
 */
export const invitationSignupBodySchema = z.object({
  fullName: z.string().trim().min(1).max(100),
  displayName: z.string().trim().min(1).max(50),
  password: passwordSchema,
});

export type InvitationSignupBody = z.infer<typeof invitationSignupBodySchema>;

export type CompleteSignupBody = z.infer<typeof completeSignupBodySchema>;

/**
 * プロフィール / 認証情報の更新 (すべて任意、1 つ以上必須)。
 *
 * 所属名・職種・通知先メールは空文字を「未設定に戻す」= null として受ける (#156)。
 * フォームは未入力を '' で送ってくるため。
 */
const clearableText = (max: number) =>
  z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().trim().max(max).nullable().optional(),
  );

export const updateProfileBodySchema = z
  .object({
    fullName: z.string().trim().min(1).max(100).optional(),
    displayName: z.string().trim().min(1).max(50).optional(),
    /** 所属名 (#156)。null / '' で未設定に戻す */
    organizationName: clearableText(255),
    /** 職種 (#156)。null / '' で未設定に戻す */
    jobTitle: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.enum(JOB_TITLES).nullable().optional(),
    ),
    /** 通知先メール (#156)。null / '' でログイン用メールへ戻す */
    notificationEmail: z.preprocess(
      (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
      z.string().trim().toLowerCase().email().max(320).nullable().optional(),
    ),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters.')
      .max(128)
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v) && /[^\w\s]/.test(v), {
        message: 'Password must include letters, digits, and a symbol.',
      })
      .optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'At least one field must be provided.',
  });

export type UpdateProfileBody = z.infer<typeof updateProfileBodySchema>;

/** 退会 (アカウント削除) リクエスト。退会理由は必須。 */
export const deleteAccountBodySchema = z.object({
  reason: withdrawalReasonSchema,
});

export type DeleteAccountBody = z.infer<typeof deleteAccountBodySchema>;
