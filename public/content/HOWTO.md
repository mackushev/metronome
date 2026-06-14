# Adding exercise content

The exercise viewer is fully data-driven. Everything lives in this one folder:
the images and their descriptor files sit side by side. Adding material needs
**no code changes** and **no central edits** — the app derives the page list,
the topic list, ids and item order itself.

All files conform to [`schema.json`](./schema.json) (JSON Schema 2020-12). You can
hand that schema and an image to an LLM and ask it to produce a descriptor
(prompt template at the bottom).

> Content is yours to supply. Make sure you have the rights to any image you add.

## Layout

```
public/content/
  manifest.json   # just a list of descriptor filenames — nothing else
  schema.json     # the schema all files validate against
  0001.json       # a descriptor: one or several exercise groups
  sample.svg      # an image a group points at
```

## Two steps to add content

1. Drop the image(s) **and** a descriptor `NNNN.json` into this folder.
2. Add the descriptor's filename to `manifest.json`.

The manifest is only a list of descriptor files:

```json
["0001.json", "0002.json"]
```

## Descriptor

A descriptor is **one group or an array of groups**. Each group points at an
image and is tagged with a **page** and a **topic** — both are required, because
the viewer lets you navigate by page or by topic. Several groups may share a
page, and a descriptor may mix pages and topics freely.

```json
[
  {
    "image": "p7.png", "w": 2480, "h": 3508,
    "page": "7", "topic": "Single Beat Combinations",
    "grid": {
      "rows": 12, "cols": 2,
      "margin": { "top": 280, "right": 120, "bottom": 200, "left": 120 },
      "gapX": 40, "gapY": 30, "order": "row-major"
    }
  },
  {
    "image": "p7.png", "w": 2480, "h": 3508,
    "page": "7", "topic": "Accents",
    "items": [
      { "title": "Accent on 1", "bbox": { "x": 120, "y": 3000, "w": 2240, "h": 220 } }
    ]
  }
]
```

- `image` is a filename **in this folder**; `w`/`h` are its pixel size.
- `page` and `topic` are free labels. The viewer collects every distinct page and
  topic on its own — you never maintain those lists by hand.
- Items come from one of three forms per group:
  - **grid** — rows × columns of aligned exercises.
  - **items** — an explicit list for irregular layouts.
  - **neither** — the whole image is one exercise.

Ids and order are derived: items are numbered and ordered exactly as they appear
across the manifest and within each file, so you never set an order by hand.

## LLM prompt template

> You produce a JSON descriptor that validates against the attached
> `schema.json`. It is one group or an array of groups. The image is `<FILE>`,
> `<W>`×`<H>` pixels, in the same folder. It has `<R>` rows and `<C>` columns of
> exercises aligned in a grid. Output **only** the JSON. Prefer a `grid` block.
> Use page `<PAGE>` and topic `<TOPIC>`.
