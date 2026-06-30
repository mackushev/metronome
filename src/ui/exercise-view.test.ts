// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store, defaultSettings } from '../state';
import { ExerciseView } from './exercise-view';

const grid = { rows: 8, cols: 2, margin: { top: 120, right: 60, bottom: 60, left: 60 }, gapX: 40, gapY: 30 };
const descriptor = { image: 'sample.svg', w: 1200, h: 1600, page: '1', topic: 'Warm-ups', grid };

const manifest = ['0001.json'];
const descriptors: Record<string, unknown> = { '0001.json': descriptor };

function mockFetch() {
  return vi.fn(async (url: string) => {
    if (url.includes('manifest.json')) return { ok: true, status: 200, json: async () => manifest } as Response;
    const name = url.split('/').pop()!;
    return { ok: true, status: 200, json: async () => descriptors[name] } as Response;
  });
}

async function mount() {
  const store = new Store(defaultSettings());
  const view = new ExerciseView(store);
  await view.show();
  return store;
}

/** Mount with a second page added to the same topic, so the page picker is meaningful. */
async function mountMultiPage() {
  manifest.push('0002.json');
  descriptors['0002.json'] = { ...descriptor, page: '2' };
  try {
    return await mount();
  } finally {
    manifest.pop();
    delete descriptors['0002.json'];
  }
}

describe('ExerciseView (jsdom integration)', () => {
  beforeEach(() => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1];
    vi.stubGlobal('fetch', mockFetch());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads content on show and renders the first item', async () => {
    const store = await mount();
    const img = document.getElementById('ex-img') as HTMLImageElement;
    expect(img.src).toContain('content/sample.svg');
    // 8x2 grid -> 16 items
    expect(document.getElementById('ex-caption')!.textContent).toContain('1/16');
    expect(store.get().exercise.currentId).toBe('0001-1');
  });

  it('the topic picker is derived with an "All" option', async () => {
    await mount();
    const topics = document.querySelectorAll('#ex-topic option');
    expect([...topics].map((o) => (o as HTMLOptionElement).value)).toEqual(['', 'Warm-ups']);
  });

  it('page chips are derived (one per page) — no combobox', async () => {
    const store = await mountMultiPage();
    expect(document.querySelector('#ex-page')).toBeNull(); // no <select>
    const topic = document.getElementById('ex-topic') as HTMLSelectElement;
    topic.value = 'Warm-ups';
    topic.dispatchEvent(new Event('change', { bubbles: true }));
    const chips = document.querySelectorAll('#ex-page-chips .ex-page-chip');
    expect([...chips].map((c) => (c as HTMLElement).dataset.page)).toEqual(['1', '2']);
    // Nothing selected by default -> every chip is off (= all pages active).
    expect([...chips].some((c) => c.classList.contains('active'))).toBe(false);
    expect(store.get().exercise.pages).toEqual([]);
  });

  it('the page chips stay hidden for a single-page topic (nothing to choose)', async () => {
    const store = await mount();
    const pageField = document.getElementById('ex-page-field') as HTMLElement;
    const topic = document.getElementById('ex-topic') as HTMLSelectElement;
    // No topic chosen on load -> no page control.
    expect(pageField.hidden).toBe(true);
    // The only topic spans a single page, so the chips have nothing to offer.
    topic.value = 'Warm-ups';
    topic.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().exercise.topic).toBe('Warm-ups');
    expect(pageField.hidden).toBe(true);
  });

  it('the page chips show once a topic spans more than one page', async () => {
    const store = await mountMultiPage();
    const pageField = document.getElementById('ex-page-field') as HTMLElement;
    const topic = document.getElementById('ex-topic') as HTMLSelectElement;
    // No topic chosen on load -> no page control.
    expect(pageField.hidden).toBe(true);
    // Selecting the multi-page topic reveals the (topic-filtered) chips.
    topic.value = 'Warm-ups';
    topic.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().exercise.topic).toBe('Warm-ups');
    expect(pageField.hidden).toBe(false);
    const chips = document.querySelectorAll('#ex-page-chips .ex-page-chip');
    expect([...chips].map((c) => (c as HTMLElement).dataset.page)).toEqual(['1', '2']);
    // Clearing the topic hides them again.
    topic.value = '';
    topic.dispatchEvent(new Event('change', { bubbles: true }));
    expect(pageField.hidden).toBe(true);
  });

  it('toggling chips builds the page set; clearing all means "all pages"', async () => {
    const store = await mountMultiPage();
    const topic = document.getElementById('ex-topic') as HTMLSelectElement;
    topic.value = 'Warm-ups';
    topic.dispatchEvent(new Event('change', { bubbles: true }));
    const chip = (page: string) =>
      document.querySelector(`#ex-page-chips .ex-page-chip[data-page="${page}"]`) as HTMLButtonElement;

    chip('2').click();
    expect(store.get().exercise.pages).toEqual(['2']);
    expect(chip('2').classList.contains('active')).toBe(true);

    chip('1').click();
    expect(store.get().exercise.pages).toEqual(['2', '1']);

    // Toggling both back off returns to the empty ("all pages") set.
    chip('2').click();
    chip('1').click();
    expect(store.get().exercise.pages).toEqual([]);
    expect(chip('1').classList.contains('active')).toBe(false);
  });

  it('the overlay arrows step prev/next within the filter (wrapping)', async () => {
    const store = await mount();
    (document.getElementById('ex-next') as HTMLButtonElement).click();
    expect(store.get().exercise.currentId).toBe('0001-2');
    // from the first item, prev wraps to the last of the 16
    (document.getElementById('ex-prev') as HTMLButtonElement).click();
    (document.getElementById('ex-prev') as HTMLButtonElement).click();
    expect(store.get().exercise.currentId).toBe('0001-16');
  });

  it('the Random toggle is stored', async () => {
    const store = await mount();
    const random = document.getElementById('ex-random') as HTMLInputElement;
    random.checked = true;
    random.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().exercise.random).toBe(true);
  });

  it('enabling Auto records the interval', async () => {
    const store = await mount();
    const autoToggle = document.getElementById('ex-auto-toggle') as HTMLDivElement;
    const inc = document.getElementById('ex-delta-inc') as HTMLButtonElement;
    // Click the header to toggle auto-advance on (restores the last value, default 20s)
    autoToggle.click();
    expect(store.get().exercise.autoSec).toBe(20);
    // The +15s button raises the interval (pointerdown then pointerup without a drag = click).
    inc.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientY: 0 }));
    inc.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientY: 0 }));
    expect(store.get().exercise.autoSec).toBe(35);
    // Click again to turn off
    autoToggle.click();
    expect(store.get().exercise.autoSec).toBe(0);
  });
});
