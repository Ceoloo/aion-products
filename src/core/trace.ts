/**
 * Execution tracing & lineage.
 *
 * Every AI execution in the system flows through the Core and produces an
 * ExecutionTrace. This is the backbone of the Mission-001 technical gate
 * ("maintain traceability") and the learning gate (the lineage from context →
 * detected state → recommendation → rep action → outcome must exist).
 */

export type ProviderKind = 'anthropic' | 'deterministic';

export interface ExecutionTrace {
  id: string;
  callId: string;
  turnIndex: number;
  /** which engine issued the task, e.g. "extraction". */
  engine: string;
  /** task kind, e.g. "extract_facts". */
  kind: string;
  provider: ProviderKind;
  /** model id when provider is anthropic. */
  model: string | null;
  /** true when the LLM path failed and we fell back to deterministic. */
  fellBack: boolean;
  latencyMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  /** short, non-PII-leaking summary of the input. */
  inputSummary: string;
  /** short summary of what the task produced. */
  outputSummary: string;
  error?: string;
  at: string; // ISO timestamp
}

let seq = 0;
export function nextTraceId(): string {
  seq += 1;
  return `trace_${Date.now().toString(36)}_${seq}`;
}

/** Collects traces for a call so they can be persisted as durable lineage. */
export class Tracer {
  readonly callId: string;
  private readonly entries: ExecutionTrace[] = [];

  constructor(callId: string) {
    this.callId = callId;
  }

  record(trace: ExecutionTrace): void {
    this.entries.push(trace);
  }

  all(): ExecutionTrace[] {
    return [...this.entries];
  }

  /** Aggregate stats used by the post-call report + gate checks. */
  summary(): TraceSummary {
    const total = this.entries.length;
    const byProvider: Record<string, number> = {};
    let fallbacks = 0;
    let totalLatency = 0;
    for (const e of this.entries) {
      byProvider[e.provider] = (byProvider[e.provider] ?? 0) + 1;
      if (e.fellBack) fallbacks += 1;
      totalLatency += e.latencyMs;
    }
    return {
      total,
      byProvider,
      fallbacks,
      avgLatencyMs: total ? Math.round(totalLatency / total) : 0,
    };
  }
}

export interface TraceSummary {
  total: number;
  byProvider: Record<string, number>;
  fallbacks: number;
  avgLatencyMs: number;
}
