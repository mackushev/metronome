import {
  BEATS_MAX,
  BEATS_MIN,
  BPM_MAX,
  BPM_MIN,
  SOUNDS,
  SUBDIVISIONS,
  clampBpm,
  resizeBeatStates,
  type ClickVolume,
  type SoundName,
  type Store,
} from '../state';

/** Balance positions: beat dot + click dot of growing size */
const CLICK_VOLUMES: { value: ClickVolume; title: string }[] = [
  { value: 'soft', title: 'Clicks quiet' },
  { value: 'medium', title: 'Clicks medium' },
  { value: 'equal', title: 'Clicks as loud as beats' },
];

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

export interface ControlsCallbacks {
  /** BPM changed by the user (not by the trainer) */
  onUserBpmChange: (bpm: number) => void;
  onSoundPreview: (kind?: 'normal' | 'sub') => void;
}

/** Binds the static settings panel markup to the store */
export function bindControls(store: Store, callbacks: ControlsCallbacks): void {
  const slider = byId<HTMLInputElement>('bpm-slider');
  const beatsValue = byId<HTMLSpanElement>('beats-value');
  const subdivSeg = byId<HTMLDivElement>('subdiv-seg');
  const soundSeg = byId<HTMLDivElement>('sound-seg');
  const balanceSeg = byId<HTMLDivElement>('balance-seg');
  const volumeSlider = byId<HTMLInputElement>('volume-slider');
  const trainerEnabled = byId<HTMLInputElement>('trainer-enabled');
  const trainerDelta = byId<HTMLInputElement>('trainer-delta');
  const trainerStep = byId<HTMLInputElement>('trainer-step');
  const trainerMax = byId<HTMLInputElement>('trainer-max');
  const trainerFields = byId<HTMLDivElement>('trainer-fields');

  // --- Tempo ---
  slider.min = String(BPM_MIN);
  slider.max = String(BPM_MAX);
  slider.addEventListener('input', () => callbacks.onUserBpmChange(clampBpm(Number(slider.value))));
  for (const btn of document.querySelectorAll<HTMLButtonElement>('[data-bpm-delta]')) {
    btn.addEventListener('click', () => {
      callbacks.onUserBpmChange(clampBpm(store.get().bpm + Number(btn.dataset.bpmDelta)));
    });
  }

  // --- Beats per measure ---
  const changeBeats = (delta: number) => {
    const s = store.get();
    const beats = Math.min(BEATS_MAX, Math.max(BEATS_MIN, s.beats + delta));
    if (beats !== s.beats) {
      store.update({ beats, beatStates: resizeBeatStates(s.beatStates, beats) });
    }
  };
  byId<HTMLButtonElement>('beats-dec').addEventListener('click', () => changeBeats(-1));
  byId<HTMLButtonElement>('beats-inc').addEventListener('click', () => changeBeats(1));

  // --- Clicks per beat ---
  for (const value of SUBDIVISIONS) {
    const btn = document.createElement('button');
    btn.className = 'btn seg-btn';
    btn.textContent = String(value);
    btn.dataset.value = String(value);
    btn.addEventListener('click', () => store.update({ subdivision: value }));
    subdivSeg.append(btn);
  }

  // --- Sound ---
  for (const { name, label } of SOUNDS) {
    const btn = document.createElement('button');
    btn.className = 'btn seg-btn';
    btn.textContent = label;
    btn.dataset.value = name;
    btn.addEventListener('click', () => {
      store.update({ sound: name });
      callbacks.onSoundPreview();
    });
    soundSeg.append(btn);
  }

  // --- Clicks vs beats balance ---
  for (const { value, title } of CLICK_VOLUMES) {
    const btn = document.createElement('button');
    btn.className = 'btn seg-btn balance-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.dataset.value = value;
    // Pictogram: a beat dot and a click dot whose size matches the position
    btn.innerHTML = `<i class="bal-dot bal-beat"></i><i class="bal-dot bal-click bal-${value}"></i>`;
    btn.addEventListener('click', () => {
      store.update({ clickVolume: value });
      // Preview the subdivision click so the chosen level is audible
      callbacks.onSoundPreview('sub');
    });
    balanceSeg.append(btn);
  }

  // --- Volume ---
  volumeSlider.addEventListener('input', () => {
    store.update({ volume: Number(volumeSlider.value) / 100 });
  });
  // Preview the click on slider release so the level can be judged without starting
  volumeSlider.addEventListener('change', () => callbacks.onSoundPreview());

  // --- Speed trainer ---
  let trainerApplyTimer: number | undefined;
  const updateTrainer = () => {
    window.clearTimeout(trainerApplyTimer);
    const prev = store.get().trainer;
    const maxRaw = trainerMax.value.trim();
    store.update({
      trainer: {
        enabled: trainerEnabled.checked,
        deltaSec: Math.max(2, Number(trainerDelta.value) || prev.deltaSec),
        stepBpm: Math.max(1, Number(trainerStep.value) || prev.stepBpm),
        maxBpm: maxRaw === '' ? null : clampBpm(Number(maxRaw)),
      },
    });
  };
  trainerEnabled.addEventListener('change', updateTrainer);
  for (const input of [trainerDelta, trainerStep, trainerMax]) {
    // 'change' fires only on blur/Enter — also auto-apply after a typing pause
    input.addEventListener('change', updateTrainer);
    input.addEventListener('input', () => {
      window.clearTimeout(trainerApplyTimer);
      trainerApplyTimer = window.setTimeout(updateTrainer, 2000);
    });
  }

  // --- Reflect state back into the controls ---
  const sync = () => {
    const s = store.get();
    slider.value = String(s.bpm);
    beatsValue.textContent = String(s.beats);
    for (const btn of subdivSeg.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      btn.classList.toggle('selected', Number(btn.dataset.value) === s.subdivision);
    }
    for (const btn of soundSeg.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      btn.classList.toggle('selected', (btn.dataset.value as SoundName) === s.sound);
    }
    for (const btn of balanceSeg.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      btn.classList.toggle('selected', (btn.dataset.value as ClickVolume) === s.clickVolume);
    }
    volumeSlider.value = String(Math.round(s.volume * 100));
    trainerEnabled.checked = s.trainer.enabled;
    trainerFields.classList.toggle('disabled', !s.trainer.enabled);
    if (document.activeElement !== trainerDelta) trainerDelta.value = String(s.trainer.deltaSec);
    if (document.activeElement !== trainerStep) trainerStep.value = String(s.trainer.stepBpm);
    if (document.activeElement !== trainerMax) {
      trainerMax.value = s.trainer.maxBpm === null ? '' : String(s.trainer.maxBpm);
    }
  };
  store.subscribe(sync);
  sync();
}
