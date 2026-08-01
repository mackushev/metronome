/** Visual themes. Layout-affecting values live alongside color and type tokens
 * in style.css; this catalog supplies user-facing metadata and safe ids. */
export const THEMES = [
  {
    id: 'classic',
    label: 'Classic',
    description: 'Soft dark',
    browserColor: '#101218',
    preview: {
      bg: '#101218',
      panel: '#1d212b',
      accent: '#ffb02e',
      beat: '#5db1ff',
      trainer: '#3fd67f',
      radius: '8px',
      font: 'system-ui, sans-serif',
    },
  },
  {
    id: 'acid',
    label: 'Acid clean',
    description: 'Hard contrast',
    browserColor: '#0b0b0d',
    preview: {
      bg: '#0b0b0d',
      panel: '#141417',
      accent: '#ffe000',
      beat: '#3ae1ff',
      trainer: '#c6ff2e',
      radius: '2px',
      font: "'Space Grotesk', sans-serif",
    },
  },
] as const;

export type ThemeName = (typeof THEMES)[number]['id'];

export function isThemeName(value: unknown): value is ThemeName {
  return THEMES.some((theme) => theme.id === value);
}

/** Apply the theme selector and keep the browser chrome color in sync. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  const selected = THEMES.find((candidate) => candidate.id === theme);
  if (meta && selected) meta.content = selected.browserColor;
}
