/**
 * The conversion ladder.
 *
 * Mission-001 is explicit: conversion is NOT one terminal state. Revenue
 * Copilot optimizes *progression* along a configurable ladder. Different
 * businesses configure different rungs; the engine reasons about advancement
 * between rungs, not about a single "converted" boolean.
 */

import type { FactKey } from './facts.ts';

export interface LadderStage {
  id: string;
  label: string;
  /** 0-based position on the ladder; higher = closer to revenue. */
  order: number;
  description: string;
  /**
   * Facts that should be confirmed for the deal to legitimately *sit* at this
   * rung. Used by the readiness engine to explain what is missing.
   */
  gateFacts: FactKey[];
  /** Whether all detected objections must be resolved to hold this rung. */
  requiresObjectionsResolved: boolean;
  /** Whether an explicit prospect commitment is needed to hold this rung. */
  requiresCommitment: boolean;
  /**
   * True for rungs that count as a "meaningful downstream conversion" in the
   * Mission-001 conversion gate (application / demo / proposal / appointment).
   */
  meaningfulConversion: boolean;
  /**
   * True for rungs that can only be set by an explicit outcome event recorded
   * after the call (e.g. approval, funding). The live loop never auto-advances
   * a deal into an outcome-only rung from conversation alone — it caps at the
   * highest rung the conversation itself can evidence.
   */
  outcomeOnly?: boolean;
}

export interface Ladder {
  key: string;
  stages: LadderStage[];
}

export interface LadderPosition {
  /** order index of the stage the deal currently occupies. */
  currentOrder: number;
  /** highest order index reached during the call (monotonic). */
  highWaterOrder: number;
  /** order index the deal held when the call started. */
  startOrder: number;
}

export function stageByOrder(ladder: Ladder, order: number): LadderStage | undefined {
  return ladder.stages.find((s) => s.order === order);
}

export function stageById(ladder: Ladder, id: string): LadderStage | undefined {
  return ladder.stages.find((s) => s.id === id);
}

export function maxOrder(ladder: Ladder): number {
  return ladder.stages.reduce((m, s) => Math.max(m, s.order), 0);
}

/** Net advancement over the call (can be negative if the deal slipped). */
export function stageDelta(pos: LadderPosition): number {
  return pos.currentOrder - pos.startOrder;
}
