# Metronome

A browser-only metronome with no backend: a circular UI with beat dots
(inspired by RhythmBot), precise sound via the Web Audio API, and a speed
trainer that gradually raises the tempo.

Live: https://mackushev.github.io/metronome/ (moving to https://beat.js.org)

## Features

### Three modes

The app has three top-level modes, switchable via pills at the top of the
page. Each mode has its own URL for analytics and deep-linking:

| Mode | URL | Description |
|------|-----|-------------|
| **Metronome** | `/` (default) | Classic metronome with beats, subdivisions, accents, and a beat bar |
| **Exercises** | `/exercises` | Sheet-music practice view with auto-advance and filtering by page/topic |
| **Polyrhythm** | `/polyrhythm` | Two independent pulse streams (A : B) sharing one cycle on the circle |

### Core

- **Tempo** 20–300 BPM: a rotary ring around the play button (one turn =
  60 BPM), ±1 arrows on the ring, a slider, ±1/±5 buttons, and vertical
  drag on the circle center.
- **Beats per measure** 1–8 and **clicks per beat** 1–8: outer arcs of dots
  on the circle (beats on the right, clicks on the left) or panel controls.
- **Accents and mutes**: tap a beat rectangle below the circle (or a beat
  dot on the circle) to cycle normal → accent → tick → mute.
- **Beat bar** below the circle: one rectangle per beat — tall orange =
  accent, medium blue = normal, low outline = mute; the sounding beat
  lights up.
- **3 click sounds** (click, beep, cowbell) synthesized on the fly —
  no audio files; a 3-position balance control sets how loud subdivision
  clicks are relative to beats.
- **Speed trainer**: every N seconds the tempo rises by M BPM (applied
  from the nearest beat), optionally up to a ceiling; progress is shown
  as a green ring around the circle. Supports two-stage ramps.
- **Polyrhythm mode**: two concentric dot rings (master A and slave B,
  1–9 pulses each) with independent mute toggles and per-rhythm sound
  selection.
- **Exercises mode**: displays sheet-music images from `public/content/`,
  with page/topic filters, prev/next navigation, auto-advance timer,
  and random order.
- **Volume slider**, Space for start/stop, settings persisted in
  localStorage, responsive layout for phone, tablet, and desktop.
- **Works offline**: a PWA service worker precaches the app after the
  first visit; it can be installed to the home screen.

## Development

```bash
npm install
npm run dev      # dev server with hot reload
npm test         # unit and smoke tests (vitest)
npm run build    # static build in dist/ — deployable to any static hosting
```

Pushes to `main` are deployed to GitHub Pages automatically
(`.github/workflows/deploy.yml`: tests → build → publish).

## Architecture

```
src/
├── main.ts              — wires the UI, the engine, the router, and the trainer together
├── state.ts             — Settings type, Store (subscriptions + localStorage persistence)
├── router.ts            — client-side routing: URL ↔ AppMode via History API + GoatCounter
├── trainer.ts           — pure speed-trainer logic (multi-stage tempo ramp)
├── audio/
│   ├── engine.ts        — lookahead tick scheduler (precise AudioContext clock)
│   └── sounds.ts        — click/beep/cowbell synthesis with oscillators
├── content/
│   ├── manifest.ts      — loads exercise descriptors from public/content/
│   ├── navigation.ts    — prev/next/random exercise navigation
│   └── types.ts         — exercise content types
└── ui/
    ├── circle.ts        — SVG circle: dots, needle, dial, selectors, polyrhythm rings, trainer arc
    ├── beatbar.ts       — beat rectangles below the circle
    ├── controls.ts      — settings panel (sound, balance, volume, speed trainer stages)
    └── exercise-view.ts — exercise sheet display, filters, auto-advance
```

### Key decisions

- **Sound scheduling** is driven by a lookahead scheduler ("A Tale of Two
  Clocks") — a cheap `setInterval` schedules clicks ~120 ms ahead against the
  precise `AudioContext.currentTime` clock, so the tempo never drifts with
  browser timer jitter.

- **Client-side routing** uses `history.pushState` / `replaceState` so mode
  switches change the URL without a page reload. On GitHub Pages a
  `404.html` (auto-copied from `index.html` at build time) catches direct
  navigation to sub-paths. The service worker's `navigateFallback` handles
  the same for offline mode.

- **State management** is a single `Store` class with immutable snapshots
  and a subscribe/notify pattern. All settings (including the active mode)
  are persisted to `localStorage` on every change. The URL takes precedence
  over localStorage on page load — if you open `/exercises`, you get the
  exercises view regardless of what was saved.
