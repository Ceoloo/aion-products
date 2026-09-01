/**
 * LiveCopilot — the real product loop.
 *
 * Ingests a conversation as a first-class data stream, maintains the live deal
 * interpretation turn-by-turn, surfaces next-best-action recommendations,
 * records the rep-value feedback loop, and accumulates the learning lineage.
 * `finish()` freezes everything into a durable CallIntelligence record.
 *
 * Every AI step is submitted to the AiExecutionService, which routes it through
 * the canonical @aion/core control plane, so the whole loop travels the
 * Mission-001 technical path: transcript → live interpretation → structured
 * state → Core-governed execution → recommendation → rep interaction → outcome
 * → durable record, with full traceability (canonical correlation ids).
 */

import type { AiExecutor } from '../platform/ai-execution.ts';
import type { SalesSchema } from '../config/schema.ts';
import type { PreCallContext } from '../domain/context.ts';
import type { DealState, Gap } from '../domain/deal.ts';
import type { Turn } from '../domain/types.ts';
import type { Recommendation, RepFeedback } from '../domain/recommendation.ts';
import type { RecommendationOutcome } from '../domain/recommendation.ts';
import type { LineageRecord } from '../domain/lineage.ts';
import type { ContextInput } from '../engines/context.ts';

import { assembleContext } from '../engines/context.ts';
import { extractionTask, applyFactUpdates } from '../engines/extraction.ts';
import { stageTask } from '../engines/stage.ts';
import { signalsTask } from '../engines/signals.ts';
import { objectionTask } from '../engines/objection.ts';
import { nbaTask } from '../engines/nba.ts';
import { evaluateLadder, updatePosition } from '../engines/ladder.ts';
import { computeReadiness } from '../engines/readiness.ts';
import { detectGaps, missingInformation } from '../engines/gaps.ts';

import { initialState, snapshot, mapUrgencyTextToEnum } from './state.ts';

export interface LiveUpdate {
  turnIndex: number;
  state: DealState;
  recommendations: Recommendation[];
  gaps: Gap[];
}

export interface BeginOptions {
  exec: AiExecutor;
  schema: SalesSchema;
  context: ContextInput;
}

const STAGE_WINDOW = 5;

export class LiveCopilot {
  readonly exec: AiExecutor;
  readonly schema: SalesSchema;
  readonly context: PreCallContext;
  private state: DealState;

  private readonly transcript: Turn[] = [];
  private readonly surfaced: Recommendation[] = [];
  private readonly outcomes: RecommendationOutcome[] = [];
  private readonly lineage: LineageRecord[] = [];
  private readonly pending: LineageRecord[] = [];

  private constructor(exec: AiExecutor, schema: SalesSchema, context: PreCallContext, state: DealState) {
    this.exec = exec;
    this.schema = schema;
    this.context = context;
    this.state = state;
  }

  static async begin(opts: BeginOptions): Promise<LiveCopilot> {
    const context = await assembleContext(opts.exec, opts.context);
    const state = initialState(opts.exec.callId, opts.schema, context);
    return new LiveCopilot(opts.exec, opts.schema, context, state);
  }

  /** Ingest one conversation turn and return the refreshed live guidance. */
  async ingest(turn: Turn): Promise<LiveUpdate> {
    this.transcript.push(turn);
    this.state.updatedAtTurn = turn.index;

    const newTurns = [turn];
    const window = this.transcript.slice(-STAGE_WINDOW);

    // Independent interpretation steps run concurrently; all governed by @aion/core.
    const [extraction, stage, signals, objections] = await Promise.all([
      this.exec.run(extractionTask({ turns: newTurns, factSlots: this.schema.factSlots, existing: this.state.facts, turnIndex: turn.index })),
      this.exec.run(stageTask({ turns: window, priorStage: this.state.conversationStage, hasOpenObjection: this.state.objections.some((o) => o.status !== 'resolved'), turnIndex: turn.index })),
      this.exec.run(signalsTask({ turns: newTurns, turnIndex: turn.index })),
      this.exec.run(objectionTask({ turns: newTurns, existing: this.state.objections, playbook: this.schema.objectionPlaybook, turnIndex: turn.index })),
    ]);

    // Merge interpretation into the live state.
    this.state.facts = applyFactUpdates(this.state.facts, extraction.output, turn.index);
    this.state.conversationStage = stage.output.conversationStage;
    this.state.sentiment = stage.output.sentiment;
    this.state.buyingSignals.push(...signals.output.buyingSignals);
    this.state.commitments.push(...signals.output.commitments);
    this.state.objections = objections.output;

    // Reconcile urgency enum from the extracted textual urgency fact.
    const urgencyFact = this.state.facts.urgency;
    if (urgencyFact?.value) {
      const mapped = mapUrgencyTextToEnum(urgencyFact.value);
      if (mapped !== 'unknown') this.state.urgency = mapped;
    }

    // Deterministic, explainable derivations.
    const ladderEval = evaluateLadder(this.state, this.schema);
    this.state.position = updatePosition(this.state.position, ladderEval.currentOrder);
    this.state.readiness = computeReadiness(this.state, this.schema);
    this.state.gaps = detectGaps(this.state, this.schema, ladderEval);
    this.state.missingInformation = missingInformation(this.state, this.schema);

    // Attribute pending lineage records to this prospect response.
    if (turn.speaker === 'prospect') this.attributeLineage(turn);

    // Next-best-action.
    const nba = await this.exec.run(nbaTask({ state: this.state, gaps: this.state.gaps, schema: this.schema, context: this.context, turnIndex: turn.index }));
    for (const rec of nba.output) {
      this.surfaced.push(rec);
      const record: LineageRecord = {
        recommendationId: rec.id,
        traceId: nba.correlationId,
        surfacedAtTurn: turn.index,
        recommendationType: rec.type,
        recommendationTitle: rec.title,
        stateBefore: snapshot(this.state, this.schema),
        feedback: null,
        followedByRep: false,
        prospectResponseTurn: null,
        prospectResponse: null,
        ladderOrderAfter: null,
        conversionAdvanced: null,
      };
      this.lineage.push(record);
      this.pending.push(record);
    }

    return { turnIndex: turn.index, state: structuredClone(this.state), recommendations: nba.output, gaps: [...this.state.gaps] };
  }

  private attributeLineage(prospectTurn: Turn): void {
    const orderNow = this.state.position.currentOrder;
    for (const rec of this.pending) {
      if (rec.surfacedAtTurn >= prospectTurn.index) continue;
      rec.prospectResponseTurn = prospectTurn.index;
      rec.prospectResponse = prospectTurn.text;
      rec.ladderOrderAfter = orderNow;
      rec.conversionAdvanced = orderNow > rec.stateBefore.ladderOrder;
    }
    // Everything attributed is no longer pending.
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i]!.prospectResponseTurn !== null) this.pending.splice(i, 1);
    }
  }

  /** The rep-value loop: mark how the rep reacted to a surfaced recommendation. */
  recordFeedback(recommendationId: string, feedback: RepFeedback, atTurn: number, note?: string): void {
    this.outcomes.push({ recommendationId, feedback, atTurn, note });
    const record = this.lineage.find((r) => r.recommendationId === recommendationId);
    if (record) {
      record.feedback = feedback;
      record.followedByRep = feedback === 'acted_on';
    }
  }

  // Read-only accessors used by the report builder and callers.
  currentState(): DealState { return structuredClone(this.state); }
  getTranscript(): Turn[] { return [...this.transcript]; }
  getSurfaced(): Recommendation[] { return [...this.surfaced]; }
  getOutcomes(): RecommendationOutcome[] { return [...this.outcomes]; }
  getLineage(): LineageRecord[] { return this.lineage.map((r) => ({ ...r })); }
}
