import type { SoundName } from '../state';

export type TickKind = 'accent' | 'normal' | 'sub';

interface Voice {
  type: OscillatorType;
  freq: Record<TickKind, number>;
  /** Peak gain for beats; subdivision gain = normal × subLevel */
  gain: Record<'accent' | 'normal', number>;
  /** Decay duration, seconds */
  decay: number;
  /** How far the frequency drops by the end of the click */
  pitchDrop?: number;
  /** A second detuned oscillator at freq × ratio (the classic cowbell recipe) */
  secondRatio?: number;
}

// Subdivision clicks sit roughly an octave below the beat and decay faster,
// so beats and clicks are clearly distinguishable by ear
const VOICES: Record<SoundName, Voice> = {
  click: {
    type: 'square',
    freq: { accent: 1800, normal: 1150, sub: 560 },
    gain: { accent: 0.9, normal: 0.6 },
    decay: 0.03,
  },
  beep: {
    type: 'sine',
    freq: { accent: 1320, normal: 880, sub: 440 },
    gain: { accent: 0.9, normal: 0.65 },
    decay: 0.07,
  },
  cowbell: {
    type: 'square',
    freq: { accent: 660, normal: 540, sub: 270 },
    gain: { accent: 0.7, normal: 0.5 },
    decay: 0.13,
    secondRatio: 1.48,
  },
};

/** Subdivision clicks decay this much faster than beats */
const SUB_DECAY_FACTOR = 0.55;

/**
 * Schedules a single metronome click at the exact audio time `time`.
 * `subLevel` scales subdivision clicks relative to a normal beat (0..1).
 */
export function scheduleSound(
  ctx: AudioContext,
  dest: AudioNode,
  sound: SoundName,
  kind: TickKind,
  time: number,
  subLevel = 0.45,
): void {
  const voice = VOICES[sound];
  const peak = kind === 'sub' ? voice.gain.normal * subLevel : voice.gain[kind];
  const freq = voice.freq[kind];
  const decay = kind === 'sub' ? voice.decay * SUB_DECAY_FACTOR : voice.decay;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(peak, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  gain.connect(dest);

  const ratios = voice.secondRatio ? [1, voice.secondRatio] : [1];
  for (const ratio of ratios) {
    const osc = ctx.createOscillator();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(freq * ratio, time);
    if (voice.pitchDrop) {
      osc.frequency.exponentialRampToValueAtTime(freq * ratio * voice.pitchDrop, time + decay);
    }
    osc.connect(gain);
    osc.start(time);
    osc.stop(time + decay + 0.01);
  }
}
