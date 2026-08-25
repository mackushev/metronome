import type {
  BBox,
  ContentImage,
  Item,
  RhythmElement,
  RhythmExercise,
  RhythmicAlphabetDescriptor,
} from './types';

const W = 1200;
const H = 190;
const WHOLE: BBox = { x: 0, y: 0, w: W, h: H };

/** Benny Greb's 16 binary letters: one-note, two-note, three-note, full, empty. */
export const BINARY_LETTERS: RhythmElement[] = [
  ['A', '1000'], ['B', '0100'], ['C', '0010'], ['D', '0001'],
  ['E', '1100'], ['F', '0110'], ['G', '0011'], ['H', '1001'],
  ['I', '1010'], ['J', '0101'], ['K', '1110'], ['L', '0111'],
  ['M', '1011'], ['N', '1101'], ['O', '1111'], ['P', '0000'],
].map(([letter, pattern]) => ({ letter, steps: [...pattern].map((step) => step === '1') }));

/** The matching eight triplet letters. */
export const TERNARY_LETTERS: RhythmElement[] = [
  ['Q', '100'], ['R', '010'], ['S', '001'], ['T', '110'],
  ['U', '011'], ['V', '101'], ['W', '111'], ['X', '000'],
].map(([letter, pattern]) => ({ letter, steps: [...pattern].map((step) => step === '1') }));

function words(alphabet: RhythmElement[], length: number): RhythmElement[][] {
  let result: RhythmElement[][] = [[]];
  for (let slot = 0; slot < length; slot += 1) {
    result = result.flatMap((prefix) =>
      alphabet
        .filter((candidate) => !prefix.includes(candidate))
        .map((candidate) => [...prefix, candidate]),
    );
  }
  // Put the practice sequence first: ABC → DEF → …, wrapping at the end.
  // The remaining permutations stay available to Random mode.
  const linearCandidates = Array.from({ length: alphabet.length }, (_, index) => {
    const start = (index * length) % alphabet.length;
    return Array.from({ length }, (_unused, offset) => alphabet[(start + offset) % alphabet.length]);
  });
  const key = (word: RhythmElement[]) => word.map((element) => element.letter).join('');
  const seenLinear = new Set<string>();
  const linear = linearCandidates.filter((word) => {
    const wordKey = key(word);
    if (seenLinear.has(wordKey)) return false;
    seenLinear.add(wordKey);
    return true;
  });
  const linearKeys = new Set(linear.map(key));
  return [...linear, ...result.filter((word) => !linearKeys.has(key(word)))];
}

/** Expand a descriptor into every word whose letters do not repeat internally. */
export function rhythmicAlphabetItems(descriptor: RhythmicAlphabetDescriptor): Item[] {
  const length = Math.max(1, Math.round(descriptor.wordLength ?? 4));
  const make = (
    system: RhythmExercise['system'],
    alphabet: RhythmElement[],
    page: string,
  ): Item[] =>
    words(alphabet, length).map((elements) => {
      const name = elements.map((element) => element.letter).join('');
      return {
        id: `benny-${system}-${name}`,
        image: '',
        bbox: WHOLE,
        title: elements.map((element) => element.letter).join(' · '),
        page,
        topic: descriptor.topic,
        rhythm: { system, elements },
      };
    });

  return [
    ...make('binary', BINARY_LETTERS, descriptor.binaryPage),
    ...make('ternary', TERNARY_LETTERS, descriptor.ternaryPage),
  ];
}

const svgCache = new Map<string, ContentImage>();

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  })[char]!);
}

/** Render one rhythm word as lightly imperfect book-like cards. */
export function rhythmicAlphabetImage(item: Item): ContentImage | null {
  if (!item.rhythm) return null;
  const cached = svgCache.get(item.id);
  if (cached) return cached;

  const count = item.rhythm.elements.length;
  const gap = 18;
  const outer = 18;
  const cardW = (W - outer * 2 - gap * (count - 1)) / count;
  const cards = item.rhythm.elements.map((element, index) => {
    const x = outer + index * (cardW + gap);
    const y = 10;
    const cardH = H - 20;
    const labelW = 54;
    const start = x + 112;
    const end = x + cardW - 42;
    const stepGap = element.steps.length > 1 ? (end - start) / (element.steps.length - 1) : 0;
    const marks = element.steps.map((played, step) => {
      const cx = start + step * stepGap;
      return played
        ? `<circle cx="${cx}" cy="105" r="17" fill="#050505"/>`
        : `<path d="M ${cx - 15} 105 Q ${cx} 101 ${cx + 15} 105" fill="none" stroke="#171717" stroke-width="6" stroke-linecap="round"/>`;
    }).join('');
    return `<g>
      <rect x="${x}" y="${y}" width="${cardW}" height="${cardH}" rx="7" fill="#fff" stroke="#d7d5cf" stroke-width="2" filter="url(#paper-shadow)"/>
      <path d="M ${x + 2} ${y + 6} Q ${x + cardW / 2} ${y - 3} ${x + cardW - 3} ${y + 7}" fill="none" stroke="#eceae5" stroke-width="5" opacity=".8"/>
      <rect x="${x + 9}" y="${y + 6}" width="${labelW}" height="50" fill="#fff" stroke="#e0ded8" stroke-width="2"/>
      <text x="${x + 36}" y="${y + 44}" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="42" fill="#111">${escapeXml(element.letter)}</text>
      ${marks}
    </g>`;
  }).join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs><filter id="paper-shadow" x="-10%" y="-15%" width="120%" height="140%"><feGaussianBlur in="SourceAlpha" stdDeviation="7"/><feOffset dy="5"/><feComponentTransfer><feFuncA type="linear" slope=".18"/></feComponentTransfer><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <rect width="${W}" height="${H}" fill="#fbfaf7"/>
    ${cards}
  </svg>`;
  const image: ContentImage = {
    id: item.id,
    src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    w: W,
    h: H,
  };
  svgCache.set(item.id, image);
  return image;
}
