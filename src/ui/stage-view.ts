import type { Store } from '../state';
import { requestWakeLock, releaseWakeLock } from '../wake-lock';
import type { StageExerciseSource } from './exercise-view';

/** Live position read-out from the engine (see MetronomeEngine.position). */
export interface StagePosition {
  beatIndex: number;
  subIndex: number;
  fraction: number;
  countIn?: number;
}

/** Per-frame context the main loop feeds the stage overlay. */
export interface StageContext {
  /** Short speed-trainer status (e.g. "+5 BPM · 12s"), or null when inactive. */
  trainerText: string | null;
}

/**
 * Stage view — a full-screen black presentation of the current beat for use on
 * stage: one giant number plus a column of beat dots, the accent beat coloured,
 * and a flash on every beat (stronger on the accent). It reads the live engine
 * position and the store; it owns no tempo/meter state of its own.
 *
 * It is an overlay (not an app mode) so it works on top of whatever is playing.
 */
export class StageView {
  private readonly root: HTMLDivElement;
  private readonly numberEl: HTMLDivElement;
  private readonly dotsEl: HTMLDivElement;
  private dots: HTMLDivElement[] = [];

  // Bottom info strip: speed-trainer status and the exercise panel.
  private readonly trainerLine: HTMLDivElement;
  private readonly exPanel: HTMLDivElement;
  private readonly exViewport: HTMLDivElement;
  private readonly exImg: HTMLImageElement;
  private readonly exCaption: HTMLDivElement;
  private readonly exCountdown: HTMLDivElement;

  private open = false;
  /** Signature of the meter the dots were last built for. */
  private dotsKey = '';
  /** Key of the currently displayed beat, to detect changes (drives flash). */
  private shownKey = '';
  /** Exercise item currently drawn in the panel (re-crop only when it changes). */
  private exItemId: string | null = null;

  private readonly store: Store;
  private readonly onToggle: () => void;
  private readonly exercise: StageExerciseSource | null;

  constructor(store: Store, onToggle: () => void, exercise: StageExerciseSource | null = null) {
    this.store = store;
    this.onToggle = onToggle;
    this.exercise = exercise;
    this.root = document.createElement('div');
    this.root.className = 'stage-overlay';

    const inner = document.createElement('div');
    inner.className = 'stage-inner';

    this.numberEl = document.createElement('div');
    this.numberEl.className = 'stage-number';

    this.dotsEl = document.createElement('div');
    this.dotsEl.className = 'stage-dots';

    inner.append(this.numberEl, this.dotsEl);

    // --- Bottom info strip ---
    const info = document.createElement('div');
    info.className = 'stage-info';

    // Visibility is driven via style.display (not the `hidden` attribute), since
    // these elements set `display` in CSS which would override `hidden`.
    this.trainerLine = document.createElement('div');
    this.trainerLine.className = 'stage-trainer';
    this.trainerLine.style.display = 'none';

    this.exPanel = document.createElement('div');
    this.exPanel.className = 'stage-ex';
    this.exPanel.style.display = 'none';
    this.exViewport = document.createElement('div');
    this.exViewport.className = 'stage-ex-viewport';
    this.exImg = document.createElement('img');
    this.exImg.alt = 'Current exercise';
    this.exViewport.append(this.exImg);
    const exMeta = document.createElement('div');
    exMeta.className = 'stage-ex-meta';
    this.exCaption = document.createElement('div');
    this.exCaption.className = 'stage-ex-caption';
    this.exCountdown = document.createElement('div');
    this.exCountdown.className = 'stage-ex-countdown';
    exMeta.append(this.exCaption, this.exCountdown);
    this.exPanel.append(this.exViewport, exMeta);

    info.append(this.trainerLine, this.exPanel);

    const exit = document.createElement('button');
    exit.type = 'button';
    exit.className = 'stage-exit';
    exit.setAttribute('aria-label', 'Exit stage view');
    exit.textContent = '✕';
    exit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.hide();
    });

    const hint = document.createElement('div');
    hint.className = 'stage-hint';
    hint.textContent = 'tap: start / stop · ✕ or Esc: exit';

    this.root.append(inner, info, exit, hint);
    // Tapping anywhere on the backdrop starts / stops the metronome.
    this.root.addEventListener('click', () => this.onToggle());

    document.body.appendChild(this.root);

    window.addEventListener('keydown', (e) => {
      if (this.open && e.key === 'Escape') this.hide();
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.shownKey = '';
    this.exItemId = null;
    this.buildDots();
    // Resting display until the first beat arrives.
    this.numberEl.textContent = '1';
    this.numberEl.classList.remove('accent', 'counting');
    this.setActive(-1);
    this.root.classList.add('open');
    requestWakeLock();
    this.enterFullscreen();
  }

  hide(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('open');
    releaseWakeLock();
    this.exitFullscreen();
  }

  /** Called every animation frame from the main loop while (and only if) open. */
  tick(pos: StagePosition | null, ctx: StageContext = { trainerText: null }): void {
    if (!this.open) return;
    this.buildDots();
    this.updateInfo(ctx);

    // Stopped: freeze on the last beat shown so stopping never bumps the count
    // (the resting "1" is set once in show(), before the first beat).
    if (!pos) return;

    const counting = pos.countIn != null;
    const key = counting ? `c${pos.countIn}` : `b${pos.beatIndex}`;
    if (key === this.shownKey) return;
    this.shownKey = key;

    const beatStates = this.store.get().beatStates;
    const isAccent = !counting && beatStates[pos.beatIndex] === 'accent';

    this.numberEl.textContent = String(counting ? pos.countIn : pos.beatIndex + 1);
    this.numberEl.classList.toggle('accent', isAccent);
    this.numberEl.classList.toggle('counting', counting);

    this.setActive(pos.beatIndex);
    this.flash(isAccent);
  }

  private setActive(beatIndex: number): void {
    this.dots.forEach((dot, i) => dot.classList.toggle('active', i === beatIndex));
  }

  /** Refresh the bottom strip: speed-trainer status and the exercise panel. */
  private updateInfo(ctx: StageContext): void {
    // Speed trainer: time left until the next tempo step.
    const showTrainer = ctx.trainerText != null;
    this.trainerLine.style.display = showTrainer ? '' : 'none';
    if (showTrainer) this.trainerLine.textContent = ctx.trainerText;

    // Exercise: the current item plus its auto-advance countdown.
    const info =
      this.exercise && this.store.get().mode === 'exercises' ? this.exercise.stageInfo() : null;
    const showEx = info != null && info.itemId != null;
    this.exPanel.style.display = showEx ? '' : 'none';
    if (!info || !showEx) {
      this.exItemId = null;
      return;
    }
    // Re-crop only when the shown item changes (retry until the layout has width).
    if (info.itemId !== this.exItemId) {
      if (this.exercise!.renderInto(this.exViewport, this.exImg)) this.exItemId = info.itemId;
    }
    this.exCaption.textContent = info.caption;
    this.exCountdown.textContent = info.pending
      ? '⏎ switching…'
      : info.remainingSec != null
        ? `next in ${Math.ceil(info.remainingSec)}s`
        : '';
  }

  /** Retrigger the flash animation on the whole overlay. */
  private flash(accent: boolean): void {
    this.root.classList.remove('flash', 'flash-accent');
    // Force reflow so re-adding the class restarts the CSS animation.
    void this.root.offsetWidth;
    this.root.classList.add('flash');
    this.root.classList.toggle('flash-accent', accent);
  }

  /** (Re)build the dot column when the meter or accents change. */
  private buildDots(): void {
    const s = this.store.get();
    const key = `${s.beats}:${s.beatStates.join(',')}`;
    if (key === this.dotsKey) return;
    this.dotsKey = key;
    this.dotsEl.replaceChildren();
    this.dots = Array.from({ length: s.beats }, (_, i) => {
      const dot = document.createElement('div');
      dot.className = 'stage-dot';
      if (s.beatStates[i] === 'accent') dot.classList.add('accent');
      this.dotsEl.appendChild(dot);
      return dot;
    });
  }

  private enterFullscreen(): void {
    const el = this.root as HTMLDivElement & {
      webkitRequestFullscreen?: () => Promise<void>;
    };
    const req = el.requestFullscreen ?? el.webkitRequestFullscreen;
    if (req) void req.call(el).catch(() => {});
  }

  private exitFullscreen(): void {
    const doc = document as Document & { webkitExitFullscreen?: () => Promise<void> };
    if (!document.fullscreenElement) return;
    const exit = doc.exitFullscreen ?? doc.webkitExitFullscreen;
    if (exit) void exit.call(doc).catch(() => {});
  }
}
