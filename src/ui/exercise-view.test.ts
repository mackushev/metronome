// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store, defaultSettings } from '../state';
import { ExerciseView } from './exercise-view';

const manifest = ['0001.json'];
const descriptor = {
  image: 'sample.svg',
  w: 1200,
  h: 1600,
  page: '1',
  topic: 'Warm-ups',
  grid: { rows: 8, cols: 2, margin: { top: 120, right: 60, bottom: 60, left: 60 }, gapX: 40, gapY: 30 },
};

function mockFetch() {
  return vi.fn(async (url: string) => {
    const body = url.includes('manifest.json') ? manifest : descriptor;
    return { ok: true, status: 200, json: async () => body } as Response;
  });
}

async function mount() {
  const store = new Store(defaultSettings());
  const view = new ExerciseView(store);
  await view.show();
  return store;
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

  it('page and topic pickers are derived, each with an "All" option', async () => {
    await mount();
    const pages = document.querySelectorAll('#ex-page option');
    const topics = document.querySelectorAll('#ex-topic option');
    expect([...pages].map((o) => (o as HTMLOptionElement).value)).toEqual(['', '1']);
    expect([...topics].map((o) => (o as HTMLOptionElement).value)).toEqual(['', 'Warm-ups']);
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
    const auto = document.getElementById('ex-auto') as HTMLInputElement;
    const sec = document.getElementById('ex-auto-sec') as HTMLInputElement;
    sec.value = '30';
    auto.checked = true;
    auto.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().exercise.autoSec).toBe(30);
  });
});
