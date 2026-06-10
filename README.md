# Metronome

A browser-only metronome with no backend: a circular UI with beat dots
(inspired by RhythmBot), precise sound via the Web Audio API, and a speed
trainer that gradually raises the tempo.

Live: https://mackushev.github.io/metronome/ (moving to https://beat.js.org)

## Features

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
  as a green ring around the circle.
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
├── main.ts          — wires the UI, the engine, and the trainer together
├── state.ts         — settings, subscriptions, localStorage
├── trainer.ts       — pure speed-trainer logic
├── audio/
│   ├── engine.ts    — lookahead tick scheduler (precise AudioContext clock)
│   └── sounds.ts    — click synthesis with oscillators
└── ui/
    ├── circle.ts    — SVG circle: dots, needle, dial, selectors, trainer ring
    ├── beatbar.ts   — beat rectangles below the circle
    └── controls.ts  — settings panel
```

Key decision: the sound is driven by a lookahead scheduler ("A Tale of Two
Clocks") — a cheap `setInterval` schedules clicks ~120 ms ahead against the
precise `AudioContext.currentTime` clock, so the tempo never drifts with
browser timer jitter.
