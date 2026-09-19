import { Link, NavLink } from 'react-router-dom';
import {
  Archive,
  LayoutDashboard,
  List,
  MoreHorizontal,
  Plus,
  CreditCard,
  LogOut,
  Settings2,
  Share2,
  UserRound,
  Users,
} from 'lucide-react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/components/ui/utils';
import { Wordmark } from '@/components/trakon/Wordmark';

export type SidebarProject = { id: string; name: string };
export type SidebarUser = {
  displayName: string;
  email: string;
  /** プロフィール画像 (#157)。未設定はイニシャル表示 */
  avatarUrl?: string | null;
};

/**
 * ログイン後画面の左サイドバー (Figma node 9:2)。
 *
 * 幅 224px。上から ワードマーク / ダッシュボード / プロジェクト一覧、
 * 下に ユーザー情報を固定で置く。
 * データ取得は行わない表示専用コンポーネント（配線は app/SidebarLayout.tsx）。
 */
export function AppSidebar({
  projects,
  user,
  onSignOut,
  planBadge,
}: {
  projects: SidebarProject[];
  /** 読込中・未ログインは null（フッターを Skeleton にする） */
  user: SidebarUser | null;
  onSignOut: () => void;
  /** プランバッジ。契約状態から注入する。null なら非表示 (Free) */
  planBadge?: { label: string; variant: 'brand' | 'secondary' } | null;
}) {
  return (
    <aside className="border-sidebar-border bg-sidebar text-sidebar-foreground flex h-full w-56 shrink-0 flex-col border-r">
      <Link to="/dashboard" className="shrink-0 px-6 pt-6 pb-2">
        <Wordmark />
      </Link>

      <nav className="shrink-0 px-3 pt-2">
        <SideLink to="/dashboard" icon={<LayoutDashboard className="size-5" />}>
          ダッシュボード
        </SideLink>
      </nav>

      {/* プロジェクトセクションの見出し。右にセクション単位の操作を並べる (Figma 87:2 / 18:2 / 9:12)。
          スクロール領域の外に置き、プロジェクトが増えても隠れないようにしている (#54)。 */}
      <div className="mt-5 flex shrink-0 items-center gap-1 px-6 pb-1">
        <span className="text-text-tertiary flex-1 text-label font-medium">プロジェクト</span>
        <SectionIconLink to="/projects" label="プロジェクト一覧">
          <List className="size-5" />
        </SectionIconLink>
        <SectionIconLink to="/projects?tab=archived" label="アーカイブ済みプロジェクト">
          <Archive className="size-5" />
        </SectionIconLink>
        <SectionIconLink to="/projects/new" label="プロジェクトを作成">
          <Plus className="size-5" />
        </SectionIconLink>
      </div>

      <div className="flex-1 overflow-y-auto px-3 pb-2">
        <nav className="flex flex-col gap-1">
          {projects.map((p) => (
            <ProjectRow key={p.id} id={p.id} name={p.name} />
          ))}
        </nav>
      </div>

      {/* ユーザー情報フッター: 全ページ共通で常時表示 (読込中は Skeleton)。
          アカウント系の導線はここに集約する (Figma node 254:2 のメニュー)。 */}
      <div className="border-border shrink-0 border-t px-3 py-3">
        {user ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hover:bg-accent flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left"
              >
                <Avatar
                  name={user.displayName || user.email}
                  src={user.avatarUrl}
                  className="size-9 text-body"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body font-medium">{user.displayName}</span>
                  <span className="text-text-tertiary block truncate text-label">
                    {user.email}
                  </span>
                  {planBadge && (
                    <Badge variant={planBadge.variant} size="sm" className="mt-1 font-bold">
                      {planBadge.label}
                    </Badge>
                  )}
                </span>
                <MoreHorizontal className="text-text-tertiary size-5 shrink-0" aria-hidden />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-52">
              <DropdownMenuItem asChild>
                <Link to="/settings/profile">
                  <UserRound className="size-4" />
                  マイページ
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings/members">
                  <Users className="size-4" />
                  メンバー管理
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link to="/settings/billing">
                  <CreditCard className="size-4" />
                  プラン・お支払い
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onSignOut}>
                <LogOut className="size-4" />
                ログアウト
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <div className="flex items-center gap-3 px-3 py-2">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1 space-y-1">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

/** プロジェクト行。選択中はブランドの淡色で塗り、右の「⋯」から設定系へ飛ぶ (Figma 9:13 / 18:4)。 */
function ProjectRow({ id, name }: SidebarProject) {
  return (
    <div className="relative">
      <NavLink
        to={`/projects/${id}`}
        className={({ isActive }) =>
          cn(
            'flex h-11 items-center rounded-lg pr-9 pl-4 text-label transition-colors',
            isActive ? 'bg-brand-subtle font-medium' : 'text-foreground hover:bg-accent',
          )
        }
      >
        <span className="truncate">{name}</span>
      </NavLink>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`${name} の操作`}
          className="text-text-tertiary hover:text-foreground focus-visible:ring-ring absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm outline-none focus-visible:ring-2"
        >
          <MoreHorizontal className="size-[18px]" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>{name}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link to={`/projects/${id}/edit`}>
              <Settings2 />
              プロジェクト情報
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`/projects/${id}/members`}>
              <Users />
              メンバー
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link to={`/projects/${id}/share-links`}>
              <Share2 />
              共有リンク
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function SectionIconLink({
  to,
  label,
  children,
}: {
  to: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      className="text-text-secondary hover:bg-accent hover:text-foreground flex size-6 items-center justify-center rounded-sm transition-colors"
    >
      {children}
    </Link>
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
          'flex h-11 items-center gap-3 rounded-lg px-4 text-body transition-colors',
          isActive
            ? 'bg-brand-subtle font-medium'
            : 'text-text-secondary hover:bg-accent hover:text-foreground',
        )
      }
    >
      {icon}
      {children}
    </NavLink>
  );
}
