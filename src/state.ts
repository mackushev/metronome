/** tick — the beat sounds like a regular subdivision tick */
export type BeatState = 'normal' | 'accent' | 'mute' | 'tick';
export type SoundName = 'click' | 'beep' | 'cowbell';
/** Loudness of subdivision clicks relative to beats */
export type ClickVolume = 'soft' | 'medium' | 'equal';

export interface TrainerStage {
  deltaSec: number;
  stepBpm: number;
  maxBpm: number | null;
}

export interface TrainerSettings {
  enabled: boolean;
  stages: TrainerStage[];
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
  /** Individually muted subdivision clicks, keys "beatIndex-subIndex" */
  mutedSubs: string[];
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

/** Gain multiplier for subdivision clicks per balance position */
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

export function subKey(beatIndex: number, subIndex: number): string {
  return `${beatIndex}-${subIndex}`;
}

export function isSubMuted(mutedSubs: string[], beatIndex: number, subIndex: number): boolean {
  return mutedSubs.includes(subKey(beatIndex, subIndex));
}

export function toggleSubMute(mutedSubs: string[], beatIndex: number, subIndex: number): string[] {
  const key = subKey(beatIndex, subIndex);
  return mutedSubs.includes(key) ? mutedSubs.filter((k) => k !== key) : [...mutedSubs, key];
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

const DEFAULT_STAGE: TrainerStage = { deltaSec: 30, stepBpm: 5, maxBpm: null };

export function defaultSettings(): Settings {
  return {
    bpm: 120,
    beats: 4,
    subdivision: 1,
    sound: 'click',
    volume: 0.8,
    clickVolume: 'soft',
    mutedSubs: [],
    beatStates: defaultBeatStates(4),
    trainer: { enabled: false, stages: [{ ...DEFAULT_STAGE }] },
  };
}

const STORAGE_KEY = 'metronome-settings-v1';

function parseTrainerStage(raw: unknown): TrainerStage {
  const s = raw as Record<string, unknown>;
  return {
    deltaSec: Math.max(2, Number(s?.deltaSec) || DEFAULT_STAGE.deltaSec),
    stepBpm: Math.max(1, Number(s?.stepBpm) || DEFAULT_STAGE.stepBpm),
    maxBpm: s?.maxBpm != null && s.maxBpm !== '' ? clampBpm(Number(s.maxBpm)) : null,
  };
}

export function loadSettings(): Settings {
  const fallback = defaultSettings();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<Settings> & { trainer?: any };
    const beats = Math.min(BEATS_MAX, Math.max(BEATS_MIN, Number(parsed.beats) || fallback.beats));
    const states = Array.isArray(parsed.beatStates) ? (parsed.beatStates as BeatState[]) : [];

    let trainer: TrainerSettings;
    const rawTrainer = parsed.trainer;
    if (rawTrainer && Array.isArray(rawTrainer.stages)) {
      const stages: TrainerStage[] = rawTrainer.stages.map(parseTrainerStage);
      trainer = {
        enabled: Boolean(rawTrainer.enabled),
        stages: stages.length > 0 ? stages : [{ ...DEFAULT_STAGE }],
      };
    } else if (rawTrainer) {
      // Migrate from old format { enabled, deltaSec, stepBpm, maxBpm }
      trainer = {
        enabled: Boolean(rawTrainer.enabled),
        stages: [parseTrainerStage(rawTrainer)],
      };
    } else {
      trainer = fallback.trainer;
    }

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
      mutedSubs: Array.isArray(parsed.mutedSubs)
        ? parsed.mutedSubs.filter((k): k is string => typeof k === 'string' && /^\d+-\d+$/.test(k))
        : [],
      beatStates: resizeBeatStates(
        states.map((s) => (s === 'accent' || s === 'mute' || s === 'tick' ? s : 'normal')),
        beats,
      ),
      trainer,
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
