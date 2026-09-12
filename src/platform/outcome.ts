/**
 * Call-level outcome attribution for Mission 001.
 *
 * Execution Result ≠ Business Outcome. After a call, the product records a
 * business outcome and links it to the durable run/execution ids produced by
 * Runtime (or the in-memory plane in offline mode). Persistence of the outcome
 * record itself is owned by aion-data via Runtime HTTP; this helper shapes the
 * attribution payload and maps it to CreateOutcomeInput.
 */

import type { CreateOutcomeInput, OutcomeRecord } from './runtime-contracts.ts';
import type { RuntimeClient } from './runtime-client.ts';

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
    status: 'pending' | 'realized' | 'failed' | 'unknown';
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

/**
 * Map product attribution → Runtime/Data CreateOutcomeInput.
 * Requires at least one runId (first run is the durable link).
 */
export function toCreateOutcomeInput(
  attribution: CallOutcomeAttribution,
): CreateOutcomeInput | null {
  const runId = attribution.runIds[0];
  if (!runId) return null;
  return {
    runId,
    status: attribution.outcome.status,
    outcomeType: attribution.outcome.type,
    ...(attribution.outcome.value !== undefined ? { value: attribution.outcome.value } : {}),
    ...(attribution.outcome.currency ? { currency: attribution.outcome.currency } : {}),
    measuredAt: attribution.measuredAt,
    metadata: {
      ...attribution.metadata,
      callId: attribution.callId,
      runIds: attribution.runIds,
      executionIds: attribution.executionIds,
      totalCostUnits: attribution.totalCostUnits,
      ...(attribution.totalTokens !== undefined ? { totalTokens: attribution.totalTokens } : {}),
      advanced: attribution.outcome.advanced,
      ...(attribution.outcome.stageBeforeId
        ? { stageBeforeId: attribution.outcome.stageBeforeId }
        : {}),
      ...(attribution.outcome.stageAfterId
        ? { stageAfterId: attribution.outcome.stageAfterId }
        : {}),
      ...(attribution.outcome.summary ? { summary: attribution.outcome.summary } : {}),
    },
  };
}

/**
 * When Runtime is configured and the call produced run ids, POST a durable
 * outcome. No-ops (returns null) when offline or when there are no run ids.
 */
export async function publishCallOutcome(
  client: RuntimeClient,
  attribution: CallOutcomeAttribution,
): Promise<OutcomeRecord | null> {
  const input = toCreateOutcomeInput(attribution);
  if (!input) return null;
  const { outcome } = await client.createOutcome(input);
  return outcome;
}
