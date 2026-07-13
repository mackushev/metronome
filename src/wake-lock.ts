/**
 * Screen Wake Lock helper — keeps the display awake while the stage view is
 * open so the metronome stays visible mid-performance.
 *
 * The API is not universal (older browsers, insecure contexts) and the browser
 * silently drops the lock whenever the tab is hidden, so everything here
 * degrades quietly: a missing API or a rejected request is a no-op, and we
 * re-acquire on `visibilitychange` while the lock is meant to be held.
 */

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

interface WakeLockNavigator {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}

let sentinel: WakeLockSentinelLike | null = null;
/** True while the caller wants the lock held (drives re-acquire on visibility). */
let wanted = false;
let listenerBound = false;

function supported(): boolean {
  return 'wakeLock' in navigator;
}

async function acquire(): Promise<void> {
  if (!wanted || sentinel || document.visibilityState !== 'visible') return;
  const nav = navigator as unknown as WakeLockNavigator;
  if (!nav.wakeLock) return;
  try {
    sentinel = await nav.wakeLock.request('screen');
    sentinel.addEventListener('release', () => {
      sentinel = null;
    });
  } catch {
    // Denied (battery saver, permissions) — keep working without it.
    sentinel = null;
  }
}

function bindVisibility(): void {
  if (listenerBound) return;
  listenerBound = true;
  document.addEventListener('visibilitychange', () => {
    if (wanted && document.visibilityState === 'visible') void acquire();
  });
}

/** Ask the OS to keep the screen on. Safe to call when unsupported. */
export function requestWakeLock(): void {
  if (!supported()) return;
  wanted = true;
  bindVisibility();
  void acquire();
}

/** Release the lock (if held) and stop re-acquiring. */
export function releaseWakeLock(): void {
  wanted = false;
  const held = sentinel;
  sentinel = null;
  if (held && !held.released) void held.release().catch(() => {});
}
