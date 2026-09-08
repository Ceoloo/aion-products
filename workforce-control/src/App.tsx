import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { TenantProvider } from '@/hooks/useTenant';
import HoldingOverview from '@/pages/HoldingOverview';
import MissionControl from '@/pages/MissionControl';
import MissionDetail from '@/pages/MissionDetail';
import ExecutionDetail from '@/pages/ExecutionDetail';
import NewMission from '@/pages/NewMission';
import Ol001Scoreboard from '@/pages/Ol001Scoreboard';
import Implementations from '@/pages/Implementations';
import NewImplementation from '@/pages/NewImplementation';
import ImplementationDetail from '@/pages/ImplementationDetail';

/**
 * UX-001 AION Operator Console — Command Center + Mission Control + OL-001 + IE-001.
 * HARD RULE: metrics from Runtime/Data only; writes only via governed APIs.
 */
export default function App() {
  return (
    <TenantProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<HoldingOverview />} />
          <Route path="/ol001" element={<Ol001Scoreboard />} />
          <Route path="/implementations" element={<Implementations />} />
          <Route path="/implementations/new" element={<NewImplementation />} />
          <Route path="/implementations/:caseId" element={<ImplementationDetail />} />
          <Route path="/missions" element={<MissionControl />} />
          <Route path="/missions/new" element={<NewMission />} />
          <Route path="/missions/:missionId" element={<MissionDetail />} />
          <Route path="/executions/:executionId" element={<ExecutionDetail />} />
        </Routes>
      </BrowserRouter>
    </TenantProvider>
  );
}
