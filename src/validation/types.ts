/**
 * Production-validation types.
 *
 * MISSION-001 is engineering-complete and green on synthetic fixtures. The
 * remaining gate is REAL-WORLD validation: ≥25 real sales conversations scored
 * end-to-end (docs/GATES.md). Real calls use the same `CallFixture` shape as the
 * synthetic set — the scorer does not fork — but they carry provenance so the
 * harness can (a) count only genuinely real calls toward the threshold and
 * (b) refuse to validate on consent-less data.
 *
 * A synthetic green run is NOT validation; provenance is what keeps that honest.
 */

import type { CallFixture } from '../../fixtures/types.ts';

/** Where a labeled call came from. */
export interface CallProvenance {
  /**
   * 'real' — an actual sales conversation (counts toward the ≥25 gate).
   * 'synthetic' — a fixture/example (never counts toward real-world validation).
   */
  source: 'real' | 'synthetic';
  /** ISO-8601 date the conversation happened (real calls). */
  recordedAt?: string;
  /**
   * Whether the parties consented to recording/analysis. Real-world validation
   * requires consent === true for every real call; the harness gates on it.
   */
  consent?: boolean;
  /** Opaque rep identifier (not PII — an internal handle/UUID). */
  rep?: string;
  /** True if transcript/context were redacted of PII before storage. */
  redacted?: boolean;
  /** Free-text note (e.g. transcription source, labeling reviewer). */
  notes?: string;
}

/** A labeled call plus its provenance, as consumed by the validation harness. */
export interface ValidationCall {
  provenance: CallProvenance;
  call: CallFixture;
}
