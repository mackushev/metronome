import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Served from /metronome/ on github.io until the beat.js.org PR is merged;
  // after the merge: base '/', public/CNAME, and the Pages custom domain
  base: command === 'build' ? '/metronome/' : '/',
  server: {
    // The dev server runs on a remote machine — allow requests by its hostname
    allowedHosts: ['.yandex.net'],
  },
}));
