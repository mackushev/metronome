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

  private autoTimer: number | undefined;

  private readonly root = byId<HTMLElement>('exercise-view');
  private readonly viewport = byId<HTMLDivElement>('ex-viewport');
  private readonly img = byId<HTMLImageElement>('ex-img');
  private readonly caption = byId<HTMLDivElement>('ex-caption');
  private readonly empty = byId<HTMLParagraphElement>('ex-empty');
  private readonly pageSel = byId<HTMLSelectElement>('ex-page');
  private readonly topicSel = byId<HTMLSelectElement>('ex-topic');
  private readonly autoChk = byId<HTMLInputElement>('ex-auto');
  private readonly autoSec = byId<HTMLInputElement>('ex-auto-sec');
  private readonly randomChk = byId<HTMLInputElement>('ex-random');

  private readonly store: Store;

  constructor(store: Store) {
    this.store = store;
    byId<HTMLButtonElement>('ex-prev').addEventListener('click', () => this.step(-1));
    byId<HTMLButtonElement>('ex-next').addEventListener('click', () => this.step(1));
    this.pageSel.addEventListener('change', () => this.setFilter({ page: this.pageSel.value }));
    this.topicSel.addEventListener('change', () => this.setFilter({ topic: this.topicSel.value }));
    this.randomChk.addEventListener('change', () => this.patch({ random: this.randomChk.checked }));
    this.autoChk.addEventListener('change', () => this.applyAuto());
    this.autoSec.addEventListener('change', () => this.applyAuto());

    // Re-frame the current item when the viewport width changes.
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(() => this.render()).observe(this.viewport);
    }
    this.store.subscribe(() => this.syncControls());
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
  }

  hide(): void {
    this.root.hidden = true;
    this.stopAuto();
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
    const target = pickNext(this.filtered(), this.s().currentId, this.s().random);
    if (target) this.patch({ currentId: target.id });
  }

  private applyAuto(): void {
    const sec = Math.max(2, Number(this.autoSec.value) || 0);
    this.patch({ autoSec: this.autoChk.checked ? sec : 0 });
  }

  private stopAuto(): void {
    window.clearInterval(this.autoTimer);
    this.autoTimer = undefined;
  }

  private syncAuto(): void {
    this.stopAuto();
    const sec = this.s().autoSec;
    if (sec > 0 && !this.root.hidden) {
      this.autoTimer = window.setInterval(() => this.advanceOnce(), sec * 1000);
    }
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
    this.autoChk.checked = s.autoSec > 0;
    if (document.activeElement !== this.autoSec && s.autoSec > 0) {
      this.autoSec.value = String(s.autoSec);
    }
    this.syncAuto();
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
    const t = crop(item.bbox, image, width);
    this.viewport.style.height = `${t.viewportHeight}px`;
    this.img.src = resolveSrc(image.src);
    this.img.style.width = `${t.imgWidth}px`;
    this.img.style.height = `${t.imgHeight}px`;
    this.img.style.transform = `translate(${t.offsetX}px, ${t.offsetY}px)`;

    const list = this.filtered();
    const pos = list.findIndex((it) => it.id === item.id) + 1;
    const label = `${item.page ? `p.${item.page}` : ''}${item.topic ? ` · ${item.topic}` : ''}`.trim();
    this.caption.textContent = `${item.title ? `${item.title} · ` : ''}${pos}/${list.length}${label ? ` · ${label}` : ''}`;
  }
}
