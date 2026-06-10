import type { SoundName } from '../state';

export type TickKind = 'accent' | 'normal' | 'sub';

interface Voice {
  type: OscillatorType;
  freq: Record<TickKind, number>;
  gain: Record<TickKind, number>;
  /** Decay duration, seconds */
  decay: number;
  /** How far the frequency drops by the end of the click (woodblock effect) */
  pitchDrop?: number;
}

const VOICES: Record<SoundName, Voice> = {
  click: {
    type: 'square',
    freq: { accent: 1800, normal: 1150, sub: 880 },
    gain: { accent: 0.9, normal: 0.6, sub: 0.28 },
    decay: 0.03,
  },
  beep: {
    type: 'sine',
    freq: { accent: 1320, normal: 880, sub: 660 },
    gain: { accent: 0.9, normal: 0.65, sub: 0.3 },
    decay: 0.07,
  },
  wood: {
    type: 'triangle',
    freq: { accent: 1100, normal: 760, sub: 580 },
    gain: { accent: 1.0, normal: 0.7, sub: 0.32 },
    decay: 0.09,
    pitchDrop: 0.45,
  },
};

/** Schedules a single metronome click at the exact audio time `time` */
export function scheduleSound(
  ctx: AudioContext,
  dest: AudioNode,
  sound: SoundName,
  kind: TickKind,
  time: number,
): void {
  const voice = VOICES[sound];
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = voice.type;
  osc.frequency.setValueAtTime(voice.freq[kind], time);
  if (voice.pitchDrop) {
    osc.frequency.exponentialRampToValueAtTime(voice.freq[kind] * voice.pitchDrop, time + voice.decay);
  }

  gain.gain.setValueAtTime(voice.gain[kind], time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + voice.decay);

  osc.connect(gain).connect(dest);
  osc.start(time);
  osc.stop(time + voice.decay + 0.01);
}
