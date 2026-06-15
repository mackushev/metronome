// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultSettings, type Settings } from '../state';
import { CircleView, normalizeDeltaDeg, type CircleCallbacks } from './circle';

const SVG_NS = 'http://www.w3.org/2000/svg';

function makeSvg(): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 360 360');
  document.body.appendChild(svg);
  return svg;
}

function noopCallbacks(): CircleCallbacks {
  return {
    onBeatClick: vi.fn(),
    dial: { start: () => 120, change: vi.fn(), step: vi.fn() },
    onBeatsSelect: vi.fn(),
    onSubdivSelect: vi.fn(),
    onSubToggle: vi.fn(),
    onPolyToggleA: vi.fn(),
    onPolyToggleB: vi.fn(),
    onPolySelectA: vi.fn(),
    onPolySelectB: vi.fn(),
  };
}

// ---- normalizeDeltaDeg (pure function) ----

describe('normalizeDeltaDeg', () => {
  it('returns 0 for 0', () => {
    expect(normalizeDeltaDeg(0)).toBe(0);
  });

  it('returns small positive deltas as-is', () => {
    expect(normalizeDeltaDeg(45)).toBe(45);
  });

  it('returns small negative deltas as-is', () => {
    expect(normalizeDeltaDeg(-90)).toBe(-90);
  });

  it('wraps +270 to -90 (shortest path)', () => {
    expect(normalizeDeltaDeg(270)).toBe(-90);
  });

  it('wraps -270 to +90', () => {
    expect(normalizeDeltaDeg(-270)).toBe(90);
  });

  it('wraps exactly 180 to 180', () => {
    expect(normalizeDeltaDeg(180)).toBe(180);
  });

  it('wraps exactly -180 to 180 (open left, closed right)', () => {
    expect(normalizeDeltaDeg(-180)).toBe(180);
  });

  it('wraps full turns to 0', () => {
    expect(normalizeDeltaDeg(360)).toBe(0);
    expect(normalizeDeltaDeg(-360)).toBe(-0);
  });

  it('wraps multi-turn values correctly', () => {
    expect(normalizeDeltaDeg(360 + 45)).toBe(45);
    expect(normalizeDeltaDeg(-360 - 90)).toBe(-90);
  });
});

// ---- CircleView ----

describe('CircleView', () => {
  let svg: SVGSVGElement;
  let callbacks: CircleCallbacks;
  let circle: CircleView;
  let settings: Settings;

  beforeEach(() => {
    svg = makeSvg();
    callbacks = noopCallbacks();
    circle = new CircleView(svg, callbacks);
    settings = defaultSettings();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  describe('render (metronome mode)', () => {
    it('creates beat dots for 4/4 with subdivision=1', () => {
      circle.render(settings);
      const dots = svg.querySelectorAll('.dot-beat');
      expect(dots.length).toBe(4);
    });

    it('creates subdivision dots when subdivision > 1', () => {
      settings.subdivision = 2;
      circle.render(settings);
      const beatDots = svg.querySelectorAll('.dot-beat');
      const subDots = svg.querySelectorAll('.dot-sub');
      expect(beatDots.length).toBe(4);
      expect(subDots.length).toBe(4); // 4 beats × 2 subs, 4 are beat dots, 4 are sub dots
    });

    it('changes dot count when beats change', () => {
      circle.render(settings); // 4 beats
      settings.beats = 6;
      settings.beatStates = ['accent', 'normal', 'normal', 'normal', 'normal', 'normal'];
      circle.render(settings);
      expect(svg.querySelectorAll('.dot-beat').length).toBe(6);
    });

    it('applies accent class to the first beat by default', () => {
      circle.render(settings);
      const beatDots = svg.querySelectorAll('.dot-beat');
      expect(beatDots[0]?.classList.contains('accent')).toBe(true);
    });

    it('applies mute class to muted beats', () => {
      settings.beatStates = ['mute', 'normal', 'normal', 'normal'];
      circle.render(settings);
      const beatDots = svg.querySelectorAll('.dot-beat');
      expect(beatDots[0]?.classList.contains('mute')).toBe(true);
    });

    it('applies muted class to muted subdivision dots', () => {
      settings.subdivision = 2;
      settings.mutedSubs = ['0-1']; // beat 0, sub 1 muted
      circle.render(settings);
      const subDots = svg.querySelectorAll('.dot-sub');
      // The first sub dot (beat 0, sub 1) should be muted
      expect(subDots[0]?.classList.contains('muted')).toBe(true);
    });
  });

  describe('tick (animation)', () => {
    it('sets active class on the correct dot', () => {
      circle.render(settings);
      circle.tick({ beatIndex: 0, subIndex: 0, fraction: 0 });
      const dots = svg.querySelectorAll('.dot');
      expect(dots[0]?.classList.contains('active')).toBe(true);
    });

    it('removes active class on null (stopped)', () => {
      circle.render(settings);
      circle.tick({ beatIndex: 1, subIndex: 0, fraction: 0 });
      circle.tick(null);
      const activeDots = svg.querySelectorAll('.dot.active');
      expect(activeDots.length).toBe(0);
    });

    it('makes needle visible during playback', () => {
      circle.render(settings);
      circle.tick({ beatIndex: 0, subIndex: 0, fraction: 0 });
      const needle = svg.querySelector('.needle') as SVGElement;
      expect(needle?.style.visibility).toBe('visible');
    });

    it('hides needle when stopped', () => {
      circle.render(settings);
      circle.tick({ beatIndex: 0, subIndex: 0, fraction: 0 });
      circle.tick(null);
      const needle = svg.querySelector('.needle') as SVGElement;
      expect(needle?.style.visibility).toBe('hidden');
    });
  });

  describe('renderPoly (polyrhythm mode)', () => {
    it('creates dots for both rhythms', () => {
      circle.renderPoly(settings); // default 3:2
      const dotsA = svg.querySelectorAll('.dot-poly-a');
      const dotsB = svg.querySelectorAll('.dot-poly-b');
      expect(dotsA.length).toBe(3);
      expect(dotsB.length).toBe(2);
    });

    it('rebuilds when ratio changes', () => {
      circle.renderPoly(settings);
      settings.polyrhythm.a = 5;
      settings.polyrhythm.b = 4;
      circle.renderPoly(settings);
      expect(svg.querySelectorAll('.dot-poly-a').length).toBe(5);
      expect(svg.querySelectorAll('.dot-poly-b').length).toBe(4);
    });

    it('marks muted pulses in rhythm A', () => {
      settings.polyrhythm.mutedA = [1];
      circle.renderPoly(settings);
      const dotsA = svg.querySelectorAll('.dot-poly-a');
      expect(dotsA[1]?.classList.contains('muted')).toBe(true);
      expect(dotsA[0]?.classList.contains('muted')).toBe(false);
    });

    it('marks muted pulses in rhythm B', () => {
      settings.polyrhythm.mutedB = [0];
      circle.renderPoly(settings);
      const dotsB = svg.querySelectorAll('.dot-poly-b');
      expect(dotsB[0]?.classList.contains('muted')).toBe(true);
    });
  });

  describe('polyTick (polyrhythm animation)', () => {
    it('highlights rhythm A dot and shows needle', () => {
      circle.renderPoly(settings);
      circle.polyTick({ phase: 0, aIndex: 0, bIndex: -1 });
      const dotsA = svg.querySelectorAll('.dot-poly-a');
      expect(dotsA[0]?.classList.contains('active')).toBe(true);
      const needle = svg.querySelector('.needle') as SVGElement;
      expect(needle?.style.visibility).toBe('visible');
    });

    it('hides everything on null (stopped)', () => {
      circle.renderPoly(settings);
      circle.polyTick({ phase: 0, aIndex: 0, bIndex: 1 });
      circle.polyTick(null);
      const needle = svg.querySelector('.needle') as SVGElement;
      expect(needle?.style.visibility).toBe('hidden');
    });

    it('fades out poly dot after POLY_HIGHLIGHT_MS', () => {
      vi.useFakeTimers();
      circle.renderPoly(settings);
      circle.polyTick({ phase: 0, aIndex: 1, bIndex: 0 });
      const dotsA = svg.querySelectorAll('.dot-poly-a');
      expect(dotsA[1]?.classList.contains('active')).toBe(true);
      vi.advanceTimersByTime(150);
      expect(dotsA[1]?.classList.contains('active')).toBe(false);
      vi.useRealTimers();
    });
  });

  describe('setTrainerProgress', () => {
    it('shows the trainer ring with a progress fraction', () => {
      circle.render(settings);
      circle.setTrainerProgress(0.5);
      const ring = svg.querySelector('.trainer-ring') as SVGElement;
      expect(ring?.style.visibility).toBe('visible');
    });

    it('hides the trainer ring when null', () => {
      circle.render(settings);
      circle.setTrainerProgress(0.5);
      circle.setTrainerProgress(null);
      const ring = svg.querySelector('.trainer-ring') as SVGElement;
      expect(ring?.style.visibility).toBe('hidden');
    });
  });

  describe('callbacks', () => {
    it('fires onBeatClick when a beat dot is tapped', () => {
      circle.render(settings);
      const beatDot = svg.querySelectorAll('.dot-beat')[1];
      beatDot?.dispatchEvent(new Event('pointerdown'));
      expect(callbacks.onBeatClick).toHaveBeenCalledWith(1);
    });

    it('fires onSubToggle when a subdivision dot is tapped', () => {
      settings.subdivision = 2;
      circle.render(settings);
      const subDot = svg.querySelectorAll('.dot-sub')[0]; // beat 0, sub 1
      subDot?.dispatchEvent(new Event('pointerdown'));
      expect(callbacks.onSubToggle).toHaveBeenCalledWith(0, 1);
    });

    it('fires onPolyToggleA when a rhythm A dot is tapped', () => {
      circle.renderPoly(settings);
      const dotA = svg.querySelectorAll('.dot-poly-a')[2];
      dotA?.dispatchEvent(new Event('pointerdown'));
      expect(callbacks.onPolyToggleA).toHaveBeenCalledWith(2);
    });

    it('fires onPolyToggleB when a rhythm B dot is tapped', () => {
      circle.renderPoly(settings);
      const dotB = svg.querySelectorAll('.dot-poly-b')[1];
      dotB?.dispatchEvent(new Event('pointerdown'));
      expect(callbacks.onPolyToggleB).toHaveBeenCalledWith(1);
    });
  });

  describe('mode switching', () => {
    it('can switch from poly to metronome mode cleanly', () => {
      circle.renderPoly(settings);
      expect(svg.querySelectorAll('.dot-poly-a').length).toBe(3);

      // Now switch to metronome
      circle.render(settings);
      expect(svg.querySelectorAll('.dot-beat').length).toBe(4);
      expect(svg.querySelectorAll('.dot-poly-a').length).toBe(0);
    });

    it('can switch from metronome to poly mode cleanly', () => {
      circle.render(settings);
      expect(svg.querySelectorAll('.dot-beat').length).toBe(4);

      circle.renderPoly(settings);
      expect(svg.querySelectorAll('.dot-poly-a').length).toBe(3);
      expect(svg.querySelectorAll('.dot-poly-b').length).toBe(2);
    });
  });
});
