/**
 * AiExecutionService — the product's AI orchestration/service layer.
 *
 * This is the ONLY chokepoint through which Revenue Copilot performs AI work.
 *
 * Week 3 dual mode:
 *   - Offline / tests: in-memory @aion/core control plane + RevenueExecutionAdapter
 *   - Production: durable AION Runtime via RuntimeClient (serviceKey → catalog)
 *
 * Server composition injects a Runtime transport; browser composition cannot select it.
 * Products do NOT code-depend on aion-runtime; they talk HTTP only.
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
import {
  REVENUE_CAPABILITIES,
  capabilityForEngine,
  serviceKeyForEngine,
} from './revenue-ai-tasks.ts';
import { RevenueExecutionAdapter } from './revenue-execution-adapter.ts';
import type { Effort, LlmProvider } from './provider-contracts.ts';
import type { FactSlot } from '../domain/facts.ts';
import type { TraceSummary } from '../domain/report.ts';
import {
  type RuntimeTransport,
  RuntimeApiError,
  type RuntimeCommandResponse,
} from './runtime-contracts.ts';

export interface AiExecResult<O> {
  output: O;
  /** Canonical @aion/core run id for this execution. */
  runId: string;
  /** Canonical correlation id — the trace spine shared by all events/telemetry. */
  correlationId: string;
  /** Durable execution id when Runtime produced one. */
  executionId?: string;
  executor: string;
  model: string | null;
  fellBack: boolean;
  /** Abstract cost units from the execution result. */
  costUnits: number;
  /** Optional token usage when a model ran. */
  costTokens?: number;
}

/** The narrow contract engines/pipeline depend on (keeps them off the platform internals). */
export interface AiExecutor {
  readonly callId: string;
  run<I, O>(task: AiTask<I, O>): Promise<AiExecResult<O>>;
}

export interface SharedExecutionConfig {
  callId: string;
  /** Injected provider; null forces deterministic execution (in-memory mode). */
  llm?: LlmProvider | null;
  model?: string;
  effort?: Effort;
  maxTokens?: number;
  /** Product precondition for durable CRM writes (before requesting that capability). */
  crmWriteConfidence?: number;
  autoWriteInferredFacts?: boolean;
  /** Explicitly injected transport. Omit for canonical in-memory execution. */
  runtime?: RuntimeTransport | null;
}

interface ExecutionLogEntry {
  engine: string;
  kind: string;
  capability: string;
  serviceKey?: string;
  runId: string;
  correlationId: string;
  executionId?: string;
  executor: string;
  model: string | null;
  fellBack: boolean;
  durationMs: number;
  riskLevel: string;
  costUnits: number;
  costTokens?: number;
  mode: 'in-memory' | 'runtime';
}

export class SharedExecutionService implements AiExecutor {
  readonly callId: string;
  private readonly plane: ControlPlane | null;
  private readonly runtime: RuntimeTransport | null;
  private readonly actor: AgentActor;
  private readonly mission: Mission;
  private readonly registry = new Map<string, AiTask<unknown, unknown>>();
  private readonly log: ExecutionLogEntry[] = [];
  private readonly llmConfigured: boolean;
  private readonly crmWriteConfidence: number;
  private readonly autoWriteInferredFacts: boolean;
  private seq = 0;

  constructor(cfg: SharedExecutionConfig) {
    this.callId = cfg.callId;
    const llm = cfg.llm ?? null;
    this.llmConfigured = llm !== null;
    this.crmWriteConfidence = cfg.crmWriteConfidence ?? 0.85;
    this.autoWriteInferredFacts = cfg.autoWriteInferredFacts ?? false;

    // Model resolution is provider-aware so the default is valid for whichever
    // runtime is active. OpenRouter uses namespaced slugs (e.g.
    // "anthropic/claude-3.5-sonnet"); the Anthropic SDK uses bare ids. An
    // explicit `cfg.model` overrides either (environment defaults belong to the server).
    const isOpenRouter = llm?.name === 'openrouter';
    const model =
      cfg.model ??
      (isOpenRouter
        ? 'anthropic/claude-3.5-sonnet'
        : 'claude-opus-4-8');
    const effort = cfg.effort ?? 'medium';
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

    if (cfg.runtime) {
      this.runtime = cfg.runtime;
      this.plane = null;
    } else {
      this.runtime = null;
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
  }

  /** True when commands go to durable Runtime. */
  get usesRuntime(): boolean {
    return this.runtime !== null;
  }

  get controlPlane(): ControlPlane {
    if (!this.plane) {
      throw new Error('controlPlane is unavailable with an injected Runtime transport');
    }
    return this.plane;
  }

  llmAvailable(): boolean {
    return this.llmConfigured;
  }

  /** Accumulated cost units across this call's AI executions. */
  totalCostUnits(): number {
    return this.log.reduce((sum, e) => sum + e.costUnits, 0);
  }

  /** Run / execution ids recorded this call (for outcome attribution). */
  attributionIds(): {
    runIds: string[];
    executionIds: string[];
    totalCostUnits: number;
    totalTokens?: number;
  } {
    const runIds = this.log.map((e) => e.runId);
    const executionIds = this.log
      .map((e) => e.executionId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    const totalCostUnits = this.totalCostUnits();
    const tokenSum = this.log.reduce((sum, e) => sum + (e.costTokens ?? 0), 0);
    return {
      runIds,
      executionIds,
      totalCostUnits,
      ...(tokenSum > 0 ? { totalTokens: tokenSum } : {}),
    };
  }

  async run<I, O>(task: AiTask<I, O>): Promise<AiExecResult<O>> {
    if (this.runtime) {
      return this.runViaRuntime(task);
    }
    return this.runInMemory(task);
  }

  private async runInMemory<I, O>(task: AiTask<I, O>): Promise<AiExecResult<O>> {
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
      outcome = await this.plane!.orchestrator.submit(command);
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

    const costUnits = Number(result.cost?.units ?? 0);
    const costTokens =
      typeof result.cost?.tokens === 'number' ? result.cost.tokens : undefined;

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
      costUnits,
      ...(costTokens !== undefined ? { costTokens } : {}),
      mode: 'in-memory',
    });

    return {
      output,
      runId,
      correlationId,
      executor: result.executor,
      model: result.model ?? null,
      fellBack,
      costUnits,
      ...(costTokens !== undefined ? { costTokens } : {}),
    };
  }

  private async runViaRuntime<I, O>(task: AiTask<I, O>): Promise<AiExecResult<O>> {
    const serviceKey = serviceKeyForEngine(task.engine);
    let response: RuntimeCommandResponse;
    try {
      response = await this.runtime!.submitCommand({
        name: task.kind,
        actor: this.actor,
        serviceKey,
        missionId: this.mission.missionId,
        payload: {
          engine: task.engine,
          kind: task.kind,
          turnIndex: task.turnIndex,
          input: task.input,
          // Offline-friendly deterministic hint for Runtime mock adapters.
          deterministicHint: task.summarizeInput(task.input),
        },
        metadata: {
          product: 'revenue-copilot',
          callId: this.callId,
          serviceKey,
        },
      });
    } catch (err) {
      if (err instanceof RuntimeApiError && err.status === 403) {
        throw new Error(`Runtime denied "${serviceKey}": ${err.message}`);
      }
      throw err;
    }

    if (response.status === 'denied') {
      throw new Error(
        `Runtime denied "${serviceKey}": ${response.decision?.reason ?? 'policy denied'}`,
      );
    }
    if (response.status === 'awaiting_approval') {
      const approvalId = response.approval?.approvalId;
      throw new Error(
        `Runtime requires human approval for "${serviceKey}"` +
          (approvalId ? ` (approvalId=${approvalId})` : ''),
      );
    }

    const result = response.result;
    if (!result || result.status !== 'succeeded') {
      throw new Error(
        `Runtime execution failed for "${serviceKey}": ${result?.error?.message ?? response.status}`,
      );
    }

    // Prefer structured value; otherwise fall back to the task's deterministic
    // path so Copilot remains usable when Runtime's adapter is a stub/mock.
    let output: O;
    let fellBack = Boolean(result.metadata?.fellBack);
    const rawValue = result.output?.value;
    if (rawValue !== undefined) {
      output = rawValue as O;
    } else {
      output = task.deterministic(task.input);
      fellBack = true;
    }

    const runId = String(response.run?.runId ?? '');
    const correlationId = String(response.run?.correlationId ?? runId);
    const executionId =
      typeof response.execution?.executionId === 'string'
        ? response.execution.executionId
        : undefined;
    const costUnits = Number(result.cost?.units ?? response.execution?.cost?.units ?? 0);
    const costTokensRaw = result.cost?.tokens ?? response.execution?.cost?.tokens;
    const costTokens = typeof costTokensRaw === 'number' ? costTokensRaw : undefined;

    this.log.push({
      engine: task.engine,
      kind: task.kind,
      capability: capabilityForEngine(task.engine),
      serviceKey,
      runId,
      correlationId,
      ...(executionId ? { executionId } : {}),
      executor: String(result.executor ?? 'runtime'),
      model: result.model ?? null,
      fellBack,
      durationMs: Number(result.durationMs ?? 0),
      riskLevel: String(response.decision?.riskLevel ?? 'R1'),
      costUnits,
      ...(costTokens !== undefined ? { costTokens } : {}),
      mode: 'runtime',
    });

    return {
      output,
      runId,
      correlationId,
      ...(executionId ? { executionId } : {}),
      executor: String(result.executor ?? 'runtime'),
      model: result.model ?? null,
      fellBack,
      costUnits,
      ...(costTokens !== undefined ? { costTokens } : {}),
    };
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
    const rows = this.plane ? this.plane.telemetrySink.all() : [];
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
