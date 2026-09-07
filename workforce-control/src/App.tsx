import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { TenantProvider } from '@/hooks/useTenant';
import HoldingOverview from '@/pages/HoldingOverview';
import MissionControl from '@/pages/MissionControl';
import MissionDetail from '@/pages/MissionDetail';
import ExecutionDetail from '@/pages/ExecutionDetail';

/**
 * UX-001 AION Operator Console — Command Center + Mission Control.
 * HARD RULE: metrics from Runtime/Data only; writes only via governed APIs.
 */
export default function App() {
  return (
    <TenantProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HoldingOverview />} />
          <Route path="/missions" element={<MissionControl />} />
          <Route path="/missions/:missionId" element={<MissionDetail />} />
          <Route path="/executions/:executionId" element={<ExecutionDetail />} />
        </Routes>
      </BrowserRouter>
    </TenantProvider>
  );
}
