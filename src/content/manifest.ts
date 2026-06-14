import { expandGrid } from './navigation';
import type {
  BBox,
  ContentImage,
  ContentModel,
  DescriptorFile,
  Group,
  Item,
  ItemSpec,
  Manifest,
  Page,
  Source,
  Topic,
} from './types';

/** Folder that holds every descriptor and image. */
const CONTENT_DIR = 'content';

/** Resolve a content-relative path against the app base (works under /metronome/). */
function resolveUrl(path: string): string {
  const base = import.meta.env.BASE_URL || '/';
  return base.replace(/\/$/, '') + '/' + path.replace(/^\//, '');
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(resolveUrl(path));
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return (await res.json()) as T;
}

const wholeImageBox = (img: ContentImage): BBox => ({ x: 0, y: 0, w: img.w, h: img.h });

/** Strip directory and extension to get a stable id from a filename. */
function baseId(filename: string): string {
  return filename.replace(/^.*\//, '').replace(/\.[^.]+$/, '');
}

/** Turn a loaded group into normalized items (grid expanded, defaults filled). */
function itemsFromSource(source: Source, startOrder: number): Item[] {
  const out: Item[] = [];
  const push = (spec: ItemSpec, index: number, bbox: BBox) => {
    out.push({
      id: spec.id ?? `${source.id}-${index + 1}`,
      image: spec.image ?? source.image.id,
      bbox,
      title: spec.title,
      page: spec.page == null ? source.page : String(spec.page),
      topic: spec.topic == null ? source.topic : String(spec.topic),
      order: startOrder + index,
    });
  };

  if (source.grid) {
    const boxes = expandGrid(source.image, source.grid);
    boxes.forEach((bbox, i) => push(source.items?.[i] ?? {}, i, bbox));
  } else if (source.items && source.items.length > 0) {
    source.items.forEach((spec, i) => push(spec, i, spec.bbox ?? wholeImageBox(source.image)));
  } else {
    // No items and no grid: the whole image is a single item.
    push({}, 0, wholeImageBox(source.image));
  }
  return out;
}

/** Register a label into an ordered list + lookup, first appearance wins. */
function bucket(it: Item, key: 'page' | 'topic', seen: Set<string>, list: Topic[], by: Map<string, Item[]>) {
  const label = it[key];
  if (!label) return;
  if (!seen.has(label)) {
    seen.add(label);
    list.push({ id: label, title: label });
  }
  const items = by.get(label) ?? [];
  items.push(it);
  by.set(label, items);
}

/**
 * Compose the navigable model from the loaded groups. Pages, topics, the flat
 * item index and all groupings are derived here — nothing is declared centrally.
 */
export function composeModel(sources: Source[]): ContentModel {
  const imagesById = new Map<string, ContentImage>();
  const items: Item[] = [];

  for (const source of sources) {
    if (source.image) imagesById.set(source.image.id, source.image);
    for (const it of itemsFromSource(source, items.length)) items.push(it);
  }

  const pages: Page[] = [];
  const topics: Topic[] = [];
  const pageSeen = new Set<string>();
  const topicSeen = new Set<string>();
  const itemsByPage = new Map<string, Item[]>();
  const itemsByTopic = new Map<string, Item[]>();
  const indexById = new Map<string, number>();

  items.forEach((it, i) => {
    indexById.set(it.id, i);
    bucket(it, 'page', pageSeen, pages, itemsByPage);
    bucket(it, 'topic', topicSeen, topics, itemsByTopic);
  });

  return { items, imagesById, pages, topics, itemsByPage, itemsByTopic, indexById };
}

/** Build loaded groups (id + resolved image) from one on-disk descriptor file. */
export function toSources(filename: string, file: DescriptorFile): Source[] {
  const groups: Group[] = Array.isArray(file) ? file : [file];
  const base = baseId(filename);
  return groups.map((g, gi) => ({
    id: groups.length > 1 ? `${base}-${gi + 1}` : base,
    image: { id: g.image, src: `${CONTENT_DIR}/${g.image}`, w: g.w, h: g.h },
    page: String(g.page),
    topic: String(g.topic),
    items: g.items,
    grid: g.grid,
  }));
}

/**
 * Load the manifest (a list of descriptor filenames) and every descriptor in the
 * content folder, then compose the model. A descriptor that fails to load is
 * skipped with a warning so one bad file does not break the viewer.
 */
export async function loadContent(manifestPath = `${CONTENT_DIR}/manifest.json`): Promise<ContentModel> {
  const files = await fetchJson<Manifest>(manifestPath);
  const perFile = await Promise.all(
    (files ?? []).map(async (filename) => {
      try {
        const file = await fetchJson<DescriptorFile>(`${CONTENT_DIR}/${filename}`);
        return toSources(filename, file);
      } catch (err) {
        console.warn(`[content] skipping ${filename}:`, err);
        return [] as Source[];
      }
    }),
  );
  return composeModel(perFile.flat());
}
