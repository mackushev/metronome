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
  /** Inharmonic partials as ratios of the base frequency (metallic timbre) */
  partials?: number[];
  /** Bandpass filter center as a ratio of the base frequency — removes the buzz */
  bandpassRatio?: number;
  /** Stick-strike noise burst and a two-stage "clank" envelope */
  strike?: boolean;
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
  // Modal frequencies of a real cowbell are inharmonic (≈1 : 1.48 : 2.19 : 2.83);
  // the bandpass and the strike transient hide the synthetic oscillator buzz
  cowbell: {
    type: 'square',
    freq: { accent: 660, normal: 540, sub: 270 },
    gain: { accent: 1.1, normal: 0.8 },
    decay: 0.22,
    partials: [1, 1.48, 2.19, 2.83],
    bandpassRatio: 1.6,
    strike: true,
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
  if (voice.strike) {
    // "Clank": a sharp initial drop, then a short ring fading out
    gain.gain.exponentialRampToValueAtTime(peak * 0.3, time + 0.015);
  }
  gain.gain.exponentialRampToValueAtTime(0.001, time + decay);
  gain.connect(dest);

  // Oscillators feed the gain through an optional bandpass that shapes the timbre
  let oscTarget: AudioNode = gain;
  if (voice.bandpassRatio) {
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq * voice.bandpassRatio;
    bp.Q.value = 1.2;
    bp.connect(gain);
    oscTarget = bp;
  }

  const ratios = voice.partials ?? [1];
  for (const ratio of ratios) {
    const osc = ctx.createOscillator();
    osc.type = voice.type;
    osc.frequency.setValueAtTime(freq * ratio, time);
    if (voice.pitchDrop) {
      osc.frequency.exponentialRampToValueAtTime(freq * ratio * voice.pitchDrop, time + decay);
    }
    osc.connect(oscTarget);
    osc.start(time);
    osc.stop(time + decay + 0.01);
  }

  if (voice.strike) {
    // A short noise burst — the stick hitting the metal
    const len = Math.max(1, Math.floor(ctx.sampleRate * 0.006));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(peak * 0.4, time);
    noise.connect(noiseGain).connect(dest);
    noise.start(time);
  }
}
