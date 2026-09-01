/**
 * Conversion readiness (Live responsibility #6).
 *
 * Deliberately explainable, NOT an opaque AI percentage. Readiness is computed
 * from the schema's declarative signals; the score is the weighted fraction of
 * signals confirmed and is fully reconstructable from the signal list. Later,
 * outcome data can replace this with an empirical model — the interface stays.
 */

import type { DealState, ConversionReadiness, ReadinessLevel, ReadinessSignal } from '../domain/deal.ts';
import type { SalesSchema } from '../config/schema.ts';

function levelFor(score: number, blocked: boolean): ReadinessLevel {
  if (blocked && score >= 0.6) return 'moderate'; // strong signals but a blocker caps it
  if (score >= 0.85) return 'ready';
  if (score >= 0.7) return 'strong';
  if (score >= 0.45) return 'moderate';
  if (score >= 0.2) return 'developing';
  return 'cold';
}

export function computeReadiness(state: DealState, schema: SalesSchema): ConversionReadiness {
  const signals: ReadinessSignal[] = [];
  let weightedConfirmed = 0;
  let totalWeight = 0;
  let blocked = false;
  const blockers: string[] = [];

  for (const def of schema.readinessSignals) {
    const evd = def.evaluate(state);
    const signal: ReadinessSignal = { key: def.key, label: def.label, state: evd.state, detail: evd.detail };
    signals.push(signal);
    totalWeight += def.weight;
    if (evd.state === 'confirmed') weightedConfirmed += def.weight;
    else if (evd.state === 'partial') weightedConfirmed += def.weight * 0.5;
    else if (evd.state === 'blocked') {
      blocked = true;
      blockers.push(def.label);
    } else {
      blockers.push(def.label);
    }
  }

  const score = totalWeight > 0 ? weightedConfirmed / totalWeight : 0;
  const level = levelFor(score, blocked);

  // Primary blocker: a hard 'blocked' signal takes precedence over merely missing.
  const hardBlocker = signals.find((s) => s.state === 'blocked');
  const missing = signals.find((s) => s.state === 'missing');
  const primaryBlocker = hardBlocker
    ? `${hardBlocker.label}${hardBlocker.detail ? ` (${hardBlocker.detail})` : ''}`
    : missing
      ? missing.label
      : null;

  return { signals, level, primaryBlocker, score: Number(score.toFixed(3)) };
}
