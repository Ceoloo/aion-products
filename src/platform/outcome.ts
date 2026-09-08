/**
 * Call-level outcome attribution for Mission 001.
 *
 * Execution Result ≠ Business Outcome. After a call, the product records a
 * business outcome and links it to the durable run/execution ids produced by
 * Runtime (or the in-memory plane in offline mode). Persistence of the outcome
 * record itself is owned by aion-data; this helper shapes the attribution
 * payload products hand off.
 */

export interface CallOutcomeAttribution {
  callId: string;
  /** Durable run ids from governed AI executions during the call. */
  runIds: string[];
  /** Durable execution ids when Runtime returned them. */
  executionIds: string[];
  /** Total abstract cost units accumulated across executions. */
  totalCostUnits: number;
  /** Optional token usage when models were involved. */
  totalTokens?: number;
  /** Product-domain outcome summary (stage advance, conversion, etc.). */
  outcome: {
    type: string;
    status: 'pending' | 'realized' | 'failed' | 'cancelled';
    advanced: boolean;
    stageBeforeId?: string;
    stageAfterId?: string;
    value?: number;
    currency?: string;
    summary?: string;
  };
  measuredAt: string;
  metadata: Record<string, unknown>;
}

export interface BuildCallOutcomeInput {
  callId: string;
  runIds: string[];
  executionIds?: string[];
  totalCostUnits: number;
  totalTokens?: number;
  advanced: boolean;
  stageBeforeId?: string;
  stageAfterId?: string;
  value?: number;
  currency?: string;
  summary?: string;
  metadata?: Record<string, unknown>;
}

/** Build a durable-ready outcome attribution record for a finished call. */
export function buildCallOutcomeAttribution(
  input: BuildCallOutcomeInput,
): CallOutcomeAttribution {
  return {
    callId: input.callId,
    runIds: [...input.runIds],
    executionIds: [...(input.executionIds ?? [])],
    totalCostUnits: input.totalCostUnits,
    ...(input.totalTokens !== undefined ? { totalTokens: input.totalTokens } : {}),
    outcome: {
      type: 'revenue.call',
      status: input.advanced ? 'realized' : 'pending',
      advanced: input.advanced,
      ...(input.stageBeforeId ? { stageBeforeId: input.stageBeforeId } : {}),
      ...(input.stageAfterId ? { stageAfterId: input.stageAfterId } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.summary ? { summary: input.summary } : {}),
    },
    measuredAt: new Date().toISOString(),
    metadata: {
      product: 'revenue-copilot',
      mission: '001',
      ...(input.metadata ?? {}),
    },
  };
}
