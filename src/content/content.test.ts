import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { composeModel, toSources } from './manifest';
import { crop, expandGrid, filterItems, pickNext } from './navigation';
import type { ContentImage, Source } from './types';

const image: ContentImage = { id: 'x.png', src: 'content/x.png', w: 1000, h: 800 };

describe('expandGrid', () => {
  it('lays out cells row-major with margins and gaps', () => {
    const boxes = expandGrid(image, {
      rows: 2,
      cols: 2,
      margin: { top: 100, bottom: 100, left: 100, right: 100 },
      gapX: 0,
      gapY: 0,
    });
    expect(boxes).toHaveLength(4);
    expect(boxes[0]).toEqual({ x: 100, y: 100, w: 400, h: 300 });
    expect(boxes[3]).toEqual({ x: 500, y: 400, w: 400, h: 300 });
  });

  it('col-major changes iteration order, not geometry', () => {
    const boxes = expandGrid(image, { rows: 2, cols: 2, order: 'col-major' });
    expect(boxes[0].x).toBe(boxes[1].x);
  });
});

describe('crop', () => {
  it('scales the bbox to the viewport width and offsets the image', () => {
    const t = crop({ x: 100, y: 50, w: 500, h: 100 }, image, 1000);
    expect(t.scale).toBe(2);
    expect(t.imgWidth).toBe(2000);
    expect(t.offsetX).toBe(-200);
    expect(t.offsetY).toBe(-100);
    expect(t.viewportHeight).toBe(200);
  });
});

describe('toSources', () => {
  it('keeps a single-group file id as the bare filename', () => {
    const s = toSources('0007.json', { image: 'p7.png', w: 100, h: 80, page: '7', topic: 'Rolls' });
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe('0007');
    expect(s[0].image).toEqual({ id: 'p7.png', src: 'content/p7.png', w: 100, h: 80 });
    expect(s[0].page).toBe('7');
  });

  it('suffixes ids when a file holds several groups', () => {
    const s = toSources('0008.json', [
      { image: 'a.png', w: 10, h: 10, page: '8', topic: 'A' },
      { image: 'b.png', w: 10, h: 10, page: '8', topic: 'B' },
    ]);
    expect(s.map((x) => x.id)).toEqual(['0008-1', '0008-2']);
  });
});

function model() {
  const sources: Source[] = [
    {
      id: 's1',
      image: { id: 'i1.png', src: 'content/i1.png', w: 1000, h: 1000 },
      page: '1',
      topic: 'Alpha',
      grid: { rows: 2, cols: 1 }, // 2 items
    },
    {
      id: 's2',
      image: { id: 'i2.png', src: 'content/i2.png', w: 1000, h: 1000 },
      page: '2',
      topic: 'Beta',
      items: [{ id: 's2-x' }, { id: 's2-y' }, { id: 's2-z' }], // 3 items
    },
    {
      id: 's3',
      image: { id: 'i1.png', src: 'content/i1.png', w: 1000, h: 1000 },
      page: '1', // shares page 1 with s1
      topic: 'Gamma',
      items: [{ id: 's3-g' }],
    },
  ];
  return composeModel(sources);
}

describe('composeModel', () => {
  it('derives pages and topics in first-appearance order', () => {
    const m = model();
    expect(m.pages.map((p) => p.id)).toEqual(['1', '2']);
    expect(m.topics.map((t) => t.id)).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('groups items by page across descriptors, and by topic', () => {
    const m = model();
    expect(m.itemsByPage.get('1')!.map((i) => i.id)).toEqual(['s1-1', 's1-2', 's3-g']);
    expect(m.itemsByPage.get('2')).toHaveLength(3);
    expect(m.itemsByTopic.get('Gamma')).toHaveLength(1);
  });

  it('expands grids and fills page/topic defaults', () => {
    const m = model();
    expect(m.items[0].id).toBe('s1-1');
    expect(m.items[0].page).toBe('1');
    expect(m.items[0].topic).toBe('Alpha');
    expect(m.items[0].bbox.w).toBe(1000);
  });
});

describe('filterItems', () => {
  it('filters by page and/or topic; empty means any', () => {
    const m = model();
    expect(filterItems(m, '1', '').map((i) => i.id)).toEqual(['s1-1', 's1-2', 's3-g']);
    expect(filterItems(m, '', 'Beta')).toHaveLength(3);
    expect(filterItems(m, '1', 'Gamma').map((i) => i.id)).toEqual(['s3-g']);
    expect(filterItems(m, '', '')).toHaveLength(6);
  });
});

describe('pickNext', () => {
  it('advances in order and wraps', () => {
    const list = filterItems(model(), '1', '');
    expect(pickNext(list, 's1-1', false)!.id).toBe('s1-2');
    expect(pickNext(list, 's3-g', false)!.id).toBe('s1-1'); // wraps
    expect(pickNext(list, null, false)!.id).toBe('s1-1'); // no current -> first
  });

  it('random stays in the list and avoids repeating the current item', () => {
    const list = filterItems(model(), '1', '');
    for (let i = 0; i < 10; i++) {
      const r = pickNext(list, 's1-1', true, () => 0.99)!;
      expect(list).toContain(r);
      expect(r.id).not.toBe('s1-1');
    }
  });

  it('returns null for an empty list', () => {
    expect(pickNext([], null, false)).toBeNull();
  });
});

describe('published schema', () => {
  const ajv = new Ajv2020({ allErrors: true });
  const dir = resolve(process.cwd(), 'public/content');
  const schema = JSON.parse(readFileSync(resolve(dir, 'schema.json'), 'utf-8'));
  const validate = ajv.compile(schema);

  it('the shipped manifest (a file list) validates', () => {
    const data = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf-8'));
    expect(validate(data)).toBe(true);
  });

  it('the shipped sample descriptor (several groups) validates', () => {
    const data = JSON.parse(readFileSync(resolve(dir, '0001.json'), 'utf-8'));
    expect(validate(data)).toBe(true);
  });
});
