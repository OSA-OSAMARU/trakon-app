import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/lib/supabase';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { Wordmark } from '@/components/trakon/Wordmark';

/**
 * パスワード再設定 (recovery) 専用の着地ページ。
 *
 * `resetPasswordForEmail` の redirectTo からここへ着地する。Supabase SDK は
 * detectSessionInUrl により recovery トークンを消費して一時セッションを確立する。
 * このページは RequireAuth / SC01LoginPage の外にあるため、セッションが確立されても
 * ダッシュボードへ自動遷移せず、新パスワードの入力を促す (§9.1 SR-AUTH)。
 */
export function ResetPasswordPage() {
  const { session, isLoading } = useAuthSession();

  if (isLoading) {
    return (
      <Centered>
        <Loader2 className="size-4 animate-spin" />
        リンクを確認しています…
      </Centered>
    );
  }

  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 pt-24">
      <div className="w-full max-w-sm">
        <h1 className="mb-8 text-center">
          <Wordmark />
        </h1>
        {session ? <NewPasswordForm /> : <InvalidLink />}
      </div>
    </div>
  );
}

// -----------------------------------------------------------------------------
// 新パスワード入力フォーム
// -----------------------------------------------------------------------------
const resetSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'パスワードは8文字以上で入力してください')
      .max(128)
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v) && /[^\w\s]/.test(v), {
        message: '英字・数字・記号をそれぞれ1文字以上含めてください',
      }),
    confirm: z.string(),
  })
  .refine((v) => v.newPassword === v.confirm, {
    path: ['confirm'],
    message: 'パスワードが一致しません',
  });
type ResetInput = z.infer<typeof resetSchema>;

function NewPasswordForm() {
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<ResetInput>({ resolver: zodResolver(resetSchema) });

  const onSubmit = async (values: ResetInput) => {
    setServerError(null);
    const { error } = await supabase.auth.updateUser({ password: values.newPassword });
    if (error) {
      setServerError('パスワードの変更に失敗しました。時間をおいて再度お試しください。');
      return;
    }
    // 再設定完了後はサインアウトし、新パスワードでの明示的なログインを促す。
    await supabase.auth.signOut();
    toast.success('パスワードを変更しました。新しいパスワードでログインしてください。');
    navigate('/login', { replace: true });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">新しいパスワードの設定</CardTitle>
        <CardDescription>
          新しいパスワードを入力してください。
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <Field
            id="newPassword"
            label="新しいパスワード"
            hint="8文字以上、英字・数字・記号を含む"
            error={form.formState.errors.newPassword?.message}
          >
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              {...form.register('newPassword')}
            />
            <PasswordStrength value={form.watch('newPassword') ?? ''} />
          </Field>
          <Field
            id="confirm"
            label="新しいパスワード（確認）"
            error={form.formState.errors.confirm?.message}
          >
            <Input
              id="confirm"
              type="password"
              autoComplete="new-password"
              {...form.register('confirm')}
            />
          </Field>
          {serverError && <p className="text-sm text-destructive">{serverError}</p>}
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="size-4 animate-spin" />}
            パスワードを変更する
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// リンク無効／期限切れ
// -----------------------------------------------------------------------------
function InvalidLink() {
  const navigate = useNavigate();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">リンクが無効です</CardTitle>
        <CardDescription>
          パスワード再設定リンクの有効期限が切れているか、既に使用済みです。
          お手数ですが、もう一度リセットメールを送信してください。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          type="button"
          className="w-full"
          onClick={() => navigate('/login?screen=password-reset-request', { replace: true })}
        >
          リセットメールを再送する
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={() => navigate('/login', { replace: true })}
        >
          <ArrowLeft className="size-4" />
          ログインに戻る
        </Button>
      </CardContent>
    </Card>
  );
}

// -----------------------------------------------------------------------------
// Shared (SC01LoginPage と同一の見た目)
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

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      {children}
    </div>
  );
}
