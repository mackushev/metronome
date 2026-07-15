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

- **Tempo** 20–300 BPM: a jog-wheel ring around the play button (one turn =
  60 BPM), ±1 arrows on the ring, and vertical drag on the circle center.
- **Beats per measure** 1–8 and **clicks per beat** 1–8: outer arcs of dots
  on the circle (beats on the right, clicks on the left).
- **Accents and mutes**: tap a beat rectangle below the circle (or a beat
  dot on the circle) to cycle normal → accent → tick → mute.
- **Beat sectors**: pie wedges under the dots light up with lead-ahead so
  the eye can anticipate each click; the downbeat flashes brighter.
- **Beat bar** below the circle: one rectangle per beat — tall orange =
  accent, medium blue = normal, low outline = mute; the sounding beat
  lights up.
- **Two click timbres** (click, beep) plus an optional **spoken count**
  ("one and a…") on subdivisions 1–4 — all synthesized on the fly, no audio
  files for the clicks. A 3-position balance control sets how loud
  subdivision clicks are relative to beats.
- **Speed trainer**: every N seconds the tempo rises by M BPM (applied
  from the nearest beat), optionally up to a ceiling; progress is shown
  as a green ring around the circle. Supports two-stage ramps.
- **Polyrhythm mode**: a base-meter ring plus four concentric limb-voice
  rings (1–9 pulses each), every voice independently muteable per-pulse,
  disable-able, with its own drum-kit timbre (kick/snare/hi-hat/ride/…)
  and volume.
- **Exercises mode**: displays sheet-music images from `public/content/`,
  with page/topic filters, prev/next navigation, auto-advance timer aligned
  to measure starts, next-item preview, and random order.
- **Stage view**: a full-screen presentation overlay (big beat number, flash
  on every hit, keeps the screen awake via the Wake Lock API) launched by
  the FAB near the circle; works on top of any mode.
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
├── wake-lock.ts         — Screen Wake Lock helper for the stage view
├── audio/
│   ├── engine.ts        — lookahead tick scheduler (precise AudioContext clock), polyrhythm loop
│   └── sounds.ts        — synthesized timbres (clicks + drum kit) via oscillators
├── content/
│   ├── manifest.ts      — loads exercise descriptors from public/content/
│   ├── navigation.ts    — filter / prev / next / random exercise navigation
│   └── types.ts         — exercise content types
└── ui/
    ├── circle.ts        — SVG circle: dots, beat sectors, jog-wheel dial, selectors, polyrhythm rings, trainer arc
    ├── beatbar.ts       — beat rectangles below the circle
    ├── controls.ts      — settings panel (sound, balance, volume, speed-trainer stages, polyrhythm voices)
    ├── exercise-view.ts — exercise sheet display, filters, auto-advance, next-item preview
    └── stage-view.ts    — full-screen presentation overlay (big beat number, flash, wake lock)
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
