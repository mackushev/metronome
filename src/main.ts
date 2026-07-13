import './style.css';
import { MetronomeEngine } from './audio/engine';
import { modeFromUrl, pushMode, replaceMode, onPopState } from './router';
import {
  clampBpm,
  loadSettings,
  resizeBeatStates,
  Store,
  cycleBeatState,
  toggleSubMute,
  togglePolyMute,
  type AppMode,
} from './state';
import {
  currentStageStepBpm,
  secondsToNextStep,
  trainerAtMax,
  trainerProgress,
  trainerTargetBpm,
} from './trainer';
import { BeatBar } from './ui/beatbar';
import { CircleView } from './ui/circle';
import { bindControls } from './ui/controls';
import { ExerciseView } from './ui/exercise-view';
import { StageView } from './ui/stage-view';

// --- Determine the initial mode: URL wins, then localStorage, then default ---
const savedSettings = loadSettings();
const urlMode = modeFromUrl();
if (urlMode != null) {
  // The URL explicitly requests a mode — override whatever localStorage had.
  savedSettings.mode = urlMode;
  savedSettings.exercise = { ...savedSettings.exercise, enabled: urlMode === 'exercises' };
}

const store = new Store(savedSettings);
const engine = new MetronomeEngine(() => store.get());

// Make sure the address bar reflects the active mode from the very start.
// `replaceMode` does *not* create a new back-stack entry.
replaceMode(store.get().mode);

function toggleBeatState(beatIndex: number): void {
  const states = [...store.get().beatStates];
  states[beatIndex] = cycleBeatState(states[beatIndex] ?? 'normal');
  store.update({ beatStates: states });
}

const svg = document.getElementById('circle') as unknown as SVGSVGElement;
const circle = new CircleView(svg, {
  onBeatClick: toggleBeatState,
  dial: {
    start: () => store.get().bpm,
    change: (value) => setUserBpm(clampBpm(value)),
    step: (delta) => setUserBpm(clampBpm(store.get().bpm + delta)),
  },
  onBeatsSelect: (beats) => {
    store.update({ beats, beatStates: resizeBeatStates(store.get().beatStates, beats) });
  },
  onSubdivSelect: (subdivision) => store.update({ subdivision }),
  onSubToggle: (beatIndex, subIndex) => {
    store.update({ mutedSubs: toggleSubMute(store.get().mutedSubs, beatIndex, subIndex) });
  },
  onPolyToggle: (voice, pulse) => {
    const voices = store.get().polyrhythm.voices.map((v, i) =>
      i === voice ? { ...v, muted: togglePolyMute(v.muted, pulse) } : v,
    );
    store.update({ polyrhythm: { voices } });
  },
});

const beatBarEl = document.getElementById('beat-bar')!;
const beatBar = new BeatBar(beatBarEl, toggleBeatState);

const bpmValue = document.getElementById('bpm-value')!;
const audioNotice = document.getElementById('audio-notice')!;
const audioNoticeText = document.getElementById('audio-notice-text')!;
const playBtn = document.getElementById('play') as HTMLButtonElement;
const playIcon = playBtn.querySelector('.icon-play')!;
const trainerStatus = document.getElementById('trainer-status')!;
const center = document.getElementById('center')!;

// --- Speed trainer: reference point (starting tempo and audio time) ---
let trainerBase: { startBpm: number; startTime: number } | null = null;

function resetTrainerBase(): void {
  const time = engine.currentTime();
  trainerBase =
    engine.running && store.get().trainer.enabled && time !== null
      ? { startBpm: store.get().bpm, startTime: time }
      : null;
}

// The trainer tempo is applied from the nearest beat — no waiting for the measure end
engine.onBeatScheduled = (audioTime, beatIndex) => {
  const s = store.get();
  if (s.trainer.enabled && trainerBase) {
    const target = trainerTargetBpm(trainerBase.startBpm, audioTime - trainerBase.startTime, s.trainer);
    if (target !== s.bpm) store.update({ bpm: target });
  }
  // Exercise auto-advance switches only at the start of a new measure.
  if (beatIndex === 0 && s.mode === 'exercises') {
    exerciseView.onMeasureStart();
  }
};

// --- Audio problem notices (mobile browsers, autoplay policies, iOS mute switch) ---
let noticeSticky = false;

function showAudioNotice(text: string, sticky: boolean): void {
  audioNoticeText.textContent = text;
  audioNotice.hidden = false;
  noticeSticky = sticky;
}

document.getElementById('audio-notice-close')!.addEventListener('click', () => {
  audioNotice.hidden = true;
});

engine.onAudioIssue = (issue) => {
  showAudioNotice(
    issue === 'unsupported'
      ? 'This browser cannot play sound (no Web Audio support). Please use an up-to-date Chrome, Safari, Firefox, or Edge.'
      : 'Audio did not start — the browser blocked playback. Tap play again; on iPhone/iPad also check the Silent Mode switch and the volume.',
    true,
  );
};

const isIOS =
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes('Mac') && navigator.maxTouchPoints > 1);
const IOS_HINT_KEY = 'metronome-ios-hint-shown';

function maybeShowIosHint(): void {
  if (!isIOS) return;
  try {
    if (localStorage.getItem(IOS_HINT_KEY)) return;
    localStorage.setItem(IOS_HINT_KEY, '1');
  } catch {
    return;
  }
  showAudioNotice('No sound? Flip the Silent Mode switch off and raise the volume.', false);
}

function setUserBpm(bpm: number): void {
  store.update({ bpm });
  // The user changed the tempo — the trainer restarts its countdown from the new value
  resetTrainerBase();
}

bindControls(store, {
  onSoundPreview: (kind) => engine.preview(kind ?? 'normal'),
  onVoicePreview: (sound) => engine.preview('normal', sound),
});

// --- Mode switch: the three pills reshape the page ---
const exerciseView = new ExerciseView(store);
// Tapping the stage backdrop toggles play/stop; exit is the ✕ button or Esc.
// The stage overlay mirrors the current exercise via the exercise view.
const stageView = new StageView(store, () => togglePlay(), exerciseView);
const appEl = document.getElementById('app')!;

// --- Stage view: a full-screen presentation overlay, orthogonal to the mode ---
document.getElementById('stage-enter')!.addEventListener('click', () => stageView.show());
const modeMetronome = document.getElementById('mode-metronome') as HTMLButtonElement;
const modeExercises = document.getElementById('mode-exercises') as HTMLButtonElement;
const modePolyrhythm = document.getElementById('mode-polyrhythm') as HTMLButtonElement;

function syncMode(): void {
  const mode = store.get().mode;
  appEl.classList.toggle('mode-metronome', mode === 'metronome');
  appEl.classList.toggle('mode-exercises', mode === 'exercises');
  appEl.classList.toggle('mode-polyrhythm', mode === 'polyrhythm');
  modeMetronome.classList.toggle('selected', mode === 'metronome');
  modeExercises.classList.toggle('selected', mode === 'exercises');
  modePolyrhythm.classList.toggle('selected', mode === 'polyrhythm');
  // The beat bar is only meaningful in metronome mode.
  beatBarEl.hidden = mode !== 'metronome';
  if (mode === 'exercises') void exerciseView.show();
  else exerciseView.hide();
  // Render the right circle layout for the active mode.
  if (mode === 'polyrhythm') circle.renderPoly(store.get());
  else circle.render(store.get());
}

/**
 * Switch the app to a new mode. When `fromPopState` is true we are reacting to
 * browser back/forward — the URL is already correct, so we must NOT push a new
 * history entry (that would break the back button).
 */
function setMode(mode: AppMode, fromPopState = false): void {
  if (store.get().mode !== mode) {
    // Keep the legacy exercise.enabled flag in sync for backward compatibility.
    store.update({ mode, exercise: { ...store.get().exercise, enabled: mode === 'exercises' } });
  }
  if (!fromPopState) pushMode(mode);
  syncMode();
}

modeMetronome.addEventListener('click', () => setMode('metronome'));
modeExercises.addEventListener('click', () => setMode('exercises'));
modePolyrhythm.addEventListener('click', () => setMode('polyrhythm'));

// --- Browser back / forward: sync the mode from the URL ---
onPopState((mode) => setMode(mode, true));

syncMode();

// The collapsible panels are collapsed by the syncs above; re-enable transitions
// only after the browser has painted that initial (collapsed) state, so the
// expanded→collapsed border/padding animation does not flash on load.
requestAnimationFrame(() => requestAnimationFrame(() => appEl.classList.remove('preload')));

// --- Start/stop ---
function togglePlay(): void {
  engine.toggle();
  resetTrainerBase();
  playIcon.textContent = engine.running ? '❚❚' : '▶';
  playBtn.classList.toggle('playing', engine.running);
  if (engine.running) maybeShowIosHint();
  exerciseView.setPlaying(engine.running);
}

playBtn.addEventListener('click', togglePlay);
window.addEventListener('keydown', (event) => {
  if (event.code === 'Space' && !(event.target instanceof HTMLInputElement)) {
    event.preventDefault();
    togglePlay();
  }
});

// --- Drag on the center: up/down = tempo ---
let drag: { startY: number; startBpm: number; moved: boolean } | null = null;
center.addEventListener('pointerdown', (event) => {
  if (event.target instanceof Element && event.target.closest('#play')) return;
  drag = { startY: event.clientY, startBpm: store.get().bpm, moved: false };
  center.setPointerCapture(event.pointerId);
});
center.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const dy = drag.startY - event.clientY;
  if (Math.abs(dy) > 3) drag.moved = true;
  if (drag.moved) setUserBpm(clampBpm(drag.startBpm + dy / 2));
});
const endDrag = () => (drag = null);
center.addEventListener('pointerup', endDrag);
center.addEventListener('pointercancel', endDrag);

// --- React to settings changes ---
let prevTrainer = JSON.stringify(store.get().trainer);
store.subscribe((s) => {
  bpmValue.textContent = String(s.bpm);
  if (s.mode === 'polyrhythm') circle.renderPoly(s);
  else circle.render(s);
  beatBar.render(s);
  // Restart the trainer countdown only when its own parameters change
  const trainerNow = JSON.stringify(s.trainer);
  if (trainerNow !== prevTrainer) {
    prevTrainer = trainerNow;
    resetTrainerBase();
  }
});
bpmValue.textContent = String(store.get().bpm);
if (store.get().mode === 'polyrhythm') circle.renderPoly(store.get());
else circle.render(store.get());
beatBar.render(store.get());

// --- Frame loop: needle, tick highlight, trainer progress ---
// While a count-in plays, the big BPM number in the center shows the countdown.
let countdownShown = false;
function updateCenterCountdown(countIn: number | null | undefined): void {
  if (countIn != null) {
    bpmValue.textContent = String(countIn);
    center.classList.add('counting');
    countdownShown = true;
  } else if (countdownShown) {
    countdownShown = false;
    center.classList.remove('counting');
    bpmValue.textContent = String(store.get().bpm);
  }
}

function frame(): void {
  if (store.get().mode === 'polyrhythm') {
    circle.polyTick(engine.polyPosition());
    circle.setTrainerProgress(null);
    stageView.tick(engine.position());
    requestAnimationFrame(frame);
    return;
  }
  const pos = engine.position();
  circle.tick(pos);
  updateCenterCountdown(pos?.countIn);
  beatBar.setActive(pos ? pos.beatIndex : null);

  // A sticky "audio blocked" notice disappears as soon as audio actually plays
  if (noticeSticky && !audioNotice.hidden && engine.audioRunning()) {
    audioNotice.hidden = true;
  }

  // Short trainer status for the stage overlay, built alongside the full one.
  let stageTrainerText: string | null = null;
  const s = store.get();
  const time = engine.currentTime();
  if (engine.running && s.trainer.enabled && trainerBase && time !== null) {
    const elapsed = time - trainerBase.startTime;
    if (trainerAtMax(s.bpm, trainerBase.startBpm, s.trainer)) {
      circle.setTrainerProgress(1);
      trainerStatus.textContent = `Limit reached: ${s.bpm} BPM`;
      stageTrainerText = `Max ${s.bpm} BPM`;
    } else {
      circle.setTrainerProgress(trainerProgress(elapsed, trainerBase.startBpm, s.trainer));
      const toNext = Math.ceil(secondsToNextStep(elapsed, trainerBase.startBpm, s.trainer));
      const stepBpm = currentStageStepBpm(elapsed, trainerBase.startBpm, s.trainer);
      trainerStatus.textContent = `+${stepBpm} BPM in ${toNext} s (started at ${trainerBase.startBpm})`;
      stageTrainerText = `${s.bpm} BPM · +${stepBpm} in ${toNext}s`;
    }
  } else {
    circle.setTrainerProgress(null);
    trainerStatus.textContent =
      s.trainer.enabled && !engine.running ? 'Start the metronome — the tempo will rise on its own' : '';
  }
  stageView.tick(pos, { trainerText: stageTrainerText });
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// --- Service worker: reload the page when a new version takes control ---
// With skipWaiting + clientsClaim the new SW activates immediately after
// install; the `controllerchange` event fires on the *old* page that is
// still running stale JS/CSS.  A reload picks up the fresh precache.
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });
}
