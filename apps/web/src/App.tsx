import { Navigate, Route, Routes, Navigate as Nav, useParams } from 'react-router-dom';

import { AuthCallbackPage } from './app/AuthCallbackPage';
import { DashboardPage } from './app/DashboardPage';
import { SidebarLayout } from './app/SidebarLayout';
import { RequireAuth } from './features/auth/RequireAuth';
import { SC01LoginPage } from './features/auth/SC01LoginPage';
import { InvitationAcceptPage } from './features/invitations/InvitationAcceptPage';
import { ItemSchedulePage } from './features/plans/ItemSchedulePage';
import { MembersPage } from './features/projects/MembersPage';
import { ProjectCreatePage } from './features/projects/ProjectCreatePage';
import { ProjectEditPage } from './features/projects/ProjectEditPage';
import { ProjectListPage } from './features/projects/ProjectListPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<SC01LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route path="/invitations/:token" element={<InvitationAcceptPage />} />

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
        <Route
          path="/projects/:projectId/items/:itemId"
          element={<ItemSchedulePage />}
        />
        {/* /projects/:projectId は当面 edit に飛ばす (詳細ダッシュボードは Phase 1) */}
        <Route path="/projects/:projectId" element={<ProjectRedirectToEdit />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}

function ProjectRedirectToEdit() {
  const { projectId } = useParams<{ projectId: string }>();
  return <Nav to={`/projects/${projectId}/edit`} replace />;
}
