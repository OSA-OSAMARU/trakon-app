import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/features/auth/useCurrentUser';

/**
 * Supabase Auth の Magic-link / OAuth コールバック着地点。
 * Supabase SDK は detectSessionInUrl により URL の fragment を消費して
 * セッションを確立する。ここでは sync 結果を見て次の画面に遷移する。
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { session, sessionLoading, data, isLoading, error } = useCurrentUser();
  // 後方互換: 旧リセットメールは /auth/callback に着地する。PASSWORD_RECOVERY を
  // 検出したら専用のパスワード再設定ページへ振り替える (detectSessionInUrl が
  // hash を消費するため type=recovery は直接読めず、イベントで判定する)。
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
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
  }, [session, sessionLoading, data, isLoading, error, navigate, isRecovery]);

  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      認証情報を確認しています…
    </div>
  );
}
