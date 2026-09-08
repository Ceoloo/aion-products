/**
 * Cohort classification for Operator Console missions.
 *
 * Standing rule: OL-001 went live once live GHL + live model access were
 * verified (ghl-live capability proof green). Console launches still default to
 * pre_ol_validation and must NOT inflate the OL-001 100-mission scoreboard —
 * production credit requires explicit productionEconomic=true opt-in.
 */

export const COHORT_OL001 = 'OL-001';
export const COHORT_PRE_OL = 'pre_ol_validation';

export function isOl001ProductionMission(m: {
  name?: string;
  metadata?: Record<string, unknown> | null;
}): boolean {
  const meta = m.metadata ?? {};
  if (meta.cohort !== COHORT_OL001) return false;
  // Explicit opt-in only — name matching alone must not count.
  return meta.productionEconomic === true;
}

export function isPreOlValidationMission(m: {
  name?: string;
  metadata?: Record<string, unknown> | null;
}): boolean {
  const meta = m.metadata ?? {};
  if (meta.cohort === COHORT_PRE_OL) return true;
  if (meta.productionEconomic === false) return true;
  // Legacy / proof residue that was incorrectly labeled OL-001 without economic truth.
  if (meta.cohort === COHORT_OL001 && meta.productionEconomic !== true) return true;
  if (String(m.name ?? '').includes('OL-001') && meta.productionEconomic !== true) {
    return true;
  }
  // Architecture proof missions (M004/M005/M006) and other untagged system tests.
  if (!meta.cohort && /^M00[4-9]\b/i.test(String(m.name ?? ''))) return true;
  return false;
}

export function missionCohortLabel(m: {
  name?: string;
  metadata?: Record<string, unknown> | null;
}): 'OL-001' | 'PRE-OL' | 'other' {
  if (isOl001ProductionMission(m)) return 'OL-001';
  if (isPreOlValidationMission(m)) return 'PRE-OL';
  return 'other';
}
