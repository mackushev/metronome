import { BEATS_MAX, SUBDIVISIONS, isSubMuted, type Settings } from '../state';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VIEW = 360;
const CX = VIEW / 2;
const CY = VIEW / 2;
const DOT_RING_R = 138;
/** Polyrhythm: the base-meter tick ring (outermost) and the four voice rings.
    The rings sit in the annulus between the centre overlay (~r 77) and the
    selectors; the ±1 dial arrows are dropped in poly mode to keep it clear. */
const POLY_BASE_R = 150;
const POLY_VOICE_RADII = [136, 118, 100, 84];
const NEEDLE_R = 112;
const TRAINER_RING_R = 152;
const DIAL_R = 100;
/** Tempo dial sensitivity: degrees of rotation per 1 BPM (full turn = 60 BPM) */
const DEG_PER_BPM = 6;
/** Jog-wheel tick scale: one tick every 12° (30 ticks), short marks just
    inside the rim */
const DIAL_TICK_STEP_DEG = 12;
const DIAL_TICK_INNER_R = 93;
const DIAL_TICK_OUTER_R = 98;
/** The marker rides inside the rim (not on it) so it never slides under the
    ±1 buttons, which sit just outside the rim */
const DIAL_MARKER_R = 87;
const DIAL_ARROW_R = DIAL_R + 7;
/** Spring used while the marker settles onto an exact tick after release/tap */
const DIAL_SETTLE_TRANSITION = 'transform .45s cubic-bezier(.22, 1.4, .36, 1)';
/** Delta badge auto-hides this long after the last tempo change */
const DIAL_BADGE_HIDE_MS = 1800;
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
  /** Tap on a subdivision dot: mute/unmute that single ghost click */
  onSubToggle: (beatIndex: number, subIndex: number) => void;
  /** Polyrhythm: tap a pulse on a voice ring to mute/unmute it */
  onPolyToggle: (voice: number, pulse: number) => void;
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
  /** Jog wheel: a group with the tick scale + green rim, a rotating marker
      group, the invisible grab zone, the ±1 buttons and the delta badge. */
  private dialGroup: SVGGElement;
  private dialMarkerRot: SVGGElement;
  private dialBadge: SVGGElement;
  private dialBadgeText: SVGTextElement;
  private dialHit: SVGCircleElement;
  private dialArrows: SVGElement[] = [];
  private dialDrag: { startValue: number; lastAngle: number; totalDeg: number } | null = null;
  private dialDragging = false;
  private dialPointerId: number | null = null;
  /** Window-bound move/up handlers, attached only while a drag is in flight */
  private readonly onDialMove = (event: PointerEvent): void => this.dialMove(event);
  private readonly onDialUp = (): void => this.dialUp();
  /** One-shot: the next marker update animates the settle spring */
  private dialSettleOnce = false;
  /** BPM the current gesture started from — the badge shows the delta from it */
  private dialDeltaBase: number | null = null;
  private dialBadgeVisible = false;
  private dialBadgeTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  private selBeats: SelectorDot[] = [];
  private selSubdiv: SelectorDot[] = [];
  private selDecor: SVGElement[] = [];
  private beats = 0;
  private subdivision = 0;
  private activeIndex = -1;

  // Polyrhythm rendering state
  private polyMode = false;
  /** Voice rings: one array of dots per limb voice */
  private polyVoiceDots: SVGCircleElement[][] = [];
  /** The thin guide circle under each voice's dots */
  private polyVoiceGuides: SVGCircleElement[] = [];
  private polyKey = '';
  /** Last pulse index reported by the engine for each voice ring */
  private polyActiveVoices: number[] = [];
  /** Per-voice fade timers so each highlight turns off independently */
  private polyVoiceTimers: (ReturnType<typeof setTimeout> | null)[] = [];
  /** How long (ms) a polyrhythm dot stays lit after it fires.
   *  150 ms works well: at 120 BPM in 3:2 the shortest gap is ~167 ms,
   *  so the flash ends just before the next pulse arrives. */
  private static readonly POLY_HIGHLIGHT_MS = 150;

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

    this.dialGroup = this.buildDialWheel();
    this.dialMarkerRot = this.dialGroup.querySelector('.dial-marker-rot') as SVGGElement;
    this.dialHit = el('circle', { class: 'dial-hit', cx: CX, cy: CY, r: DIAL_R });
    // Only pointerdown lives on the wheel; move/up are bound to the window for
    // the duration of the gesture so the drag always ends — even when the
    // pointer is released over the center overlay (which sits above the SVG)
    // or pointer capture is lost.
    this.dialHit.addEventListener('pointerdown', (event) => this.dialDown(event));
    this.buildDialArrows();
    [this.dialBadge, this.dialBadgeText] = this.buildDialBadge();

    this.selDecor = this.buildSelectorBands([
      ['band-beats', +1, 'beats'],
      ['band-subdiv', -1, 'clicks'],
    ]);
    this.selBeats = this.buildSelector(BEATS_MAX, 'sel-beats', +1, (value) =>
      this.callbacks.onBeatsSelect(value),
    );
    this.selSubdiv = this.buildSelector(SUBDIVISIONS.length, 'sel-subdiv', -1, (value) =>
      this.callbacks.onSubdivSelect(value),
    );
  }

  // --- Outer selector dots ---

  /** Colored sector backdrop arcs; labels curve along the circle at the sector tops */
  private buildSelectorBands(specs: readonly (readonly [string, 1 | -1, string])[]): SVGElement[] {
    const decor: SVGElement[] = [];
    for (const [cls, side, label] of specs) {
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
      decor.push(band, labelPath, text);
    }
    return decor;
  }

  /** Arc of count dots; side=+1 — right half (clockwise), -1 — left half.
      step defaults to SELECTOR_STEP_DEG; pass a smaller one to fit many dots. */
  private buildSelector(
    count: number,
    cls: string,
    side: 1 | -1,
    onSelect: (value: number) => void,
    step: number = SELECTOR_STEP_DEG,
  ): SelectorDot[] {
    // Shrink dots a touch when they are densely packed
    const r = step < SELECTOR_STEP_DEG ? 4.5 : 6;
    const result: SelectorDot[] = [];
    for (let value = 1; value <= count; value++) {
      const deg = selectorAngle(side, SELECTOR_OFFSET_DEG + (value - 1) * step);
      const { x, y } = polar(SELECTOR_R, deg);
      const dot = el('circle', { class: `sel-dot ${cls}`, cx: x, cy: y, r });
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

  // --- Tempo dial (jog wheel) ---

  /** The static wheel: a faint tick scale, the green rim, and the rotating
      marker that signals "this turns". The marker only carries the rotation
      transform; everything else is decorative and ignores pointer events. */
  private buildDialWheel(): SVGGElement {
    const group = el('g', { class: 'dial' });
    for (let deg = 0; deg < 360; deg += DIAL_TICK_STEP_DEG) {
      const a = deg - 90;
      const p0 = polar(DIAL_TICK_INNER_R, a);
      const p1 = polar(DIAL_TICK_OUTER_R, a);
      group.append(el('line', { class: 'dial-tick', x1: p0.x, y1: p0.y, x2: p1.x, y2: p1.y }));
    }
    group.append(el('circle', { class: 'dial-rim', cx: CX, cy: CY, r: DIAL_R }));
    const markerRot = el('g', { class: 'dial-marker-rot' });
    markerRot.append(el('circle', { class: 'dial-marker', cx: CX, cy: CY - DIAL_MARKER_R, r: 6 }));
    group.append(markerRot);
    return group;
  }

  /** Badge in the upper-right of the wheel showing the running delta (+5 / −3) */
  private buildDialBadge(): [SVGGElement, SVGTextElement] {
    const group = el('g', { class: 'dial-badge' });
    group.style.display = 'none';
    const { x, y } = polar(DIAL_R, -45);
    group.append(el('rect', { class: 'dial-badge-bg', x: x - 20, y: y - 11, width: 40, height: 22, rx: 7 }));
    const text = el('text', { class: 'dial-badge-text', x, y, dy: '0.02em' });
    group.append(text);
    return [group, text];
  }

  /** Pointer angle relative to the circle center, degrees */
  private pointerAngle(event: PointerEvent): number {
    const rect = this.svg.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * VIEW - CX;
    const y = ((event.clientY - rect.top) / rect.height) * VIEW - CY;
    return (Math.atan2(y, x) * 180) / Math.PI;
  }

  private dialDown(event: PointerEvent): void {
    event.preventDefault();
    try {
      this.dialHit.setPointerCapture(event.pointerId);
    } catch {
      /* capture is best-effort; the window listeners below are the safety net */
    }
    this.dialPointerId = event.pointerId;
    const startValue = this.callbacks.dial.start();
    this.dialDragging = true;
    this.dialSettleOnce = false;
    this.dialDeltaBase = startValue;
    this.dialBadgeVisible = true;
    if (this.dialBadgeTimer) clearTimeout(this.dialBadgeTimer);
    this.dialDrag = { startValue, lastAngle: this.pointerAngle(event), totalDeg: 0 };
    window.addEventListener('pointermove', this.onDialMove);
    window.addEventListener('pointerup', this.onDialUp);
    window.addEventListener('pointercancel', this.onDialUp);
    this.updateDial(startValue);
  }

  private dialMove(event: PointerEvent): void {
    if (!this.dialDrag) return;
    // Safety net: if the button was released without us getting pointerup
    // (capture lost, focus change), end the drag instead of tracking a hover.
    if (event.buttons === 0) {
      this.dialUp();
      return;
    }
    const angle = this.pointerAngle(event);
    const delta = normalizeDeltaDeg(angle - this.dialDrag.lastAngle);
    this.dialDrag.lastAngle = angle;
    this.dialDrag.totalDeg += delta;
    // change() rounds and re-renders, which calls updateDial() with the new BPM
    this.callbacks.dial.change(this.dialDrag.startValue + this.dialDrag.totalDeg / DEG_PER_BPM);
  }

  private dialUp(): void {
    window.removeEventListener('pointermove', this.onDialMove);
    window.removeEventListener('pointerup', this.onDialUp);
    window.removeEventListener('pointercancel', this.onDialUp);
    if (this.dialPointerId !== null) {
      try {
        this.dialHit.releasePointerCapture(this.dialPointerId);
      } catch {
        /* capture may already be gone */
      }
      this.dialPointerId = null;
    }
    if (!this.dialDrag) return;
    this.dialDrag = null;
    this.dialDragging = false;
    this.dialSettleOnce = true; // settle the marker onto the now-rounded BPM
    this.updateDial(this.callbacks.dial.start());
    this.flashDelta();
  }

  /** ±1 BPM arrows along the bottom of the wheel: minus left, plus right */
  private buildDialArrows(): void {
    for (const [deg, delta, glyph] of [
      [124, -1, '−'],
      [56, 1, '+'],
    ] as const) {
      const { x, y } = polar(DIAL_ARROW_R, deg);
      const btn = el('circle', { class: 'dial-arrow-btn', cx: x, cy: y, r: 15 });
      const label = el('text', { class: 'dial-arrow-label', x, y, dy: '0.35em' });
      label.textContent = glyph;
      const hit = el('circle', { class: 'dial-arrow-hit', cx: x, cy: y, r: 20 });
      hit.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.dialStep(delta);
      });
      this.dialArrows.push(btn, label, hit);
    }
  }

  private dialStep(delta: number): void {
    if (this.dialDeltaBase === null) this.dialDeltaBase = this.callbacks.dial.start();
    this.dialBadgeVisible = true;
    this.dialSettleOnce = true;
    // step() re-renders synchronously → updateDial() runs the settle spring
    this.callbacks.dial.step(delta);
    this.flashDelta();
  }

  /** Reflect the BPM on the wheel: rotate the marker, drive the grab/settle
      feedback, and refresh the delta badge. Called on every render. */
  private updateDial(bpm: number): void {
    const animate = this.dialSettleOnce && !this.dialDragging && !this.reducedMotion;
    this.dialSettleOnce = false;
    this.dialMarkerRot.style.transition = animate ? DIAL_SETTLE_TRANSITION : 'none';
    this.dialMarkerRot.style.transform = `rotate(${(bpm * DEG_PER_BPM).toFixed(2)}deg)`;
    this.dialGroup.classList.toggle('grabbing', this.dialDragging);
    if (this.dialDeltaBase !== null && (this.dialDragging || this.dialBadgeVisible)) {
      const d = Math.round(bpm) - this.dialDeltaBase;
      this.dialBadgeText.textContent = (d > 0 ? '+' : '') + String(d);
      this.dialBadge.style.display = '';
    } else {
      this.dialBadge.style.display = 'none';
    }
  }

  private flashDelta(): void {
    this.dialBadgeVisible = true;
    if (this.dialBadgeTimer) clearTimeout(this.dialBadgeTimer);
    this.dialBadgeTimer = setTimeout(() => {
      this.dialBadgeVisible = false;
      this.dialDeltaBase = null;
      this.dialBadge.style.display = 'none';
      this.dialBadgeTimer = null;
    }, DIAL_BADGE_HIDE_MS);
  }

  /** Rebuilds the dots to match the current settings (call on every change) */
  render(settings: Settings): void {
    const { beats, subdivision, beatStates, mutedSubs } = settings;
    if (this.polyMode) {
      // Leaving polyrhythm mode: force a full metronome rebuild
      this.polyMode = false;
      this.beats = 0;
      this.subdivision = 0;
    }
    if (beats !== this.beats || subdivision !== this.subdivision) {
      this.rebuild(beats, subdivision);
    }
    this.dots.forEach((dot, i) => {
      const active = i === this.activeIndex ? ' active' : '';
      if (i % subdivision === 0) {
        dot.setAttribute('class', `dot dot-beat ${beatStates[i / subdivision] ?? 'normal'}${active}`);
      } else {
        const muted = isSubMuted(mutedSubs, Math.floor(i / subdivision), i % subdivision);
        dot.setAttribute('class', `dot dot-sub${muted ? ' muted' : ''}${active}`);
      }
    });
    this.renderSelector(this.selBeats, beats);
    this.renderSelector(this.selSubdiv, subdivision);
    this.updateDial(settings.bpm);
  }

  private rebuild(beats: number, subdivision: number): void {
    this.beats = beats;
    this.subdivision = subdivision;
    this.activeIndex = -1;
    this.svg.replaceChildren();
    this.dots = [];

    // Visual wheel first, then the invisible grab zone, then the ±1 buttons on
    // top (so their hit targets win over the drag zone), then the delta badge.
    this.svg.append(
      el('circle', { class: 'base-ring', cx: CX, cy: CY, r: DOT_RING_R }),
      this.trainerRing,
      this.needle,
      this.dialGroup,
      this.dialHit,
      ...this.dialArrows,
      this.dialBadge,
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
      } else {
        const beatIndex = Math.floor(i / subdivision);
        const subIndex = i % subdivision;
        dot.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.callbacks.onSubToggle(beatIndex, subIndex);
        });
      }
      this.svg.append(dot);
      this.dots.push(dot);
    }
  }

  /** Renders the base ring + voice rings (call on every change in polyrhythm mode) */
  renderPoly(settings: Settings): void {
    const { beats, subdivision, beatStates, mutedSubs } = settings;
    const voices = settings.polyrhythm.voices;
    const key = `${beats}:${subdivision}:${voices.map((v) => v.pulses).join(',')}`;
    if (!this.polyMode || key !== this.polyKey) {
      this.rebuildPoly(beats, subdivision, voices);
      this.polyKey = key;
    }
    // Base meter ticks (outer ring) — beats + ghost subdivisions like the metronome
    this.dots.forEach((dot, i) => {
      const active = i === this.activeIndex ? ' active' : '';
      if (i % subdivision === 0) {
        dot.setAttribute('class', `dot dot-beat ${beatStates[i / subdivision] ?? 'normal'}${active}`);
      } else {
        const muted = isSubMuted(mutedSubs, Math.floor(i / subdivision), i % subdivision);
        dot.setAttribute('class', `dot dot-sub${muted ? ' muted' : ''}${active}`);
      }
    });
    // Voice rings — a disabled voice is hidden entirely (dots + guide)
    voices.forEach((voice, v) => {
      const disabled = voice.enabled ? '' : ' disabled';
      if (this.polyVoiceGuides[v]) this.polyVoiceGuides[v].style.display = voice.enabled ? '' : 'none';
      this.polyVoiceDots[v]?.forEach((dot, i) => {
        const muted = voice.muted.includes(i) ? ' muted' : '';
        const accent = i === 0 ? ' accent' : '';
        const active = i === this.polyActiveVoices[v] ? ' active' : '';
        dot.setAttribute('class', `dot dot-poly dot-poly-v${v}${accent}${muted}${active}${disabled}`);
      });
    });
    this.renderSelector(this.selBeats, beats);
    this.renderSelector(this.selSubdiv, subdivision);
  }

  private rebuildPoly(
    beats: number,
    subdivision: number,
    voices: Settings['polyrhythm']['voices'],
  ): void {
    this.polyMode = true;
    this.beats = 0;
    this.subdivision = 0;
    this.activeIndex = -1;
    this.polyActiveVoices = voices.map(() => -1);
    for (const t of this.polyVoiceTimers) if (t !== null) clearTimeout(t);
    this.polyVoiceTimers = voices.map(() => null);
    this.svg.replaceChildren();
    this.dots = [];
    this.polyVoiceDots = voices.map(() => []);
    this.polyVoiceGuides = [];

    // Tempo control stays (spin the ring / drag the centre) but the visible
    // BPM-colored dial track and the ±1 arrows are dropped — only the invisible
    // dialHit target remains, leaving a clean annulus for the voice rings.
    this.svg.append(
      el('circle', { class: 'base-ring', cx: CX, cy: CY, r: POLY_BASE_R }),
      this.trainerRing,
      this.needle,
      this.dialHit,
    );
    // A very thin, barely-visible guide circle under each voice's dots
    for (let v = 0; v < voices.length; v++) {
      const r = POLY_VOICE_RADII[v] ?? POLY_VOICE_RADII[POLY_VOICE_RADII.length - 1];
      const guide = el('circle', { class: 'voice-guide', cx: CX, cy: CY, r });
      this.svg.append(guide);
      this.polyVoiceGuides.push(guide);
    }
    // Outer arcs: right selects beats per bar, left selects clicks per beat.
    this.svg.append(...this.selDecor);
    for (const { dot, num, hit } of [...this.selBeats, ...this.selSubdiv]) {
      this.svg.append(dot, num, hit);
    }

    // Base meter on the outer ring: beats (big, clickable) + ghost subdivisions
    const total = beats * subdivision;
    for (let i = 0; i < total; i++) {
      const { x, y } = polar(POLY_BASE_R, tickAngle(i, total));
      const isBeat = i % subdivision === 0;
      const dot = el('circle', {
        class: isBeat ? 'dot dot-beat normal' : 'dot dot-sub',
        cx: x,
        cy: y,
        r: isBeat ? 9 : 4,
      });
      if (isBeat) {
        const beatIndex = i / subdivision;
        dot.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.callbacks.onBeatClick(beatIndex);
        });
      } else {
        const beatIndex = Math.floor(i / subdivision);
        const subIndex = i % subdivision;
        dot.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.callbacks.onSubToggle(beatIndex, subIndex);
        });
      }
      this.svg.append(dot);
      this.dots.push(dot);
    }

    // One concentric ring per voice
    voices.forEach((voice, v) => {
      const r = POLY_VOICE_RADII[v] ?? POLY_VOICE_RADII[POLY_VOICE_RADII.length - 1];
      for (let i = 0; i < voice.pulses; i++) {
        const { x, y } = polar(r, tickAngle(i, voice.pulses));
        const dot = el('circle', { class: `dot dot-poly dot-poly-v${v}`, cx: x, cy: y, r: 6.5 });
        dot.addEventListener('pointerdown', (event) => {
          event.preventDefault();
          this.callbacks.onPolyToggle(v, i);
        });
        this.svg.append(dot);
        this.polyVoiceDots[v].push(dot);
      }
    });
  }

  /** Polyrhythm animation update; readout = null when stopped */
  polyTick(readout: { phase: number; base: number; voices: number[] } | null): void {
    if (!readout) {
      this.setActive(-1);
      this.setPolyActiveVoices(this.polyActiveVoices.map(() => -1));
      this.needle.style.visibility = 'hidden';
      return;
    }
    this.setActive(readout.base);
    this.setPolyActiveVoices(readout.voices);
    const angle = readout.phase * 360;
    this.needle.setAttribute('transform', `rotate(${angle} ${CX} ${CY})`);
    this.needle.style.visibility = 'visible';
  }

  /** Light each voice's most recent pulse, with an independent fade-out per voice. */
  private setPolyActiveVoices(indices: number[]): void {
    indices.forEach((index, v) => {
      const dots = this.polyVoiceDots[v];
      if (!dots || index === this.polyActiveVoices[v]) return;
      const prev = this.polyVoiceTimers[v];
      if (prev !== null) clearTimeout(prev);
      if (this.polyActiveVoices[v] >= 0) dots[this.polyActiveVoices[v]]?.classList.remove('active');
      if (index >= 0) {
        dots[index]?.classList.add('active');
        this.polyVoiceTimers[v] = setTimeout(() => {
          dots[index]?.classList.remove('active');
          this.polyVoiceTimers[v] = null;
        }, CircleView.POLY_HIGHLIGHT_MS);
      } else {
        this.polyVoiceTimers[v] = null;
      }
      this.polyActiveVoices[v] = index;
    });
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
