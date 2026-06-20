import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Plus } from 'lucide-react';

import { Toaster } from '@/components/ui/sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/components/ui/utils';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/features/auth/useCurrentUser';
import { ProfileModal } from '@/features/auth/ProfileModal';
import { projectsApi, projectsQueryKey } from '@/features/projects/api';

const DOT_PALETTE = [
  'bg-violet-500',
  'bg-sky-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-500',
];

function dotColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return DOT_PALETTE[hash % DOT_PALETTE.length]!;
}

/**
 * ログイン後画面の共通レイアウト (プロトタイプ SidebarLayout 準拠)。
 * - 左サイドバー: TRAKON ロゴ / ダッシュボード / プロジェクト一覧 (色ドット + 追加)
 * - フッター: ユーザープロフィールボタン → ProfileModal
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
      <aside className="flex h-full w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <Link
          to="/dashboard"
          className="shrink-0 px-6 py-5 text-2xl font-extrabold tracking-[0.2em]"
        >
          TRAKON
        </Link>

        <nav className="shrink-0 px-3">
          <SideLink to="/dashboard" icon={<LayoutDashboard className="size-4" />}>
            ダッシュボード
          </SideLink>
        </nav>

        <div className="mt-4 flex shrink-0 items-center justify-between px-5 py-1">
          <span className="text-xs font-medium text-muted-foreground">プロジェクト</span>
          <Link
            to="/projects/new"
            aria-label="プロジェクトを作成"
            className="text-muted-foreground hover:text-foreground"
          >
            <Plus className="size-4" />
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto px-3">
          <nav className="flex flex-col gap-0.5">
            {(projectsQuery.data ?? []).map((p) => (
              <NavLink
                key={p.id}
                to={`/projects/${p.id}`}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors',
                    isActive
                      ? 'bg-primary/10 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )
                }
              >
                <span className={cn('size-2 shrink-0 rounded-full', dotColor(p.id))} />
                <span className="truncate">{p.name}</span>
              </NavLink>
            ))}
            <NavLink
              to="/projects"
              className="mt-1 px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              すべて見る →
            </NavLink>
          </nav>
        </div>

        {/* ユーザー情報フッター: 全ページ共通で常時表示 (読込中は Skeleton) */}
        <div className="shrink-0 border-t border-border">
          {user ? (
            <button
              type="button"
              onClick={() => setProfileOpen(true)}
              className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-accent/40"
            >
              <Avatar name={user.displayName || user.email} className="size-8 text-xs" />
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{user.displayName}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {user.email}
                </span>
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2 px-4 py-3">
              <Skeleton className="size-8 rounded-full" />
              <div className="flex-1 space-y-1">
                <Skeleton className="h-3.5 w-24" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          )}
        </div>
      </aside>

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

function SideLink({
  to,
  icon,
  children,
}: {
  to: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-primary/10 font-medium text-primary'
            : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}
