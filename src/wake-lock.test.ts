// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('wake lock', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('releases a lock that resolves after the caller no longer wants it', async () => {
    let resolveRequest!: (sentinel: {
      released: boolean;
      release: () => Promise<void>;
      addEventListener: () => void;
    }) => void;
    const request = vi.fn(
      () =>
        new Promise<{
          released: boolean;
          release: () => Promise<void>;
          addEventListener: () => void;
        }>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request },
    });
    const release = vi.fn(async () => {});
    const { requestWakeLock, releaseWakeLock } = await import('./wake-lock');

    requestWakeLock();
    releaseWakeLock();
    resolveRequest({ released: false, release, addEventListener: vi.fn() });
    await Promise.resolve();
    await Promise.resolve();

    expect(request).toHaveBeenCalledOnce();
    expect(release).toHaveBeenCalledOnce();
  });
});
