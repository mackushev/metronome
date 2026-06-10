import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => ({
  // Served from /metronome/ on github.io until the beat.js.org PR is merged;
  // after the merge: base '/', public/CNAME, and the Pages custom domain
  base: command === 'build' ? '/metronome/' : '/',
  server: {
    // The dev server runs on a remote machine — allow requests by its hostname
    allowedHosts: ['.yandex.net'],
  },
  plugins: [
    // Offline mode: the service worker precaches the whole app (it is fully
    // client-side — sound is synthesized, settings live in localStorage)
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Metronome',
        short_name: 'Metronome',
        description: 'Browser metronome: circular UI, Web Audio, speed trainer',
        theme_color: '#101218',
        background_color: '#101218',
        display: 'standalone',
        icons: [{ src: 'favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
    }),
  ],
}));
