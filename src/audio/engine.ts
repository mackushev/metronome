import { CLICK_VOLUME_FACTOR, isSubMuted, type Settings } from '../state';
import { scheduleSound, type TickKind } from './sounds';

export interface Position {
  beatIndex: number;
  subIndex: number;
}

/** One pulse in a polyrhythm cycle. offset is its position 0..1 around the cycle. */
export interface PolyEvent {
  rhythm: 'a' | 'b';
  index: number;
  offset: number;
}

/**
 * All pulses of one polyrhythm cycle, sorted by their position around the cycle.
 * Rhythm A fires `a` evenly spaced pulses, rhythm B fires `b` of them in the
 * very same span. The shared downbeat (offset 0) yields one event per rhythm.
 */
export function polyEventsForCycle(a: number, b: number): PolyEvent[] {
  const events: PolyEvent[] = [];
  for (let i = 0; i < a; i++) events.push({ rhythm: 'a', index: i, offset: i / a });
  for (let j = 0; j < b; j++) events.push({ rhythm: 'b', index: j, offset: j / b });
  // Sort by time; on a tie keep rhythm A first (the downbeat reads as a beat).
  events.sort((x, y) => x.offset - y.offset || (x.rhythm === y.rhythm ? 0 : x.rhythm === 'a' ? -1 : 1));
  return events;
}

/** UI read-out for the polyrhythm circle: needle phase and the last fired pulses. */
export interface PolyReadout {
  /** 0..1 position around the circle for the sweeping needle */
  phase: number;
  /** Index of the most recently sounded pulse in rhythm A, or -1 */
  aIndex: number;
  /** Index of the most recently sounded pulse in rhythm B, or -1 */
  bIndex: number;
}

/** Pure transition to the next tick; extracted for tests */
export function advance(pos: Position, beats: number, subdivision: number): Position {
  let { beatIndex, subIndex } = pos;
  subIndex += 1;
  if (subIndex >= subdivision) {
    subIndex = 0;
    beatIndex += 1;
  }
  if (beatIndex >= beats) beatIndex = 0;
  return { beatIndex, subIndex };
}

export function tickKind(settings: Settings, pos: Position): TickKind | 'silent' {
  if (pos.subIndex !== 0) {
    return isSubMuted(settings.mutedSubs, pos.beatIndex, pos.subIndex) ? 'silent' : 'sub';
  }
  const state = settings.beatStates[pos.beatIndex] ?? 'normal';
  if (state === 'mute') return 'silent';
  if (state === 'tick') return 'sub';
  return state === 'accent' ? 'accent' : 'normal';
}

interface ScheduledTick extends Position {
  time: number;
  intervalSec: number;
}

/** A polyrhythm pulse already committed to the audio clock (for the UI read-out) */
interface PolyScheduled {
  time: number;
  rhythm: 'a' | 'b';
  index: number;
  cycleStart: number;
  cycleDur: number;
}

const LOOKAHEAD_SEC = 0.12;
const TIMER_MS = 25;
/** A beat in the "tick" state plays the sub timbre at this fixed, audible level —
    it must not fade away with the ghost-note balance setting */
const TICK_BEAT_LEVEL = 0.5;

/**
 * Lookahead scheduler ("A Tale of Two Clocks"): a cheap setInterval
 * schedules clicks ahead of time against the precise AudioContext clock.
 */
export class MetronomeEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private timer: number | null = null;
  private nextTime = 0;
  private pos: Position = { beatIndex: 0, subIndex: 0 };
  private scheduled: ScheduledTick[] = [];

  // Polyrhythm scheduling state
  private polyEvents: PolyEvent[] = [];
  private polyCursor = 0;
  private polyCycleStart = Number.NaN;
  private polyScheduled: PolyScheduled[] = [];
  private polyKey = '';

  /** Called when each beat is scheduled (used by the speed trainer) */
  onBeatScheduled: ((audioTime: number) => void) | null = null;

  /** Called when audio cannot work: no Web Audio support or playback blocked */
  onAudioIssue: ((issue: 'unsupported' | 'blocked') => void) | null = null;

  private readonly getSettings: () => Settings;

  constructor(getSettings: () => Settings) {
    this.getSettings = getSettings;
  }

  get running(): boolean {
    return this.timer !== null;
  }

  /** Precise audio clock; null before the first start */
  currentTime(): number | null {
    return this.ctx ? this.ctx.currentTime : null;
  }

  /** True when the context exists and is actually producing audio */
  audioRunning(): boolean {
    return this.running && this.ctx !== null && this.ctx.state === 'running';
  }

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      // Older iOS Safari only exposes the webkit-prefixed constructor
      const w = window as unknown as {
        AudioContext?: typeof AudioContext;
        webkitAudioContext?: typeof AudioContext;
      };
      const Ctor = w.AudioContext ?? w.webkitAudioContext;
      if (!Ctor) {
        this.onAudioIssue?.('unsupported');
        return null;
      }
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.getSettings().volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  start(): void {
    if (this.running) return;
    const ctx = this.ensureContext();
    if (!ctx) return;
    this.pos = { beatIndex: 0, subIndex: 0 };
    this.scheduled = [];
    this.polyScheduled = [];
    this.polyCursor = 0;
    this.polyCycleStart = Number.NaN;
    this.polyKey = '';
    // The context clock may stand still until resume() completes — wait for it,
    // otherwise a burst of catch-up clicks piles up
    this.nextTime = Number.POSITIVE_INFINITY;
    this.timer = window.setInterval(() => this.schedule(), TIMER_MS);
    void ctx
      .resume()
      .then(() => {
        if (!this.running) return;
        this.nextTime = this.ctx!.currentTime + 0.08;
        this.schedule();
      })
      .catch(() => this.onAudioIssue?.('blocked'));
    // Watchdog: autoplay policies may keep the context suspended without rejecting
    window.setTimeout(() => {
      if (this.running && this.ctx && this.ctx.state !== 'running') {
        this.onAudioIssue?.('blocked');
      }
    }, 1500);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.scheduled = [];
  }

  toggle(): void {
    this.running ? this.stop() : this.start();
  }

  /** One-off click outside the main loop (for sound/volume/balance preview) */
  preview(kind: TickKind = 'normal'): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    void ctx.resume().catch(() => {});
    const s = this.getSettings();
    this.master!.gain.value = s.volume;
    scheduleSound(ctx, this.master!, s.sound, kind, ctx.currentTime + 0.02, CLICK_VOLUME_FACTOR[s.clickVolume]);
  }

  /**
   * Current position for the UI: which tick is sounding and the fraction
   * of the way to the next one. Returns null when stopped or not yet started.
   */
  position(): (Position & { fraction: number }) | null {
    if (!this.ctx || !this.running) return null;
    const now = this.ctx.currentTime;
    let current: ScheduledTick | null = null;
    for (const tick of this.scheduled) {
      if (tick.time <= now) current = tick;
      else break;
    }
    if (!current) return null;
    const fraction = Math.min(1, (now - current.time) / current.intervalSec);
    return { beatIndex: current.beatIndex, subIndex: current.subIndex, fraction };
  }

  /**
   * Polyrhythm read-out for the UI: the sweeping-needle phase (0..1 around the
   * circle) plus the most recently sounded pulse index in each rhythm.
   * Returns null when stopped or before the first cycle is scheduled.
   */
  polyPosition(): PolyReadout | null {
    if (!this.ctx || !this.running) return null;
    const now = this.ctx.currentTime;
    let phase = 0;
    let current: PolyScheduled | null = null;
    let aIndex = -1;
    let bIndex = -1;
    for (const ev of this.polyScheduled) {
      if (ev.time <= now) {
        current = ev;
        if (ev.rhythm === 'a') aIndex = ev.index;
        else bIndex = ev.index;
      } else break;
    }
    if (current && current.cycleDur > 0) {
      phase = ((now - current.cycleStart) / current.cycleDur) % 1;
      if (phase < 0) phase += 1;
    }
    return { phase, aIndex, bIndex };
  }

  private schedule(): void {
    if (!this.running) return;
    if (this.getSettings().mode === 'polyrhythm') {
      this.schedulePoly();
      return;
    }
    const ctx = this.ctx!;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_SEC) {
      const s = this.getSettings();
      // Settings may change on the fly — keep the position within the grid
      if (this.pos.beatIndex >= s.beats) this.pos = { beatIndex: 0, subIndex: 0 };
      if (this.pos.subIndex >= s.subdivision) this.pos = { ...this.pos, subIndex: 0 };

      if (this.pos.subIndex === 0) {
        this.onBeatScheduled?.(this.nextTime);
      }
      // The trainer may have just changed the BPM — read the interval after the callback
      const interval = 60 / this.getSettings().bpm / s.subdivision;
      const kind = tickKind(this.getSettings(), this.pos);
      this.master!.gain.value = s.volume;
      if (kind !== 'silent') {
        const subLevel =
          this.pos.subIndex === 0 ? TICK_BEAT_LEVEL : CLICK_VOLUME_FACTOR[s.clickVolume];
        scheduleSound(ctx, this.master!, s.sound, kind, this.nextTime, subLevel);
      }

      this.scheduled.push({ ...this.pos, time: this.nextTime, intervalSec: interval });
      this.pos = advance(this.pos, s.beats, s.subdivision);
      this.nextTime += interval;
    }
    // Trim ticks that have already sounded so the queue does not grow
    const cutoff = ctx.currentTime - 1;
    while (this.scheduled.length > 1 && this.scheduled[0].time < cutoff) {
      this.scheduled.shift();
    }
  }

  /**
   * Polyrhythm loop. Both rhythms share one cycle whose length is set by rhythm
   * A: `a` pulses, each one quarter-note long at the current BPM. Rhythm B fits
   * its `b` pulses into that very same span. Rhythm A sounds as beats (downbeat
   * accented), rhythm B as ghost-style ticks; either pulse can be muted.
   */
  private schedulePoly(): void {
    const ctx = this.ctx!;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_SEC) {
      const s = this.getSettings();
      const a = s.polyrhythm.a;
      const b = s.polyrhythm.b;
      const cycleDur = (60 / s.bpm) * a;
      const key = `${a}:${b}`;

      // (Re)start a cycle when its events are exhausted or the counts changed
      if (this.polyCursor >= this.polyEvents.length || key !== this.polyKey) {
        if (key !== this.polyKey || Number.isNaN(this.polyCycleStart)) {
          this.polyEvents = polyEventsForCycle(a, b);
          this.polyKey = key;
          this.polyCycleStart = this.nextTime;
        } else {
          // Advance to the next cycle, preserving phase continuity
          this.polyCycleStart += cycleDur;
        }
        this.polyCursor = 0;
      }

      const ev = this.polyEvents[this.polyCursor];
      const time = this.polyCycleStart + ev.offset * cycleDur;
      // The very first scheduling pass may produce a stale start time
      if (time < this.nextTime - 1e-6) {
        this.polyCursor += 1;
        continue;
      }

      const muted =
        ev.rhythm === 'a'
          ? s.polyrhythm.mutedA.includes(ev.index)
          : s.polyrhythm.mutedB.includes(ev.index);
      if (!muted) {
        const kind: TickKind =
          ev.rhythm === 'a' ? (ev.index === 0 ? 'accent' : 'normal') : 'sub';
        const level =
          ev.rhythm === 'a' ? TICK_BEAT_LEVEL : CLICK_VOLUME_FACTOR[s.clickVolume];
        this.master!.gain.value = s.volume;
        scheduleSound(ctx, this.master!, s.sound, kind, time, level);
      }

      this.polyScheduled.push({
        time,
        rhythm: ev.rhythm,
        index: ev.index,
        cycleStart: this.polyCycleStart,
        cycleDur,
      });
      this.polyCursor += 1;
      this.nextTime = time + 1e-4;
    }
    // Trim pulses that already sounded so the queue does not grow
    const cutoff = ctx.currentTime - 1;
    while (this.polyScheduled.length > 1 && this.polyScheduled[0].time < cutoff) {
      this.polyScheduled.shift();
    }
  }
}
