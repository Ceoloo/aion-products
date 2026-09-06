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
};
