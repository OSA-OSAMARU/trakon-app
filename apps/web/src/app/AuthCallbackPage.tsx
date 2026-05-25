import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useCurrentUser } from '@/features/auth/useCurrentUser';

/**
 * Supabase Auth の Magic-link / OAuth コールバック着地点。
 * Supabase SDK は detectSessionInUrl により URL の fragment を消費して
 * セッションを確立する。ここでは sync 結果を見て次の画面に遷移する。
 */
export function AuthCallbackPage() {
  const navigate = useNavigate();
  const { session, sessionLoading, data, isLoading, error } = useCurrentUser();

  useEffect(() => {
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
  }, [session, sessionLoading, data, isLoading, error, navigate]);

  return (
    <div className="flex min-h-screen items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" />
      認証情報を確認しています…
    </div>
  );
}
