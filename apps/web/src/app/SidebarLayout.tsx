import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';
import { AppSidebar } from '@/components/layout/AppSidebar';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/features/auth/useCurrentUser';
import { ProfileModal } from '@/features/auth/ProfileModal';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';

/**
 * ログイン後画面の共通レイアウト。
 * サイドバーの見た目は components/layout/AppSidebar に切り出し、ここは配線だけを持つ。
 */
export function SidebarLayout() {
  const navigate = useNavigate();
  const { data } = useCurrentUser();
  const user = data && !data.requiresProfileCompletion ? data.user : null;
  const [profileOpen, setProfileOpen] = useState(false);

  const projectsQuery = useQuery({
    queryKey: projectsQueryKey.all,
    queryFn: () => projectsApi.list(),
  });

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="flex h-screen overflow-hidden bg-content text-foreground">
      <AppSidebar
        projects={projectsQuery.data ?? []}
        user={user}
        onOpenProfile={() => setProfileOpen(true)}
      />

      <main className="h-full flex-1 overflow-auto bg-content">
        <Outlet />
      </main>

      {user && (
        <ProfileModal
          user={user}
          open={profileOpen}
          onClose={() => setProfileOpen(false)}
          onSignOut={signOut}
        />
      )}

      <Toaster richColors position="bottom-center" />
    </div>
  );
}
