import { Navigate, useLocation } from 'react-router-dom';

import { useCurrentUser } from './useCurrentUser';

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { session, sessionLoading, data, isLoading } = useCurrentUser();

  if (sessionLoading || isLoading) {
    return <CenteredSpinner label="読み込み中…" />;
  }

  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }

  if (data?.requiresProfileCompletion) {
    return <Navigate to="/login?screen=create-account" replace />;
  }

  return <>{children}</>;
}

function CenteredSpinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  );
}
