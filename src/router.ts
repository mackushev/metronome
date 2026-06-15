import type { AppMode } from './state';

/** Valid mode slugs that appear in the URL path. */
const MODE_SLUGS: Record<string, AppMode> = {
  metronome: 'metronome',
  exercises: 'exercises',
  polyrhythm: 'polyrhythm',
};

/** The default mode is "metronome" — used when the URL has no mode segment. */
const DEFAULT_MODE: AppMode = 'metronome';

/**
 * Return the base path that Vite injects (e.g. "/metronome/" in production,
 * "/" in dev). We read it from `<base href>` if present, otherwise fall back
 * to "/".
 */
function basePath(): string {
  return import.meta.env.BASE_URL ?? '/';
}

/**
 * Extract the mode from the current `location.pathname`, stripping the base
 * path prefix. Returns `null` when the URL is just the base (no mode segment),
 * meaning "use whatever mode was saved in localStorage".
 */
export function modeFromUrl(): AppMode | null {
  const base = basePath();
  let path = location.pathname;

  // Strip the base prefix so we are left with the mode slug (or nothing).
  if (path.startsWith(base)) {
    path = path.slice(base.length);
  }

  // Remove trailing slash and any query string leaking in.
  const segment = path.replace(/\/+$/, '').split('/')[0]?.toLowerCase() ?? '';

  if (segment === '') return null; // bare root — no explicit mode in URL
  return MODE_SLUGS[segment] ?? null; // unknown segment — treat as root
}

/** Build the full URL path for the given mode. */
function modePath(mode: AppMode): string {
  const base = basePath();
  // "metronome" is the default — we represent it as the bare base path.
  if (mode === DEFAULT_MODE) return base;
  return `${base}${mode}`;
}

/**
 * Push a new history entry for the given mode. The page does **not** reload —
 * only the URL in the address bar changes.
 *
 * After pushing, we ping GoatCounter (if loaded) so the "page view" shows up
 * in analytics.
 */
export function pushMode(mode: AppMode): void {
  const target = modePath(mode);
  // Avoid duplicate entries when the user taps the already-active pill.
  if (location.pathname === target) return;
  history.pushState({ mode }, '', target);
  trackPageView(target);
}

/**
 * Replace the current history entry (no new back-stack item). Used on the
 * very first load so that the initial URL is correct without polluting the
 * back button.
 */
export function replaceMode(mode: AppMode): void {
  const target = modePath(mode);
  if (location.pathname === target) return;
  history.replaceState({ mode }, '', target);
}

/**
 * Listen for browser back / forward navigation. The callback receives the
 * mode encoded in the history state, or re-reads the URL if the state is
 * missing (e.g. the very first entry has no state).
 */
export function onPopState(cb: (mode: AppMode) => void): void {
  window.addEventListener('popstate', (event) => {
    const stateMode = (event.state as { mode?: string } | null)?.mode;
    const fromState: AppMode | undefined =
      stateMode != null ? MODE_SLUGS[stateMode] : undefined;
    cb(fromState ?? modeFromUrl() ?? DEFAULT_MODE);
  });
}

// ---------------------------------------------------------------------------
// GoatCounter integration
// ---------------------------------------------------------------------------

interface GoatCounter {
  count: (vars: { path: string; event?: boolean }) => void;
}

declare global {
  interface Window {
    goatcounter?: GoatCounter;
  }
}

/** Tell GoatCounter about a virtual page view after a pushState navigation. */
function trackPageView(path: string): void {
  try {
    window.goatcounter?.count({ path });
  } catch {
    // GoatCounter not loaded (dev, ad-blocker, offline) — silently skip.
  }
}
