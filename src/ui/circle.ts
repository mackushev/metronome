import { BEATS_MAX, SUBDIVISIONS, type Settings } from '../state';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW = 360;
const CX = VIEW / 2;
const CY = VIEW / 2;
const DOT_RING_R = 138;
const NEEDLE_R = 112;
const TRAINER_RING_R = 152;
const DIAL_R = 100;
/** Tempo dial sensitivity: degrees of rotation per 1 BPM (full turn = 60 BPM) */
const DEG_PER_BPM = 6;
/** Outer selector dots: radius and tilt of the inter-sector gap axis
    (20° counterclockwise from vertical) */
const SELECTOR_R = 168;
const SELECTOR_ROT_DEG = -20;
/** A curved label sits at the top of each sector; dots follow further along the arc */
const ZONE_LABEL_FROM_DEG = 8;
const ZONE_LABEL_TO_DEG = 38;
const SELECTOR_OFFSET_DEG = 40;
const SELECTOR_STEP_DEG = 16;
/** Sector backdrop arc: from/to (degrees along the arc from the axis) */
const BAND_FROM_DEG = 6;
const BAND_TO_DEG = 160;

/** Angle of a selector dot/element: deg degrees along the arc from the tilted axis */
function selectorAngle(side: 1 | -1, deg: number): number {
  return -90 + SELECTOR_ROT_DEG + side * deg;
}

function el<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  return node;
}

/** Tick angle in degrees: first beat at the top, clockwise */
function tickAngle(index: number, total: number): number {
  return (index / total) * 360 - 90;
}

/** Rotation step normalized to (-180, 180]: crossing the top causes no full-turn jump */
export function normalizeDeltaDeg(delta: number): number {
  let d = delta % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function polar(radius: number, deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
}

function dotCenter(index: number, total: number): { x: number; y: number } {
  return polar(DOT_RING_R, tickAngle(index, total));
}

/** Circular arc of radius r from fromDeg to toDeg (for sector backdrops) */
function arcPath(r: number, fromDeg: number, toDeg: number): string {
  const p0 = polar(r, fromDeg);
  const p1 = polar(r, toDeg);
  const largeArc = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const sweep = toDeg > fromDeg ? 1 : 0;
  return `M ${p0.x} ${p0.y} A ${r} ${r} 0 ${largeArc} ${sweep} ${p1.x} ${p1.y}`;
}

export interface DialCallbacks {
  /** Current BPM at the moment the dial is grabbed */
  start: () => number;
  /** New value while rotating (not rounded, not clamped) */
  change: (value: number) => void;
  /** Arrow tap: shift the tempo by delta */
  step: (delta: number) => void;
}

export interface CircleCallbacks {
  onBeatClick: (beatIndex: number) => void;
  dial: DialCallbacks;
  /** Tap on an outer dot on the right: set the number of beats per measure */
  onBeatsSelect: (beats: number) => void;
  /** Tap on an outer dot on the left: set the number of clicks per beat */
  onSubdivSelect: (subdivision: number) => void;
}

interface SelectorDot {
  dot: SVGCircleElement;
  num: SVGTextElement;
  hit: SVGCircleElement;
}

/**
 * The metronome circle: beat dots (clickable) and subdivision dots,
 * a sweeping needle, current-tick highlight, the trainer progress ring,
 * the tempo dial around the center, and outer selector dots for the
 * number of beats (right arc) and clicks per beat (left arc).
 */
export class CircleView {
  private dots: SVGCircleElement[] = [];
  private needle: SVGLineElement;
  private trainerRing: SVGCircleElement;
  private trainerRingLen: number;
  private dialTrack: SVGCircleElement;
  private dialHit: SVGCircleElement;
  private dialArrows: SVGElement[] = [];
  private dialDrag: { startValue: number; lastAngle: number; totalDeg: number } | null = null;
  private selBeats: SelectorDot[] = [];
  private selSubdiv: SelectorDot[] = [];
  private selDecor: SVGElement[] = [];
  private beats = 0;
  private subdivision = 0;
  private activeIndex = -1;

  private readonly svg: SVGSVGElement;
  private readonly callbacks: CircleCallbacks;

  constructor(svg: SVGSVGElement, callbacks: CircleCallbacks) {
    this.svg = svg;
    this.callbacks = callbacks;
    this.trainerRingLen = 2 * Math.PI * TRAINER_RING_R;
    this.trainerRing = el('circle', {
      class: 'trainer-ring',
      cx: CX,
      cy: CY,
      r: TRAINER_RING_R,
      'stroke-dasharray': this.trainerRingLen,
      'stroke-dashoffset': this.trainerRingLen,
      transform: `rotate(-90 ${CX} ${CY})`,
    });
    this.needle = el('line', { class: 'needle', x1: CX, y1: CY, x2: CX, y2: CY - NEEDLE_R });
    this.needle.style.visibility = 'hidden';

    this.dialTrack = el('circle', { class: 'dial-track', cx: CX, cy: CY, r: DIAL_R });
    this.dialHit = el('circle', { class: 'dial-hit', cx: CX, cy: CY, r: DIAL_R });
    this.dialHit.addEventListener('pointerdown', (event) => this.dialDown(event));
    this.dialHit.addEventListener('pointermove', (event) => this.dialMove(event));
    this.dialHit.addEventListener('pointerup', () => (this.dialDrag = null));
    this.dialHit.addEventListener('pointercancel', () => (this.dialDrag = null));
    this.buildDialArrows();

    this.buildSelectorBands();
    this.selBeats = this.buildSelector(BEATS_MAX, 'sel-beats', +1, (value) =>
      this.callbacks.onBeatsSelect(value),
    );
    this.selSubdiv = this.buildSelector(SUBDIVISIONS.length, 'sel-subdiv', -1, (value) =>
      this.callbacks.onSubdivSelect(value),
    );
  }

  // --- Outer selector dots ---

  /** Colored sector backdrop arcs; labels curve along the circle at the sector tops */
  private buildSelectorBands(): void {
    for (const [cls, side, label] of [
      ['band-beats', +1, 'beats'],
      ['band-subdiv', -1, 'clicks'],
    ] as const) {
      const band = el('path', {
        class: `sel-band ${cls}`,
        d: arcPath(SELECTOR_R, selectorAngle(side, BAND_FROM_DEG), selectorAngle(side, BAND_TO_DEG)),
      });
      // Always draw the label path clockwise (left to right) so the text is not upside down
      const degs = [selectorAngle(side, ZONE_LABEL_FROM_DEG), selectorAngle(side, ZONE_LABEL_TO_DEG)];
      const labelPath = el('path', {
        id: `zone-path-${cls}`,
        d: arcPath(SELECTOR_R, Math.min(...degs), Math.max(...degs)),
        fill: 'none',
      });
      const text = el('text', { class: `sel-zone-label ${cls}` });
      const textPath = el('textPath', { href: `#zone-path-${cls}`, startOffset: '50%' });
      textPath.setAttribute('text-anchor', 'middle');
      textPath.textContent = label;
      text.append(textPath);
      this.selDecor.push(band, labelPath, text);
    }
  }

  /** Arc of count dots; side=+1 — right half (clockwise), -1 — left half */
  private buildSelector(
    count: number,
    cls: string,
    side: 1 | -1,
    onSelect: (value: number) => void,
  ): SelectorDot[] {
    const result: SelectorDot[] = [];
    for (let value = 1; value <= count; value++) {
      const deg = selectorAngle(side, SELECTOR_OFFSET_DEG + (value - 1) * SELECTOR_STEP_DEG);
      const { x, y } = polar(SELECTOR_R, deg);
      const dot = el('circle', { class: `sel-dot ${cls}`, cx: x, cy: y, r: 6 });
      const num = el('text', { class: 'sel-num', x, y, dy: '0.34em' });
      num.textContent = String(value);
      const hit = el('circle', { class: 'sel-hit', cx: x, cy: y, r: 13 });
      hit.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        onSelect(value);
      });
      result.push({ dot, num, hit });
    }
    return result;
  }

  private renderSelector(sel: SelectorDot[], value: number): void {
    sel.forEach(({ dot, num }, i) => {
      dot.classList.toggle('filled', i + 1 <= value);
      dot.classList.toggle('current', i + 1 === value);
      num.classList.toggle('filled', i + 1 <= value);
    });
  }

  // --- Tempo dial ---

  /** Pointer angle relative to the circle center, degrees */
  private pointerAngle(event: PointerEvent): number {
    const rect = this.svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEW - CX;
    const y = ((event.clientY - rect.top) / rect.height) * VIEW - CY;
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  private dialDown(event: PointerEvent): void {
    event.preventDefault();
    (event.target as Element).setPointerCapture(event.pointerId);
    this.dialDrag = {
      startValue: this.callbacks.dial.start(),
      lastAngle: this.pointerAngle(event),
      totalDeg: 0,
    };
  }

  private dialMove(event: PointerEvent): void {
    if (!this.dialDrag) return;
    const angle = this.pointerAngle(event);
    const delta = normalizeDeltaDeg(angle - this.dialDrag.lastAngle);
    this.dialDrag.lastAngle = angle;
    this.dialDrag.totalDeg += delta;
    this.callbacks.dial.change(this.dialDrag.startValue + this.dialDrag.totalDeg / DEG_PER_BPM);
  }

  /** ±1 BPM arrows on the horizontal radius of the dial: minus left, plus right */
  private buildDialArrows(): void {
    for (const [side, delta] of [
      [-1, -1],
      [1, 1],
    ] as const) {
      const x = CX + side * DIAL_R;
      const y = CY;
      const chevron = el('polyline', {
        class: 'dial-arrow',
        points: `${x - side * 4},${y - 8} ${x + side * 4},${y} ${x - side * 4},${y + 8}`,
      });
      const hit = el('circle', { class: 'dial-arrow-hit', cx: x, cy: y, r: 17 });
      hit.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.callbacks.dial.step(delta);
      });
      this.dialArrows.push(chevron, hit);
    }
  }

  /** Rebuilds the dots to match the current settings (call on every change) */
  render(settings: Settings): void {
    const { beats, subdivision, beatStates } = settings;
    if (beats !== this.beats || subdivision !== this.subdivision) {
      this.rebuild(beats, subdivision);
    }
    for (let beat = 0; beat < beats; beat++) {
      const dot = this.dots[beat * subdivision];
      dot.setAttribute(
        'class',
        `dot dot-beat ${beatStates[beat] ?? 'normal'}${beat * subdivision === this.activeIndex ? ' active' : ''}`,
      );
    }
    this.renderSelector(this.selBeats, beats);
    this.renderSelector(this.selSubdiv, subdivision);
  }

  private rebuild(beats: number, subdivision: number): void {
    this.beats = beats;
    this.subdivision = subdivision;
    this.activeIndex = -1;
    this.svg.replaceChildren();
    this.dots = [];

    this.svg.append(
      el('circle', { class: 'base-ring', cx: CX, cy: CY, r: DOT_RING_R }),
      this.trainerRing,
      this.needle,
      this.dialTrack,
      this.dialHit,
      ...this.dialArrows,
    );
    this.svg.append(...this.selDecor);
    for (const { dot, num, hit } of [...this.selBeats, ...this.selSubdiv]) {
      this.svg.append(dot, num, hit);
    }

    const total = beats * subdivision;
    for (let i = 0; i < total; i++) {
      const { x, y } = dotCenter(i, total);
      const isBeat = i % subdivision === 0;
      const dot = el('circle', {
        class: isBeat ? 'dot dot-beat normal' : 'dot dot-sub',
        cx: x,
        cy: y,
        r: isBeat ? 11 : 4.5,
      });
      if (isBeat) {
        const beatIndex = i / subdivision;
        dot.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.callbacks.onBeatClick(beatIndex);
        });
      }
      this.svg.append(dot);
      this.dots.push(dot);
    }
  }

  /** Animation update; pos = null when the metronome is stopped */
  tick(pos: { beatIndex: number; subIndex: number; fraction: number } | null): void {
    if (!pos) {
      this.setActive(-1);
      this.needle.style.visibility = 'hidden';
      return;
    }
    const total = this.beats * this.subdivision;
    const index = pos.beatIndex * this.subdivision + pos.subIndex;
    this.setActive(index);
    const angle = ((index + pos.fraction) / total) * 360;
    this.needle.setAttribute('transform', `rotate(${angle} ${CX} ${CY})`);
    this.needle.style.visibility = 'visible';
  }

  /** Progress toward the next trainer speed-up, 0..1; null hides the ring */
  setTrainerProgress(fraction: number | null): void {
    if (fraction === null) {
      this.trainerRing.style.visibility = 'hidden';
      return;
    }
    this.trainerRing.style.visibility = 'visible';
    this.trainerRing.setAttribute(
      'stroke-dashoffset',
      String(this.trainerRingLen * (1 - Math.min(1, Math.max(0, fraction)))),
    );
  }

  private setActive(index: number): void {
    if (index === this.activeIndex) return;
    if (this.activeIndex >= 0) this.dots[this.activeIndex]?.classList.remove('active');
    if (index >= 0) this.dots[index]?.classList.add('active');
    this.activeIndex = index;
  }
}
