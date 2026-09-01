/**
 * AiExecutionService — the product's AI orchestration/service layer.
 *
 * This is the ONLY chokepoint through which Revenue Copilot performs AI work,
 * and it resolves through the canonical @aion/core control plane rather than a
 * product-local Core:
 *
 *   engines → AiExecutionService (this) → @aion/core control plane
 *           → RevenueExecutionAdapter → Anthropic / deterministic provider
 *           → ExecutionResult + canonical trace (correlationId, telemetry, events)
 *
 * Ownership boundary:
 *   - Revenue Copilot owns AI task definitions and sales interpretation.
 *   - @aion/core owns governance, permission, risk routing, run state, and the
 *     execution contract.
 *   - The model provider is an execution adapter, not the authority.
 *
 * We do NOT code-depend on aion-runtime: Runtime composes the production
 * deployment (durable stores, real adapters). Here we use the in-memory control
 * plane @aion/core ships for exactly this purpose.
 */

import {
  createInMemoryControlPlane,
  createAgentActor,
  createMission,
  capability,
  type ControlPlane,
  type CommandInput,
  type AgentActor,
  type Mission,
} from '@aion/core';
import type { AiTask } from './revenue-ai-tasks.ts';
import { REVENUE_CAPABILITIES, capabilityForEngine } from './revenue-ai-tasks.ts';
import { RevenueExecutionAdapter, type Effort, type LlmProvider } from './provider-adapter.ts';
import type { FactSlot } from '../domain/facts.ts';
import type { TraceSummary } from '../domain/report.ts';

export interface AiExecResult<O> {
  output: O;
  /** Canonical @aion/core run id for this execution. */
  runId: string;
  /** Canonical correlation id — the trace spine shared by all events/telemetry. */
  correlationId: string;
  executor: string;
  model: string | null;
  fellBack: boolean;
}

/** The narrow contract engines/pipeline depend on (keeps them off the platform internals). */
export interface AiExecutor {
  readonly callId: string;
  run<I, O>(task: AiTask<I, O>): Promise<AiExecResult<O>>;
}

export interface AiExecutionConfig {
  callId: string;
  /** Injected provider; null forces deterministic execution. */
  llm?: LlmProvider | null;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  /** Product precondition for durable CRM writes (before requesting that capability). */
  crmWriteConfidence?: number;
  autoWriteInferredFacts?: boolean;
}

interface ExecutionLogEntry {
  engine: string;
  kind: string;
  capability: string;
  runId: string;
  correlationId: string;
  executor: string;
  model: string | null;
  fellBack: boolean;
  durationMs: number;
  riskLevel: string;
}

export class AiExecutionService implements AiExecutor {
  readonly callId: string;
  private readonly plane: ControlPlane;
  private readonly actor: AgentActor;
  private readonly mission: Mission;
  private readonly registry = new Map<string, AiTask<unknown, unknown>>();
  private readonly log: ExecutionLogEntry[] = [];
  private readonly llmConfigured: boolean;
  private readonly crmWriteConfidence: number;
  private readonly autoWriteInferredFacts: boolean;
  private seq = 0;

  constructor(cfg: AiExecutionConfig) {
    this.callId = cfg.callId;
    const llm = cfg.llm ?? null;
    this.llmConfigured = llm !== null;
    this.crmWriteConfidence = cfg.crmWriteConfidence ?? 0.85;
    this.autoWriteInferredFacts = cfg.autoWriteInferredFacts ?? false;

    const model = cfg.model ?? process.env.AION_MODEL ?? 'claude-opus-4-8';
    const effort = cfg.effort ?? (process.env.AION_EFFORT as Effort) ?? 'medium';
    const maxTokens = cfg.maxTokens ?? 1536;

    // A governed agent worker, granted exactly the revenue capabilities, at a
    // low autonomous risk ceiling. @aion/core enforces this — not this code.
    this.actor = createAgentActor({
      name: 'RevenueCopilot',
      purpose: 'Interpret live sales conversations and guide the rep toward conversion.',
      owner: 'aion-products/revenue-copilot',
      permissions: REVENUE_CAPABILITIES.map((c) => capability(c)),
      defaultRiskLevel: 'R1',
      maxRiskLevel: 'R2',
      costBudget: 1000,
    });

    this.mission = createMission({
      name: `Revenue Copilot — call ${this.callId}`,
      owner: 'aion-products/revenue-copilot',
      objective: 'Advance a live sales conversation toward revenue.',
      successCriteria: ['faithful interpretation of the conversation', 'conversion-stage advancement'],
      riskLevel: 'R1',
    });

    const adapter = new RevenueExecutionAdapter({
      llm,
      resolveTask: (t) => this.registry.get(t),
      model,
      effort,
      maxTokens,
    });

    // Every revenue capability is classified R1 (Low, autonomous within policy).
    const capabilityRisk: Record<string, 'R1'> = {};
    for (const c of REVENUE_CAPABILITIES) capabilityRisk[c] = 'R1';

    this.plane = createInMemoryControlPlane({
      policy: { risk: { capabilityRisk } },
      adapters: [adapter],
    });
  }

  get controlPlane(): ControlPlane {
    return this.plane;
  }

  llmAvailable(): boolean {
    return this.llmConfigured;
  }

  async run<I, O>(task: AiTask<I, O>): Promise<AiExecResult<O>> {
    const token = `task_${(this.seq += 1)}`;
    this.registry.set(token, task as AiTask<unknown, unknown>);

    const command: CommandInput = {
      name: task.kind,
      actor: this.actor,
      capability: capability(capabilityForEngine(task.engine)),
      missionId: this.mission.missionId,
      payload: { taskToken: token, turnIndex: task.turnIndex },
    };

    let outcome;
    try {
      outcome = await this.plane.orchestrator.submit(command);
    } finally {
      this.registry.delete(token);
    }

    if (outcome.status === 'denied') {
      throw new Error(`@aion/core denied "${command.capability}": ${outcome.decision.reason}`);
    }
    if (outcome.status === 'awaiting_approval') {
      throw new Error(`@aion/core requires human approval for "${command.capability}" (unexpected for R1)`);
    }
    const result = outcome.result;
    if (!result || result.status !== 'succeeded' || !result.output) {
      throw new Error(`execution failed for "${command.capability}": ${result?.error?.message ?? 'no result'}`);
    }

    const output = (result.output as { value: O }).value;
    const fellBack = Boolean((result.metadata as Record<string, unknown>)?.fellBack);
    const runId = String(outcome.run.runId);
    const correlationId = String(outcome.run.correlationId);

    this.log.push({
      engine: task.engine,
      kind: task.kind,
      capability: String(command.capability),
      runId,
      correlationId,
      executor: result.executor,
      model: result.model ?? null,
      fellBack,
      durationMs: result.durationMs,
      riskLevel: String(outcome.decision.riskLevel),
    });

    return { output, runId, correlationId, executor: result.executor, model: result.model ?? null, fellBack };
  }

  /**
   * Product precondition for an automated durable fact write: the fact must be
   * stated explicitly and clear the confidence bar. (The write itself would be
   * a separately governed @aion/core capability; this gate decides whether to
   * even request it.)
   */
  canAutoWriteFact(slot: FactSlot): boolean {
    if (slot.value === null) return false;
    if (!slot.statedExplicitly && !this.autoWriteInferredFacts) return false;
    return slot.confidence >= this.crmWriteConfidence;
  }

  /**
   * A read-model summary over the canonical @aion/core telemetry plus the
   * product's own execution log. @aion/core remains the trace authority (it
   * mints runId/correlationId and records telemetry); this only summarizes.
   */
  traceSummary(): TraceSummary {
    const rows = this.plane.telemetrySink.all();
    const executionRows = rows.filter((r) => r.operation === 'execution').length;
    const byModel: Record<string, number> = {};
    let fallbacks = 0;
    let totalLatency = 0;
    for (const e of this.log) {
      const key = e.model ?? 'unknown';
      byModel[key] = (byModel[key] ?? 0) + 1;
      if (e.fellBack) fallbacks += 1;
      totalLatency += e.durationMs;
    }
    return {
      total: this.log.length,
      telemetryRows: rows.length,
      executionRows,
      byModel,
      fallbacks,
      avgLatencyMs: this.log.length ? Math.round(totalLatency / this.log.length) : 0,
      correlationIds: new Set(this.log.map((e) => e.correlationId)).size,
    };
  }
}
