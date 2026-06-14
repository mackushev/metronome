/**
 * Content model for the exercise viewer.
 *
 * Everything is declarative. The manifest lists descriptor files; each
 * descriptor file holds one or several "group" descriptions; each group points
 * at an image and is tagged with both a page and a topic. The loader reads it
 * all into memory — collecting pages and topics and ordering exercises by the
 * order they are mentioned. See public/content/schema.json.
 */

/** A pixel rectangle inside an image. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Raw raster asset. `src` is relative and resolved with import.meta.env.BASE_URL. */
export interface ContentImage {
  id: string;
  src: string;
  w: number;
  h: number;
}

/** A navigation grouping (both pages and topics share this shape). */
export interface Topic {
  id: string;
  title: string;
}
export type Page = Topic;

/** A single exercise: a crop of an image (or the whole image when bbox is omitted). */
export interface ItemSpec {
  id?: string;
  /** Image filename; defaults to the group's image. */
  image?: string;
  bbox?: BBox;
  title?: string;
  /** Page label; defaults to the group's page. */
  page?: string;
  /** Topic label; defaults to the group's topic. */
  topic?: string;
}

/** Grid generator: expands into evenly spaced item boxes over the image. */
export interface Grid {
  rows: number;
  cols: number;
  margin?: { top?: number; right?: number; bottom?: number; left?: number };
  gapX?: number;
  gapY?: number;
  /** Iteration order of the generated cells. Defaults to 'row-major'. */
  order?: 'row-major' | 'col-major';
}

/**
 * One group description as authored on disk: an image (by filename) tagged with
 * a page and a topic, plus its items (explicit, a grid, or the whole image).
 */
export interface Group {
  /** Image filename, relative to the content folder. */
  image: string;
  w: number;
  h: number;
  page: string;
  topic: string;
  items?: ItemSpec[];
  grid?: Grid;
}

/** A descriptor file holds one group or several. */
export type DescriptorFile = Group | Group[];

/** A group after loading: derived id and resolved image. */
export interface Source {
  id: string;
  image: ContentImage;
  page: string;
  topic: string;
  items?: ItemSpec[];
  grid?: Grid;
}

/** Root meta-manifest: nothing but the list of descriptor filenames. */
export type Manifest = string[];

/** A normalized item after composing — every field resolved. */
export interface Item {
  id: string;
  image: string;
  bbox: BBox;
  title?: string;
  page: string;
  topic: string;
  /** Position in the flat ordered index. */
  order: number;
}

/** The composed, in-memory content the UI navigates by page or by topic. */
export interface ContentModel {
  /** Flat item list, in order of appearance. */
  items: Item[];
  imagesById: Map<string, ContentImage>;
  pages: Page[];
  topics: Topic[];
  itemsByPage: Map<string, Item[]>;
  itemsByTopic: Map<string, Item[]>;
  /** item id -> index in `items`. */
  indexById: Map<string, number>;
}
