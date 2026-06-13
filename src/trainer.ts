import { BPM_MAX, clampBpm, type TrainerSettings, type TrainerStage } from './state';

interface StageContext {
  index: number;
  stageBpm: number;
  elapsed: number;
  stage: TrainerStage;
}

/**
 * Resolves which trainer stage is active given elapsed time since start.
 * Each stage with a maxBpm runs until that BPM is reached, then the next stage begins.
 */
function resolveStage(startBpm: number, totalElapsed: number, stages: TrainerStage[]): StageContext {
  let currentBpm = startBpm;
  let remaining = Math.max(0, totalElapsed);

  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const isLast = i === stages.length - 1;

    if (isLast || stage.maxBpm === null || stage.deltaSec <= 0) {
      return { index: i, stageBpm: currentBpm, elapsed: remaining, stage };
    }

    const cap = Math.max(currentBpm, stage.maxBpm);
    if (cap <= currentBpm) {
      // No-op stage: maxBpm is at or below current BPM, skip instantly
      continue;
    }

    const stepsNeeded = Math.ceil((cap - currentBpm) / stage.stepBpm);
    const duration = stepsNeeded * stage.deltaSec;

    if (remaining < duration) {
      return { index: i, stageBpm: currentBpm, elapsed: remaining, stage };
    }

    remaining -= duration;
    currentBpm = cap;
  }

  // Fallback: return last stage (shouldn't be reached for non-empty stages)
  const last = stages[stages.length - 1];
  return { index: stages.length - 1, stageBpm: currentBpm, elapsed: remaining, stage: last };
}

/**
 * Target trainer tempo: BPM at given elapsed time from startBpm across all stages.
 */
export function trainerTargetBpm(
  startBpm: number,
  elapsedSec: number,
  { stages }: Pick<TrainerSettings, 'stages'>,
): number {
  if (stages.length === 0) return clampBpm(startBpm);
  const { stageBpm, elapsed, stage } = resolveStage(startBpm, elapsedSec, stages);
  if (stage.deltaSec <= 0) return clampBpm(stageBpm);
  const steps = Math.floor(elapsed / stage.deltaSec);
  const cap = stage.maxBpm ?? BPM_MAX;
  return clampBpm(Math.min(stageBpm + steps * stage.stepBpm, Math.max(stageBpm, cap)));
}

/** Whether the ceiling is reached across all stages */
export function trainerAtMax(
  currentBpm: number,
  startBpm: number,
  { stages }: Pick<TrainerSettings, 'stages'>,
): boolean {
  if (stages.length === 0) return true;
  const lastStage = stages[stages.length - 1];
  const overallCap = lastStage.maxBpm ?? BPM_MAX;
  return currentBpm >= Math.max(startBpm, overallCap);
}

/** Fraction of time until the next speed-up in the current stage, 0..1 */
export function trainerProgress(
  elapsedSec: number,
  startBpm: number,
  { stages }: Pick<TrainerSettings, 'stages'>,
): number {
  if (stages.length === 0) return 0;
  const { elapsed, stage } = resolveStage(startBpm, elapsedSec, stages);
  if (stage.deltaSec <= 0) return 0;
  return (Math.max(0, elapsed) % stage.deltaSec) / stage.deltaSec;
}

/** Seconds until the next speed-up in the current stage */
export function secondsToNextStep(
  elapsedSec: number,
  startBpm: number,
  { stages }: Pick<TrainerSettings, 'stages'>,
): number {
  if (stages.length === 0) return 0;
  const { elapsed, stage } = resolveStage(startBpm, elapsedSec, stages);
  if (stage.deltaSec <= 0) return 0;
  return stage.deltaSec - (Math.max(0, elapsed) % stage.deltaSec);
}

/** The stepBpm of the currently active stage (for status display) */
export function currentStageStepBpm(
  elapsedSec: number,
  startBpm: number,
  { stages }: Pick<TrainerSettings, 'stages'>,
): number {
  if (stages.length === 0) return 0;
  const { stage } = resolveStage(startBpm, elapsedSec, stages);
  return stage.stepBpm;
}
