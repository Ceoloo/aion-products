import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { TenantProvider } from '@/hooks/useTenant';
import HoldingOverview from '@/pages/HoldingOverview';
import MissionDetail from '@/pages/MissionDetail';
import ExecutionDetail from '@/pages/ExecutionDetail';

/**
 * Workforce Control Center — exactly 3 primary screens + approval panel.
 * HARD RULE: all metrics from Runtime/Data API responses only.
 */
export default function App() {
  return (
    <TenantProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HoldingOverview />} />
          <Route path="/missions/:missionId" element={<MissionDetail />} />
          <Route path="/executions/:executionId" element={<ExecutionDetail />} />
        </Routes>
      </BrowserRouter>
    </TenantProvider>
  );
}
