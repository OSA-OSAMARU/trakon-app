import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar } from '@/components/ui/avatar';
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

const AUTH_METHOD_LABEL: Record<CurrentUser['primaryAuthMethod'], string> = {
  password: 'メール + パスワード',
  google: 'Google',
  microsoft: 'Microsoft',
};

type Mode = 'view' | 'profile' | 'password';

/**
 * プロフィール / 認証情報モーダル (プロトタイプ ProfileModal 準拠)。
 * - 表示 / 氏名・表示名の編集 / パスワード変更 を切替
 * - 更新は PATCH /auth/me、成功時 ['auth','sync'] を invalidate
 */
export function ProfileModal({
  user,
  open,
  onClose,
  onSignOut,
}: {
  user: CurrentUser;
  open: boolean;
  onClose: () => void;
  onSignOut: () => void;
}) {
  const [mode, setMode] = useState<Mode>('view');
  const close = () => {
    setMode('view');
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>アカウント</DialogTitle>
          <DialogDescription>
            {mode === 'password'
              ? 'パスワードを変更します。'
              : mode === 'profile'
                ? 'お名前と表示名を変更します。'
                : 'プロフィール情報を確認・編集できます。'}
          </DialogDescription>
        </DialogHeader>

        {mode === 'view' && (
          <ViewMode
            user={user}
            onEdit={() => setMode('profile')}
            onChangePassword={() => setMode('password')}
            onSignOut={onSignOut}
            onClose={close}
          />
        )}
        {mode === 'profile' && <ProfileForm user={user} onDone={() => setMode('view')} />}
        {mode === 'password' && <PasswordForm onDone={() => setMode('view')} />}
      </DialogContent>
    </Dialog>
  );
}

function ViewMode({
  user,
  onEdit,
  onChangePassword,
  onSignOut,
  onClose,
}: {
  user: CurrentUser;
  onEdit: () => void;
  onChangePassword: () => void;
  onSignOut: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Avatar
          name={user.displayName || user.fullName || user.email}
          className="size-12 text-base"
        />
        <div className="min-w-0">
          <p className="truncate font-medium">{user.displayName}</p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
        </div>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">氏名</dt>
        <dd>{user.fullName}</dd>
        <dt className="text-muted-foreground">表示名</dt>
        <dd>{user.displayName}</dd>
        <dt className="text-muted-foreground">認証方法</dt>
        <dd>{AUTH_METHOD_LABEL[user.primaryAuthMethod]}</dd>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={onEdit}>
          プロフィールを編集
        </Button>
        {user.primaryAuthMethod === 'password' && (
          <Button variant="outline" size="sm" onClick={onChangePassword}>
            パスワードを変更
          </Button>
        )}
      </div>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          閉じる
        </Button>
        <Button variant="outline" onClick={onSignOut}>
          <LogOut className="size-4" />
          サインアウト
        </Button>
      </DialogFooter>
    </>
  );
}

const profileSchema = z.object({
  fullName: z.string().trim().min(1, '氏名は必須').max(100),
  displayName: z.string().trim().min(1, '表示名は必須').max(50),
});
type ProfileValues = z.infer<typeof profileSchema>;

function ProfileForm({ user, onDone }: { user: CurrentUser; onDone: () => void }) {
  const qc = useQueryClient();
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: user.fullName, displayName: user.displayName },
  });

  const mut = useMutation({
    mutationFn: (v: ProfileValues) => authApi.updateProfile(v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'sync'] });
      toast.success('プロフィールを更新しました');
      onDone();
    },
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '更新に失敗しました'),
  });

  return (
    <form onSubmit={form.handleSubmit((v) => mut.mutate(v))} className="space-y-3">
      <FormField label="氏名" error={form.formState.errors.fullName?.message}>
        <Input {...form.register('fullName')} autoFocus />
      </FormField>
      <FormField label="表示名" error={form.formState.errors.displayName?.message}>
        <Input {...form.register('displayName')} />
      </FormField>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onDone} disabled={mut.isPending}>
          キャンセル
        </Button>
        <Button type="submit" disabled={mut.isPending}>
          {mut.isPending && <Loader2 className="size-4 animate-spin" />}
          保存
        </Button>
      </DialogFooter>
    </form>
  );
}

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
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '変更に失敗しました'),
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
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
