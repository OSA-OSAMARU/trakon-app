import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Mail, ArrowLeft, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { ApiClientError } from '@/lib/api';
import { useAuthSession } from './useAuthSession';
import { authApi, type SyncResponse } from './api';
import { OAuthButtons } from './OAuthButtons';

// =============================================================================
// SC-01 ログイン/サインアップ統合画面
// Magic-link 系 5 状態：login / signup / email-sent / create-account /
//   password-reset-request
// URL: /login?screen=<state>&email=<email>&next=<next>
// =============================================================================

type Screen = 'login' | 'signup' | 'email-sent' | 'create-account' | 'password-reset-request';

const SCREENS: Screen[] = [
  'login',
  'signup',
  'email-sent',
  'create-account',
  'password-reset-request',
];

const GENERIC_AUTH_ERROR =
  'メールアドレスまたはパスワードが正しくありません。'; // PRD §9.1 / SR-AUTH

function readScreen(params: URLSearchParams): Screen {
  const s = params.get('screen') as Screen | null;
  return s && SCREENS.includes(s) ? s : 'login';
}

export function SC01LoginPage() {
  const [params, setParams] = useSearchParams();
  const screen = readScreen(params);
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: sessionLoading } = useAuthSession();

  // 既にログイン済みかつ profile 完了済みなら /dashboard へ
  useEffect(() => {
    if (!sessionLoading && isAuthenticated && screen !== 'create-account') {
      navigate('/dashboard', { replace: true });
    }
  }, [sessionLoading, isAuthenticated, screen, navigate]);

  const goTo = (next: Screen, extra?: Record<string, string>) => {
    const sp = new URLSearchParams(params);
    sp.set('screen', next);
    for (const [k, v] of Object.entries(extra ?? {})) sp.set(k, v);
    setParams(sp, { replace: true });
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 pt-24">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center text-3xl font-extrabold tracking-[0.2em]">TRAKON</h1>
        {screen === 'login' && <LoginForm goTo={goTo} />}
        {screen === 'signup' && <SignupForm goTo={goTo} />}
        {screen === 'email-sent' && <EmailSent email={params.get('email') ?? ''} goTo={goTo} />}
        {screen === 'create-account' && <CreateAccountForm />}
        {screen === 'password-reset-request' && <PasswordResetRequest goTo={goTo} />}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 1. login — メール + パスワード
// -----------------------------------------------------------------------------
const loginSchema = z.object({
  email: z.string().email('正しいメールアドレスを入力してください'),
  password: z.string().min(1, 'パスワードを入力してください'),
});
type LoginInput = z.infer<typeof loginSchema>;

function LoginForm({ goTo }: { goTo: (next: Screen, extra?: Record<string, string>) => void }) {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  const onSubmit = async (values: LoginInput) => {
    setServerError(null);
    // ログイン状態の保存希望を記録 (Supabase は既定で localStorage 永続)
    try {
      localStorage.setItem('trakon.rememberMe', remember ? '1' : '0');
    } catch {
      /* localStorage 不可環境は無視 */
    }
    const { error } = await supabase.auth.signInWithPassword(values);
    if (error) {
      setServerError(GENERIC_AUTH_ERROR);
      return;
    }
    navigate('/dashboard', { replace: true });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">ログイン</CardTitle>
        <CardDescription>アカウントにサインインします</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Field id="email" label="メールアドレス" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <Field id="password" label="パスワード" error={form.formState.errors.password?.message}>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              {...form.register('password')}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              className="size-4 accent-primary"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
            />
            ログイン状態を保存する
          </label>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            ログイン
          </Button>
        </form>
        <div className="mt-6">
          <OAuthButtons />
        </div>
        <div className="mt-6 flex flex-col items-center gap-2 text-sm">
          <button
            type="button"
            className="text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => goTo('password-reset-request')}
          >
            パスワードを忘れた場合
          </button>
          <button
            type="button"
            className="text-foreground underline-offset-4 hover:underline"
            onClick={() => goTo('signup')}
          >
            新規登録はこちら
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// 2. signup — メール入力 → Magic-link 送信
// -----------------------------------------------------------------------------
const signupSchema = z.object({
  email: z.string().email('正しいメールアドレスを入力してください'),
});
type SignupInput = z.infer<typeof signupSchema>;

// 新規登録では利用規約・プライバシーポリシーへの同意を必須とする。
// signupSchema はパスワード再設定でも再利用するため、同意付きは別スキーマにする。
const signupWithConsentSchema = signupSchema.extend({
  agreeToTerms: z.boolean().refine((v) => v === true, {
    message: '利用規約とプライバシーポリシーに同意してください',
  }),
});
type SignupWithConsentInput = z.infer<typeof signupWithConsentSchema>;

function SignupForm({
  goTo,
}: {
  goTo: (next: Screen, extra?: Record<string, string>) => void;
}) {
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<SignupWithConsentInput>({
    resolver: zodResolver(signupWithConsentSchema),
    defaultValues: { agreeToTerms: false },
  });
  // 規約同意チェックの状態。メール・OAuth いずれの新規登録もこのチェックで解放する。
  const agreed = form.watch('agreeToTerms');

  const onSubmit = async (values: SignupWithConsentInput) => {
    setServerError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email: values.email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) {
      setServerError('メールの送信に失敗しました。時間をおいて再度お試しください。');
      return;
    }
    goTo('email-sent', { email: values.email });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">新規登録</CardTitle>
        <CardDescription>
          メールアドレスを入力するとログイン用のリンクが届きます
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Field id="email" label="メールアドレス" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
          </Field>
          <div className="space-y-1">
            <label className="flex items-start gap-2 text-[13px] leading-relaxed text-muted-foreground">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                {...form.register('agreeToTerms')}
              />
              <span>
                <a
                  href="/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-2"
                >
                  利用規約
                </a>
                および
                <a
                  href="/privacy"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground underline underline-offset-2"
                >
                  プライバシーポリシー
                </a>
                に同意します
              </span>
            </label>
            {form.formState.errors.agreeToTerms && (
              <p className="text-xs text-destructive">
                {form.formState.errors.agreeToTerms.message}
              </p>
            )}
          </div>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          <Button
            type="submit"
            className="w-full"
            disabled={form.formState.isSubmitting || !agreed}
          >
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            <Mail className="size-4" />
            認証メールを送る
          </Button>
        </form>
        <div className="mt-6">
          {/* OAuth は「みなし同意」文言 (OAuthButtons 内) で担保するため、規約チェック
              未完でも押下可能。チェックボックスはメール登録ボタン専用。 */}
          <OAuthButtons />
        </div>
        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
          <a href="/terms" target="_blank" rel="noreferrer" className="underline underline-offset-2">
            利用規約
          </a>
          {' ・ '}
          <a
            href="/privacy"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            プライバシーポリシー
          </a>
          {' ・ '}
          <a
            href="/commerce"
            target="_blank"
            rel="noreferrer"
            className="underline underline-offset-2"
          >
            特定商取引法に基づく表記
          </a>
        </p>
        <div className="mt-4 text-center text-sm">
          <button
            type="button"
            className="text-foreground underline-offset-4 hover:underline"
            onClick={() => goTo('login')}
          >
            既にアカウントをお持ちの方
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// 3. email-sent — 送信完了表示 + 再送（60秒クールダウン）
// -----------------------------------------------------------------------------
function EmailSent({
  email,
  goTo,
}: {
  email: string;
  goTo: (next: Screen, extra?: Record<string, string>) => void;
}) {
  const [cooldown, setCooldown] = useState(60);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const resend = async () => {
    if (cooldown > 0 || !email) return;
    setResending(true);
    await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setResending(false);
    setCooldown(60);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">メールを送信しました</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">{email}</span> 宛にログイン用リンクを送りました。
          メールアプリを開いてリンクをクリックしてください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={cooldown > 0 || resending || !email}
          onClick={resend}
        >
          {cooldown > 0 ? `再送 (${cooldown}s)` : '再送'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => goTo('signup')}
        >
          <ArrowLeft className="size-4" />
          別のメールアドレスで登録
        </Button>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// 4. create-account — Magic-link クリック後の詳細入力
// -----------------------------------------------------------------------------
const createAccountSchema = z
  .object({
    fullName: z.string().trim().min(1, '本名を入力してください').max(100),
    displayName: z.string().trim().min(1, '表示名を入力してください').max(50),
    password: z
      .string()
      .min(8, 'パスワードは8文字以上で入力してください')
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v) && /[^\w\s]/.test(v), {
        message: '英字・数字・記号をそれぞれ1文字以上含めてください',
      }),
    passwordConfirm: z.string(),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'パスワードが一致しません',
  });
type CreateAccountInput = z.infer<typeof createAccountSchema>;

function CreateAccountForm() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { session, isLoading } = useAuthSession();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<CreateAccountInput>({ resolver: zodResolver(createAccountSchema) });

  if (isLoading) return <CardSkeleton label="読み込み中…" />;
  if (!session) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">セッションが見つかりません</CardTitle>
          <CardDescription>
            メールのリンクから開き直してください。
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const onSubmit = async (values: CreateAccountInput) => {
    setServerError(null);
    try {
      const user = await authApi.completeSignup({
        fullName: values.fullName,
        displayName: values.displayName,
        password: values.password,
      });
      // 完了結果で sync キャッシュを「プロフィール完了済み」に確定上書きする。
      // invalidateQueries は create-account 上で非アクティブな sync クエリを再取得せず
      // (stale マークのみ)、遷移先の RequireAuth が古い requiresProfileCompletion: true を
      // 読んで create-account に差し戻してしまうため、setQueryData で確定値を書き込む。
      // キーは useCurrentUser と同一: ['auth', 'sync', session.user.id]
      queryClient.setQueryData<SyncResponse>(['auth', 'sync', session.user.id], {
        user,
        requiresProfileCompletion: false,
      });
      navigate('/dashboard', { replace: true });
    } catch (err) {
      if (err instanceof ApiClientError && err.code === 'SAME_EMAIL_DIFFERENT_PROVIDER') {
        const details = err.details as { primaryAuthMethod?: string } | undefined;
        const method =
          details?.primaryAuthMethod === 'google'
            ? 'Google'
            : details?.primaryAuthMethod === 'microsoft'
              ? 'Microsoft'
              : 'メール+パスワード';
        setServerError(`このメールアドレスは ${method} で登録済みです。`);
        return;
      }
      setServerError(
        err instanceof ApiClientError ? err.message : '登録に失敗しました。時間をおいてお試しください。',
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">プロフィール登録</CardTitle>
        <CardDescription>
          <span className="font-medium text-foreground">{session.user.email}</span>{' '}
          として、お名前とパスワードを設定します。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Field id="fullName" label="氏名" error={form.formState.errors.fullName?.message}>
            <Input id="fullName" autoComplete="name" {...form.register('fullName')} />
          </Field>
          <Field
            id="displayName"
            label="表示名"
            hint="プロジェクトで表示される名前です"
            error={form.formState.errors.displayName?.message}
          >
            <Input id="displayName" {...form.register('displayName')} />
          </Field>
          <Field
            id="password"
            label="パスワード"
            hint="8文字以上、英字・数字・記号を含む"
            error={form.formState.errors.password?.message}
          >
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...form.register('password')}
            />
            <PasswordStrength value={form.watch('password') ?? ''} />
          </Field>
          <Field
            id="passwordConfirm"
            label="パスワード（確認）"
            error={form.formState.errors.passwordConfirm?.message}
          >
            <Input
              id="passwordConfirm"
              type="password"
              autoComplete="new-password"
              {...form.register('passwordConfirm')}
            />
          </Field>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            登録
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// 5. password-reset-request — リセットメール送信要求
// -----------------------------------------------------------------------------
function PasswordResetRequest({
  goTo,
}: {
  goTo: (next: Screen, extra?: Record<string, string>) => void;
}) {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<SignupInput>({ resolver: zodResolver(signupSchema) });

  const onSubmit = async (values: SignupInput) => {
    setServerError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(values.email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });
    if (error) {
      // 機密第一: 存在判定を漏らさないため成功扱いに統一
      setSent(true);
      return;
    }
    setSent(true);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">パスワードの再設定</CardTitle>
        <CardDescription>
          ご登録のメールアドレスにリセット用のリンクを送ります。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {sent ? (
          <div className="space-y-4">
            <p className="text-sm">
              入力されたメールアドレスが登録されていればリンクを送信しました。届かない場合は迷惑メールフォルダもご確認ください。
            </p>
            <Button type="button" variant="ghost" className="w-full" onClick={() => goTo('login')}>
              <ArrowLeft className="size-4" />
              ログインに戻る
            </Button>
          </div>
        ) : (
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <Field id="email" label="メールアドレス" error={form.formState.errors.email?.message}>
              <Input id="email" type="email" autoComplete="email" {...form.register('email')} />
            </Field>
            {serverError && <p className="text-sm text-destructive">{serverError}</p>}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
              リセットメールを送る
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => goTo('login')}>
              <ArrowLeft className="size-4" />
              ログインに戻る
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Shared field
// -----------------------------------------------------------------------------
function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// -----------------------------------------------------------------------------
// パスワード強度インジケータ (プロトタイプ準拠)
// -----------------------------------------------------------------------------
function PasswordStrength({ value }: { value: string }) {
  if (!value) return null;
  let score = 0;
  if (value.length >= 8) score++;
  if (/[A-Za-z]/.test(value)) score++;
  if (/\d/.test(value)) score++;
  if (/[^\w\s]/.test(value)) score++;

  const meta =
    score <= 1
      ? { label: '弱い', color: 'bg-red-500' }
      : score === 2
        ? { label: '普通', color: 'bg-amber-500' }
        : score === 3
          ? { label: 'やや強い', color: 'bg-lime-500' }
          : { label: '強い', color: 'bg-emerald-500' };

  return (
    <div className="mt-1.5 space-y-1" aria-live="polite">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full ${i < score ? meta.color : 'bg-muted'}`}
          />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">強度：{meta.label}</p>
    </div>
  );
}

function CardSkeleton({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-center gap-2 pt-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {label}
      </CardContent>
    </Card>
  );
}
