import './style.css';
import { MetronomeEngine } from './audio/engine';
import { clampBpm, loadSettings, resizeBeatStates, Store, cycleBeatState } from './state';
import { secondsToNextStep, trainerAtMax, trainerProgress, trainerTargetBpm } from './trainer';
import { BeatBar } from './ui/beatbar';
import { CircleView } from './ui/circle';
import { bindControls } from './ui/controls';

const store = new Store(loadSettings());
const engine = new MetronomeEngine(() => store.get());

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
});

const beatBar = new BeatBar(document.getElementById('beat-bar')!, toggleBeatState);

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
engine.onBeatScheduled = (audioTime) => {
  const s = store.get();
  if (!s.trainer.enabled || !trainerBase) return;
  const target = trainerTargetBpm(trainerBase.startBpm, audioTime - trainerBase.startTime, s.trainer);
  if (target !== s.bpm) store.update({ bpm: target });
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
  onUserBpmChange: setUserBpm,
  onSoundPreview: () => engine.preview(),
});

// --- Start/stop ---
function togglePlay(): void {
  engine.toggle();
  resetTrainerBase();
  playIcon.textContent = engine.running ? '❚❚' : '▶';
  playBtn.classList.toggle('playing', engine.running);
  if (engine.running) maybeShowIosHint();
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
  circle.render(s);
  beatBar.render(s);
  // Restart the trainer countdown only when its own parameters change
  const trainerNow = JSON.stringify(s.trainer);
  if (trainerNow !== prevTrainer) {
    prevTrainer = trainerNow;
    resetTrainerBase();
  }
});
bpmValue.textContent = String(store.get().bpm);
circle.render(store.get());
beatBar.render(store.get());

// --- Frame loop: needle, tick highlight, trainer progress ---
function frame(): void {
  const pos = engine.position();
  circle.tick(pos);
  beatBar.setActive(pos ? pos.beatIndex : null);

  // A sticky "audio blocked" notice disappears as soon as audio actually plays
  if (noticeSticky && !audioNotice.hidden && engine.audioRunning()) {
    audioNotice.hidden = true;
  }

  const s = store.get();
  const time = engine.currentTime();
  if (engine.running && s.trainer.enabled && trainerBase && time !== null) {
    const elapsed = time - trainerBase.startTime;
    if (trainerAtMax(s.bpm, trainerBase.startBpm, s.trainer)) {
      circle.setTrainerProgress(1);
      trainerStatus.textContent = `Limit reached: ${s.bpm} BPM`;
    } else {
      circle.setTrainerProgress(trainerProgress(elapsed, s.trainer.deltaSec));
      const toNext = Math.ceil(secondsToNextStep(elapsed, s.trainer.deltaSec));
      trainerStatus.textContent = `+${s.trainer.stepBpm} BPM in ${toNext} s (started at ${trainerBase.startBpm})`;
    }
  } else {
    circle.setTrainerProgress(null);
    trainerStatus.textContent =
      s.trainer.enabled && !engine.running ? 'Start the metronome — the tempo will rise on its own' : '';
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
