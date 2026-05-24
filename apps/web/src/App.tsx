import { Routes, Route } from 'react-router-dom';
import { HealthCheckPage } from './app/HealthCheckPage';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HealthCheckPage />} />
    </Routes>
  );
}
