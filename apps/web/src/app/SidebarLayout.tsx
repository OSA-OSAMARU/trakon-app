import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, FolderKanban, LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { cn } from '@/components/ui/utils';
import { supabase } from '@/lib/supabase';
import { useCurrentUser } from '@/features/auth/useCurrentUser';

/**
 * ログイン後画面の共通レイアウト。
 * - 左サイドバー: ダッシュボード / プロジェクト
 * - 上部ヘッダー: ロゴ / ユーザー displayName / サインアウト
 * - メイン: <Outlet />
 */
export function SidebarLayout() {
  const navigate = useNavigate();
  const { data } = useCurrentUser();
  const user = data && !data.requiresProfileCompletion ? data.user : null;

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate('/login', { replace: true });
  };

  return (
    <div className="grid min-h-screen grid-rows-[auto_1fr] bg-background text-foreground">
      <header className="flex h-14 items-center justify-between border-b border-border px-6">
        <Link to="/dashboard" className="text-base font-semibold tracking-tight">
          TRAKON
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {user && (
            <span className="text-muted-foreground">
              {user.displayName}{' '}
              <span className="text-xs">({user.email})</span>
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut className="size-4" />
            サインアウト
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-[14rem_1fr]">
        <aside className="border-r border-border">
          <nav className="flex flex-col gap-1 p-3 text-sm">
            <SideLink to="/dashboard" icon={<LayoutDashboard className="size-4" />}>
              ダッシュボード
            </SideLink>
            <SideLink to="/projects" icon={<FolderKanban className="size-4" />}>
              プロジェクト
            </SideLink>
          </nav>
        </aside>

        <main className="overflow-auto">
          <Outlet />
        </main>
      </div>

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
          'flex items-center gap-2 rounded-md px-3 py-2 transition-colors',
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
