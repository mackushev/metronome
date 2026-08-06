import type { GapClickSettings } from './state';

export type GapClickPhase = 'click' | 'gap';

/**
 * Pick the first silent measure for one cycle. There are `clickBars + 1`
 * positions where the complete silent run fits inside the cycle.
 */
export function randomGapStart(
  settings: Pick<GapClickSettings, 'clickBars'>,
  random: () => number = Math.random,
  earliestStart = 0,
): number {
  const clickBars = Math.max(1, Math.round(settings.clickBars));
  const first = Math.min(clickBars, Math.max(0, Math.round(earliestStart)));
  const sample = Math.min(1 - Number.EPSILON, Math.max(0, random()));
  return first + Math.floor(sample * (clickBars - first + 1));
}

/**
 * Resolve a zero-based measure within the repeating click/gap cycle.
 * Without an explicit gap start, playback uses the regular click-then-gap order.
 */
export function gapClickPhase(
  measureIndex: number,
  settings: Pick<GapClickSettings, 'clickBars' | 'gapBars'>,
  gapStart?: number,
): GapClickPhase {
  const clickBars = Math.max(1, Math.round(settings.clickBars));
  const gapBars = Math.max(1, Math.round(settings.gapBars));
  const cycleBars = clickBars + gapBars;
  const cycleIndex = ((Math.floor(measureIndex) % cycleBars) + cycleBars) % cycleBars;
  const silentFrom = Math.min(clickBars, Math.max(0, Math.round(gapStart ?? clickBars)));
  return cycleIndex >= silentFrom && cycleIndex < silentFrom + gapBars ? 'gap' : 'click';
}

export function isGapMeasure(
  measureIndex: number,
  settings: Pick<GapClickSettings, 'clickBars' | 'gapBars'>,
  gapStart?: number,
): boolean {
  return gapClickPhase(measureIndex, settings, gapStart) === 'gap';
}

/** Only the downbeat that begins a silent run is allowed through the gap. */
export function isGapEntryTick(
  gap: boolean,
  gapEntryMeasure: boolean,
  beatIndex: number,
  subIndex: number,
): boolean {
  return gap && gapEntryMeasure && beatIndex === 0 && subIndex === 0;
}
