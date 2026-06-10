import { CLICK_VOLUME_FACTOR, type Settings } from '../state';
import { scheduleSound, type TickKind } from './sounds';

export interface Position {
  beatIndex: number;
  subIndex: number;
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
  if (pos.subIndex !== 0) return 'sub';
  const state = settings.beatStates[pos.beatIndex] ?? 'normal';
  if (state === 'mute') return 'silent';
  if (state === 'tick') return 'sub';
  return state === 'accent' ? 'accent' : 'normal';
}

interface ScheduledTick extends Position {
  time: number;
  intervalSec: number;
}

const LOOKAHEAD_SEC = 0.12;
const TIMER_MS = 25;

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

  /** Called when each beat is scheduled (used by the speed trainer) */
  onBeatScheduled: ((audioTime: number) => void) | null = null;

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

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.getSettings().volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  start(): void {
    if (this.running) return;
    const ctx = this.ensureContext();
    this.pos = { beatIndex: 0, subIndex: 0 };
    this.scheduled = [];
    // The context clock may stand still until resume() completes — wait for it,
    // otherwise a burst of catch-up clicks piles up
    this.nextTime = Number.POSITIVE_INFINITY;
    this.timer = window.setInterval(() => this.schedule(), TIMER_MS);
    void ctx.resume().then(() => {
      if (!this.running) return;
      this.nextTime = this.ctx!.currentTime + 0.08;
      this.schedule();
    });
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
    void ctx.resume();
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

  private schedule(): void {
    if (!this.running) return;
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
        scheduleSound(ctx, this.master!, s.sound, kind, this.nextTime, CLICK_VOLUME_FACTOR[s.clickVolume]);
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
}
