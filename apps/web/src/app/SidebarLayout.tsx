import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { LayoutDashboard, Plus } from 'lucide-react';

import { Toaster } from '@/components/ui/sonner';
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
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border">
        <Link to="/dashboard" className="px-5 py-5 text-xl font-bold tracking-tight">
          TRAKON
        </Link>

        <nav className="px-3">
          <SideLink to="/dashboard" icon={<LayoutDashboard className="size-4" />}>
            ダッシュボード
          </SideLink>
        </nav>

        <div className="mt-4 flex items-center justify-between px-5 py-1">
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
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
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

        {user && (
          <button
            type="button"
            onClick={() => setProfileOpen(true)}
            className="flex items-center gap-2 border-t border-border px-4 py-3 text-left hover:bg-accent/40"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {(user.displayName || user.email).charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{user.displayName}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{user.email}</span>
            </span>
          </button>
        )}
      </aside>

      <main className="flex-1 overflow-auto">
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

      <Toaster richColors position="top-right" />
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
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}
