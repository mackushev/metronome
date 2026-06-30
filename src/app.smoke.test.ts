// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

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
        return { buffer: null, connect: () => ({ connect() {} }), start() {}, stop() {} };
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

  it('sound controls are built', () => {
    // The main-beat sound row offers only the two click timbres
    expect(document.querySelectorAll('#sound-seg .seg-btn').length).toBe(2);
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

  it('the tempo dial is rendered as a jog wheel: rim, marker, grab zone and two ±1 buttons', () => {
    expect(document.querySelector('#circle .dial-rim')).not.toBeNull();
    expect(document.querySelector('#circle .dial-marker')).not.toBeNull();
    expect(document.querySelector('#circle .dial-hit')).not.toBeNull();
    expect(document.querySelectorAll('#circle .dial-arrow-btn').length).toBe(2);
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

  it('tempo is displayed correctly', () => {
    expect(document.getElementById('bpm-value')!.textContent).toBe('120');
  });

  it('beat bar: one rectangle per beat, a tap cycles its state', () => {
    const beats = document.querySelectorAll('#circle .dot-beat').length;
    let cells = document.querySelectorAll('#beat-bar .beat-cell');
    expect(cells.length).toBe(beats);
    cells[2].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    cells = document.querySelectorAll('#beat-bar .beat-cell');
    expect(cells[2].classList.contains('accent')).toBe(true);
  });

  it('exercises are off by default, so the beat bar is visible', () => {
    expect((document.getElementById('beat-bar') as HTMLElement).hidden).toBe(false);
    expect((document.getElementById('exercise-view') as HTMLElement).hidden).toBe(true);
    expect(document.getElementById('app')!.classList.contains('mode-metronome')).toBe(true);
  });

  it('the Exercises pill reshapes the page: sheet shown, beat bar hidden', () => {
    (document.getElementById('mode-exercises') as HTMLButtonElement).click();
    expect((document.getElementById('exercise-view') as HTMLElement).hidden).toBe(false);
    expect((document.getElementById('beat-bar') as HTMLElement).hidden).toBe(true);
    expect(document.getElementById('app')!.classList.contains('mode-exercises')).toBe(true);
    // back to the metronome
    (document.getElementById('mode-metronome') as HTMLButtonElement).click();
    expect((document.getElementById('beat-bar') as HTMLElement).hidden).toBe(false);
  });

  it('the Polyrhythm pill shows the base ring plus voice rings and hides the beat bar', () => {
    (document.getElementById('mode-polyrhythm') as HTMLButtonElement).click();
    expect(document.getElementById('app')!.classList.contains('mode-polyrhythm')).toBe(true);
    expect((document.getElementById('beat-bar') as HTMLElement).hidden).toBe(true);
    // base meter ticks (the beat count carries over from metronome mode) + voices 3,4,3,2
    expect(document.querySelectorAll('#circle .dot-beat').length).toBeGreaterThan(0);
    expect(document.querySelectorAll('#circle .dot-poly-v0').length).toBe(3);
    expect(document.querySelectorAll('#circle .dot-poly-v1').length).toBe(4);
    expect(document.querySelectorAll('#circle .dot-poly-v3').length).toBe(2);
    // back to the metronome removes the voice rings
    (document.getElementById('mode-metronome') as HTMLButtonElement).click();
    expect(document.querySelectorAll('#circle .dot-poly').length).toBe(0);
    expect((document.getElementById('beat-bar') as HTMLElement).hidden).toBe(false);
  });

  it('a voice pulse stepper changes that voice ring', () => {
    (document.getElementById('mode-polyrhythm') as HTMLButtonElement).click();
    const row0 = document.querySelectorAll('#poly-voices .poly-voice')[0];
    const [dec, inc] = row0.querySelectorAll<HTMLButtonElement>('.poly-voice-pulses .btn');
    inc.click();
    expect(row0.querySelector('.trainer-num')!.textContent).toBe('4');
    expect(document.querySelectorAll('#circle .dot-poly-v0').length).toBe(4);
    dec.click();
    expect(row0.querySelector('.trainer-num')!.textContent).toBe('3');
    expect(document.querySelectorAll('#circle .dot-poly-v0').length).toBe(3);
    (document.getElementById('mode-metronome') as HTMLButtonElement).click();
  });

  it('tapping a voice on/off dot disables and re-enables the whole voice', () => {
    (document.getElementById('mode-polyrhythm') as HTMLButtonElement).click();
    const row0 = document.querySelectorAll('#poly-voices .poly-voice')[0];
    const toggle = row0.querySelector('.poly-voice-dot') as HTMLButtonElement;
    toggle.click();
    expect(toggle.classList.contains('off')).toBe(true);
    expect(row0.classList.contains('disabled')).toBe(true);
    expect(document.querySelectorAll('#circle .dot-poly-v0.disabled').length).toBeGreaterThan(0);
    toggle.click();
    expect(toggle.classList.contains('off')).toBe(false);
    expect(document.querySelectorAll('#circle .dot-poly-v0.disabled').length).toBe(0);
    (document.getElementById('mode-metronome') as HTMLButtonElement).click();
  });

  it('tapping a voice dot mutes only that single pulse', () => {
    (document.getElementById('mode-polyrhythm') as HTMLButtonElement).click();
    let dots = document.querySelectorAll('#circle .dot-poly-v1');
    dots[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    dots = document.querySelectorAll('#circle .dot-poly-v1');
    expect(dots[1].classList.contains('muted')).toBe(true);
    expect(dots[0].classList.contains('muted')).toBe(false);
    dots[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    dots = document.querySelectorAll('#circle .dot-poly-v1');
    expect(dots[1].classList.contains('muted')).toBe(false);
    (document.getElementById('mode-metronome') as HTMLButtonElement).click();
  });

  it('trainer: every button updates the displayed value', () => {
    const incBtn = document.getElementById('t0-delta-inc') as HTMLButtonElement;
    const decBtn = document.getElementById('t0-delta-dec') as HTMLButtonElement;
    const num = document.getElementById('t0-delta-num')!;
    // default is 30; tap +15s
    incBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    incBtn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(num.textContent).toBe('45');
    // tap −15s
    decBtn.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    decBtn.dispatchEvent(new MouseEvent('pointerup', { bubbles: true }));
    expect(num.textContent).toBe('30');
  });

  it('tapping a subdivision dot mutes only that single ghost click', () => {
    // Use the circle arc selector to turn on subdivisions (2nd dot = value 2)
    const subdivDots = document.querySelectorAll('#circle .sel-hit');
    // The last 8 hit zones belong to the subdiv arc
    const subdiv2Hit = subdivDots[subdivDots.length - 7]; // 2nd subdiv dot (value=2)
    subdiv2Hit.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
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
    const before = Number(document.getElementById('bpm-value')!.textContent);
    hits[1].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(document.getElementById('bpm-value')!.textContent).toBe(String(before + 1));
    hits[0].dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(document.getElementById('bpm-value')!.textContent).toBe(String(before));
  });
});
