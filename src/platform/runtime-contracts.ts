/** Transport-neutral Runtime contracts; no HTTP or environment access. */
export interface SubmitCommandRequest {
  name: string;
  actor: unknown;
  capability?: string;
  /** Preferred: catalog resolution on Runtime. */
  serviceKey?: string;
  requestId?: string;
  missionId?: string;
  workflowId?: string;
  toolId?: string;
  payload?: Record<string, unknown>;
  riskLevel?: string;
  metadata?: Record<string, unknown>;
}

export interface RuntimeApiErrorBody {
  error: string;
  message: string;
}

export class RuntimeApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'RuntimeApiError';
    this.status = status;
    this.code = code;
  }
}

/** Narrow view of a successful gateway command response. */
export interface RuntimeCommandResponse {
  status: string;
  run?: { runId?: string; correlationId?: string; [k: string]: unknown };
  execution?: {
    executionId?: string;
    cost?: { units?: number; tokens?: number };
    [k: string]: unknown;
  };
  decision?: { reason?: string; riskLevel?: string; [k: string]: unknown };
  result?: {
    status?: string;
    output?: { value?: unknown; [k: string]: unknown };
    executor?: string;
    model?: string;
    durationMs?: number;
    cost?: { units?: number; tokens?: number };
    metadata?: Record<string, unknown>;
    error?: { message?: string };
    [k: string]: unknown;
  };
  approval?: { approvalId?: string; [k: string]: unknown };
  [k: string]: unknown;
}

export interface RuntimeTransport {
  submitCommand(input: SubmitCommandRequest): Promise<RuntimeCommandResponse>;
}

/** Durable business outcome — mirrors aion-data CreateOutcomeInput / OutcomeRecord. */
export type OutcomeStatus = 'pending' | 'realized' | 'failed' | 'cancelled';

export interface CreateOutcomeInput {
  runId: string;
  missionId?: string;
  status?: OutcomeStatus;
  outcomeType?: string;
  externalReference?: string;
  value?: number;
  currency?: string;
  measuredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateOutcomeInput {
  status?: OutcomeStatus;
  outcomeType?: string;
  externalReference?: string;
  value?: number;
  currency?: string;
  measuredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface OutcomeRecord {
  outcomeId: string;
  runId: string;
  missionId?: string;
  status: OutcomeStatus | string;
  outcomeType?: string;
  externalReference?: string;
  value?: number;
  currency?: string;
  measuredAt?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

/** Opaque Revenue Copilot session row via Runtime → Data. */
export interface RevenueSessionRecord {
  sessionId: string;
  checkpoint: unknown | null;
  finalRecord: unknown | null;
  revision: number;
}

export interface CreateRevenueSessionInput {
  sessionId: string;
  checkpoint: unknown;
}

export interface UpdateRevenueSessionInput {
  revision: number;
  checkpoint?: unknown | null;
  finalRecord?: unknown | null;
}
