import { Navigate, Route, Routes } from 'react-router-dom';

import { AuthCallbackPage } from './app/AuthCallbackPage';
import { DashboardPage } from './app/DashboardPage';
import { RequireAuth } from './features/auth/RequireAuth';
import { SC01LoginPage } from './features/auth/SC01LoginPage';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<SC01LoginPage />} />
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <DashboardPage />
          </RequireAuth>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
