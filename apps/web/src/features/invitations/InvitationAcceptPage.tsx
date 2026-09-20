import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2, LogIn } from 'lucide-react';
import { toast } from 'sonner';

import { PROJECT_ROLE_LABEL } from '@trakon/shared';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthSession } from '@/features/auth/useAuthSession';
import { useCurrentUser } from '@/features/auth/useCurrentUser';
import { ApiClientError } from '@/lib/api';
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
                <Button
                  className="w-full"
                  onClick={() => acceptMut.mutate()}
                  disabled={acceptMut.isPending}
                >
                  {acceptMut.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="size-4" />
                  )}
                  承諾
                </Button>
              ) : (
                <Button
                  className="w-full"
                  onClick={() =>
                    navigate(
                      `/login?next=${encodeURIComponent(`/invitations/${token}`)}`,
                    )
                  }
                >
                  <LogIn className="size-4" />
                  ログインして承諾
                </Button>
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
