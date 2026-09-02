/**
 * SalesSchema — the industry-configurable layer.
 *
 * The platform intelligence (engines) stays reusable while the sales schema
 * changes per business. A schema declares: the conversion ladder, which facts
 * matter and which gate qualification, how to compute conversion readiness,
 * the objection playbook, and terminology.
 */

import type { FactKey } from '../domain/facts.ts';
import type { Ladder } from '../domain/ladder.ts';
import type { ObjectionCategory } from '../domain/deal.ts';
import type { DealState, ReadinessSignal } from '../domain/deal.ts';

/** Declarative readiness signal: a weighted, explainable predicate over state. */
export interface ReadinessSignalDef {
  key: string;
  label: string;
  /** relative weight in the explainable readiness score. */
  weight: number;
  /** Pure function of the current deal state → a readiness signal. */
  evaluate: (state: DealState) => Pick<ReadinessSignal, 'state' | 'detail'>;
}

/** Entry in the objection playbook used to interpret (not keyword-match). */
export interface ObjectionPlaybookEntry {
  category: ObjectionCategory;
  /** Cue phrases for the deterministic detector; the LLM detector ignores these. */
  cues: string[];
  /** Candidate underlying concerns this surface objection may really mean. */
  concerns: string[];
  /** Guidance for the rep, allowed to reference offer constraints. */
  responseStrategy: string;
}

export interface SalesSchema {
  key: string;
  label: string;
  ladder: Ladder;
  /** Fact slots this business actively tracks. */
  factSlots: FactKey[];
  /** Facts that must be confirmed for the deal to count as QUALIFIED. */
  qualificationFacts: FactKey[];
  /** Explainable conversion-readiness signal definitions. */
  readinessSignals: ReadinessSignalDef[];
  objectionPlaybook: ObjectionPlaybookEntry[];
  /**
   * Fact implications: `impliedFacts[key] = [a, b]` means a ladder gate on
   * `key` is satisfied when a AND b are both confirmed, even if `key` itself
   * was never captured as its own slot. E.g. pain is established once need +
   * business impact are confirmed — so the copilot doesn't double-flag pain.
   */
  impliedFacts?: Partial<Record<FactKey, FactKey[]>>;
  terminology: {
    /** Noun for the meaningful downstream conversion, e.g. "application". */
    conversionEventNoun: string;
    prospectNoun: string;
  };
}

/** Helper: is a fact confirmed (known + confidence above bar)? */
export function factConfirmed(state: DealState, key: FactKey, minConfidence = 0.5): boolean {
  const slot = state.facts[key];
  return !!slot && slot.value !== null && slot.confidence >= minConfidence;
}
