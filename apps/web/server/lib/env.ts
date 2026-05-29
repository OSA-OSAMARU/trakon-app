import { z } from 'zod';

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_ENV: z.enum(['local', 'dev', 'prod', 'test']).default('local'),
    SUPABASE_URL: z.string().url(),
    /**
     * Supabase secret key (`sb_secret_*`) — 新方式 (推奨)。
     * 未設定なら deprecated な SUPABASE_SERVICE_ROLE_KEY (JWT) にフォールバック。
     * Supabase Legacy API keys は 2026 年末でサポート終了予定。
     */
    SUPABASE_SECRET_KEY: z.string().min(20).optional(),
    /** @deprecated 新方式 SUPABASE_SECRET_KEY を使用すること。 */
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
    SUPABASE_JWT_AUD: z.string().default('authenticated'),
    DATABASE_URL: z.string().url().optional(),
    DIRECT_URL: z.string().url().optional(),
    SERVER_PORT: z.coerce.number().default(3001),
    /** 招待 URL の組み立てに使用 (FE オリジン) */
    PUBLIC_APP_URL: z.string().url().default('http://localhost:5173'),
    /** Resend 本実装 (未設定なら dummy mailer にフォールバック) */
    RESEND_API_KEY: z.string().optional(),
    RESEND_FROM_EMAIL: z.string().optional(),
    /** Sentry エラー監視 (未設定なら no-op) */
    SENTRY_DSN: z.string().optional(),
    SENTRY_ENVIRONMENT: z.string().optional(),
  })
  .refine((d) => Boolean(d.SUPABASE_SECRET_KEY ?? d.SUPABASE_SERVICE_ROLE_KEY), {
    message:
      'SUPABASE_SECRET_KEY (推奨, sb_secret_*) または SUPABASE_SERVICE_ROLE_KEY (deprecated) のいずれかが必要',
    path: ['SUPABASE_SECRET_KEY'],
  })
  .transform((d) => ({
    ...d,
    // 優先順: SUPABASE_SECRET_KEY → SUPABASE_SERVICE_ROLE_KEY
    SUPABASE_SECRET_KEY: (d.SUPABASE_SECRET_KEY ?? d.SUPABASE_SERVICE_ROLE_KEY) as string,
  }));

export type ServerEnv = z.infer<typeof envSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`[trakon] Invalid server env: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}
