import { describe, expect, it, vi } from 'vitest';
import { scheduleSound } from './sounds';

describe('scheduleSound noise buffers', () => {
  it('reuses one white-noise buffer for repeated drum hits', () => {
    const audioParam = {
      value: 0,
      setValueAtTime: vi.fn(),
      exponentialRampToValueAtTime: vi.fn(),
    };
    const createBuffer = vi.fn((_channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }));
    const ctx = {
      sampleRate: 1000,
      createBuffer,
      createGain: () => ({ gain: { ...audioParam }, connect: vi.fn() }),
      createOscillator: () => ({
        type: 'sine',
        frequency: { ...audioParam },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
      }),
      createBiquadFilter: () => ({
        type: 'bandpass',
        frequency: { ...audioParam },
        Q: { ...audioParam },
        connect: vi.fn(),
      }),
      createBufferSource: () => ({ buffer: null, connect: vi.fn(), start: vi.fn() }),
    } as unknown as AudioContext;
    const dest = {} as AudioNode;

    scheduleSound(ctx, dest, 'hihat', 'normal', 0);
    scheduleSound(ctx, dest, 'snare', 'normal', 1);

    expect(createBuffer).toHaveBeenCalledOnce();
  });
});
