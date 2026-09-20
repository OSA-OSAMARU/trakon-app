import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2, LogIn, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { PROJECT_ROLE_LABEL } from '@trakon/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LEGAL_LINKS } from '@/features/legal/legalLinks';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useCurrentUser } from '@/features/auth/useCurrentUser';
import { supabase } from '@/lib/supabase';
import { ApiClientError } from '@/lib/api';
import { withNextParam } from '@/features/auth/nextPath';
import { invitationsApi } from './api';

const dateTimeFmt = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * SC-02 招待受諾画面 (/invitations/:token)
 *  - 未認証でも開ける (招待内容を表示)
 *  - 招待には 2 つのスコープがある (#160)
 *      project … プロジェクトへの招待。受諾後はそのプロジェクトへ送る
 *      org     … 組織への招待 (メンバー管理から発行)。紐づくプロジェクトは
 *                0 件のこともあるため、受諾後はプロジェクト一覧へ送る
 *
 * 未認証のときは「新規登録」と「ログイン」の両方を出す (#231)。
 * 招待される人はアカウントを持っていないことの方が多く、ログインしか無いと
 * そこで行き止まりになっていた。
 *
 * 新規登録は**この画面の中で完結する** (#233)。以前はここからマジックリンクの
 * 送信に回していたため、招待された人は「招待メール → 確認メール」と 2 通目を
 * 待たされていた。招待メールが届いている時点でアドレスの所有は確かめられて
 * いるので、確認メールは要らない。
 * 既にアカウントを持っている人はログインへ送る (`?next=` でここへ戻る)。
 */
export function InvitationAcceptPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const verifyQuery = useQuery({
    queryKey: ['invitations', token],
    queryFn: () => invitationsApi.verify(token!),
    enabled: !!token,
    retry: 0,
  });

  const { isAuthenticated, isLoading: sessionLoading } = useAuthSession();
  const { data: userData, isLoading: userLoading } = useCurrentUser();
  const profileReady = userData && !userData.requiresProfileCompletion;

  const acceptMut = useMutation({
    mutationFn: () => invitationsApi.accept(token!),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      // 組織単位の招待では project が null になる (#228)。
      if (!res.project) {
        toast.success('組織に参加しました');
        navigate('/projects', { replace: true });
        return;
      }
      toast.success('プロジェクトに参加しました');
      navigate(`/projects/${res.project.id}/edit`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === 'INVITATION_EMAIL_MISMATCH') {
        toast.error('招待されたメールアドレスでログインしてください');
        return;
      }
      if (err instanceof ApiClientError && err.code === 'ALREADY_MEMBER') {
        toast.message('既にこのプロジェクトに参加しています');
        navigate(`/projects`, { replace: true });
        return;
      }
      toast.error(err instanceof ApiClientError ? err.message : '受諾に失敗しました');
    },
  });

  /** 未認証時に、案内 (choose) と登録フォーム (signup) を切り替える */
  const [mode, setMode] = useState<'choose' | 'signup'>('choose');

  const invitee = verifyQuery.data?.invitee ?? null;
  const loginEmail = userData?.user?.email ?? null;
  /** 招待先と別のアカウントでログインしている (受諾は 403 になる) */
  const emailMismatch =
    !!invitee && !!loginEmail && invitee.email.toLowerCase() !== loginEmail.toLowerCase();

  /**
   * ログイン / 新規登録へ送る。戻り先にこの招待画面を指定し、
   * 招待先メールを入力欄の初期値として渡す (#231)。
   */
  const goToAuth = (screen: 'login' | 'signup') => {
    const base = screen === 'signup' ? '/login?screen=signup' : '/login';
    const path = withNextParam(base, `/invitations/${token}`);
    const email = invitee?.email;
    if (!email) {
      navigate(path);
      return;
    }
    const separator = path.includes('?') ? '&' : '?';
    navigate(`${path}${separator}email=${encodeURIComponent(email)}`);
  };

  /** 別アカウントで入り直す。今のセッションを切ってからログインへ送る */
  const switchAccount = async () => {
    await supabase.auth.signOut();
    goToAuth('login');
  };

  if (!token) return <Centered>無効な招待リンクです</Centered>;

  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 pt-24">
      <div className="w-full max-w-sm space-y-6">
        <h1 className="text-center text-heading-page font-semibold tracking-tight">TRAKON</h1>

        {verifyQuery.isLoading && (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-10 text-body text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              招待を確認しています…
            </CardContent>
          </Card>
        )}

        {verifyQuery.error && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-heading-section">
                <AlertCircle className="size-4 text-destructive" />
                招待を確認できません
              </CardTitle>
              <CardDescription>
                招待の期限が切れているか、既に受諾済みかもしれません。招待者にご確認ください。
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {verifyQuery.data && (
          <Card>
            <CardHeader>
              <CardTitle className="text-heading-section">
                {verifyQuery.data.scope === 'org' ? '組織への招待' : 'プロジェクトへの招待'}
              </CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">
                  {verifyQuery.data.project?.name ?? verifyQuery.data.organizationName}
                </span>{' '}
                への招待を受け取りました。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
                <dt className="text-muted-foreground">招待先</dt>
                <dd>{verifyQuery.data.invitee.email}</dd>
                <dt className="text-muted-foreground">氏名</dt>
                <dd>{verifyQuery.data.invitee.name || '—'}</dd>
                {/* 区分ではなく権限を出す。操作可否の根拠はロールだけ (§7.12) */}
                <dt className="text-muted-foreground">権限</dt>
                <dd>{PROJECT_ROLE_LABEL[verifyQuery.data.invitee.roleType]}</dd>
                <dt className="text-muted-foreground">有効期限</dt>
                <dd>
                  {dateTimeFmt.format(new Date(verifyQuery.data.expiresAt))}
                </dd>
              </dl>

              {sessionLoading || userLoading ? (
                <Button disabled className="w-full">
                  <Loader2 className="size-4 animate-spin" />
                  読み込み中…
                </Button>
              ) : isAuthenticated && profileReady ? (
                <div className="space-y-3">
                  {/* ログイン中のアカウントと招待先が違うと受諾は 403 になる。
                      押してから弾かれるより先に気付けるようにする (#231) */}
                  {emailMismatch && (
                    <div className="bg-danger-subtle space-y-2 rounded-md px-4 py-3">
                      <p className="text-body">
                        今ログインしているのは{' '}
                        <span className="font-medium">{loginEmail}</span> です。この招待は{' '}
                        <span className="font-medium">{verifyQuery.data.invitee.email}</span>{' '}
                        宛のため、このままでは参加できません。
                      </p>
                      <Button
                        variant="secondary"
                        className="w-full"
                        onClick={() => void switchAccount()}
                      >
                        <LogIn className="size-4" />
                        別のアカウントでログイン
                      </Button>
                    </div>
                  )}
                  <Button
                    className="w-full"
                    onClick={() => acceptMut.mutate()}
                    disabled={acceptMut.isPending || emailMismatch}
                  >
                    {acceptMut.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="size-4" />
                    )}
                    承諾
                  </Button>
                </div>
              ) : mode === 'signup' ? (
                <SignupForm
                  token={token}
                  defaultName={verifyQuery.data.invitee.name}
                  onBack={() => setMode('choose')}
                  onGoToLogin={() => goToAuth('login')}
                />
              ) : (
                <div className="space-y-3">
                  <Button className="w-full" onClick={() => setMode('signup')}>
                    <UserPlus className="size-4" />
                    新規登録して参加
                  </Button>
                  <Button
                    variant="secondary"
                    className="w-full"
                    onClick={() => goToAuth('login')}
                  >
                    <LogIn className="size-4" />
                    ログインして参加
                  </Button>
                  <p className="text-label text-muted-foreground">
                    TRAKON のアカウントをお持ちでない方は「新規登録して参加」から、
                    お持ちの方は「ログインして参加」からお進みください。
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-body text-muted-foreground">
      {children}
    </div>
  );
}

// -----------------------------------------------------------------------------
// 招待からの直接登録 (#233)
// -----------------------------------------------------------------------------

const signupSchema = z
  .object({
    fullName: z.string().trim().min(1, '氏名を入力してください').max(100),
    displayName: z.string().trim().min(1, '表示名を入力してください').max(50),
    password: z
      .string()
      .min(8, 'パスワードは8文字以上で入力してください')
      .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v) && /[^\w\s]/.test(v), {
        message: '英字・数字・記号をそれぞれ1文字以上含めてください',
      }),
    passwordConfirm: z.string(),
    agreeToTerms: z.boolean().refine((v) => v === true, {
      message: '利用規約とプライバシーポリシーに同意してください',
    }),
  })
  .refine((v) => v.password === v.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'パスワードが一致しません',
  });
type SignupValues = z.infer<typeof signupSchema>;

/**
 * 招待画面の中で完結する新規登録 (#233)。
 *
 * メールアドレスは招待が持っているので入力させない。ここで入力させると
 * 招待先と別のアドレスを入れられてしまい、確認していないアドレスで
 * アカウントが作れることになる。
 *
 * 登録が通ったらそのままパスワードでサインインする。サーバー側は既に受諾まで
 * 終えているので、あとはセッションを張って行き先へ送るだけ。
 */
function SignupForm({
  token,
  defaultName,
  onBack,
  onGoToLogin,
}: {
  token: string;
  /** 招待に入っていた氏名。入っていれば初期値にする */
  defaultName: string;
  onBack: () => void;
  onGoToLogin: () => void;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      fullName: defaultName,
      displayName: defaultName,
      password: '',
      passwordConfirm: '',
      agreeToTerms: false,
    },
  });

  const mut = useMutation({
    mutationFn: async (v: SignupValues) => {
      const res = await invitationsApi.signup(token, {
        fullName: v.fullName,
        displayName: v.displayName,
        password: v.password,
      });
      // 作ったばかりのパスワードでそのままサインインする。
      // 確認メールを挟まないのがこの導線の主眼なので、ここで詰まらせない。
      const { error } = await supabase.auth.signInWithPassword({
        email: res.email,
        password: v.password,
      });
      if (error) throw error;
      return res;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      qc.invalidateQueries({ queryKey: ['auth', 'sync'] });
      if (!res.accepted.project) {
        toast.success('アカウントを作成し、組織に参加しました');
        navigate('/projects', { replace: true });
        return;
      }
      toast.success('アカウントを作成し、プロジェクトに参加しました');
      navigate(`/projects/${res.accepted.project.id}/edit`, { replace: true });
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.code === 'EMAIL_ALREADY_REGISTERED') {
        setServerError(err.message);
        return;
      }
      setServerError(
        err instanceof ApiClientError ? err.message : '登録に失敗しました。時間をおいてお試しください。',
      );
    },
  });

  const alreadyRegistered =
    mut.error instanceof ApiClientError && mut.error.code === 'EMAIL_ALREADY_REGISTERED';

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={form.handleSubmit((v) => {
        setServerError(null);
        mut.mutate(v);
      })}
    >
      <Field id="signup-fullName" label="氏名" error={form.formState.errors.fullName?.message}>
        <Input id="signup-fullName" autoComplete="name" {...form.register('fullName')} />
      </Field>
      <Field
        id="signup-displayName"
        label="表示名"
        hint="予定表やボールの担当欄に出る名前です"
        error={form.formState.errors.displayName?.message}
      >
        <Input id="signup-displayName" {...form.register('displayName')} />
      </Field>
      <Field
        id="signup-password"
        label="パスワード"
        hint="8文字以上、英字・数字・記号を含む"
        error={form.formState.errors.password?.message}
      >
        <Input
          id="signup-password"
          type="password"
          autoComplete="new-password"
          {...form.register('password')}
        />
      </Field>
      <Field
        id="signup-passwordConfirm"
        label="パスワード（確認）"
        error={form.formState.errors.passwordConfirm?.message}
      >
        <Input
          id="signup-passwordConfirm"
          type="password"
          autoComplete="new-password"
          {...form.register('passwordConfirm')}
        />
      </Field>

      <div className="space-y-1">
        <label className="flex items-start gap-2 text-body leading-relaxed text-muted-foreground">
          <input
            type="checkbox"
            className="mt-0.5 size-4 shrink-0 accent-primary"
            {...form.register('agreeToTerms')}
          />
          <span>
            <a
              href={LEGAL_LINKS.terms}
              target="_blank"
              rel="noreferrer"
              className="text-foreground underline underline-offset-2"
            >
              利用規約
            </a>
            および
            <a
              href={LEGAL_LINKS.privacy}
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
          <p className="text-label text-destructive">
            {form.formState.errors.agreeToTerms.message}
          </p>
        )}
      </div>

      {serverError && <p className="text-body text-destructive">{serverError}</p>}
      {/* 既に登録済みなら登録ではなくログインへ送る。押す先が無いと詰む */}
      {alreadyRegistered && (
        <Button type="button" variant="secondary" className="w-full" onClick={onGoToLogin}>
          <LogIn className="size-4" />
          ログインして参加
        </Button>
      )}

      <Button type="submit" className="w-full" disabled={mut.isPending}>
        {mut.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <UserPlus className="size-4" />
        )}
        登録して参加
      </Button>
      <Button
        type="button"
        variant="ghost"
        className="w-full"
        onClick={onBack}
        disabled={mut.isPending}
      >
        <ArrowLeft className="size-4" />
        戻る
      </Button>
    </form>
  );
}

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
      {hint && !error && <p className="text-label text-muted-foreground">{hint}</p>}
      {error && <p className="text-label text-destructive">{error}</p>}
    </div>
  );
}
