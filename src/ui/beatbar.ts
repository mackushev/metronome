import type { Settings } from '../state';

/**
 * Beat bar below the circle: one rectangle per beat of the measure.
 * A tap cycles the beat state (normal → accent → mute); subdivisions
 * are intentionally not shown here.
 */
export class BeatBar {
  private cells: HTMLButtonElement[] = [];
  private activeIndex = -1;

  private readonly root: HTMLElement;
  private readonly onBeatClick: (beatIndex: number) => void;

  constructor(root: HTMLElement, onBeatClick: (beatIndex: number) => void) {
    this.root = root;
    this.onBeatClick = onBeatClick;
  }

  render(settings: Settings): void {
    const { beats, beatStates } = settings;
    if (this.cells.length !== beats) this.rebuild(beats);
    this.cells.forEach((cell, i) => {
      cell.className = `beat-cell ${beatStates[i] ?? 'normal'}${i === this.activeIndex ? ' active' : ''}`;
    });
  }

  /** Highlights the sounding beat; null — the metronome is stopped */
  setActive(index: number | null): void {
    const idx = index ?? -1;
    if (idx === this.activeIndex) return;
    if (this.activeIndex >= 0) this.cells[this.activeIndex]?.classList.remove('active');
    if (idx >= 0) this.cells[idx]?.classList.add('active');
    this.activeIndex = idx;
  }

  private rebuild(beats: number): void {
    this.root.replaceChildren();
    this.cells = [];
    this.activeIndex = -1;
    for (let i = 0; i < beats; i++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'beat-cell normal';
      cell.setAttribute('aria-label', `Beat ${i + 1}`);
      cell.addEventListener('pointerdown', (event) => {
        event.preventDefault();
        this.onBeatClick(i);
      });
      this.root.append(cell);
      this.cells.push(cell);
    }
  }
}
