import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/features/auth/useCurrentUser';

/**
 * OAuth プロバイダ (Supabase) が email 取得に失敗したときのエラー文言。
 * Azure (Microsoft) が email クレームを返さないと Supabase が
 * "Error getting user email from external provider" を返す (設計 §6.6.1)。
 */
function friendlyProviderError(errorDescription: string | null): string {
  const desc = errorDescription ?? '';
  if (/email/i.test(desc)) {
    return 'メールアドレスを取得できなかったため、ログインを完了できませんでした。ご利用のアカウントでメールアドレスが公開されているかご確認のうえ、別の方法でログインしてください。';
  }
  return 'ログインを完了できませんでした。お手数ですが、もう一度お試しください。';
}

/**
 * Supabase Auth の Magic-link / OAuth コールバック着地点。
 * Supabase SDK は detectSessionInUrl により URL の fragment を消費して
 * セッションを確立する。ここでは sync 結果を見て次の画面に遷移する。
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { session, sessionLoading, data, isLoading, error } = useCurrentUser();
  // 後方互換: 旧リセットメールは /auth/callback に着地する。PASSWORD_RECOVERY を
  // 検出したら専用のパスワード再設定ページへ振り替える (detectSessionInUrl が
  // hash を消費するため type=recovery は直接読めず、イベントで判定する)。
  const [isRecovery, setIsRecovery] = useState(false);

  // OAuth プロバイダ (Supabase) がコールバックに付けるエラー。email 取得失敗などで
  // ?error=...&error_description=... が付く。従来は無視して無言で /login に戻していたため
  // 原因が UI から一切分からなかった。ここで検出して画面に表示する。
  const providerError = searchParams.get('error');
  const providerErrorDescription = searchParams.get('error_description');

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // プロバイダエラー時は遷移せずエラーを表示する (無言リダイレクトの抑止)。
    if (providerError) return;
    if (isRecovery) {
      navigate('/auth/reset-password', { replace: true });
      return;
    }
    if (sessionLoading || isLoading) return;
    if (!session) {
      navigate('/login', { replace: true });
      return;
    }
    if (error) {
      navigate('/login', { replace: true });
      return;
    }
    if (data?.requiresProfileCompletion) {
      navigate('/login?screen=create-account', { replace: true });
      return;
    }
    if (data && !data.requiresProfileCompletion) {
      navigate('/dashboard', { replace: true });
    }
  }, [session, sessionLoading, data, isLoading, error, navigate, isRecovery, providerError]);

  if (providerError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-sm text-destructive">{friendlyProviderError(providerErrorDescription)}</p>
        {providerErrorDescription && (
          <p className="text-xs text-muted-foreground">詳細: {providerErrorDescription}</p>
        )}
        <Link to="/login" replace className="text-sm text-foreground underline underline-offset-2">
          ログイン画面に戻る
        </Link>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      認証情報を確認しています…
    </div>
  );
}
