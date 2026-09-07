/**
 * Runtime HTTP client for Workforce Control Center.
 *
 * HARD RULE: numbers on screen come only from these responses.
 * Empty / missing fields render as empty-state — never invent KPIs.
 */
import type {
  ApprovalRequest,
  EconomicsRollup,
  ExecutionObject,
  ImplementationCase,
  Mission,
} from './types';

const RUNTIME_URL = (import.meta.env.VITE_AION_RUNTIME_URL as string | undefined)?.replace(/\/$/, '') ?? '';
const DEFAULT_TENANT = (import.meta.env.VITE_AION_TENANT_ID as string | undefined) ?? 'aion-systems';

export class RuntimeHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RuntimeHttpError';
  }
}

async function request<T>(
  path: string,
  tenantId: string,
  init?: RequestInit,
): Promise<T> {
  const base = RUNTIME_URL || '';
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'x-aion-tenant-id': tenantId,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  const text = await res.text();
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { error: 'invalid_json', message: text };
    }
  }
  if (!res.ok) {
    const err = body as { error?: string; message?: string };
    throw new RuntimeHttpError(
      res.status,
      err.error ?? 'http_error',
      err.message ?? `HTTP ${res.status}`,
    );
  }
  return body as T;
}

export const RuntimeApi = {
  defaultTenant: DEFAULT_TENANT,
  runtimeUrl: RUNTIME_URL || '(same-origin / vite proxy)',

  getEconomics(tenantId: string) {
    return request<{ economics: EconomicsRollup }>(
      `/v1/economics?tenantId=${encodeURIComponent(tenantId)}`,
      tenantId,
    );
  },

  listMissions(tenantId: string) {
    return request<{ missions: Mission[] }>('/v1/missions', tenantId);
  },

  getMission(tenantId: string, missionId: string) {
    return request<{ mission: Mission }>(
      `/v1/missions/${encodeURIComponent(missionId)}`,
      tenantId,
    );
  },

  getMissionEconomics(tenantId: string, missionId: string) {
    return request<{ economics: EconomicsRollup }>(
      `/v1/missions/${encodeURIComponent(missionId)}/economics`,
      tenantId,
    );
  },

  listExecutions(tenantId: string, limit = 100) {
    return request<{ executions: ExecutionObject[]; count: number }>(
      `/v1/executions?limit=${limit}`,
      tenantId,
    );
  },

  getExecution(tenantId: string, executionId: string) {
    return request<{ execution: ExecutionObject }>(
      `/v1/executions/${encodeURIComponent(executionId)}`,
      tenantId,
    );
  },

  getExecutionsByRoot(tenantId: string, rootExecutionId: string) {
    return request<{ executions: ExecutionObject[]; count: number }>(
      `/v1/executions/by-root/${encodeURIComponent(rootExecutionId)}`,
      tenantId,
    );
  },

  listApprovals(tenantId: string, status?: 'pending' | 'granted' | 'rejected') {
    const qs = status ? `?status=${status}` : '';
    return request<{ approvals: ApprovalRequest[]; count: number }>(
      `/v1/approvals${qs}`,
      tenantId,
    );
  },

  /**
   * Governed human gate — UI never invents authority; Runtime decides.
   * Body: { approve, decidedBy, note? }
   */
  decideApproval(
    tenantId: string,
    approvalId: string,
    body: { approve: boolean; decidedBy: string; note?: string },
  ) {
    return request<{
      status: string;
      run: unknown;
      execution: ExecutionObject | null;
      decision: unknown;
    }>(`/v1/approvals/${encodeURIComponent(approvalId)}/decision`, tenantId, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  /**
   * Launch a mission via the canonical Runtime contract (same as proofs).
   * UI must not invent a parallel execution path.
   */
  runMission(tenantId: string, body: Record<string, unknown>) {
    return request<{
      status: string;
      rootExecutionId?: string;
      stoppedAtStep?: number | null;
      steps?: unknown[];
      mission?: Mission;
      workflow?: { workflowId?: string; name?: string; version?: string };
    }>('/v1/missions/run', tenantId, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  // ── IE-001 Implementation Engine ────────────────────────────────────────

  listImplementations(tenantId: string, deliveryStatus?: string) {
    const qs = deliveryStatus
      ? `?deliveryStatus=${encodeURIComponent(deliveryStatus)}`
      : '';
    return request<{ cases: ImplementationCase[]; count: number }>(
      `/v1/implementations${qs}`,
      tenantId,
    );
  },

  getImplementation(tenantId: string, caseId: string) {
    return request<{ case: ImplementationCase }>(
      `/v1/implementations/${encodeURIComponent(caseId)}`,
      tenantId,
    );
  },

  createImplementation(
    tenantId: string,
    body: {
      clientRef: string;
      clientName: string;
      ownerId: string;
      commercialStatus?: string;
      nextAction?: string;
    },
  ) {
    return request<{ case: ImplementationCase }>('/v1/implementations', tenantId, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  submitImplementationIntake(
    tenantId: string,
    caseId: string,
    body: Record<string, unknown>,
  ) {
    return request<{
      case: ImplementationCase;
      recommendation?: ImplementationCase['recommendation'];
    }>(`/v1/implementations/${encodeURIComponent(caseId)}/intake`, tenantId, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  draftImplementationBlueprint(
    tenantId: string,
    caseId: string,
    body: Record<string, unknown>,
  ) {
    return request<{
      case: ImplementationCase;
      blueprint?: ImplementationCase['blueprint'];
    }>(`/v1/implementations/${encodeURIComponent(caseId)}/blueprint`, tenantId, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  approveImplementationBlueprint(
    tenantId: string,
    caseId: string,
    body: { approvedBy: string },
  ) {
    return request<{
      case: ImplementationCase;
      blueprint?: ImplementationCase['blueprint'];
    }>(
      `/v1/implementations/${encodeURIComponent(caseId)}/blueprint/approve`,
      tenantId,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  // ── IE-002 Provisioning + Activation ────────────────────────────────────

  startImplementationProvisioning(
    tenantId: string,
    caseId: string,
    body: { startedBy?: string } = {},
  ) {
    return request<{ case: ImplementationCase }>(
      `/v1/implementations/${encodeURIComponent(caseId)}/provisioning/start`,
      tenantId,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  updateImplementationProvisioningStep(
    tenantId: string,
    caseId: string,
    stepKey: string,
    body: {
      status: string;
      evidence?: string;
      completedBy?: string;
      blockReason?: string;
    },
  ) {
    return request<{ case: ImplementationCase }>(
      `/v1/implementations/${encodeURIComponent(caseId)}/provisioning/steps/${encodeURIComponent(stepKey)}`,
      tenantId,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  probeImplementationProvisioningStep(
    tenantId: string,
    caseId: string,
    stepKey: string,
    body: Record<string, unknown>,
  ) {
    return request<{
      case: ImplementationCase;
      probe?: { step: string; ok: boolean; evidence: string; missing: string[] };
      hint?: string;
    }>(
      `/v1/implementations/${encodeURIComponent(caseId)}/provisioning/steps/${encodeURIComponent(stepKey)}/probe`,
      tenantId,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  markImplementationActivationReady(
    tenantId: string,
    caseId: string,
    body: { markedBy?: string } = {},
  ) {
    return request<{ case: ImplementationCase }>(
      `/v1/implementations/${encodeURIComponent(caseId)}/activation/ready`,
      tenantId,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },

  activateImplementation(
    tenantId: string,
    caseId: string,
    body: { approvedBy: string },
  ) {
    return request<{ case: ImplementationCase }>(
      `/v1/implementations/${encodeURIComponent(caseId)}/activate`,
      tenantId,
      { method: 'POST', body: JSON.stringify(body) },
    );
  },
};
