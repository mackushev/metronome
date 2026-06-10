# Plan: Metronome web app

## Context

A from-scratch browser metronome in `/home/almack/code/metronome`. Requirements:

- Basics: start/stop, BPM control, visual indication of the current beat.
- Beats per measure and clicks per beat (subdivisions), both 1–8.
- A choice of click sounds.
- RhythmBot-style UI: a large circle with dots around it; settings are
  selected on outer arcs of the circle.
- **Speed trainer**: while playing, the tempo rises by M BPM every Δt seconds
  (both set by the user; optional max BPM ceiling).
- Browser only, no backend. Responsive GUI for phone, tablet, and desktop.
- Tap tempo is out of scope.

## Stack

**Vite + TypeScript, no framework** (vanilla TS):

- Single-screen app with one state object; React/Svelte would not pay off.
- TypeScript matters for the correctness of the audio scheduler and trainer logic.
- Vite gives a dev server with hot reload and a one-command static build.
- Sound — **Web Audio API**, clicks are synthesized with oscillators (no assets).
- The circle is rendered with **SVG** (easier hit-testing and styling than canvas).

## Architecture

```
metronome/
├── index.html
├── package.json, tsconfig.json, vite.config.ts
└── src/
    ├── main.ts          — wiring UI ↔ state ↔ engine
    ├── state.ts         — settings (bpm, beats, subdivision, sound, volume,
    │                      accents, trainer) + localStorage
    ├── audio/
    │   ├── engine.ts    — lookahead scheduler
    │   └── sounds.ts    — click synthesis (3 voices × accent/normal/sub)
    ├── trainer.ts       — speed-trainer logic
    ├── ui/
    │   ├── circle.ts    — SVG circle with dots, dial, selectors
    │   ├── beatbar.ts   — beat rectangles below the circle
    │   └── controls.ts  — settings panel
    └── style.css        — dark theme, responsive
```

### Key decisions

1. **Precise sound — lookahead scheduler** ("A Tale of Two Clocks"):
   a 25 ms `setInterval` schedules all ticks ~120 ms ahead against the precise
   `audioContext.currentTime` clock. The queue of scheduled ticks drives the
   UI highlight via `requestAnimationFrame`.
2. **Synthesized sounds** — square click, sine beep, triangle woodblock with
   a pitch drop; accented beats are higher and louder, muted ones are silent.
3. **Circle** — beat dots (large) and subdivision dots (small) around the ring,
   a sweeping needle, tap on a beat dot cycles accent/normal/mute. Outer arcs
   select beats per measure (right) and clicks per beat (left). A rotary dial
   around the center sets the tempo; ±1 arrows for fine taps.
4. **Speed trainer** — pure functions compute the target BPM from elapsed time;
   the tempo is applied from the nearest scheduled beat. A green progress ring
   shows time until the next step.
5. **State** — a single settings object with subscribers, persisted to
   localStorage and restored on load.

## Verification

- `npm run dev` → start/stop, live changes of BPM/beats/subdivision/sound
  without rhythm glitches; accents and mutes are audible and visible.
- Trainer: set "every 10 s +5 BPM up to 180" and watch the tempo step up.
- `npx vitest run` — unit tests for the tick grid and trainer logic plus
  a jsdom smoke test that mounts the whole app.
- `npm run build` — clean static build.
