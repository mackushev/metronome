import { describe, expect, it } from 'vitest';
import { advance, polyEventsForCycle, tickKind } from './audio/engine';
import {
  cycleBeatState,
  defaultBeatStates,
  defaultSettings,
  resizeBeatStates,
  toggleSubMute,
  togglePolyMute,
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

  it('a muted subdivision is silent individually; beats are unaffected', () => {
    const muted: Settings = { ...settings, mutedSubs: ['0-1'] };
    expect(tickKind(muted, { beatIndex: 0, subIndex: 1 })).toBe('silent');
    expect(tickKind(muted, { beatIndex: 1, subIndex: 1 })).toBe('sub');
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

describe('toggleSubMute', () => {
  it('toggles a single subdivision key on and off', () => {
    expect(toggleSubMute([], 1, 2)).toEqual(['1-2']);
    expect(toggleSubMute(['1-2', '0-1'], 1, 2)).toEqual(['0-1']);
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
  const p = { stages: [{ deltaSec: 10, stepBpm: 5, maxBpm: 130 }] };

  it('the tempo does not grow before the first interval', () => {
    expect(trainerTargetBpm(100, 0, p)).toBe(100);
    expect(trainerTargetBpm(100, 9.9, p)).toBe(100);
  });

  it('grows in steps of deltaSec', () => {
    expect(trainerTargetBpm(100, 10, p)).toBe(105);
    expect(trainerTargetBpm(100, 25, p)).toBe(110);
    expect(trainerTargetBpm(100, 40, p)).toBe(120);
  });

  it('stops at maxBpm', () => {
    expect(trainerTargetBpm(100, 100, p)).toBe(130);
    expect(trainerAtMax(130, 100, p)).toBe(true);
    expect(trainerAtMax(125, 100, p)).toBe(false);
  });

  it('without maxBpm it is capped by the global limit of 300', () => {
    const infinite = { stages: [{ deltaSec: 10, stepBpm: 5, maxBpm: null }] };
    expect(trainerTargetBpm(290, 1000, infinite)).toBe(300);
  });

  it('maxBpm below the starting tempo does not lower the tempo', () => {
    expect(trainerTargetBpm(150, 50, p)).toBe(150);
    expect(trainerAtMax(150, 150, p)).toBe(true);
  });

  it('progress and time until the next step', () => {
    expect(trainerProgress(3, 100, p)).toBeCloseTo(0.3);
    expect(trainerProgress(13, 100, p)).toBeCloseTo(0.3);
    expect(secondsToNextStep(3, 100, p)).toBeCloseTo(7);
  });

  it('two-stage: advances to stage 2 after stage 1 completes', () => {
    const two = {
      stages: [
        { deltaSec: 10, stepBpm: 5, maxBpm: 130 }, // 6 steps × 10s = 60s to complete
        { deltaSec: 15, stepBpm: 10, maxBpm: 200 },
      ],
    };
    // Still in stage 1
    expect(trainerTargetBpm(100, 55, two)).toBe(125);
    // Stage 1 just completed (elapsed=60), stage 2 begins
    expect(trainerTargetBpm(100, 60, two)).toBe(130);
    // 15s into stage 2 → +10 BPM
    expect(trainerTargetBpm(100, 75, two)).toBe(140);
    expect(trainerAtMax(200, 100, two)).toBe(true);
    expect(trainerAtMax(150, 100, two)).toBe(false);
  });
});

describe('polyrhythm: cycle events', () => {
  it('a 3-beat base with one 2-pulse voice yields five events sorted by position', () => {
    const events = polyEventsForCycle(3, [2]);
    expect(events).toHaveLength(5);
    // Base meter (-1) and the voice (0) both fire at offset 0; base reads first
    expect(events[0]).toEqual({ stream: -1, index: 0, offset: 0 });
    expect(events[1]).toEqual({ stream: 0, index: 0, offset: 0 });
    const offsets = events.map((e) => e.offset);
    expect(offsets).toEqual([...offsets].sort((x, y) => x - y));
  });

  it('base and each voice contribute exactly their own pulse count', () => {
    const events = polyEventsForCycle(4, [3]);
    expect(events.filter((e) => e.stream === -1)).toHaveLength(4);
    expect(events.filter((e) => e.stream === 0)).toHaveLength(3);
    // Base ticks are evenly spaced across the bar
    expect(events.filter((e) => e.stream === -1).map((e) => e.offset)).toEqual([0, 0.25, 0.5, 0.75]);
  });

  it('handles several voices, sorting base first on coincident offsets', () => {
    // base 4, voice0 2 — the voice pulses at 0 and 0.5 coincide with base ticks
    const events = polyEventsForCycle(4, [2, 3]);
    expect(events.filter((e) => e.stream === 0)).toHaveLength(2);
    expect(events.filter((e) => e.stream === 1)).toHaveLength(3);
    const atZero = events.filter((e) => e.offset === 0);
    expect(atZero.map((e) => e.stream)).toEqual([-1, 0, 1]);
  });
});

describe('togglePolyMute', () => {
  it('toggles a single pulse index on and off', () => {
    expect(togglePolyMute([], 2)).toEqual([2]);
    expect(togglePolyMute([2], 2)).toEqual([]);
    expect(togglePolyMute([0, 2], 1)).toEqual([0, 2, 1]);
  });
});
