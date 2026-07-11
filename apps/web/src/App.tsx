import { Navigate, Route, Routes, Navigate as Nav, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';

import { AuthCallbackPage } from './app/AuthCallbackPage';
import { DashboardPage } from './app/DashboardPage';
import { ResetPasswordPage } from './app/ResetPasswordPage';
import { SidebarLayout } from './app/SidebarLayout';
import { RequireAuth } from './features/auth/RequireAuth';
import { SC01LoginPage } from './features/auth/SC01LoginPage';
import { InvitationAcceptPage } from './features/invitations/InvitationAcceptPage';
import { CommercePage } from './features/legal/CommercePage';
import { CompanyPage } from './features/legal/CompanyPage';
import { PrivacyPage } from './features/legal/PrivacyPage';
import { TermsPage } from './features/legal/TermsPage';
import { ItemSchedulePage } from './features/plans/ItemSchedulePage';
import { MembersPage } from './features/projects/MembersPage';
import { ProjectCreatePage } from './features/projects/ProjectCreatePage';
import { ProjectEditPage } from './features/projects/ProjectEditPage';
import { ProjectListPage } from './features/projects/ProjectListPage';
import { projectsApi, projectsQueryKey } from './features/projects/api';
import { ShareLinksPage } from './features/shareLinks/ShareLinksPage';
import { SharePage } from './features/shareLinks/SharePage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<SC01LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/auth/reset-password" element={<ResetPasswordPage />} />
      <Route path="/invitations/:token" element={<InvitationAcceptPage />} />
      <Route path="/share/:token" element={<SharePage />} />

      {/* 未ログインでも閲覧可能な会社情報・法務ページ */}
      <Route path="/company" element={<CompanyPage />} />
      <Route path="/terms" element={<TermsPage />} />
      <Route path="/privacy" element={<PrivacyPage />} />
      <Route path="/commerce" element={<CommercePage />} />

      <Route
        element={
          <RequireAuth>
            <SidebarLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/projects" element={<ProjectListPage />} />
        <Route path="/projects/new" element={<ProjectCreatePage />} />
        <Route path="/projects/:projectId/edit" element={<ProjectEditPage />} />
        <Route path="/projects/:projectId/members" element={<MembersPage />} />
        <Route path="/projects/:projectId/share-links" element={<ShareLinksPage />} />
        <Route
          path="/projects/:projectId/items/:itemId"
          element={<ItemSchedulePage />}
        />
        {/* /projects/:projectId は先頭の制作物スケジュール (縦型カレンダー) へ */}
        <Route path="/projects/:projectId" element={<ProjectRedirectToSchedule />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
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
    return <div className="p-8 text-sm text-muted-foreground">読み込み中…</div>;
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
