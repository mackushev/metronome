// Dev-only helper: generates a generic placeholder "sheet" SVG so the exercise
// viewer has demo content with zero copyrighted material. Run: node scripts/make-sample-image.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../public/content/sample.svg');

const W = 1200;
const H = 1600;
const ROWS = 8;
const COLS = 2;
const M = { top: 120, right: 60, bottom: 60, left: 60 };
const GAPX = 40;
const GAPY = 30;

const usableW = W - M.left - M.right - GAPX * (COLS - 1);
const usableH = H - M.top - M.bottom - GAPY * (ROWS - 1);
const cellW = usableW / COLS;
const cellH = usableH / ROWS;

const parts = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
  `<rect width="${W}" height="${H}" fill="#ffffff"/>`,
  `<text x="${W / 2}" y="70" text-anchor="middle" font-family="sans-serif" font-size="44" font-weight="700" fill="#111">Sample Sheet (placeholder)</text>`,
];

let n = 0;
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    n++;
    const x = M.left + col * (cellW + GAPX);
    const y = M.top + row * (cellH + GAPY);
    parts.push(`<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" fill="none" stroke="#d0d0d0" stroke-width="2"/>`);
    parts.push(`<text x="${x + 16}" y="${y + 40}" font-family="sans-serif" font-size="28" font-weight="700" fill="#222">${n}</text>`);
    // Faux five-line staff to look like an exercise row.
    const sx = x + 70;
    const sw = cellW - 90;
    const sy0 = y + cellH / 2 - 28;
    for (let l = 0; l < 5; l++) {
      const ly = sy0 + l * 14;
      parts.push(`<line x1="${sx}" y1="${ly}" x2="${sx + sw}" y2="${ly}" stroke="#333" stroke-width="1.5"/>`);
    }
  }
}
parts.push('</svg>');

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, parts.join('\n'));
console.log(`Wrote ${out} (${W}x${H}, ${n} cells)`);
