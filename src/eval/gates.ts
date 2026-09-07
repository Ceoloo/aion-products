/**
 * Mission-001 gate definitions.
 *
 * The single source of truth for the gate thresholds and how an
 * {@link EvalAggregate} is scored against them. Both the synthetic evaluation
 * CLI (`npm run eval`) and the production-validation harness (`npm run validate`)
 * import these, so the two paths can never drift: the ONLY difference between
 * "synthetic engineering gate" and "production validation" is the provenance and
 * count of the calls fed in — not the gate logic.
 */

import type { EvalAggregate } from './evaluate.ts';

export const GATE_THRESHOLDS = {
  extractionAccuracy: 0.85,
  objectionAccuracy: 0.85,
  conversionEvents: 10,
  meaningfulConversions: 3,
  repValueRate: 0.6,
} as const;

export interface GateResult {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
}

export function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/**
 * Scores an aggregate against the Mission-001 gates. The label + detail strings
 * are the canonical scorecard rows shared by every harness.
 */
export function computeGates(agg: EvalAggregate): GateResult[] {
  return [
    {
      id: 'extraction',
      label: 'Live extraction accuracy (≥85% on clearly-stated facts)',
      pass: agg.extractionAccuracy >= GATE_THRESHOLDS.extractionAccuracy,
      detail: `${pct(agg.extractionAccuracy)} (${agg.correctFactChecks}/${agg.totalFactChecks})`,
    },
    {
      id: 'objection',
      label: 'Objection detection accuracy (≥85%)',
      pass: agg.objectionAccuracy >= GATE_THRESHOLDS.objectionAccuracy,
      detail: pct(agg.objectionAccuracy),
    },
    {
      id: 'stage-outcome',
      label: 'Stage-outcome correctness (advance + meaningful vs label)',
      pass: agg.stageOutcomeCorrect === agg.stageOutcomeTotal,
      detail: `${agg.stageOutcomeCorrect}/${agg.stageOutcomeTotal}`,
    },
    {
      id: 'conversion-events',
      label: 'Conversion events (≥10 across calls)',
      pass: agg.totalConversionEvents >= GATE_THRESHOLDS.conversionEvents,
      detail: `${agg.totalConversionEvents}`,
    },
    {
      id: 'meaningful-conversions',
      label: 'Meaningful conversions (≥3 calls)',
      pass: agg.meaningfulConversions >= GATE_THRESHOLDS.meaningfulConversions,
      detail: `${agg.meaningfulConversions}`,
    },
    {
      id: 'rep-value',
      label: 'Rep-value (≥60% of rated interventions useful/acted)',
      pass: (agg.repValueRate ?? 0) >= GATE_THRESHOLDS.repValueRate,
      detail: `${agg.repValueRate === null ? 'n/a' : pct(agg.repValueRate)} (${agg.interventionsValuable}/${agg.interventionsRated} rated; ${agg.interventionsSurfaced} surfaced)`,
    },
    {
      id: 'lineage',
      label: 'Learning lineage complete (context→state→rec→feedback→response→movement)',
      pass: agg.lineageComplete,
      detail: agg.lineageComplete ? 'yes' : 'no',
    },
  ];
}

export function allGatesPass(rows: GateResult[]): boolean {
  return rows.length > 0 && rows.every((r) => r.pass);
}
