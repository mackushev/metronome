/** tick — the beat sounds like a regular subdivision tick */
export type BeatState = 'normal' | 'accent' | 'mute' | 'tick';
export type SoundName = 'click' | 'beep' | 'cowbell';
/** Loudness of subdivision clicks relative to beats */
export type ClickVolume = 'soft' | 'medium' | 'equal';

export interface TrainerSettings {
  enabled: boolean;
  /** How often to raise the tempo, seconds */
  deltaSec: number;
  /** How many BPM to add per step */
  stepBpm: number;
  /** Tempo ceiling; null — no limit */
  maxBpm: number | null;
}

export interface Settings {
  bpm: number;
  /** Number of beats per measure */
  beats: number;
  /** Clicks per beat */
  subdivision: number;
  sound: SoundName;
  /** Volume 0..1 */
  volume: number;
  /** Subdivision clicks vs beats loudness ratio */
  clickVolume: ClickVolume;
  /** Subdivision (ghost) clicks muted entirely — toggled by tapping a sub dot */
  subMuted: boolean;
  /** State of each beat in the measure, length = beats */
  beatStates: BeatState[];
  trainer: TrainerSettings;
}

export const BPM_MIN = 20;
export const BPM_MAX = 300;
export const BEATS_MIN = 1;
export const BEATS_MAX = 8;
export const SUBDIVISIONS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export const SOUNDS: { name: SoundName; label: string }[] = [
  { name: 'click', label: 'Click' },
  { name: 'beep', label: 'Beep' },
  { name: 'cowbell', label: 'Cowbell' },
];

/** Gain multiplier for subdivision clicks per balance position;
    soft = barely audible ghost notes */
export const CLICK_VOLUME_FACTOR: Record<ClickVolume, number> = {
  soft: 0.18,
  medium: 0.6,
  equal: 1,
};

export function clampBpm(value: number): number {
  return Math.min(BPM_MAX, Math.max(BPM_MIN, Math.round(value)));
}

export function defaultBeatStates(beats: number): BeatState[] {
  return Array.from({ length: beats }, (_, i) => (i === 0 ? 'accent' : 'normal'));
}

/** When the number of beats changes, keep already configured accents/mutes */
export function resizeBeatStates(prev: BeatState[], beats: number): BeatState[] {
  return Array.from({ length: beats }, (_, i) => prev[i] ?? 'normal');
}

export function cycleBeatState(state: BeatState): BeatState {
  switch (state) {
    case 'normal':
      return 'accent';
    case 'accent':
      return 'tick';
    case 'tick':
      return 'mute';
    case 'mute':
      return 'normal';
  }
}

export function defaultSettings(): Settings {
  return {
    bpm: 120,
    beats: 4,
    subdivision: 1,
    sound: 'click',
    volume: 0.8,
    clickVolume: 'soft',
    subMuted: false,
    beatStates: defaultBeatStates(4),
    trainer: { enabled: false, deltaSec: 30, stepBpm: 5, maxBpm: null },
  };
}

const STORAGE_KEY = 'metronome-settings-v1';

export function loadSettings(): Settings {
  const fallback = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const beats = Math.min(BEATS_MAX, Math.max(BEATS_MIN, Number(parsed.beats) || fallback.beats));
    const states = Array.isArray(parsed.beatStates) ? (parsed.beatStates as BeatState[]) : [];
    return {
      bpm: clampBpm(Number(parsed.bpm) || fallback.bpm),
      beats,
      subdivision: (SUBDIVISIONS as readonly number[]).includes(Number(parsed.subdivision))
        ? Number(parsed.subdivision)
        : fallback.subdivision,
      sound: SOUNDS.some((s) => s.name === parsed.sound) ? (parsed.sound as SoundName) : fallback.sound,
      volume:
        typeof parsed.volume === 'number' ? Math.min(1, Math.max(0, parsed.volume)) : fallback.volume,
      clickVolume:
        parsed.clickVolume && parsed.clickVolume in CLICK_VOLUME_FACTOR
          ? parsed.clickVolume
          : fallback.clickVolume,
      subMuted: Boolean(parsed.subMuted),
      beatStates: resizeBeatStates(
        states.map((s) => (s === 'accent' || s === 'mute' || s === 'tick' ? s : 'normal')),
        beats,
      ),
      trainer: { ...fallback.trainer, ...(parsed.trainer ?? {}), enabled: Boolean(parsed.trainer?.enabled) },
    };
  } catch {
    return fallback;
  }
}

export type Listener = (settings: Settings) => void;

export class Store {
  private listeners = new Set<Listener>();

  private settings: Settings;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  get(): Settings {
    return this.settings;
  }

  update(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.trainer) this.settings.trainer = { ...patch.trainer };
    this.persist();
    for (const fn of this.listeners) fn(this.settings);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // private browsing mode — keep working without persistence
    }
  }
}
