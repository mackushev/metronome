import { CLICK_VOLUME_FACTOR, isSubMuted, type Settings, type SoundName } from '../state';
import { scheduleSound, type TickKind } from './sounds';

export interface Position {
  beatIndex: number;
  subIndex: number;
}

/**
 * One pulse in a polyrhythm cycle. `stream` is -1 for the base meter (the
 * metronome beats) or 0..n-1 for a limb voice. `offset` is its position 0..1
 * around the cycle.
 */
export interface PolyEvent {
  stream: number;
  index: number;
  offset: number;
}

/** The base meter stream id (the audible "main rhythm" ticks). */
export const BASE_STREAM = -1;

/**
 * All pulses of one polyrhythm cycle, sorted by their position around the cycle.
 * The base meter fires `baseTicks` evenly spaced ticks (beats × subdivision);
 * each voice fires its own pulse count in the very same span. The shared downbeat
 * (offset 0) yields one event per stream; the base meter sorts first so the
 * downbeat reads as a beat.
 */
export function polyEventsForCycle(baseTicks: number, voicePulses: number[]): PolyEvent[] {
  const events: PolyEvent[] = [];
  for (let i = 0; i < baseTicks; i++)
    events.push({ stream: BASE_STREAM, index: i, offset: i / baseTicks });
  voicePulses.forEach((pulses, v) => {
    for (let j = 0; j < pulses; j++) events.push({ stream: v, index: j, offset: j / pulses });
  });
  // Sort by time; on a tie order by stream so the base meter (-1) comes first.
  events.sort((x, y) => x.offset - y.offset || x.stream - y.stream);
  return events;
}

/** UI read-out for the polyrhythm circle: needle phase and the last fired pulses. */
export interface PolyReadout {
  /** 0..1 position around the circle for the sweeping needle */
  phase: number;
  /** Index of the most recently sounded base-meter tick, or -1 */
  base: number;
  /** Index of the most recently sounded pulse in each voice, or -1 */
  voices: number[];
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
  stream: number;
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
  onBeatScheduled: ((audioTime: number, beatIndex: number) => void) | null = null;

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

  /** One-off click outside the main loop (for sound/volume/balance preview).
      Pass `sound` to preview a specific timbre (e.g. a polyrhythm voice). */
  preview(kind: TickKind = 'normal', sound?: SoundName): void {
    const ctx = this.ensureContext();
    if (!ctx) return;
    void ctx.resume().catch(() => {});
    const s = this.getSettings();
    this.master!.gain.value = s.volume;
    scheduleSound(ctx, this.master!, sound ?? s.sound, kind, ctx.currentTime + 0.02, CLICK_VOLUME_FACTOR[s.clickVolume]);
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
    let base = -1;
    const voiceSettings = this.getSettings().polyrhythm.voices;
    const voices = voiceSettings.map(() => -1);
    for (const ev of this.polyScheduled) {
      if (ev.time <= now) {
        current = ev;
        if (ev.stream === BASE_STREAM) base = ev.index;
        // Disabled voices stay dark (they make no sound, so no highlight)
        else if (ev.stream < voices.length && voiceSettings[ev.stream]?.enabled) {
          voices[ev.stream] = ev.index;
        }
      } else break;
    }
    if (current && current.cycleDur > 0) {
      phase = ((now - current.cycleStart) / current.cycleDur) % 1;
      if (phase < 0) phase += 1;
    }
    return { phase, base, voices };
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
        this.onBeatScheduled?.(this.nextTime, this.pos.beatIndex);
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
   * Polyrhythm loop. The base meter defines one cycle: `beats × subdivision`
   * ticks across one bar at the current BPM, sounding exactly like the metronome
   * (beats, accents, ghost subdivision ticks, per-tick mutes). On top of it each
   * limb voice spreads its own pulse count across the very same bar, with its own
   * sound and volume; a voice can be disabled, muted per pulse, or accented on 1.
   */
  private schedulePoly(): void {
    const ctx = this.ctx!;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD_SEC) {
      const s = this.getSettings();
      const beats = s.beats;
      const sub = s.subdivision;
      const baseTicks = beats * sub;
      const voices = s.polyrhythm.voices;
      const cycleDur = (60 / s.bpm) * beats;
      const key = `${beats}:${sub}:${voices.map((v) => v.pulses).join(',')}`;

      // (Re)start a cycle when its events are exhausted or the counts changed
      if (this.polyCursor >= this.polyEvents.length || key !== this.polyKey) {
        if (key !== this.polyKey || Number.isNaN(this.polyCycleStart)) {
          this.polyEvents = polyEventsForCycle(baseTicks, voices.map((v) => v.pulses));
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

      this.master!.gain.value = s.volume;
      if (ev.stream === BASE_STREAM) {
        // The base meter: identical to the metronome (beats + ghost subdivisions)
        const pos = { beatIndex: Math.floor(ev.index / sub), subIndex: ev.index % sub };
        const kind = tickKind(s, pos);
        if (kind !== 'silent') {
          const level = pos.subIndex === 0 ? TICK_BEAT_LEVEL : CLICK_VOLUME_FACTOR[s.clickVolume];
          scheduleSound(ctx, this.master!, s.sound, kind, time, level);
        }
      } else {
        const voice = voices[ev.stream];
        if (voice && voice.enabled && !voice.muted.includes(ev.index)) {
          const kind: TickKind = ev.index === 0 ? 'accent' : 'normal';
          scheduleSound(ctx, this.master!, voice.sound, kind, time, 0.45, voice.volume);
        }
      }

      this.polyScheduled.push({
        time,
        stream: ev.stream,
        index: ev.index,
        cycleStart: this.polyCycleStart,
        cycleDur,
      });
      this.polyCursor += 1;
      // Peek at the next event: if it fires at the same instant (coincident
      // pulse, e.g. both rhythms sharing the downbeat), keep nextTime unchanged
      // so the while-loop processes it without skipping.
      const peek = this.polyCursor < this.polyEvents.length ? this.polyEvents[this.polyCursor] : null;
      if (!peek || peek.offset !== ev.offset) {
        this.nextTime = time + 1e-4;
      }
    }
    // Trim pulses that already sounded so the queue does not grow
    const cutoff = ctx.currentTime - 1;
    while (this.polyScheduled.length > 1 && this.polyScheduled[0].time < cutoff) {
      this.polyScheduled.shift();
    }
  }
}
