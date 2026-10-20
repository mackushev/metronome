// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Store, defaultSettings, loadSettings } from '../state';
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

function chooseTopic(value: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>('#ex-topic button')]
    .find((button) => button.dataset.topic === value)!;
  button.click();
}

function chooseGroup(value: string) {
  const group = document.getElementById('ex-group') as HTMLSelectElement;
  group.value = value;
  group.dispatchEvent(new Event('change', { bubbles: true }));
}

async function mount(selectGroup = true) {
  const store = new Store(defaultSettings());
  const view = new ExerciseView(store);
  await view.show();
  if (selectGroup) chooseGroup('other');
  return { store, view };
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

async function mountRhythmicAlphabet() {
  manifest.push('benny_greb.json');
  descriptors['benny_greb.json'] = {
    generator: 'benny-greb-alphabet',
    topic: 'Benny Greb alphabet',
    binaryPage: 'Binary · A–P',
    ternaryPage: 'Triplets · Q–X',
    wordLength: 4,
  };
  try {
    return await mount();
  } finally {
    manifest.pop();
    delete descriptors['benny_greb.json'];
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

  it('requires an explicit group before showing exercises or starting auto-advance', async () => {
    const { store, view } = await mount(false);
    expect(store.get().exercise.currentId).toBeNull();
    expect(document.getElementById('ex-viewport')!.hidden).toBe(true);
    expect(document.getElementById('ex-empty')!.textContent).toContain('Choose an exercise group');
    expect((document.getElementById('ex-group') as HTMLSelectElement).required).toBe(true);
    expect(document.getElementById('ex-topic-field')!.hidden).toBe(true);
    (document.getElementById('ex-next') as HTMLButtonElement).click();
    store.update({ exercise: { ...store.get().exercise, autoSec: 20 } });
    view.setPlaying(true);
    view.onMeasureStart();
    expect(view.stageInfo().itemId).toBeNull();
    expect(view.stageInfo().remainingSec).toBeNull();
    expect(document.getElementById('ex-preview')!.hidden).toBe(true);
    chooseGroup('other');
    expect(store.get().exercise.currentId).toBe('0001-1');
    view.setPlaying(false);
  });

  it('switching groups clears topic/pages and keeps previews inside the group', async () => {
    const { store, view } = await mountRhythmicAlphabet();
    (document.getElementById('ex-auto-toggle') as HTMLButtonElement).click();
    chooseGroup('benny-greb');
    expect(store.get().exercise.topics).toEqual([]);
    expect(store.get().exercise.pages).toEqual([]);
    const topics = [...document.querySelectorAll<HTMLButtonElement>('#ex-topic button')].map((o) => o.dataset.topic);
    expect(topics).toEqual(['Benny Greb alphabet']);
    expect((document.getElementById('ex-preview-img') as HTMLImageElement).src).toMatch(/^data:/);
    chooseGroup('other');
    expect(store.get().exercise.currentId).toBe('0001-1');
    expect((document.getElementById('ex-preview-img') as HTMLImageElement).src).toContain('sample.svg');
    expect(view.stageInfo().itemId).toBe('0001-1');
    (document.getElementById('ex-auto-toggle') as HTMLButtonElement).click();
  });

  it('restores a valid saved group and exercise', async () => {
    const settings = defaultSettings();
    settings.exercise = { ...settings.exercise, group: 'other', topics: ['Warm-ups'], currentId: '0001-4' };
    const store = new Store(settings);
    const view = new ExerciseView(store);
    await view.show();
    expect(store.get().exercise.currentId).toBe('0001-4');
    expect((document.getElementById('ex-group') as HTMLSelectElement).value).toBe('other');
    expect(document.getElementById('ex-caption')!.textContent).toContain('4/16');
  });

  it('clears stale saved groups instead of falling back to all exercises', async () => {
    const settings = defaultSettings();
    settings.exercise = { ...settings.exercise, group: 'removed-group', topics: ['Warm-ups'], currentId: '0001-1', pages: ['1'] };
    const store = new Store(settings);
    const view = new ExerciseView(store);
    await view.show();
    expect(store.get().exercise).toMatchObject({ group: '', topics: [], currentId: null, pages: [] });
    expect(view.stageInfo().itemId).toBeNull();
  });

  it('renders the first item after a group is selected', async () => {
    const { store } = await mount();
    const img = document.getElementById('ex-img') as HTMLImageElement;
    expect(img.src).toContain('content/sample.svg');
    // 8x2 grid -> 16 items
    expect(document.getElementById('ex-caption')!.textContent).toContain('1/16');
    expect(store.get().exercise.currentId).toBe('0001-1');
  });

  it('combines selected topics and removes only the topic clicked again', async () => {
    manifest.push('0002.json');
    descriptors['0002.json'] = { ...descriptor, page: '2', topic: 'Coordination' };
    try {
      const { store } = await mount();
      chooseTopic('Warm-ups');
      expect(document.getElementById('ex-caption')!.textContent).toContain('1/16');
      chooseTopic('Coordination');
      expect(store.get().exercise.topics).toEqual(['Warm-ups', 'Coordination']);
      expect(document.getElementById('ex-caption')!.textContent).toContain('1/32');
      expect([...document.querySelectorAll('#ex-topic button[aria-pressed="true"]')]).toHaveLength(2);
      expect([...document.querySelectorAll<HTMLElement>('#ex-page-chips button')].map((el) => el.dataset.page)).toEqual(['1', '2']);
      chooseTopic('Warm-ups');
      expect(store.get().exercise.topics).toEqual(['Coordination']);
      expect(store.get().exercise.currentId).toBe('0002-1');
      expect(document.getElementById('ex-caption')!.textContent).toContain('1/16');
      (document.getElementById('ex-prev') as HTMLButtonElement).click();
      expect(store.get().exercise.currentId).toBe('0002-16');
      chooseTopic('Coordination');
      expect(store.get().exercise.topics).toEqual([]);
      expect(document.getElementById('ex-caption')!.textContent).toContain('/32');
    } finally {
      manifest.pop();
      delete descriptors['0002.json'];
    }
  });

  it('migrates the saved single topic and restores multiple saved topics', () => {
    const getItem = vi.fn().mockReturnValue(JSON.stringify({ exercise: { topic: 'Warm-ups' } }));
    vi.stubGlobal('localStorage', { getItem });
    expect(loadSettings().exercise.topics).toEqual(['Warm-ups']);
    getItem.mockReturnValue(JSON.stringify({ exercise: { topics: ['Warm-ups', 'Coordination'] } }));
    expect(loadSettings().exercise.topics).toEqual(['Warm-ups', 'Coordination']);
  });

  it('topics toggle independently without an All button and only the group uses a select', async () => {
    await mount();
    const topics = document.querySelectorAll('#ex-topic button');
    expect([...topics].map((o) => (o as HTMLButtonElement).dataset.topic)).toEqual(['Warm-ups']);
    expect([...document.querySelectorAll('#exercise-view select')].map((el) => el.id)).toEqual(['ex-group']);
    chooseTopic('Warm-ups');
    expect(topics[0].getAttribute('aria-pressed')).toBe('true');
    chooseTopic('Warm-ups');
    expect(topics[0].getAttribute('aria-pressed')).toBe('false');
  });

  it('page chips are derived (one per page) — no combobox', async () => {
    const { store } = await mountMultiPage();
    expect(document.querySelector('#ex-page')).toBeNull(); // no <select>
    chooseTopic('Warm-ups');
    const chips = document.querySelectorAll('#ex-page-chips .ex-page-chip');
    expect([...chips].map((c) => (c as HTMLElement).dataset.page)).toEqual(['1', '2']);
    // Nothing selected by default -> every chip is off (= all pages active).
    expect([...chips].some((c) => c.classList.contains('active'))).toBe(false);
    expect(store.get().exercise.pages).toEqual([]);
  });

  it('the page chips stay hidden for a single-page topic (nothing to choose)', async () => {
    const { store } = await mount();
    const pageField = document.getElementById('ex-page-field') as HTMLElement;
    // No topic chosen on load -> no page control.
    expect(pageField.hidden).toBe(true);
    // The only topic spans a single page, so the chips have nothing to offer.
    chooseTopic('Warm-ups');
    expect(store.get().exercise.topics).toEqual(['Warm-ups']);
    expect(pageField.hidden).toBe(true);
  });

  it('the page chips show once a topic spans more than one page', async () => {
    const { store } = await mountMultiPage();
    const pageField = document.getElementById('ex-page-field') as HTMLElement;
    // No topic chosen on load -> no page control.
    expect(pageField.hidden).toBe(true);
    // Selecting the multi-page topic reveals the (topic-filtered) chips.
    chooseTopic('Warm-ups');
    expect(store.get().exercise.topics).toEqual(['Warm-ups']);
    expect(pageField.hidden).toBe(false);
    const chips = document.querySelectorAll('#ex-page-chips .ex-page-chip');
    expect([...chips].map((c) => (c as HTMLElement).dataset.page)).toEqual(['1', '2']);
    // Clearing the topic hides them again.
    chooseTopic('Warm-ups');
    expect(pageField.hidden).toBe(true);
  });

  it('toggling chips builds the page set; clearing all means "all pages"', async () => {
    const { store } = await mountMultiPage();
    chooseTopic('Warm-ups');
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
    const { store } = await mount();
    (document.getElementById('ex-next') as HTMLButtonElement).click();
    expect(store.get().exercise.currentId).toBe('0001-2');
    // from the first item, prev wraps to the last of the 16
    (document.getElementById('ex-prev') as HTMLButtonElement).click();
    (document.getElementById('ex-prev') as HTMLButtonElement).click();
    expect(store.get().exercise.currentId).toBe('0001-16');
  });

  it('the Random toggle is stored', async () => {
    const { store } = await mount();
    const random = document.getElementById('ex-random') as HTMLInputElement;
    expect(random.closest('.collapsible-title-row')).not.toBeNull();
    random.checked = true;
    random.dispatchEvent(new Event('change', { bubbles: true }));
    expect(store.get().exercise.random).toBe(true);
  });

  it('enabling Auto records the interval', async () => {
    const { store } = await mount();
    const autoToggle = document.getElementById('ex-auto-toggle') as HTMLButtonElement;
    const inc = document.getElementById('ex-delta-inc') as HTMLButtonElement;
    // Click the header to toggle auto-advance on (restores the last value, default 20s)
    autoToggle.click();
    expect(store.get().exercise.autoSec).toBe(20);
    // The +15s button raises the interval.
    inc.click();
    expect(store.get().exercise.autoSec).toBe(35);
    // Click again to turn off
    autoToggle.click();
    expect(store.get().exercise.autoSec).toBe(0);
  });

  it('re-picks the preview after manual navigation', async () => {
    const { store } = await mount();
    (document.getElementById('ex-auto-toggle') as HTMLButtonElement).click();
    expect(document.getElementById('ex-preview-label')!.textContent).toContain('2/16');

    (document.getElementById('ex-next') as HTMLButtonElement).click();

    expect(store.get().exercise.currentId).toBe('0001-2');
    expect(document.getElementById('ex-preview-label')!.textContent).toContain('3/16');
  });

  it('keeps the cached preview inside a newly selected page', async () => {
    const { store } = await mountMultiPage();
    chooseTopic('Warm-ups');
    (document.getElementById('ex-auto-toggle') as HTMLButtonElement).click();

    const page2 = document.querySelector(
      '#ex-page-chips .ex-page-chip[data-page="2"]',
    ) as HTMLButtonElement;
    page2.click();

    expect(store.get().exercise.currentId).toBe('0002-1');
    expect(document.getElementById('ex-preview-label')!.textContent).toContain('2/16');
    expect((document.getElementById('ex-preview-img') as HTMLImageElement).src).toContain('sample.svg');
  });

  it('selects and renders generated three-letter alphabet exercises', async () => {
    const { store } = await mountRhythmicAlphabet();
    chooseGroup('benny-greb');
    chooseTopic('Benny Greb alphabet');

    expect(store.get().exercise.currentId).toBe('benny-binary-ABCD');
    expect((document.getElementById('ex-img') as HTMLImageElement).src).toMatch(/^data:image\/svg\+xml/);
    expect(document.getElementById('ex-caption')!.textContent).toContain('A · B · C · D · 1/45360');
    (document.getElementById('ex-next') as HTMLButtonElement).click();
    expect(store.get().exercise.currentId).toBe('benny-binary-EFGH');
    expect(document.getElementById('ex-caption')!.textContent).toContain('E · F · G · H · 2/45360');

    const pages = [...document.querySelectorAll('#ex-page-chips .ex-page-chip')];
    expect(pages.map((page) => page.textContent)).toEqual(['Binary · A–P', 'Triplets · Q–X']);
    (pages[1] as HTMLButtonElement).click();
    expect(store.get().exercise.currentId).toBe('benny-ternary-QRST');
    expect(document.getElementById('ex-caption')!.textContent).toContain('Q · R · S · T · 1/1680');

    // Turning Triplets off returns to the default binary sequence; navigation
    // must not remain trapped in the ternary alphabet.
    (pages[1] as HTMLButtonElement).click();
    expect(store.get().exercise.pages).toEqual([]);
    expect(store.get().exercise.currentId).toBe('benny-binary-ABCD');
    (document.getElementById('ex-next') as HTMLButtonElement).click();
    expect(store.get().exercise.currentId).toBe('benny-binary-EFGH');
  });

  it('retries content loading after a transient manifest failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockImplementation(mockFetch());
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = new Store(defaultSettings());
    const view = new ExerciseView(store);

    await view.show();
    expect(store.get().exercise.currentId).toBeNull();
    await view.show();
    expect(store.get().exercise.currentId).toBeNull();
    chooseGroup('other');

    expect(store.get().exercise.currentId).toBe('0001-1');
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
