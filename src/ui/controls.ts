import {
  BPM_MIN,
  BPM_MAX,
  POLY_PULSES_MIN,
  POLY_PULSES_MAX,
  SOUNDS,
  VOICE_META,
  clampBpm,
  type ClickVolume,
  type PolyVoice,
  type Settings,
  type SoundName,
  type Store,
  type TrainerSettings,
  type TrainerStage,
} from '../state';
import { voiceTooFast } from '../audio/engine';

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
  onSoundPreview: (kind?: 'normal' | 'sub') => void;
  /** Preview a specific voice's sound (when its sound/volume is changed) */
  onVoicePreview: (sound: SoundName) => void;
}

/** Bind a button that changes a numeric value; also supports up/down drag with lower sensitivity. */
export function bindDragBtn(
  btn: HTMLButtonElement,
  clickDelta: number,
  getVal: () => number,
  setVal: (v: number) => void,
  min: number,
  max: number,
): void {
  const DRAG_THRESHOLD = 8; // px before drag mode activates
  const SENSITIVITY = 0.3; // units per pixel
  let drag: { startY: number; startVal: number } | null = null;

  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    drag = { startY: e.clientY, startVal: getVal() };
    btn.setPointerCapture?.(e.pointerId);
  });

  btn.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dy = drag.startY - e.clientY; // positive = upward
    if (Math.abs(dy) >= DRAG_THRESHOLD) {
      setVal(Math.max(min, Math.min(max, Math.round(drag.startVal + dy * SENSITIVITY))));
    }
  });

  btn.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const moved = Math.abs(drag.startY - e.clientY) >= DRAG_THRESHOLD;
    if (!moved) setVal(Math.max(min, Math.min(max, getVal() + clickDelta)));
    drag = null;
  });

  btn.addEventListener('pointercancel', () => {
    drag = null;
  });
}

/** Attach a mouse-wheel handler to a row for non-nullable integer values. */
function bindWheel(
  el: HTMLElement,
  step: number,
  getVal: () => number,
  setVal: (v: number) => void,
  min: number,
  max: number,
): void {
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      setVal(Math.max(min, Math.min(max, getVal() + dir * step)));
    },
    { passive: false },
  );
}

/** Attach a mouse-wheel handler for a nullable BPM value (null = ∞). */
function bindWheelNullable(
  el: HTMLElement,
  step: number,
  getVal: () => number | null,
  setVal: (v: number | null) => void,
  getCurrentBpm: () => number,
): void {
  el.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const cur = getVal();
      if (cur === null) {
        if (dir > 0) setVal(clampBpm(getCurrentBpm() + step));
        // scroll down when unlimited: stay unlimited
      } else {
        const next = cur + dir * step;
        if (next < BPM_MIN) setVal(null); // scrolled all the way down → clear
        else setVal(Math.min(BPM_MAX, next));
      }
    },
    { passive: false },
  );
}

/** Bind all controls for a single trainer stage. */
function bindStage(
  index: number,
  store: Store,
  getStage: () => TrainerStage,
  setStage: (patch: Partial<TrainerStage>) => void,
): void {
  const p = `t${index}`;

  // every — drag buttons ±15s
  bindDragBtn(
    byId(`${p}-delta-dec`),
    -15,
    () => getStage().deltaSec,
    (v) => setStage({ deltaSec: v }),
    2,
    600,
  );
  bindDragBtn(
    byId(`${p}-delta-inc`),
    +15,
    () => getStage().deltaSec,
    (v) => setStage({ deltaSec: v }),
    2,
    600,
  );

  // add BPM — ±1, scroll
  byId(`${p}-step-dec`).addEventListener('click', () =>
    setStage({ stepBpm: Math.max(1, getStage().stepBpm - 1) }),
  );
  byId(`${p}-step-inc`).addEventListener('click', () =>
    setStage({ stepBpm: Math.min(60, getStage().stepBpm + 1) }),
  );
  bindWheel(
    byId(`${p}-step-row`),
    1,
    () => getStage().stepBpm,
    (v) => setStage({ stepBpm: v }),
    1,
    60,
  );

  // up to — ±20, scroll, clear button
  byId(`${p}-max-dec`).addEventListener('click', () => {
    const cur = getStage().maxBpm;
    if (cur === null) return;
    setStage({ maxBpm: cur - 20 < BPM_MIN ? null : cur - 20 });
  });
  byId(`${p}-max-inc`).addEventListener('click', () => {
    const cur = getStage().maxBpm;
    setStage({ maxBpm: cur === null ? clampBpm(store.get().bpm + 20) : Math.min(BPM_MAX, cur + 20) });
  });
  byId(`${p}-max-clear`).addEventListener('click', () => setStage({ maxBpm: null }));
  bindWheelNullable(
    byId(`${p}-max-row`),
    20,
    () => getStage().maxBpm,
    (v) => setStage({ maxBpm: v }),
    () => store.get().bpm,
  );
}

/** Update the displayed values for a single trainer stage. */
function syncStage(index: number, stage: TrainerStage): void {
  const p = `t${index}`;
  byId(`${p}-delta-num`).textContent = String(stage.deltaSec);
  byId(`${p}-step-num`).textContent = String(stage.stepBpm);
  byId(`${p}-max-num`).textContent = stage.maxBpm === null ? '∞' : String(stage.maxBpm);
  const clearBtn = byId(`${p}-max-clear`);
  clearBtn.hidden = stage.maxBpm === null;
}

/** Bind the complete Speed Trainer block. */
function bindTrainer(store: Store): void {
  const trainerToggle = byId<HTMLDivElement>('trainer-toggle');
  const trainerPanel = byId<HTMLDivElement>('trainer-panel');
  const addStageBtn = byId<HTMLButtonElement>('trainer-add-stage');
  const stage1El = byId<HTMLDivElement>('trainer-stage-1');
  const removeStageBtn = byId<HTMLButtonElement>('trainer-remove-stage');

  const getT = (): TrainerSettings => store.get().trainer;
  const getStage = (i: number): TrainerStage =>
    store.get().trainer.stages[i] ?? { deltaSec: 30, stepBpm: 5, maxBpm: null };

  const setStage = (i: number, patch: Partial<TrainerStage>): void => {
    const t = getT();
    const stages = t.stages.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    store.update({ trainer: { ...t, stages } });
  };

  // Click the header to toggle enabled state
  trainerToggle.addEventListener('click', () =>
    store.update({ trainer: { ...getT(), enabled: !getT().enabled } }),
  );

  bindStage(0, store, () => getStage(0), (p) => setStage(0, p));
  bindStage(1, store, () => getStage(1), (p) => setStage(1, p));

  addStageBtn.addEventListener('click', () => {
    const t = getT();
    const s0 = t.stages[0];
    store.update({
      trainer: {
        ...t,
        stages: [...t.stages, { deltaSec: s0.deltaSec, stepBpm: s0.stepBpm, maxBpm: null }],
      },
    });
  });

  removeStageBtn.addEventListener('click', () => {
    const t = getT();
    store.update({ trainer: { ...t, stages: [t.stages[0]] } });
  });

  const syncTrainer = (s: ReturnType<Store['get']>) => {
    const t = s.trainer;
    // Collapse/expand the panel based on enabled state
    trainerPanel.classList.toggle('collapsed', !t.enabled);

    const stage0 = t.stages[0];
    syncStage(0, stage0);

    const hasMax0 = stage0.maxBpm !== null;
    const hasStage1 = t.stages.length >= 2;

    addStageBtn.hidden = !hasMax0 || hasStage1;
    stage1El.hidden = !hasStage1;

    if (hasStage1) syncStage(1, t.stages[1]);
  };

  store.subscribe(syncTrainer);
  syncTrainer(store.get());
}

/** Build a row of sound buttons that update a specific field via onSelect */
function buildSoundButtons(
  container: HTMLElement,
  onSelect: (name: SoundName) => void,
  sounds: { name: SoundName; label: string }[] = SOUNDS,
): void {
  for (const { name, label } of sounds) {
    const btn = document.createElement('button');
    btn.className = 'btn seg-btn';
    btn.textContent = label;
    btn.dataset.value = name;
    btn.addEventListener('click', () => onSelect(name));
    container.append(btn);
  }
}

/**
 * Reflect the beat-sound segment (Click / Beep / Voice). "voice" is a pseudo
 * value: selecting it flips `voiceCount` on; Click/Beep flip it off. The Voice
 * button also warns (`.warn`) when the tempo would smear the count into a drone.
 */
function syncSoundSeg(container: HTMLElement, s: Settings): void {
  for (const btn of container.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
    const value = btn.dataset.value!;
    if (value === 'voice') {
      const warn = s.voiceCount && voiceTooFast(s.bpm, s.subdivision);
      btn.classList.toggle('selected', s.voiceCount);
      btn.classList.toggle('warn', warn);
      btn.title = warn
        ? 'Too fast — the spoken count blurs into a drone at this tempo/subdivision'
        : 'Count out loud (one e and a…) — subdivisions 1–4';
    } else {
      btn.classList.toggle('selected', !s.voiceCount && value === s.sound);
    }
  }
}

/** Update one voice in the store, dropping muted pulses outside a shrunk count. */
function updateVoice(store: Store, index: number, patch: Partial<PolyVoice>): void {
  const voices = store.get().polyrhythm.voices.map((v, i) => {
    if (i !== index) return v;
    const next = { ...v, ...patch };
    if (patch.pulses !== undefined) next.muted = next.muted.filter((m) => m < next.pulses);
    return next;
  });
  store.update({ polyrhythm: { voices } });
}

/** Build the per-voice polyrhythm panel: sound select, pulse stepper, volume. */
function bindPolyVoices(store: Store, callbacks: ControlsCallbacks): void {
  const container = byId<HTMLDivElement>('poly-voices');
  const rows = store.get().polyrhythm.voices.map((_, i) => {
    const meta = VOICE_META[i];
    const row = document.createElement('div');
    row.className = 'poly-voice';

    // Tap the colored dot to enable/disable the whole voice
    const dot = document.createElement('button');
    dot.className = 'poly-voice-dot';
    dot.style.setProperty('--voice-color', meta.color);
    dot.setAttribute('aria-label', `${meta.label} on/off`);
    dot.addEventListener('click', () =>
      updateVoice(store, i, { enabled: !store.get().polyrhythm.voices[i].enabled }),
    );
    const label = document.createElement('span');
    label.className = 'poly-voice-label';
    label.textContent = meta.label;

    const sound = document.createElement('select');
    sound.className = 'poly-voice-sound';
    for (const s of SOUNDS) {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.label;
      sound.append(opt);
    }
    sound.addEventListener('change', () => {
      const name = sound.value as SoundName;
      updateVoice(store, i, { sound: name });
      callbacks.onVoicePreview(name);
    });

    const pulses = document.createElement('div');
    pulses.className = 'poly-voice-pulses';
    const dec = document.createElement('button');
    dec.className = 'btn trainer-btn';
    dec.textContent = '−';
    const num = document.createElement('span');
    num.className = 'trainer-num';
    const inc = document.createElement('button');
    inc.className = 'btn trainer-btn';
    inc.textContent = '+';
    const setPulses = (n: number): void =>
      updateVoice(store, i, { pulses: Math.min(POLY_PULSES_MAX, Math.max(POLY_PULSES_MIN, n)) });
    dec.addEventListener('click', () => setPulses(store.get().polyrhythm.voices[i].pulses - 1));
    inc.addEventListener('click', () => setPulses(store.get().polyrhythm.voices[i].pulses + 1));
    pulses.append(dec, num, inc);

    const vol = document.createElement('input');
    vol.type = 'range';
    vol.className = 'poly-voice-vol';
    vol.min = '0';
    vol.max = '100';
    vol.step = '1';
    vol.setAttribute('aria-label', `${meta.label} volume`);
    vol.addEventListener('input', () => updateVoice(store, i, { volume: Number(vol.value) / 100 }));
    vol.addEventListener('change', () => callbacks.onVoicePreview(store.get().polyrhythm.voices[i].sound));

    row.append(dot, label, sound, pulses, vol);
    container.append(row);
    return { row, dot, sound, num, vol };
  });

  const sync = (s: ReturnType<Store['get']>): void => {
    s.polyrhythm.voices.forEach((voice, i) => {
      rows[i].sound.value = voice.sound;
      rows[i].num.textContent = String(voice.pulses);
      rows[i].vol.value = String(Math.round(voice.volume * 100));
      rows[i].row.classList.toggle('disabled', !voice.enabled);
      rows[i].dot.classList.toggle('off', !voice.enabled);
    });
  };
  store.subscribe(sync);
  sync(store.get());
}

/** Binds the static settings panel markup to the store */
export function bindControls(store: Store, callbacks: ControlsCallbacks): void {
  const soundSeg = byId<HTMLDivElement>('sound-seg');
  const balanceSeg = byId<HTMLDivElement>('balance-seg');
  const volumeSlider = byId<HTMLInputElement>('volume-slider');

  // --- Sound (main beat; also the polyrhythm base ticks) ---
  // Two click-style timbres plus a spoken-count option; drum sounds live in the
  // voice selects. Picking Click/Beep turns voice counting off; picking Voice
  // turns it on (the click timbre stays as the fallback for subdivisions 5–8).
  const beatSounds = SOUNDS.filter((s) => s.name === 'click' || s.name === 'beep');
  buildSoundButtons(
    soundSeg,
    (name) => {
      store.update({ sound: name, voiceCount: false });
      callbacks.onSoundPreview();
    },
    beatSounds,
  );
  const voiceBtn = document.createElement('button');
  voiceBtn.className = 'btn seg-btn';
  voiceBtn.textContent = 'Voice';
  voiceBtn.dataset.value = 'voice';
  voiceBtn.title = 'Count out loud (one e and a…) — subdivisions 1–4';
  voiceBtn.addEventListener('click', () => store.update({ voiceCount: true }));
  soundSeg.append(voiceBtn);

  // --- Polyrhythm voices ---
  bindPolyVoices(store, callbacks);

  // --- Clicks vs beats balance ---
  for (const { value, title } of CLICK_VOLUMES) {
    const btn = document.createElement('button');
    btn.className = 'btn seg-btn balance-btn';
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.dataset.value = value;
    btn.innerHTML = `<i class="bal-dot bal-beat"></i><i class="bal-dot bal-click bal-${value}"></i>`;
    btn.addEventListener('click', () => {
      store.update({ clickVolume: value });
      callbacks.onSoundPreview('sub');
    });
    balanceSeg.append(btn);
  }

  // --- Volume ---
  volumeSlider.addEventListener('input', () => {
    store.update({ volume: Number(volumeSlider.value) / 100 });
  });
  volumeSlider.addEventListener('change', () => callbacks.onSoundPreview());

  // --- Speed trainer ---
  bindTrainer(store);

  // --- Sound: plain collapse toggle (no enabled state, just show/hide) ---
  const soundPanel = byId<HTMLDivElement>('sound-panel');
  byId<HTMLDivElement>('sound-toggle').addEventListener('click', () =>
    soundPanel.classList.toggle('collapsed'),
  );

  // --- Reflect state back into static controls ---
  store.subscribe((s) => {
    syncSoundSeg(soundSeg, s);
    for (const btn of balanceSeg.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
      btn.classList.toggle('selected', (btn.dataset.value as ClickVolume) === s.clickVolume);
    }
    volumeSlider.value = String(Math.round(s.volume * 100));
  });

  // Initial render
  const s = store.get();
  syncSoundSeg(soundSeg, s);
  for (const btn of balanceSeg.querySelectorAll<HTMLButtonElement>('.seg-btn')) {
    btn.classList.toggle('selected', (btn.dataset.value as ClickVolume) === s.clickVolume);
  }
  volumeSlider.value = String(Math.round(s.volume * 100));
}
