import { Navigate, Route, Routes, Navigate as Nav, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/sonner';

import { AuthCallbackPage } from './app/AuthCallbackPage';
import { DashboardPage } from './app/DashboardPage';
import { ResetPasswordPage } from './app/ResetPasswordPage';
import { SidebarLayout } from './app/SidebarLayout';
import { RequireAuth } from './features/auth/RequireAuth';
import { SC01LoginPage } from './features/auth/SC01LoginPage';
import { InvitationAcceptPage } from './features/invitations/InvitationAcceptPage';
import { MyPage } from '@/features/account/MyPage';
import { OrgMembersPage } from '@/features/organization/OrgMembersPage';
import { AdminPage } from './features/admin/AdminPage';
import { BillingPage } from './features/billing/BillingPage';
import { ItemSchedulePage } from './features/plans/ItemSchedulePage';
import { MembersPage } from './features/projects/MembersPage';
import { ProjectCreatePage } from './features/projects/ProjectCreatePage';
import { ProjectEditPage } from './features/projects/ProjectEditPage';
import { ProjectListPage } from './features/projects/ProjectListPage';
import { projectsApi, projectsQueryKey } from './features/projects/api';
import { ShareLinksPage } from './features/shareLinks/ShareLinksPage';
import { ExternalRedirect } from './features/legal/ExternalRedirect';
import {
  LEGACY_LEGAL_PATHS,
  LEGAL_LINK_LABEL,
  type LegalLinkKey,
} from './features/legal/legalLinks';
import { SharePage } from './features/shareLinks/SharePage';

export function App() {
  return (
    <>
      {/*
       * Toaster はルーター直下に置く。認証後レイアウトの中に置いていたため、
       * /login・/invitations/:token・/share/:token など公開ページでは
       * トーストが描画されない状態だった (設計書 §4.11 の PRD 整合メモ)。
       */}
      <Toaster richColors position="bottom-center" />
      <Routes>
        <Route path="/login" element={<SC01LoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
        <Route path="/invitations/:token" element={<InvitationAcceptPage />} />
        <Route path="/share/:token" element={<SharePage />} />

        {/* 会社情報・法務ページは公式サイトが正 (#193)。
            旧パスはブックマーク対策として公式サイトへ送るだけにする。 */}
        {LEGACY_LEGAL_PATHS.map(({ path, href }) => (
          <Route
            key={path}
            path={path}
            element={
              <ExternalRedirect href={href} label={LEGAL_LINK_LABEL[path.slice(1) as LegalLinkKey]} />
            }
          />
        ))}

        <Route
          element={
            <RequireAuth>
              <SidebarLayout />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/settings/profile" element={<MyPage />} />
          <Route path="/settings/members" element={<OrgMembersPage />} />
          <Route path="/settings/billing" element={<BillingPage />} />
          {/* 運営管理 (#204)。権限が無ければ API が 404 を返し、画面は取得失敗を出す */}
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/projects" element={<ProjectListPage />} />
          <Route path="/projects/new" element={<ProjectCreatePage />} />
          <Route path="/projects/:projectId/edit" element={<ProjectEditPage />} />
          <Route path="/projects/:projectId/members" element={<MembersPage />} />
          <Route path="/projects/:projectId/share-links" element={<ShareLinksPage />} />
          <Route path="/projects/:projectId/items/:itemId" element={<ItemSchedulePage />} />
          {/* /projects/:projectId は先頭の制作物スケジュール (縦型カレンダー) へ */}
          <Route path="/projects/:projectId" element={<ProjectRedirectToSchedule />} />
        </Route>

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </>
  );
}

/**
 * プロジェクト直下 → 先頭の制作物スケジュールへリダイレクト。
 * 制作物が無ければプロジェクト編集へフォールバック。
 */
function ProjectRedirectToSchedule() {
  const { projectId } = useParams<{ projectId: string }>();
  const itemsQuery = useQuery({
    queryKey: projectsQueryKey.items(projectId ?? ''),
    queryFn: () => projectsApi.listItems(projectId!),
    enabled: !!projectId,
  });

  if (!projectId) return <Nav to="/projects" replace />;
  if (itemsQuery.isLoading) {
    return <div className="p-8 text-body text-muted-foreground">読み込み中…</div>;
  }
  const items = (itemsQuery.data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder);
  const first = items[0];
  return (
    <Nav
      to={first ? `/projects/${projectId}/items/${first.id}` : `/projects/${projectId}/edit`}
      replace
    />
  );
}
