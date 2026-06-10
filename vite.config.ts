import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // The production build lives on GitHub Pages under /metronome/
  base: command === 'build' ? '/metronome/' : '/',
  server: {
    // The dev server runs on a remote machine — allow requests by its hostname
    allowedHosts: ['.yandex.net'],
  },
}));
