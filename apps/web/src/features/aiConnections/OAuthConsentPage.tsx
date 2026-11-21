import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Bot, Check, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Wordmark } from '@/components/trakon/Wordmark';
import { useCurrentUser } from '@/features/auth/useCurrentUser';
import { ApiClientError } from '@/lib/api';

import {
  AI_SCOPE_LABEL,
  AUTHORIZE_PARAM_KEYS,
  aiApi,
  navigateAway,
  type AuthorizeParams,
} from './api';

/**
 * SC-20 AI 連携の同意画面 (`/oauth/authorize`) — 設計書 08-mcp §8.5.2
 *
 * OAuth の authorization_endpoint そのもの。AI クライアントがブラウザでこの URL を開き、
 * 利用者は普段の TRAKON ログインで本人確認したうえで「許可する / 拒否する」を選ぶ。
 * 未ログインなら RequireAuth が /login?next=… に送り、ログイン後ここへ戻る。
 *
 * **アプリ名は自己申告**で、誰でも「Claude」を名乗って登録できる。なりすましに気づけるよう、
 * 許可したときにアクセス権を受け取る戻り先のホスト名を必ず並べて見せる (§8.9)。
 */
export function OAuthConsentPage() {
  const [searchParams] = useSearchParams();
  const params = useMemo<AuthorizeParams>(() => {
    const p: AuthorizeParams = {};
    for (const key of AUTHORIZE_PARAM_KEYS) {
      const v = searchParams.get(key);
      if (v !== null) p[key] = v;
    }
    return p;
  }, [searchParams]);

  const { data: me } = useCurrentUser();
  const [submitting, setSubmitting] = useState<'approve' | 'deny' | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const check = useQuery({
    queryKey: ['oauth-authorize', params],
    queryFn: () => aiApi.checkAuthorize(params),
    retry: false,
    staleTime: Infinity,
  });

  // パラメータに不備がある。戻り先は登録済みだが、**自動では遷移しない**。
  // 動的登録は誰でもできるため、自動で戻すと「TRAKON のドメインから任意サイトへ飛ばす
  // オープンリダイレクタ」として悪用できる (RFC 9700 §4.11.2)。戻り先を見せて押してもらう。
  const redirectTo = check.data?.status === 'redirect' ? check.data.redirectTo : null;

  const decide = async (approved: boolean) => {
    setSubmitting(approved ? 'approve' : 'deny');
    setSubmitError(null);
    try {
      const res = await aiApi.decideAuthorize(params, approved);
      navigateAway.to(res.redirectTo);
    } catch (e) {
      setSubmitError(e instanceof ApiClientError ? e.message : '処理に失敗しました。');
      setSubmitting(null);
    }
  };

  return (
    <div className="flex min-h-screen items-start justify-center bg-background px-4 pt-20 pb-10">
      <div className="w-full max-w-md space-y-6">
        <div className="flex justify-center">
          <Wordmark />
        </div>

        {check.isLoading && (
          <Card>
            <CardContent className="flex items-center justify-center gap-2 py-10 text-body text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              接続の内容を確認しています…
            </CardContent>
          </Card>
        )}

        {check.error && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-heading-section">
                <AlertCircle className="size-4 text-destructive" />
                この接続は続けられません
              </CardTitle>
              <CardDescription>
                {check.error instanceof ApiClientError
                  ? check.error.message
                  : '接続の内容を確認できませんでした。'}
                AI アプリの画面から接続をやり直してください。
              </CardDescription>
              <Link to="/help/ai" className="text-label underline underline-offset-2">
                AI 連携の設定方法を見る
              </Link>
            </CardHeader>
          </Card>
        )}

        {redirectTo && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-heading-section">
                <AlertCircle className="size-4 text-destructive" />
                この接続は続けられません
              </CardTitle>
              <CardDescription>
                AI
                アプリから届いた接続の内容に不備がありました。アプリに戻って接続をやり直してください。
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col items-stretch gap-2">
              <Button variant="secondary" onClick={() => navigateAway.to(redirectTo)}>
                アプリに戻る
              </Button>
              <p className="text-text-tertiary text-center text-label break-all">
                戻り先: {new URL(redirectTo).host}
              </p>
            </CardFooter>
          </Card>
        )}

        {check.data?.status === 'consent' && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-heading-section">
                <Bot className="size-5" aria-hidden />
                AI アプリとの連携
              </CardTitle>
              <CardDescription>
                <span className="font-medium text-foreground">{check.data.client.name}</span>
                <span className="text-text-tertiary">（アプリが名乗っている名前）</span>
                が、あなたの TRAKON アカウントへのアクセスを求めています。
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 text-body">
              <dl className="space-y-3">
                <div>
                  <dt className="text-text-secondary text-label">許可すると接続されるサービス</dt>
                  <dd className="font-mono font-medium break-all">{check.data.redirectHost}</dd>
                </div>
                {me?.user && (
                  <div>
                    <dt className="text-text-secondary text-label">ログイン中のアカウント</dt>
                    <dd>
                      {me.user.displayName}（{me.user.email}）
                    </dd>
                  </div>
                )}
              </dl>

              <div className="space-y-2">
                <p className="font-medium">このアプリができること</p>
                <ul className="space-y-1.5">
                  {check.data.scopes.map((s) => (
                    <li key={s} className="flex items-start gap-2">
                      <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
                      {AI_SCOPE_LABEL[s]}
                    </li>
                  ))}
                </ul>
                <p className="text-text-secondary text-label">
                  操作できる範囲は、あなたが参加しているプロジェクトと、そこでのあなたの権限の範囲に限られます。
                </p>
              </div>

              <p className="text-text-secondary text-label">
                予定や参加者の名前などの情報が、接続先の AI サービスに送られます。
                心当たりのないサービスなら「拒否する」を選んでください。接続はあとから「AI
                連携」設定でいつでも解除できます。
              </p>

              {submitError && (
                <p role="alert" className="text-destructive">
                  {submitError}
                </p>
              )}
            </CardContent>
            <CardFooter className="flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => decide(false)}
                disabled={submitting !== null}
                loading={submitting === 'deny'}
              >
                拒否する
              </Button>
              <Button
                variant="brand"
                onClick={() => decide(true)}
                disabled={submitting !== null}
                loading={submitting === 'approve'}
              >
                許可する
              </Button>
            </CardFooter>
          </Card>
        )}
      </div>
    </div>
  );
}
