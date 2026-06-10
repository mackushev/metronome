# Tasks

Implementation task list (see context and details in [PLAN.md](PLAN.md)).

- [x] **1. Scaffold Vite + TypeScript** — `npm create vite` (vanilla-ts), clean
  the template, base markup in `index.html` and `style.css`.
- [x] **2. Sound and scheduler** (`src/audio/sounds.ts`, `src/audio/engine.ts`) —
  Web Audio: 3 synthesized click voices, lookahead tick scheduler driven by
  `audioContext.currentTime`.
- [x] **3. State and settings panel** (`src/state.ts`, `src/ui/controls.ts`) —
  a single store with subscribers + localStorage; BPM, beats, clicks per beat,
  sound, volume controls.
- [x] **4. SVG circle with dots** (`src/ui/circle.ts`) — beat and subdivision
  dots around the ring, current-tick highlight, tap on a beat: accent →
  normal → mute; outer selector arcs; tempo dial with ±1 arrows.
- [x] **5. Speed trainer** (`src/trainer.ts`) — +M BPM every Δt seconds up to
  max, applied from the nearest beat, progress ring in the UI.
- [x] **6. Polish** — Space = start/stop, drag on the center for BPM, beat bar
  below the circle, responsive layout (phone/tablet/desktop), persistence.
- [x] **7. Tests and build** — vitest: tick grid, trainer logic, jsdom smoke
  test; `npm run build` with no errors.

## User clarifications

- Browser only, no backend.
- RhythmBot-like capabilities: BPM, clicks per beat, number of beats, accents
  and muted beats. Simple UI: a circle with dots around it.
- Responsive GUI: phone, tablet, desktop.
- Tap tempo — out of scope.
