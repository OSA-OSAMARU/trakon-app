import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, LogIn, UserPlus } from 'lucide-react';
import { toast } from 'sonner';

import { PROJECT_ROLE_LABEL } from '@trakon/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
 * 未認証のときは「ログイン」と「新規登録」の両方を出す (#231)。
 * 招待される人はアカウントを持っていないことの方が多く、ログインしか無いと
 * そこで行き止まりになっていた。どちらも `?next=` でこの画面に戻ってくるので、
 * 認証を終えたらそのまま承諾できる。招待先メールは入力欄に引き継ぐ
 * (別のアドレスで登録すると受諾が 403 になるため)。
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
              ) : (
                <div className="space-y-3">
                  <Button className="w-full" onClick={() => goToAuth('signup')}>
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
