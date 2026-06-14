import type { BBox, ContentImage, ContentModel, Grid, Item } from './types';

/** Crop transform for a viewport that shows a single bbox scaled to its width. */
export interface CropTransform {
  scale: number;
  imgWidth: number;
  imgHeight: number;
  offsetX: number;
  offsetY: number;
  viewportHeight: number;
}

/**
 * Position a full image inside a fixed-width viewport so only `bbox` is visible.
 * The image is scaled so the bbox fills the viewport width; the viewport height
 * matches the bbox at that scale.
 */
export function crop(bbox: BBox, image: ContentImage, viewportWidth: number): CropTransform {
  const scale = bbox.w > 0 ? viewportWidth / bbox.w : 1;
  return {
    scale,
    imgWidth: image.w * scale,
    imgHeight: image.h * scale,
    offsetX: -bbox.x * scale,
    offsetY: -bbox.y * scale,
    viewportHeight: bbox.h * scale,
  };
}

/**
 * Expand a grid descriptor into evenly spaced bounding boxes over an image.
 * Cells are laid out left-to-right, top-to-bottom (row-major) or column-major.
 */
export function expandGrid(image: ContentImage, grid: Grid): BBox[] {
  const m = grid.margin ?? {};
  const top = m.top ?? 0;
  const right = m.right ?? 0;
  const bottom = m.bottom ?? 0;
  const left = m.left ?? 0;
  const gapX = grid.gapX ?? 0;
  const gapY = grid.gapY ?? 0;
  const { rows, cols } = grid;

  const usableW = image.w - left - right - gapX * (cols - 1);
  const usableH = image.h - top - bottom - gapY * (rows - 1);
  const cellW = usableW / cols;
  const cellH = usableH / rows;

  const cellAt = (row: number, col: number): BBox => ({
    x: left + col * (cellW + gapX),
    y: top + row * (cellH + gapY),
    w: cellW,
    h: cellH,
  });

  const boxes: BBox[] = [];
  if (grid.order === 'col-major') {
    for (let col = 0; col < cols; col++) {
      for (let row = 0; row < rows; row++) boxes.push(cellAt(row, col));
    }
  } else {
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) boxes.push(cellAt(row, col));
    }
  }
  return boxes;
}

/** Source of randomness, injectable for deterministic tests. */
export type Rng = () => number;

/**
 * The items matching the selected page and/or topic, in order. An empty filter
 * value means "any", so no page + no topic returns every item.
 */
export function filterItems(model: ContentModel, page: string, topic: string): Item[] {
  return model.items.filter(
    (it) => (!page || it.page === page) && (!topic || it.topic === topic),
  );
}

/**
 * The next item to show within `list`: the following one in order, or a random
 * other one when `random` is set. Returns null for an empty list.
 */
export function pickNext(
  list: Item[],
  currentId: string | null,
  random: boolean,
  rng: Rng = Math.random,
): Item | null {
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];

  if (random) {
    const others = currentId ? list.filter((it) => it.id !== currentId) : list;
    const pool = others.length > 0 ? others : list;
    return pool[Math.floor(rng() * pool.length)];
  }

  const pos = currentId ? list.findIndex((it) => it.id === currentId) : -1;
  return list[(pos + 1) % list.length];
}
