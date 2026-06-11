// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it, vi } from 'vitest';

describe('smoke: the app mounts', () => {
  beforeAll(async () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8');
    document.body.innerHTML = html.match(/<body>([\s\S]*)<\/body>/)![1];
    if (!('requestAnimationFrame' in globalThis) || typeof requestAnimationFrame !== 'function') {
      (globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;
    }
    // jsdom has no Web Audio — a minimal stub so previews triggered by clicks do not throw
    const audioParam = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    (globalThis as Record<string, unknown>).AudioContext = class {
      currentTime = 0;
      destination = {};
      resume() {
        return Promise.resolve();
      }
      createGain() {
        return { gain: { ...audioParam }, connect: () => this.destination };
      }
      createOscillator() {
        return { type: '', frequency: { ...audioParam }, connect() {}, start() {}, stop() {} };
      }
      createBiquadFilter() {
        return { type: '', frequency: { ...audioParam }, Q: { ...audioParam }, connect() {} };
      }
      createBuffer(_ch: number, len: number) {
        return { getChannelData: () => new Float32Array(len) };
      }
      createBufferSource() {
        return { buffer: null, connect: () => ({ connect() {} }), start() {} };
      }
    };
    await import('./main');
  });

  it('the circle is rendered: 4 beats with the first one accented', () => {
    const beatDots = document.querySelectorAll('#circle .dot-beat');
    expect(beatDots.length).toBe(4);
    expect(beatDots[0].classList.contains('accent')).toBe(true);
  });

  it('shows the default BPM', () => {
    expect(document.getElementById('bpm-value')!.textContent).toBe('120');
  });

  it('subdivision and sound controls are built', () => {
    expect(document.querySelectorAll('#subdiv-seg .seg-btn').length).toBe(8);
    expect(document.querySelectorAll('#sound-seg .seg-btn').length).toBe(3);
  });

  it('outer selectors: 8 dots per arc plus sector backdrops', () => {
    expect(document.querySelectorAll('#circle .sel-dot.sel-beats').length).toBe(8);
    expect(document.querySelectorAll('#circle .sel-dot.sel-subdiv').length).toBe(8);
    expect(document.querySelectorAll('#circle .sel-band').length).toBe(2);
  });

  it('tapping an outer dot sets the number of beats', () => {
    const hits = document.querySelectorAll('#circle .sel-hit');
    // the first 8 hit zones belong to the beats arc; take the sixth dot
    hits[5].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(document.querySelectorAll('#circle .dot-beat').length).toBe(6);
    expect(document.querySelectorAll('#circle .sel-dot.sel-beats.filled').length).toBe(6);
  });

  it('a tap on a beat dot cycles its state', () => {
    const dot = document.querySelectorAll('#circle .dot-beat')[1];
    dot.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(document.querySelectorAll('#circle .dot-beat')[1].classList.contains('accent')).toBe(true);
  });

  it('the tempo dial is rendered: track, rotation zone and two arrows', () => {
    expect(document.querySelector('#circle .dial-track')).not.toBeNull();
    expect(document.querySelector('#circle .dial-hit')).not.toBeNull();
    expect(document.querySelectorAll('#circle .dial-arrow').length).toBe(2);
  });

  it('clicks-vs-beats balance: 3 positions, soft selected by default', () => {
    const btns = document.querySelectorAll<HTMLButtonElement>('#balance-seg .balance-btn');
    expect(btns.length).toBe(3);
    expect(btns[0].classList.contains('selected')).toBe(true);
    btns[2].click();
    expect(btns[2].classList.contains('selected')).toBe(true);
    expect(btns[0].classList.contains('selected')).toBe(false);
  });

  it('the volume slider is bound to the settings', () => {
    const slider = document.getElementById('volume-slider') as HTMLInputElement;
    expect(slider.value).toBe('80');
    slider.value = '40';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    expect(slider.value).toBe('40');
  });

  it('the +5 button changes the tempo and the slider', () => {
    const plus5 = document.querySelector<HTMLButtonElement>('[data-bpm-delta="5"]')!;
    plus5.click();
    expect(document.getElementById('bpm-value')!.textContent).toBe('125');
    expect((document.getElementById('bpm-slider') as HTMLInputElement).value).toBe('125');
  });

  it('beat bar: one rectangle per beat, a tap cycles its state', () => {
    const beats = document.querySelectorAll('#circle .dot-beat').length;
    let cells = document.querySelectorAll('#beat-bar .beat-cell');
    expect(cells.length).toBe(beats);
    expect(cells[2].classList.contains('normal')).toBe(true);
    cells[2].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    cells = document.querySelectorAll('#beat-bar .beat-cell');
    expect(cells[2].classList.contains('accent')).toBe(true);
  });

  it('trainer inputs auto-apply after a typing pause', () => {
    vi.useFakeTimers();
    try {
      const delta = document.getElementById('trainer-delta') as HTMLInputElement;
      // an invalid value falls back to the previous one (30) on apply,
      // which makes the auto-apply observable
      delta.value = '0';
      delta.dispatchEvent(new Event('input', { bubbles: true }));
      expect(delta.value).toBe('0');
      vi.advanceTimersByTime(2100);
      expect(delta.value).toBe('30');
    } finally {
      vi.useRealTimers();
    }
  });

  it('tapping a subdivision dot mutes only that single ghost click', () => {
    // turn on subdivisions so sub dots exist
    const btn2 = document.querySelector<HTMLButtonElement>('#subdiv-seg .seg-btn[data-value="2"]')!;
    btn2.click();
    let subs = document.querySelectorAll('#circle .dot-sub');
    expect(subs.length).toBeGreaterThan(1);
    subs[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    subs = document.querySelectorAll('#circle .dot-sub');
    expect(subs[0].classList.contains('muted')).toBe(true);
    expect(subs[1].classList.contains('muted')).toBe(false);
    subs[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    subs = document.querySelectorAll('#circle .dot-sub');
    expect(subs[0].classList.contains('muted')).toBe(false);
  });

  it('the audio notice is hidden by default', () => {
    expect((document.getElementById('audio-notice') as HTMLElement).hidden).toBe(true);
  });

  it('dial arrows nudge the tempo by ±1', () => {
    const hits = document.querySelectorAll('#circle .dial-arrow-hit');
    hits[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(document.getElementById('bpm-value')!.textContent).toBe('126');
    hits[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(document.getElementById('bpm-value')!.textContent).toBe('125');
  });
});
