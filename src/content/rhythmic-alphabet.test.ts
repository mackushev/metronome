import { describe, expect, it } from 'vitest';
import {
  BINARY_LETTERS,
  TERNARY_LETTERS,
  rhythmicAlphabetImage,
  rhythmicAlphabetItems,
} from './rhythmic-alphabet';

const descriptor = {
  generator: 'benny-greb-alphabet' as const,
  topic: 'Benny Greb alphabet',
  binaryPage: 'Binary · A–P',
  ternaryPage: 'Triplets · Q–X',
  wordLength: 4,
};

describe('Benny Greb rhythmic alphabet', () => {
  it('defines all 24 letters in book order', () => {
    expect(BINARY_LETTERS.map((letter) => letter.letter).join('')).toBe('ABCDEFGHIJKLMNOP');
    expect(TERNARY_LETTERS.map((letter) => letter.letter).join('')).toBe('QRSTUVWX');
    expect(BINARY_LETTERS.find((letter) => letter.letter === 'M')!.steps).toEqual([true, false, true, true]);
    expect(TERNARY_LETTERS.find((letter) => letter.letter === 'X')!.steps).toEqual([false, false, false]);
  });

  it('generates every non-repeating four-element exercise on two pages', () => {
    const items = rhythmicAlphabetItems(descriptor);
    const binaryCount = 16 * 15 * 14 * 13;
    const ternaryCount = 8 * 7 * 6 * 5;
    expect(items).toHaveLength(binaryCount + ternaryCount);
    expect(items[0].id).toBe('benny-binary-ABCD');
    expect(items[1].id).toBe('benny-binary-EFGH');
    expect(items[2].id).toBe('benny-binary-IJKL');
    expect(items[3].id).toBe('benny-binary-MNOP');
    expect(new Set(items.slice(0, binaryCount).map((item) => item.id))).toHaveLength(binaryCount);
    expect(items[binaryCount].id).toBe('benny-ternary-QRST');
    expect(items[binaryCount + 1].id).toBe('benny-ternary-UVWX');
    expect(new Set(items.map((item) => item.page))).toEqual(new Set(['Binary · A–P', 'Triplets · Q–X']));
    expect(items.every((item) => item.rhythm?.elements.length === 4)).toBe(true);
    expect(items.every((item) => new Set(item.rhythm!.elements.map((element) => element.letter)).size === 4)).toBe(true);
  });

  it('renders a self-contained SVG instead of requiring an image file', () => {
    const item = rhythmicAlphabetItems({ ...descriptor, wordLength: 1 })[0];
    const image = rhythmicAlphabetImage(item)!;
    expect(image.src).toMatch(/^data:image\/svg\+xml/);
    const svg = decodeURIComponent(image.src.split(',')[1]);
    expect(svg).toContain('<circle');
    expect(svg).toContain('>A</text>');
  });
});
