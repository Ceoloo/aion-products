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

import { RuntimeApiError, type SubmitCommandRequest, type RuntimeCommandResponse, type RuntimeApiErrorBody } from './runtime-contracts.ts';
export { RuntimeApiError } from './runtime-contracts.ts';
export type { SubmitCommandRequest, RuntimeCommandResponse, RuntimeApiErrorBody } from './runtime-contracts.ts';

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

/** Resolve Runtime base URL from env; undefined → in-memory / offline mode. */
export function runtimeUrlFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const url = env.AION_RUNTIME_URL?.trim();
  return url && url.length > 0 ? url : undefined;
}
