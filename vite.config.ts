import { defineConfig } from 'vite';

export default defineConfig({
  // The site lives at the root of the custom domain beat.js.org
  base: '/',
  server: {
    // The dev server runs on a remote machine — allow requests by its hostname
    allowedHosts: ['.yandex.net'],
  },
});
