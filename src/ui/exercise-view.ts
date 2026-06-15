import { loadContent } from '../content/manifest';
import { crop, filterItems, pickNext, step } from '../content/navigation';
import type { ContentModel, Item } from '../content/types';
import type { ExerciseState, Store } from '../state';

function byId<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

function resolveSrc(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}

/**
 * Exercise viewer: shows one item (a crop of an image). Navigation is just two
 * filters — page and topic — plus an optional auto-advance (sequential, or
 * random within the filter). Content is loaded lazily on first show.
 */
export class ExerciseView {
  private model: ContentModel | null = null;

  private loading: Promise<void> | null = null;

  /** Timestamp (ms) when the current auto-advance interval started. */
  private autoStartedAt = 0;

  /** requestAnimationFrame handle for the progress bar animation. */
  private rafId: number | undefined;

  /** Whether the metronome is currently playing. Auto-advance only runs while playing. */
  private playing = false;

  /** Pending deferred render (requestAnimationFrame id). */
  private deferredRenderRaf: number | undefined;

  /** The id of the next item currently shown in the preview (to avoid re-rendering). */
  private previewItemId: string | null = null;

  /** Cached next item so that advanceOnce uses the same item shown in preview (matters for random). */
  private cachedNextItem: Item | null = null;

  /**
   * True when the auto-advance countdown has expired but we are waiting for
   * the next measure start (beat 0) before actually switching the exercise.
   */
  private pendingAdvance = false;

  /** Whether auto-advance animation is active (replaces the old setInterval). */
  private autoActive = false;

  /** Seconds before auto-advance at which the next exercise preview appears. */
  private static readonly PREVIEW_LEAD_SEC = 20;

  private readonly root = byId<HTMLElement>('exercise-view');
  private readonly viewport = byId<HTMLDivElement>('ex-viewport');
  private readonly img = byId<HTMLImageElement>('ex-img');
  private readonly caption = byId<HTMLDivElement>('ex-caption');
  private readonly empty = byId<HTMLParagraphElement>('ex-empty');
  private readonly pageSel = byId<HTMLSelectElement>('ex-page');
  private readonly topicSel = byId<HTMLSelectElement>('ex-topic');
  private readonly autoToggle = byId<HTMLDivElement>('ex-auto-toggle');
  private readonly autoSec = byId<HTMLInputElement>('ex-auto-sec');
  private readonly randomChk = byId<HTMLInputElement>('ex-random');
  private readonly autoPanel = byId<HTMLDivElement>('ex-auto-panel');
  private readonly progressBar = byId<HTMLDivElement>('ex-progress-bar');
  private readonly progressFill = byId<HTMLDivElement>('ex-progress-fill');
  private readonly preview = byId<HTMLDivElement>('ex-preview');
  private readonly previewViewport = byId<HTMLDivElement>('ex-preview-viewport');
  private readonly previewImg = byId<HTMLImageElement>('ex-preview-img');
  private readonly previewLabel = byId<HTMLDivElement>('ex-preview-label');

  /** Last known autoSec before the user turned auto off (so we can restore it). */
  private lastAutoSec = 20;

  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
    byId<HTMLButtonElement>('ex-prev').addEventListener('click', () => this.step(-1));
    byId<HTMLButtonElement>('ex-next').addEventListener('click', () => this.step(1));
    this.pageSel.addEventListener('change', () => this.setFilter({ page: this.pageSel.value }));
    this.topicSel.addEventListener('change', () => this.setFilter({ topic: this.topicSel.value }));
    this.randomChk.addEventListener('change', () => this.patch({ random: this.randomChk.checked }));
    // Click the header to toggle auto-advance on/off
    this.autoToggle.addEventListener('click', () => this.toggleAuto());
    this.autoSec.addEventListener('change', () => this.applyAutoSec());

    // Re-frame the current item when the viewport width changes.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.render()).observe(this.viewport);
    }
    this.store.subscribe(() => {
      this.syncControls();
      this.render();
    });

    // When a cached image loads instantly the browser may composite before
    // the inline sizing styles are applied.  Re-render once the image is
    // decoded to guarantee the crop transform matches the actual layout.
    this.img.addEventListener('load', () => this.render());
  }

  private s(): ExerciseState {
    return this.store.get().exercise;
  }

  private patch(p: Partial<ExerciseState>): void {
    this.store.update({ exercise: { ...this.s(), ...p } });
  }

  /** Load content on first show; safe to call repeatedly. */
  async show(): Promise<void> {
    this.root.hidden = false;
    if (!this.model && !this.loading) {
      this.loading = loadContent()
        .then((model) => {
          this.model = model;
          this.populatePickers();
          this.resetStaleFilters();
          this.ensureCurrentInFilter();
          this.render();
        })
        .catch((err) => {
          console.warn('[content] failed to load:', err);
          this.showEmpty();
        });
    }
    await this.loading;
    this.syncControls();
    this.render();
    // Schedule a deferred re-render: after the element is unhidden the browser
    // needs a layout pass to compute the real viewport width.  On fast cached
    // loads the initial render() above may still see a zero or stale clientWidth;
    // a rAF guarantees the DOM has been laid out before we measure again.
    this.scheduleDeferredRender();
  }

  hide(): void {
    this.root.hidden = true;
    this.stopAuto();
    this.hideProgress();
  }

  /**
   * Called from main.ts when the metronome starts or stops.
   * Auto-advance only ticks while the metronome is playing;
   * starting the metronome resets the countdown.
   */
  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.syncAuto();
  }

  /** Items matching the current page/topic filter, in order. */
  private filtered(state: ExerciseState = this.s()): Item[] {
    return this.model ? filterItems(this.model, state.page, state.topic) : [];
  }

  private currentItem(): Item | null {
    const id = this.s().currentId;
    if (!this.model || id === null) return null;
    const i = this.model.indexById.get(id);
    return i === undefined ? null : this.model.items[i];
  }

  /**
   * Drop persisted page/topic filters that no longer exist in the loaded
   * content. Without this, a stale filter from localStorage (e.g. page "1"
   * from old content) produces an empty item list and the viewer shows
   * "No exercises" even though the descriptors loaded fine.
   */
  private resetStaleFilters(): void {
    if (!this.model) return;
    const s = this.s();
    const patch: Partial<ExerciseState> = {};
    if (s.page && !this.model.itemsByPage.has(s.page)) patch.page = '';
    if (s.topic && !this.model.itemsByTopic.has(s.topic)) patch.topic = '';
    if (Object.keys(patch).length > 0) this.patch(patch);
  }

  /** Keep the shown item inside the active filter; fall back to its first item. */
  private ensureCurrentInFilter(): void {
    const list = this.filtered();
    const id = this.s().currentId;
    if (!list.some((it) => it.id === id)) {
      this.patch({ currentId: list[0]?.id ?? null });
    }
  }

  /** A filter change jumps to the first item of the new selection. */
  private setFilter(p: { page?: string; topic?: string }): void {
    const nextState = { ...this.s(), ...p };
    const first = this.filtered(nextState)[0];
    this.patch({ ...p, currentId: first?.id ?? nextState.currentId });
  }

  /** Manual prev/next within the current filter (overlay arrows). */
  private step(dir: number): void {
    const target = step(this.filtered(), this.s().currentId, dir);
    if (target) this.patch({ currentId: target.id });
  }

  /** One auto-advance step within the current filter. */
  private advanceOnce(): void {
    // Use the cached preview item when available so the user sees exactly
    // the exercise that was previewed (important for random mode).
    const target = this.cachedNextItem ?? pickNext(this.filtered(), this.s().currentId, this.s().random);
    if (target) this.patch({ currentId: target.id });
    // Reset the progress timer for the next interval.
    this.autoStartedAt = performance.now();
    this.pendingAdvance = false;
    // Hide the preview so it can reappear for the next cycle.
    this.hidePreview();
  }

  /**
   * Called from main.ts on every beat-0 (start of a new measure).
   * If the auto-advance countdown has already elapsed, the exercise
   * switches now — keeping the change aligned with the musical phrase.
   */
  onMeasureStart(): void {
    if (this.pendingAdvance) {
      this.advanceOnce();
    }
  }

  /** Toggle auto-advance on/off via the header click. */
  private toggleAuto(): void {
    const isOn = this.s().autoSec > 0;
    if (isOn) {
      // Turn off — remember the last value
      this.lastAutoSec = this.s().autoSec;
      this.patch({ autoSec: 0 });
    } else {
      // Turn on — restore last value or use the input
      const sec = Math.max(2, Number(this.autoSec.value) || this.lastAutoSec);
      this.patch({ autoSec: sec });
    }
  }

  /** The seconds input changed while auto is on. */
  private applyAutoSec(): void {
    if (this.s().autoSec <= 0) return;
    const sec = Math.max(2, Number(this.autoSec.value) || 0);
    this.patch({ autoSec: sec });
  }

  private stopAuto(): void {
    this.autoActive = false;
    this.pendingAdvance = false;
    this.stopProgressAnimation();
  }

  private syncAuto(): void {
    this.stopAuto();
    const sec = this.s().autoSec;
    if (sec > 0 && !this.root.hidden && this.playing) {
      this.autoStartedAt = performance.now();
      this.autoActive = true;
      this.showProgress();
      this.startProgressAnimation();
    } else {
      this.hideProgress();
    }
  }

  /* --- Progress bar & countdown animation --- */

  private showProgress(): void {
    this.progressBar.hidden = false;
  }

  private hideProgress(): void {
    this.progressBar.hidden = true;
    this.progressFill.style.width = '0%';
    this.clearCountdownBadge();
    this.hidePreview();
  }

  /** Remove the countdown <span> from the caption if present. */
  private clearCountdownBadge(): void {
    const badge = this.caption.querySelector('.ex-countdown-badge');
    if (badge) badge.remove();
  }

  /** Append or update the countdown badge inside the caption line. */
  private setCountdownBadge(text: string): void {
    let badge = this.caption.querySelector('.ex-countdown-badge') as HTMLSpanElement | null;
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'ex-countdown-badge';
      this.caption.appendChild(badge);
    }
    badge.textContent = ` · ${text}`;
  }

  private startProgressAnimation(): void {
    this.stopProgressAnimation();
    const tick = () => {
      const sec = this.s().autoSec;
      if (sec <= 0 || !this.autoActive) {
        this.hideProgress();
        return;
      }
      const elapsed = (performance.now() - this.autoStartedAt) / 1000;
      const remaining = Math.max(0, sec - elapsed);

      if (remaining <= 0 && !this.pendingAdvance) {
        // Countdown expired — mark as pending; the actual switch happens
        // on the next measure start (beat 0) via onMeasureStart().
        this.pendingAdvance = true;
        this.ensurePreview();
      }

      // While pending, keep the bar full and show "waiting…" instead of 0s.
      if (this.pendingAdvance) {
        this.progressFill.style.width = '100%';
        this.setCountdownBadge('⏎');
      } else {
        const fraction = Math.min(elapsed / sec, 1);
        this.progressFill.style.width = `${(fraction * 100).toFixed(1)}%`;
        this.setCountdownBadge(`${Math.ceil(remaining)}s`);
      }

      // Show the next exercise preview when within the lead window.
      if (!this.pendingAdvance && remaining <= ExerciseView.PREVIEW_LEAD_SEC && remaining > 0) {
        this.ensurePreview();
      }

      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopProgressAnimation(): void {
    if (this.rafId !== undefined) {
      cancelAnimationFrame(this.rafId);
      this.rafId = undefined;
    }
  }

  /* --- Next exercise preview --- */

  /** Show the preview if not already visible; compute and render the next item. */
  private ensurePreview(): void {
    if (!this.model) return;
    const list = this.filtered();
    if (list.length < 2) return;
    // Reuse the already-picked item so random mode stays consistent.
    if (this.cachedNextItem && !this.preview.hidden) return;
    const next = this.cachedNextItem ?? pickNext(list, this.s().currentId, this.s().random);
    if (!next) return;
    this.cachedNextItem = next;
    this.renderPreview(next);
  }

  /** Render a specific item into the preview panel. */
  private renderPreview(item: Item): void {
    if (!this.model) return;
    const image = this.model.imagesById.get(item.image);
    if (!image) return;

    this.previewItemId = item.id;
    this.preview.hidden = false;

    const width = this.previewViewport.clientWidth || this.viewport.clientWidth || 360;
    if (width <= 0) return;

    const t = crop(item.bbox, image, width);
    this.previewViewport.style.height = `${t.viewportHeight}px`;
    this.previewImg.style.width = `${t.imgWidth}px`;
    this.previewImg.style.height = `${t.imgHeight}px`;
    this.previewImg.style.transform = `translate(${t.offsetX}px, ${t.offsetY}px)`;

    const newSrc = resolveSrc(image.src);
    if (this.previewImg.getAttribute('src') !== newSrc) {
      this.previewImg.src = newSrc;
    }

    // Caption: show the next item's position in the list.
    const list = this.filtered();
    const pos = list.findIndex((it) => it.id === item.id) + 1;
    this.previewLabel.textContent = `Next: ${item.title ? `${item.title} · ` : ''}${pos}/${list.length}`;
  }

  /** Hide and reset the preview panel. */
  private hidePreview(): void {
    if (this.preview.hidden && this.previewItemId === null) return;
    this.preview.hidden = true;
    this.previewItemId = null;
    this.cachedNextItem = null;
  }

  private populatePickers(): void {
    if (!this.model) return;
    const fill = (sel: HTMLSelectElement, allLabel: string, list: { id: string; title: string }[]) => {
      sel.innerHTML = '';
      const all = document.createElement('option');
      all.value = '';
      all.textContent = allLabel;
      sel.append(all);
      for (const t of list) {
        const opt = document.createElement('option');
        opt.value = t.id;
        opt.textContent = t.title;
        sel.append(opt);
      }
    };
    fill(this.pageSel, 'All pages', this.model.pages);
    fill(this.topicSel, 'All topics', this.model.topics);
  }

  private showEmpty(): void {
    this.empty.hidden = false;
    this.viewport.hidden = true;
  }

  private syncControls(): void {
    const s = this.s();
    this.pageSel.value = s.page;
    this.topicSel.value = s.topic;
    this.randomChk.checked = s.random;
    const autoOn = s.autoSec > 0;
    // Collapse/expand the auto-advance panel
    this.autoPanel.classList.toggle('collapsed', !autoOn);
    if (document.activeElement !== this.autoSec && autoOn) {
      this.autoSec.value = String(s.autoSec);
    }
    this.syncAuto();
  }

  /**
   * Schedule a single deferred render on the next animation frame.  This
   * ensures the browser has completed layout after show/hide transitions so
   * that clientWidth returns the real viewport width.
   */
  private scheduleDeferredRender(): void {
    if (this.deferredRenderRaf !== undefined) return;
    this.deferredRenderRaf = requestAnimationFrame(() => {
      this.deferredRenderRaf = undefined;
      this.render();
    });
  }

  private render(): void {
    const item = this.currentItem();
    if (!this.model || !item) {
      if (this.model && this.filtered().length === 0) this.showEmpty();
      return;
    }
    const image = this.model.imagesById.get(item.image);
    if (!image) return;

    this.empty.hidden = true;
    this.viewport.hidden = false;

    const width = this.viewport.clientWidth || this.root.clientWidth || 360;

    // If the viewport has not been laid out yet (still hidden or zero-width),
    // defer the render to after the browser completes layout.
    if (width <= 0) {
      this.scheduleDeferredRender();
      return;
    }

    const t = crop(item.bbox, image, width);
    this.viewport.style.height = `${t.viewportHeight}px`;

    // Apply sizing and positioning styles *before* setting the src so that
    // images served instantly from the service-worker / HTTP cache are
    // composited at the correct size and offset from the very first frame.
    this.img.style.width = `${t.imgWidth}px`;
    this.img.style.height = `${t.imgHeight}px`;
    this.img.style.transform = `translate(${t.offsetX}px, ${t.offsetY}px)`;

    const newSrc = resolveSrc(image.src);
    // img.src returns the fully-resolved absolute URL, so compare against the
    // attribute value to avoid always re-assigning (which resets decode state).
    if (this.img.getAttribute('src') !== newSrc) {
      this.img.src = newSrc;
    }

    const list = this.filtered();
    const pos = list.findIndex((it) => it.id === item.id) + 1;
    const label = `${item.page ? `p.${item.page}` : ''}${item.topic ? ` · ${item.topic}` : ''}`.trim();
    this.caption.textContent = `${item.title ? `${item.title} · ` : ''}${pos}/${list.length}${label ? ` · ${label}` : ''}`;
  }
}
