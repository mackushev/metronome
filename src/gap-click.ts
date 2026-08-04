import type { GapClickSettings } from './state';

export type GapClickPhase = 'click' | 'gap';

/**
 * Resolve a zero-based measure within the repeating click/gap cycle.
 * Playback always starts with the audible part of the cycle.
 */
export function gapClickPhase(
  measureIndex: number,
  settings: Pick<GapClickSettings, 'clickBars' | 'gapBars'>,
): GapClickPhase {
  const clickBars = Math.max(1, Math.round(settings.clickBars));
  const gapBars = Math.max(1, Math.round(settings.gapBars));
  const cycleBars = clickBars + gapBars;
  const cycleIndex = ((Math.floor(measureIndex) % cycleBars) + cycleBars) % cycleBars;
  return cycleIndex < clickBars ? 'click' : 'gap';
}

export function isGapMeasure(
  measureIndex: number,
  settings: Pick<GapClickSettings, 'clickBars' | 'gapBars'>,
): boolean {
  return gapClickPhase(measureIndex, settings) === 'gap';
}
