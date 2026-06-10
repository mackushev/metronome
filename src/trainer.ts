import { BPM_MAX, clampBpm } from './state';

export interface TrainerParams {
  deltaSec: number;
  stepBpm: number;
  maxBpm: number | null;
}

/**
 * Target trainer tempo: +stepBpm from the starting tempo every deltaSec seconds,
 * capped at maxBpm (and the global BPM_MAX limit).
 */
export function trainerTargetBpm(startBpm: number, elapsedSec: number, params: TrainerParams): number {
  if (params.deltaSec <= 0) return startBpm;
  const steps = Math.floor(Math.max(0, elapsedSec) / params.deltaSec);
  const target = startBpm + steps * params.stepBpm;
  const cap = params.maxBpm ?? BPM_MAX;
  return clampBpm(Math.min(target, Math.max(startBpm, cap)));
}

/** Whether the ceiling is reached — the tempo will not grow further */
export function trainerAtMax(currentBpm: number, startBpm: number, params: TrainerParams): boolean {
  const cap = Math.min(params.maxBpm ?? BPM_MAX, BPM_MAX);
  return currentBpm >= Math.max(startBpm, cap);
}

/** Fraction of time until the next speed-up, 0..1 (for the progress ring) */
export function trainerProgress(elapsedSec: number, deltaSec: number): number {
  if (deltaSec <= 0) return 0;
  const frac = (Math.max(0, elapsedSec) % deltaSec) / deltaSec;
  return frac;
}

/** Seconds until the next speed-up */
export function secondsToNextStep(elapsedSec: number, deltaSec: number): number {
  if (deltaSec <= 0) return 0;
  return deltaSec - (Math.max(0, elapsedSec) % deltaSec);
}
