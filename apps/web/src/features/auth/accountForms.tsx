import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { WITHDRAWAL_REASONS, type WithdrawalReason } from '@trakon/shared';

import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiClientError } from '@/lib/api';
import { authApi, type CurrentUser } from './api';

/**
 * ログイン情報 (メール / パスワード) と退会のダイアログ (#156)。
 *
 * マイページ (features/account/MyPage) から開く。プロフィール本体の編集はページ側に
 * 置き、ここには「認証情報を触る操作」と「取り返しのつかない操作」だけを残す。
 */

const AUTH_METHOD_LABEL: Record<CurrentUser['primaryAuthMethod'], string> = {
  password: 'メール + パスワード',
  google: 'Google',
  microsoft: 'Microsoft',
};

type LoginInfoMode = 'menu' | 'email' | 'password';

export function LoginInfoDialog({
  user,
  open,
  onClose,
}: {
  user: CurrentUser;
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<LoginInfoMode>('menu');
  const close = () => {
    setMode('menu');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ログイン情報を変更</DialogTitle>
          <DialogDescription>
            {mode === 'email'
              ? 'メールアドレスを変更します。確認メールで変更を確定します。'
              : mode === 'password'
                ? 'パスワードを変更します。'
                : 'ログインに使用するメールアドレスと認証情報を管理します。'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'menu' && (
          <>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-body">
              <dt className="text-muted-foreground">ログインメールアドレス</dt>
              <dd className="break-all">{user.email}</dd>
              <dt className="text-muted-foreground">認証方法</dt>
              <dd>{AUTH_METHOD_LABEL[user.primaryAuthMethod]}</dd>
            </dl>
            {user.primaryAuthMethod === 'password' ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => setMode('email')}>
                  メールアドレスを変更
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setMode('password')}>
                  パスワードを変更
                </Button>
              </div>
            ) : (
              // OAuth ユーザーはメール / パスワードを TRAKON 側で持たないため変更できない
              <p className="text-body text-muted-foreground">
                {AUTH_METHOD_LABEL[user.primaryAuthMethod]} でログインしています。
                メールアドレスとパスワードは {AUTH_METHOD_LABEL[user.primaryAuthMethod]} 側で変更してください。
              </p>
            )}
            <DialogFooter>
              <Button variant="secondary" size="sm" onClick={close}>
                閉じる
              </Button>
            </DialogFooter>
          </>
        )}
        {mode === 'email' && <EmailForm user={user} onDone={() => setMode('menu')} />}
        {mode === 'password' && <PasswordForm onDone={() => setMode('menu')} />}
      </DialogContent>
    </Dialog>
  );
}

export function WithdrawDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>退会する</DialogTitle>
          <DialogDescription>
            アカウントを退会します。この操作は取り消せません。
          </DialogDescription>
        </DialogHeader>
        <WithdrawForm onCancel={onClose} />
      </DialogContent>
    </Dialog>
  );
}

// -----------------------------------------------------------------------------
// メールアドレス変更
// -----------------------------------------------------------------------------

const emailSchema = (currentEmail: string) =>
  z.object({
    newEmail: z
      .string()
      .trim()
      .min(1, 'メールアドレスは必須')
      .email('メールアドレスの形式が正しくありません')
      .refine((v) => v.toLowerCase() !== currentEmail.toLowerCase(), {
        message: '現在のメールアドレスと同じです',
      }),
  });
type EmailValues = { newEmail: string };

/**
 * メールアドレス変更フォーム (パスワード認証ユーザーのみ, #129)。
 *
 * Supabase 組み込みの email 変更フローを利用する。`updateUser({ email })` を呼ぶと
 * `double_confirm_changes = true` により新旧両アドレスへ確認メール (Resend SMTP 経由) が届く。
 * ユーザーが両方のリンクを確定すると auth.users.email が変わり、次回 `/auth/me/sync` で
 * public.users.email が追随する (server: reconcileEmailIfChanged)。確認リンクは
 * `emailRedirectTo` (= /auth/callback) に着地し、そこで sync が走る。
 */
function EmailForm({ user, onDone }: { user: CurrentUser; onDone: () => void }) {
  const form = useForm<EmailValues>({
    resolver: zodResolver(emailSchema(user.email)),
    defaultValues: { newEmail: '' },
  });

  const mut = useMutation({
    mutationFn: async (v: EmailValues) => {
      const { error } = await supabase.auth.updateUser(
        { email: v.newEmail.trim() },
        { emailRedirectTo: `${window.location.origin}/auth/callback` },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(
        '確認メールを送信しました。現在のアドレスと新しいアドレスの両方に届くリンクから変更を確定してください。',
      );
      onDone();
    },
    onError: (e) =>
      toast.error(e instanceof Error ? e.message : 'メールアドレスの変更に失敗しました'),
  });

  return (
    <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-3">
      <div className="space-y-1.5">
        <Label>現在のメールアドレス</Label>
        <p className="text-body text-muted-foreground">{user.email}</p>
      </div>
      <FormField label="新しいメールアドレス" error={form.formState.errors.newEmail?.message}>
        <Input
          type="email"
          autoComplete="email"
          autoFocus
          placeholder="new@example.com"
          {...form.register('newEmail')}
        />
      </FormField>
      <p className="text-label text-muted-foreground">
        変更を確定するには、現在のアドレスと新しいアドレスの両方に届く確認メールのリンクを開く必要があります。
      </p>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={mut.isPending}>
          キャンセル
        </Button>
        <Button type="submit" disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="size-4 animate-spin" />}
          確認メールを送信
        </Button>
      </DialogFooter>
    </form>
  );
}

// -----------------------------------------------------------------------------
// パスワード変更
// -----------------------------------------------------------------------------

const passwordSchema = z
  .object({
    newPassword: z
      .string()
      .min(8, 'パスワードは8文字以上')
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
type PasswordValues = z.infer<typeof passwordSchema>;

function PasswordForm({ onDone }: { onDone: () => void }) {
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const mut = useMutation({
    mutationFn: (v: PasswordValues) => authApi.updateProfile({ newPassword: v.newPassword }),
    onSuccess: () => {
      toast.success('パスワードを変更しました');
      onDone();
    },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : '変更に失敗しました'),
  });

  return (
    <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-3">
      <FormField label="新しいパスワード" error={form.formState.errors.newPassword?.message}>
        <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
      </FormField>
      <FormField label="新しいパスワード（確認）" error={form.formState.errors.confirm?.message}>
        <Input type="password" autoComplete="new-password" {...form.register('confirm')} />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={mut.isPending}>
          キャンセル
        </Button>
        <Button type="submit" disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="size-4 animate-spin" />}
          パスワードを変更
        </Button>
      </DialogFooter>
    </form>
  );
}

// -----------------------------------------------------------------------------
// 退会
// -----------------------------------------------------------------------------

const withdrawSchema = z.object({
  reason: z.enum(
    WITHDRAWAL_REASONS.map((r) => r.value) as [WithdrawalReason, ...WithdrawalReason[]],
    { errorMap: () => ({ message: '退会理由を選択してください' }) },
  ),
  confirm: z.literal('退会', {
    errorMap: () => ({ message: '「退会」と正しく入力してください' }),
  }),
});
type WithdrawValues = z.infer<typeof withdrawSchema>;

/**
 * 退会 (アカウント削除) フォーム。退会理由のラジオ選択 +「退会」入力を必須にし、
 * DELETE /auth/me を送る。
 *
 * 成功時は `signOut({ scope: 'local' })` でローカルセッションのみ破棄してから /login へ。
 * この時点でサーバー側の Supabase ユーザーは既に削除済みのため、通常の global signOut は
 * `/logout` が無効トークンで失敗し localStorage を消し残す → stale セッションが残り、
 * 再ログイン/再登録時に sync(401) + projects(404) の無限ループを誘発する。local scope なら
 * サーバーを呼ばず確実にローカルを消せる。
 */
function WithdrawForm({ onCancel }: { onCancel: () => void }) {
  const navigate = useNavigate();
  const form = useForm<WithdrawValues>({ resolver: zodResolver(withdrawSchema) });

  const mut = useMutation({
    mutationFn: (v: WithdrawValues) => authApi.deleteAccount({ reason: v.reason }),
    onSuccess: async () => {
      toast.success('退会が完了しました');
      await supabase.auth.signOut({ scope: 'local' });
      navigate('/login', { replace: true });
    },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : '退会に失敗しました'),
  });

  return (
    <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-body font-medium">退会理由を教えてください</legend>
        <div className="space-y-1.5">
          {WITHDRAWAL_REASONS.map((r) => (
            <label key={r.value} className="flex items-center gap-2 text-body">
              <input
                type="radio"
                value={r.value}
                className="border-input bg-background checked:border-primary focus-visible:ring-ring size-4 shrink-0 appearance-none rounded-full border checked:border-[5px] focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
                {...form.register('reason')}
              />
              {r.label}
            </label>
          ))}
        </div>
        {form.formState.errors.reason && (
          <p className="text-destructive text-label">{form.formState.errors.reason.message}</p>
        )}
      </fieldset>

      <FormField
        label="確認のため「退会」と入力してください"
        error={form.formState.errors.confirm?.message}
      >
        <Input {...form.register('confirm')} autoComplete="off" placeholder="退会" />
      </FormField>

      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={mut.isPending}>
          キャンセル
        </Button>
        <Button
          type="submit"
          disabled={mut.isPending}
          className="bg-destructive hover:bg-destructive/90 text-white"
        >
          {mut.isPending && <Loader2 className="size-4 animate-spin" />}
          退会する
        </Button>
      </DialogFooter>
    </form>
  );
}

function FormField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-destructive text-label">{error}</p>}
    </div>
  );
}
