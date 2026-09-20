import { Navigate, useLocation } from 'react-router-dom';

import { useCurrentUser } from './useCurrentUser';
import { withNextParam } from './nextPath';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { session, sessionLoading, data, isLoading } = useCurrentUser();

  if (sessionLoading || isLoading) {
    return <CenteredSpinner label="読み込み中…" />;
  }

  const next = location.pathname + location.search;

  if (!session) {
    return <Navigate to={withNextParam('/login', next)} replace />;
  }

  if (data?.requiresProfileCompletion) {
    // プロフィール登録のあと、元々開こうとしていた画面へ戻す (#231)
    return <Navigate to={withNextParam('/login?screen=create-account', next)} replace />;
  }

  return <>{children}</>;
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <span className="text-body text-muted-foreground">{label}</span>
    </div>
  );
}
