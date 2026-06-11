import { describe, expect, it } from 'vitest';
import { advance, tickKind } from './audio/engine';
import {
  cycleBeatState,
  defaultBeatStates,
  defaultSettings,
  resizeBeatStates,
  type Settings,
} from './state';
import { secondsToNextStep, trainerAtMax, trainerProgress, trainerTargetBpm } from './trainer';
import { normalizeDeltaDeg } from './ui/circle';

describe('advance: tick grid', () => {
  it('walks subdivisions within a beat', () => {
    expect(advance({ beatIndex: 0, subIndex: 0 }, 4, 3)).toEqual({ beatIndex: 0, subIndex: 1 });
    expect(advance({ beatIndex: 0, subIndex: 2 }, 4, 3)).toEqual({ beatIndex: 1, subIndex: 0 });
  });

  it('wraps the measure back to the first beat', () => {
    expect(advance({ beatIndex: 3, subIndex: 1 }, 4, 2)).toEqual({ beatIndex: 0, subIndex: 0 });
  });

  it('steps beat by beat when there are no subdivisions', () => {
    expect(advance({ beatIndex: 0, subIndex: 0 }, 2, 1)).toEqual({ beatIndex: 1, subIndex: 0 });
    expect(advance({ beatIndex: 1, subIndex: 0 }, 2, 1)).toEqual({ beatIndex: 0, subIndex: 0 });
  });
});

describe('tickKind: accents and mutes', () => {
  const settings: Settings = {
    ...defaultSettings(),
    beats: 4,
    subdivision: 2,
    beatStates: ['accent', 'mute', 'normal', 'tick'],
  };

  it('first beat is accented', () => {
    expect(tickKind(settings, { beatIndex: 0, subIndex: 0 })).toBe('accent');
  });

  it('a muted beat is silent but its subdivisions sound', () => {
    expect(tickKind(settings, { beatIndex: 1, subIndex: 0 })).toBe('silent');
    expect(tickKind(settings, { beatIndex: 1, subIndex: 1 })).toBe('sub');
  });

  it('normal beat and subdivision', () => {
    expect(tickKind(settings, { beatIndex: 2, subIndex: 0 })).toBe('normal');
    expect(tickKind(settings, { beatIndex: 0, subIndex: 1 })).toBe('sub');
  });

  it('a tick beat sounds like a regular subdivision tick', () => {
    expect(tickKind(settings, { beatIndex: 3, subIndex: 0 })).toBe('sub');
  });

  it('subMuted silences subdivisions but not beats (including tick beats)', () => {
    const muted: Settings = { ...settings, subMuted: true };
    expect(tickKind(muted, { beatIndex: 0, subIndex: 1 })).toBe('silent');
    expect(tickKind(muted, { beatIndex: 0, subIndex: 0 })).toBe('accent');
    expect(tickKind(muted, { beatIndex: 3, subIndex: 0 })).toBe('sub');
  });
});

describe('beat states', () => {
  it('the first beat is accented by default', () => {
    expect(defaultBeatStates(3)).toEqual(['accent', 'normal', 'normal']);
  });

  it('cycle: normal → accent → tick → mute → normal', () => {
    expect(cycleBeatState('normal')).toBe('accent');
    expect(cycleBeatState('accent')).toBe('tick');
    expect(cycleBeatState('tick')).toBe('mute');
    expect(cycleBeatState('mute')).toBe('normal');
  });

  it('resize keeps configured beats and appends normal ones', () => {
    expect(resizeBeatStates(['accent', 'mute'], 4)).toEqual(['accent', 'mute', 'normal', 'normal']);
    expect(resizeBeatStates(['accent', 'mute', 'normal'], 2)).toEqual(['accent', 'mute']);
  });
});

describe('normalizeDeltaDeg: tempo dial', () => {
  it('small steps pass through unchanged', () => {
    expect(normalizeDeltaDeg(5)).toBe(5);
    expect(normalizeDeltaDeg(-12)).toBe(-12);
  });

  it('crossing the atan2 seam causes no full-turn jump', () => {
    // the finger moved clockwise across the seam: 175° → -175° is a +10° step
    expect(normalizeDeltaDeg(-175 - 175)).toBe(10);
    // counterclockwise: -170° → 170° is a -20° step
    expect(normalizeDeltaDeg(170 - -170)).toBe(-20);
  });
});

describe('speed trainer', () => {
  const params = { deltaSec: 10, stepBpm: 5, maxBpm: 130 };

  it('the tempo does not grow before the first interval', () => {
    expect(trainerTargetBpm(100, 0, params)).toBe(100);
    expect(trainerTargetBpm(100, 9.9, params)).toBe(100);
  });

  it('grows in steps of deltaSec', () => {
    expect(trainerTargetBpm(100, 10, params)).toBe(105);
    expect(trainerTargetBpm(100, 25, params)).toBe(110);
    expect(trainerTargetBpm(100, 40, params)).toBe(120);
  });

  it('stops at maxBpm', () => {
    expect(trainerTargetBpm(100, 100, params)).toBe(130);
    expect(trainerAtMax(130, 100, params)).toBe(true);
    expect(trainerAtMax(125, 100, params)).toBe(false);
  });

  it('without maxBpm it is capped by the global limit of 300', () => {
    expect(trainerTargetBpm(290, 1000, { deltaSec: 10, stepBpm: 5, maxBpm: null })).toBe(300);
  });

  it('maxBpm below the starting tempo does not lower the tempo', () => {
    expect(trainerTargetBpm(150, 50, params)).toBe(150);
    expect(trainerAtMax(150, 150, params)).toBe(true);
  });

  it('progress and time until the next step', () => {
    expect(trainerProgress(3, 10)).toBeCloseTo(0.3);
    expect(trainerProgress(13, 10)).toBeCloseTo(0.3);
    expect(secondsToNextStep(3, 10)).toBeCloseTo(7);
  });
});
