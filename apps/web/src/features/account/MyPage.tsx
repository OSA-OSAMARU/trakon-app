import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { JOB_TITLES, JOB_TITLE_LABEL, type JobTitle } from '@trakon/shared';

import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageContainer } from '@/components/layout/PageContainer';
import { PageHeader } from '@/components/layout/PageHeader';
import { ApiClientError } from '@/lib/api';
import { useCurrentUser } from '@/features/auth/useCurrentUser';
import { authApi, type CurrentUser } from '@/features/auth/api';
import { LoginInfoDialog, WithdrawDialog } from '@/features/auth/accountForms';
import { AvatarCropper } from '@/components/trakon/AvatarCropper';

/**
 * マイページ (Figma node 254:2)。
 *
 * TRAKON 上の表示と通知先をまとめて設定する画面。所属名 / 職種 / 通知先メールは
 * #156 で users 側に持たせた項目で、ここで一度直せば参加している全プロジェクトの
 * 表示に反映される (read-through、packages/shared/src/domain/memberProfile.ts)。
 *
 * 認証情報の変更 (メール / パスワード) と退会は、誤操作の重みが違うので
 * カードを分けてダイアログ経由にする。
 */

/** 未選択を表す番兵。Radix Select は value='' を扱えないため。 */
const NO_JOB_TITLE = '__none__';

/** アップロード上限。server/lib/avatarStorage.ts の AVATAR_MAX_BYTES と揃える。 */
const AVATAR_MAX_BYTES = 10 * 1024 * 1024;

const schema = z.object({
  fullName: z.string().trim().min(1, '名前は必須').max(100),
  displayName: z.string().trim().min(1, '表示名は必須').max(50),
  organizationName: z.string().trim().max(255),
  // 空文字は「未設定に戻す」を意味するので許可する。union だと zod のエラーが
  // 'Invalid input' に潰れてしまうため refine で自前のメッセージを出す。
  notificationEmail: z
    .string()
    .trim()
    .max(320)
    .refine((v) => v === '' || z.string().email().safeParse(v).success, {
      message: 'メールアドレスの形式が正しくありません',
    }),
  jobTitle: z.string(),
});
type Values = z.infer<typeof schema>;

function toValues(user: CurrentUser): Values {
  return {
    fullName: user.fullName,
    displayName: user.displayName,
    organizationName: user.organizationName ?? '',
    notificationEmail: user.notificationEmail ?? '',
    jobTitle: user.jobTitle ?? NO_JOB_TITLE,
  };
}

export function MyPage() {
  const { data, isLoading } = useCurrentUser();
  const user = data && !data.requiresProfileCompletion ? data.user : null;

  if (isLoading) return <PageSkeleton />;
  if (!user) return <PageSkeleton />;
  return <MyPageInner user={user} />;
}

function MyPageInner({ user }: { user: CurrentUser }) {
  const qc = useQueryClient();
  const [loginInfoOpen, setLoginInfoOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(user) });
  useEffect(() => {
    form.reset(toValues(user));
  }, [user, form]);

  const mut = useMutation({
    mutationFn: (v: Values) =>
      authApi.updateProfile({
        fullName: v.fullName,
        displayName: v.displayName,
        // 空文字は「未設定に戻す」。BE 側で null に正規化される
        organizationName: v.organizationName,
        notificationEmail: v.notificationEmail,
        jobTitle: v.jobTitle === NO_JOB_TITLE ? null : (v.jobTitle as JobTitle),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'sync'] });
      toast.success('プロフィールを更新しました');
    },
    onError: (e) => toast.error(e instanceof ApiClientError ? e.message : '更新に失敗しました'),
  });

  const jobTitle = form.watch('jobTitle');
  const avatar = useAvatarUpload();

  return (
    <>
      <PageHeader
        width="md"
        title="マイページ"
        description="プロフィールとアカウント情報を設定します"
      />
      <PageContainer width="md">
        {/* noValidate: 検証は zod (react-hook-form) 側で行う。ブラウザ標準の
            バリデーションを有効にしたままだと type="email" が不正な値で送信自体を
            止めてしまい、アプリ側のエラー表示に到達しない。 */}
        <form noValidate onSubmit={form.handleSubmit((v) => mut.mutate(v))}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">プロフィール</CardTitle>
              <p className="text-text-secondary mt-0.5 text-mini">
                TRAKON上で表示する情報と通知先を設定します
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                <Avatar
                  name={user.displayName || user.fullName || user.email}
                  src={user.avatarUrl}
                  className="size-14 text-lg"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-body font-medium">プロフィール画像</p>
                  <p className="text-text-tertiary text-mini">
                    担当者表示やコメントに使用されます（PNG / JPEG、10MB まで）
                  </p>
                  {avatar.error && <p className="text-destructive mt-1 text-xs">{avatar.error}</p>}
                </div>
                <input
                  ref={avatar.inputRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={avatar.onFileChange}
                  data-testid="avatar-file-input"
                />
                {user.avatarUrl && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => avatar.remove()}
                    disabled={avatar.isPending}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    画像を削除
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => avatar.inputRef.current?.click()}
                  disabled={avatar.isPending}
                >
                  画像を変更
                </Button>
              </div>

              <Field label="名前" error={form.formState.errors.fullName?.message}>
                <Input {...form.register('fullName')} />
              </Field>

              <Field
                label="表示名"
                error={form.formState.errors.displayName?.message}
                hint="スケジュール・担当者・TOSS履歴に表示されます"
              >
                <Input {...form.register('displayName')} />
              </Field>

              <Field label="所属名" error={form.formState.errors.organizationName?.message}>
                <Input {...form.register('organizationName')} placeholder="株式会社サンプル" />
              </Field>

              <Field
                label="通知先メールアドレス"
                error={form.formState.errors.notificationEmail?.message}
                hint={`TOSSやコメントRETURNなどの通知を送信します。未入力の場合はログインメールアドレス（${user.email}）に送ります`}
              >
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder={user.email}
                  {...form.register('notificationEmail')}
                />
              </Field>

              <Field label="職種">
                <Select
                  value={jobTitle}
                  onValueChange={(v) => form.setValue('jobTitle', v, { shouldDirty: true })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="職種を選択" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_JOB_TITLE}>未設定</SelectItem>
                    {JOB_TITLES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {JOB_TITLE_LABEL[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="border-border flex justify-end border-t pt-4">
                <Button type="submit" disabled={mut.isPending || !form.formState.isDirty}>
                  {mut.isPending && <Loader2 className="size-4 animate-spin" />}
                  変更を保存
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">ログイン情報</CardTitle>
            <p className="text-text-secondary mt-0.5 text-mini">
              ログインに使用するメールアドレスと認証情報を管理します
            </p>
          </CardHeader>
          <CardContent className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <Label className="text-text-secondary">ログインメールアドレス</Label>
              <p className="mt-1 truncate text-body">{user.email}</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setLoginInfoOpen(true)}>
              ログイン情報を変更
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">退会</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <p className="text-text-secondary text-sm">
              アカウントを削除します。この操作は取り消せません。
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setWithdrawOpen(true)}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              退会する
            </Button>
          </CardContent>
        </Card>
      </PageContainer>

      {avatar.previewUrl && (
        <AvatarCropper
          imageSrc={avatar.previewUrl}
          open
          submitting={avatar.isPending}
          onCancel={avatar.cancel}
          onCropped={(blob) => avatar.upload(blob)}
        />
      )}

      <LoginInfoDialog
        user={user}
        open={loginInfoOpen}
        onClose={() => setLoginInfoOpen(false)}
      />
      <WithdrawDialog open={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </>
  );
}

/**
 * プロフィール画像の選択 → トリミング → アップロードをまとめたフック (#157)。
 *
 * ファイル選択の時点で拡張子とサイズを見て弾く。サーバー側でも同じ検証をするが、
 * 10MB のファイルを送りつけてから 413 で返すのは無駄なので手前でも見る。
 */
function useAvatarUpload() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const clearPreview = () => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  };

  const onSettled = () => {
    qc.invalidateQueries({ queryKey: ['auth', 'sync'] });
    clearPreview();
  };

  const uploadMut = useMutation({
    mutationFn: (blob: Blob) => authApi.uploadAvatar(blob),
    onSuccess: () => toast.success('プロフィール画像を更新しました'),
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '画像をアップロードできませんでした'),
    onSettled,
  });

  const removeMut = useMutation({
    mutationFn: () => authApi.removeAvatar(),
    onSuccess: () => toast.success('プロフィール画像を削除しました'),
    onError: (e) =>
      toast.error(e instanceof ApiClientError ? e.message : '画像を削除できませんでした'),
    onSettled: () => qc.invalidateQueries({ queryKey: ['auth', 'sync'] }),
  });

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 同じファイルを選び直せるよう毎回クリアする
    e.target.value = '';
    if (!file) return;

    setError(null);
    if (file.type !== 'image/png' && file.type !== 'image/jpeg') {
      setError('PNG または JPEG の画像を選んでください。');
      return;
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError('画像は 10MB 以下にしてください。');
      return;
    }
    clearPreview();
    setPreviewUrl(URL.createObjectURL(file));
  };

  return {
    inputRef,
    previewUrl,
    error,
    isPending: uploadMut.isPending || removeMut.isPending,
    onFileChange,
    cancel: () => {
      clearPreview();
      setError(null);
    },
    upload: (blob: Blob) => uploadMut.mutate(blob),
    remove: () => removeMut.mutate(),
  };
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
      {error ? (
        <p className="text-destructive text-xs">{error}</p>
      ) : hint ? (
        <p className="text-text-tertiary text-xs">{hint}</p>
      ) : null}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 px-8 py-10">
      <Skeleton className="h-8 w-1/3" />
      <Skeleton className="h-96 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}
