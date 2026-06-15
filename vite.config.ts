import { defineConfig, type Plugin } from 'vite';
import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * After build, copy index.html → 404.html so that GitHub Pages serves the SPA
 * shell for any sub-path (e.g. /metronome/exercises). The client-side router
 * in src/router.ts then picks up the mode from the URL.
 */
function ghPages404Plugin(): Plugin {
  return {
    name: 'gh-pages-404',
    closeBundle() {
      const outDir = resolve(__dirname, 'dist');
      try {
        copyFileSync(resolve(outDir, 'index.html'), resolve(outDir, '404.html'));
      } catch {
        // Non-critical — only matters for GitHub Pages deployment.
      }
    },
  };
}

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
      workbox: {
        // Exercise content is opt-in and can be large — keep it out of the
        // precache (which would force a full download on first load) and serve
        // it from a runtime cache instead, so pages stay available offline once
        // viewed.
        globIgnores: ['**/content/**'],
        // Let the service worker handle SPA sub-paths (/exercises, /polyrhythm)
        // by serving the cached index.html for navigation requests.
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/content\//, /\.\w+$/],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.includes('/content/'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'exercise-content',
              expiration: { maxEntries: 300, maxAgeSeconds: 60 * 60 * 24 * 90 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
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
    ghPages404Plugin(),
  ],
}));
