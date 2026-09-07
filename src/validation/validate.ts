/**
 * Production-validation harness.
 *
 * Scores REAL sales conversations against the Mission-001 gates and enforces the
 * exit-gate requirements that the synthetic engineering gate cannot prove
 * (docs/GATES.md):
 *
 *   1. Count gate    — ≥25 real conversations processed end-to-end.
 *   2. Consent gate  — every real call is consented (no analysis without it).
 *   3. Mission gates — the same 7 gates as the synthetic scorer, computed on
 *                      REAL data (extraction ≥85%, objections, stage outcomes,
 *                      conversion events/meaningful, rep-value, lineage).
 *
 * Validation is complete only when all three hold. Synthetic-provenance calls
 * are excluded from the count entirely — a green synthetic run never satisfies
 * this. With no real calls yet, this reports "0 / 25, NOT YET VALIDATED", which
 * is the honest current state of MISSION-001.
 */

import { evaluateCalls, type EvalAggregate, type EvalOptions } from '../eval/evaluate.ts';
import { computeGates, allGatesPass, type GateResult } from '../eval/gates.ts';
import type { ValidationCall } from './types.ts';

/** The number of real conversations required for real-world validation. */
export const REQUIRED_REAL_CALLS = 25;

export interface ValidationReport {
  requiredRealCalls: number;
  realCallCount: number;
  syntheticExcluded: number;
  /** ≥ REQUIRED_REAL_CALLS real conversations present. */
  countGatePass: boolean;
  /** Every real call carries consent === true. */
  consentGatePass: boolean;
  /** ids of real calls missing consent. */
  missingConsent: string[];
  /** Aggregate over real calls only (null when there are none). */
  aggregate: EvalAggregate | null;
  /** Mission gate rows computed on real data (empty when there are none). */
  missionGates: GateResult[];
  missionGatesPass: boolean;
  /** All three gate families satisfied. */
  validationComplete: boolean;
}

export interface RunValidationInput {
  /** The labeled calls to consider (real + synthetic; synthetic is excluded). */
  calls: ValidationCall[];
  opts?: EvalOptions;
}

export async function runValidation(
  input: RunValidationInput,
): Promise<ValidationReport> {
  const real = input.calls.filter((c) => c.provenance.source === 'real');
  const syntheticExcluded = input.calls.length - real.length;

  const missingConsent = real
    .filter((c) => c.provenance.consent !== true)
    .map((c) => c.call.id);
  const consentGatePass = real.length > 0 && missingConsent.length === 0;

  const countGatePass = real.length >= REQUIRED_REAL_CALLS;

  // Only score calls that are actually usable (real AND consented), so an
  // unconsented call can never contribute to a passing metric.
  const scorable = real
    .filter((c) => c.provenance.consent === true)
    .map((c) => c.call);
  const aggregate = scorable.length
    ? await evaluateCalls(scorable, input.opts ?? {})
    : null;
  const missionGates = aggregate ? computeGates(aggregate) : [];
  const missionGatesPass = allGatesPass(missionGates);

  return {
    requiredRealCalls: REQUIRED_REAL_CALLS,
    realCallCount: real.length,
    syntheticExcluded,
    countGatePass,
    consentGatePass,
    missingConsent,
    aggregate,
    missionGates,
    missionGatesPass,
    validationComplete: countGatePass && consentGatePass && missionGatesPass,
  };
}
