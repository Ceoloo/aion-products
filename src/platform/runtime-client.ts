/**
 * HTTP client for the AION Runtime Execution Gateway.
 *
 * Products talk to durable Runtime over HTTP — they do NOT embed an in-memory
 * control plane in production. This client mirrors aion-runtime's
 * `RuntimeClient` surface so aion-products stays free of a code dependency on
 * the runtime package (six-repo boundary).
 */

export interface RuntimeClientOptions {
  /** Base URL of aion-runtime, e.g. http://127.0.0.1:8080 */
  baseUrl: string;
  fetch?: typeof fetch;
}

import {
  RuntimeApiError,
  type SubmitCommandRequest,
  type RuntimeCommandResponse,
  type RuntimeApiErrorBody,
  type CreateOutcomeInput,
  type UpdateOutcomeInput,
  type OutcomeRecord,
  type CreateRevenueSessionInput,
  type UpdateRevenueSessionInput,
  type RevenueSessionRecord,
} from './runtime-contracts.ts';
export { RuntimeApiError } from './runtime-contracts.ts';
export type {
  SubmitCommandRequest,
  RuntimeCommandResponse,
  RuntimeApiErrorBody,
  CreateOutcomeInput,
  UpdateOutcomeInput,
  OutcomeRecord,
  CreateRevenueSessionInput,
  UpdateRevenueSessionInput,
  RevenueSessionRecord,
} from './runtime-contracts.ts';

export class RuntimeClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: RuntimeClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.fetchFn = options.fetch ?? fetch;
  }

  async submitCommand(input: SubmitCommandRequest): Promise<RuntimeCommandResponse> {
    return this.request('POST', '/v1/commands', input) as Promise<RuntimeCommandResponse>;
  }

  async getRun(runId: string): Promise<unknown> {
    return this.request('GET', `/v1/runs/${encodeURIComponent(runId)}`);
  }

  async decideApproval(
    approvalId: string,
    body: { approve: boolean; decidedBy: string; note?: string },
  ): Promise<RuntimeCommandResponse> {
    return this.request(
      'POST',
      `/v1/approvals/${encodeURIComponent(approvalId)}/decision`,
      body,
    ) as Promise<RuntimeCommandResponse>;
  }

  async getExecution(executionId: string): Promise<unknown> {
    return this.request('GET', `/v1/executions/${encodeURIComponent(executionId)}`);
  }

  async getExecutionByRun(runId: string): Promise<unknown> {
    return this.request('GET', `/v1/executions/by-run/${encodeURIComponent(runId)}`);
  }

  async listServices(): Promise<unknown> {
    return this.request('GET', '/v1/services');
  }

  // ── Outcomes (Runtime → Data) ──────────────────────────────────────────

  async createOutcome(input: CreateOutcomeInput): Promise<{ outcome: OutcomeRecord }> {
    return this.request('POST', '/v1/outcomes', input) as Promise<{ outcome: OutcomeRecord }>;
  }

  async getOutcome(outcomeId: string): Promise<{ outcome: OutcomeRecord }> {
    return this.request(
      'GET',
      `/v1/outcomes/${encodeURIComponent(outcomeId)}`,
    ) as Promise<{ outcome: OutcomeRecord }>;
  }

  async listOutcomes(query?: {
    missionId?: string;
    runId?: string;
  }): Promise<{ outcomes: OutcomeRecord[]; count: number }> {
    const params = new URLSearchParams();
    if (query?.missionId) params.set('missionId', query.missionId);
    if (query?.runId) params.set('runId', query.runId);
    const qs = params.toString();
    const raw = (await this.request(
      'GET',
      `/v1/outcomes${qs ? `?${qs}` : ''}`,
    )) as { outcomes?: OutcomeRecord[]; count?: number };
    const outcomes = Array.isArray(raw.outcomes) ? raw.outcomes : [];
    return { outcomes, count: raw.count ?? outcomes.length };
  }

  async patchOutcome(
    outcomeId: string,
    patch: UpdateOutcomeInput,
  ): Promise<{ outcome: OutcomeRecord }> {
    return this.request(
      'PATCH',
      `/v1/outcomes/${encodeURIComponent(outcomeId)}`,
      patch,
    ) as Promise<{ outcome: OutcomeRecord }>;
  }

  // ── Revenue sessions (Runtime → Data) ──────────────────────────────────

  async createRevenueSession(
    input: CreateRevenueSessionInput,
  ): Promise<{ session: RevenueSessionRecord }> {
    return this.request('POST', '/v1/revenue-sessions', input) as Promise<{
      session: RevenueSessionRecord;
    }>;
  }

  async getRevenueSession(
    sessionId: string,
  ): Promise<{ session: RevenueSessionRecord }> {
    return this.request(
      'GET',
      `/v1/revenue-sessions/${encodeURIComponent(sessionId)}`,
    ) as Promise<{ session: RevenueSessionRecord }>;
  }

  async updateRevenueSession(
    sessionId: string,
    body: UpdateRevenueSessionInput,
  ): Promise<{ session: RevenueSessionRecord }> {
    return this.request(
      'PUT',
      `/v1/revenue-sessions/${encodeURIComponent(sessionId)}`,
      body,
    ) as Promise<{ session: RevenueSessionRecord }>;
  }

  async listRevenueSessions(status?: 'active' | 'finalized'): Promise<{
    sessions: RevenueSessionRecord[];
    count: number;
  }> {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    const raw = (await this.request('GET', `/v1/revenue-sessions${qs}`)) as {
      sessions?: RevenueSessionRecord[];
      sessionIds?: string[];
      records?: unknown[];
      count?: number;
    };
    // Normalize gateway variants (full rows, ids-only active list, finals-only).
    let sessions: RevenueSessionRecord[] = [];
    if (Array.isArray(raw.sessions)) {
      sessions = raw.sessions;
    } else if (status === 'finalized' && Array.isArray(raw.records)) {
      sessions = raw.records.map((finalRecord, i) => ({
        sessionId:
          finalRecord &&
          typeof finalRecord === 'object' &&
          typeof (finalRecord as { sessionId?: unknown }).sessionId === 'string'
            ? (finalRecord as { sessionId: string }).sessionId
            : `finalized_${i}`,
        checkpoint: null,
        finalRecord,
        revision: 0,
      }));
    } else if (status === 'active' && Array.isArray(raw.sessionIds)) {
      sessions = raw.sessionIds.map((sessionId) => ({
        sessionId,
        checkpoint: null,
        finalRecord: null,
        revision: 0,
      }));
    }
    return { sessions, count: raw.count ?? sessions.length };
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let parsed: unknown = {};
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = { error: 'invalid_json', message: text };
      }
    }
    if (!res.ok) {
      const err = parsed as RuntimeApiErrorBody;
      throw new RuntimeApiError(
        res.status,
        typeof err.error === 'string' ? err.error : 'http_error',
        typeof err.message === 'string' ? err.message : `HTTP ${res.status}`,
      );
    }
    return parsed;
  }
}

/**
 * Durable deployments (staging/production) must use Runtime HTTP (ADR-007).
 * Image packaging gates may set AION_ENVIRONMENT=production without a Runtime
 * only when AION_ALLOW_IN_MEMORY_CONTROL_PLANE=1 is explicit.
 */
export function isDurableDeployment(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const name = (env.AION_ENVIRONMENT ?? 'local').trim().toLowerCase();
  if (name !== 'production' && name !== 'staging' && name !== 'prod') {
    return false;
  }
  if (env.AION_ALLOW_IN_MEMORY_CONTROL_PLANE === '1') return false;
  return true;
}

/** Resolve Runtime base URL from env; undefined → in-memory / offline mode. */
export function runtimeUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = env.AION_RUNTIME_URL?.trim();
  return url && url.length > 0 ? url : undefined;
}

/**
 * Resolve Runtime URL with ADR-007 fail-closed semantics: staging/production
 * require AION_RUNTIME_URL (unless explicitly allowed for packaging gates).
 */
export function resolveRuntimeUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = runtimeUrlFromEnv(env);
  if (url) return url;
  if (isDurableDeployment(env)) {
    throw new Error(
      'AION_RUNTIME_URL is required when AION_ENVIRONMENT is production|staging (ADR-007 fail-closed). Set AION_ALLOW_IN_MEMORY_CONTROL_PLANE=1 only for non-durable packaging gates.',
    );
  }
  return undefined;
}
