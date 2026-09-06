import { useState } from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { AppSidebar } from '@/components/layout/AppSidebar';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/features/auth/useCurrentUser';
import { ProfileModal } from '@/features/auth/ProfileModal';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';
import { useEntitlement } from '@/features/billing/useEntitlement';
import { BillingStatusBanner } from '@/features/billing/BillingStatusBanner';
import { BILLING_PLANS } from '@trakon/shared';

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

  // サイドバーのプランバッジは契約状態から作る (ハードコードしない、§4.5)。
  // 契約プランではなく**実効プラン**を出す。解約済みで Team と出し続けると、
  // 実際には Free の上限が効いている状態と食い違う
  const { entitlement } = useEntitlement();
  const planBadge =
    entitlement && entitlement.effectivePlanCode !== 'free'
      ? { label: BILLING_PLANS[entitlement.effectivePlanCode].label, variant: 'brand' as const }
      : null;

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
        planBadge={planBadge}
      />

      <main className="h-full flex-1 overflow-auto bg-content">
        {/* 課金起因の状態は隠さずバナーで示し、復旧導線を出す (§4.5.2) */}
        <BillingStatusBanner />
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

    </div>
  );
}
