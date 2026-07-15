#!/usr/bin/env python3
"""
Recompress exercise page images (public/content/page_*.webp) to a smaller size
without visible quality loss.

Sheet-music pages are essentially two-tone (ink on paper) — lossy VP8 wastes a
lot of bits smoothing anti-aliased edges. Quantising the grayscale to a tiny
palette (default 4 levels) with Floyd–Steinberg dither, then encoding
losslessly (`cwebp -lossless -z 9`), produces a sharper picture in about half
the bytes on typical pages. Where the original already beats us (some pages
were hand-tuned earlier — page_07, page_08), the file is left alone.

Requirements: Pillow (`pip install pillow`) and `cwebp` on PATH
(`brew install webp` on macOS).

Usage:  python scripts/optimize-images.py [--colors N] [--dry-run] [--force]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("Pillow is required: pip install pillow")

REPO_ROOT = Path(__file__).resolve().parent.parent
CONTENT_DIR = REPO_ROOT / "public" / "content"


def which_or_die(name: str) -> str:
    path = shutil.which(name)
    if not path:
        sys.exit(f"`{name}` not found on PATH — install libwebp (brew install webp)")
    return path


def optimize_one(src: Path, colors: int, cwebp: str, dwebp: str, tmp: Path) -> int:
    """Encode `src` (a .webp) via grayscale + palette + lossless webp.

    Returns the size in bytes of the new .webp (written to `tmp/out.webp`).
    """
    decoded = tmp / "in.png"
    quantised = tmp / "q.png"
    out = tmp / "out.webp"

    subprocess.run([dwebp, "-quiet", str(src), "-o", str(decoded)], check=True)
    im = Image.open(decoded).convert("L").convert(
        "P", palette=Image.Palette.ADAPTIVE, colors=colors, dither=Image.Dither.FLOYDSTEINBERG
    )
    im.save(quantised)
    subprocess.run(
        [cwebp, "-quiet", "-m", "6", "-lossless", "-z", "9", str(quantised), "-o", str(out)],
        check=True,
    )
    return out.stat().st_size


def format_size(n: int) -> str:
    return f"{n / 1024:6.1f} KB"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument("--colors", type=int, default=4, help="palette size (default: 4)")
    ap.add_argument("--dry-run", action="store_true", help="report only, do not overwrite")
    ap.add_argument("--force", action="store_true", help="overwrite even when the new file is larger")
    ap.add_argument("--glob", default="page_*.webp", help="glob within public/content/")
    args = ap.parse_args()

    cwebp = which_or_die("cwebp")
    dwebp = which_or_die("dwebp")

    files = sorted(CONTENT_DIR.glob(args.glob))
    if not files:
        sys.exit(f"No files match {CONTENT_DIR}/{args.glob}")

    total_before = total_after = 0
    replaced = skipped = 0

    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for src in files:
            before = src.stat().st_size
            try:
                after = optimize_one(src, args.colors, cwebp, dwebp, tmp)
            except subprocess.CalledProcessError as e:
                print(f"{src.name}: failed ({e})", file=sys.stderr)
                continue

            total_before += before
            keep_new = args.force or after < before
            note = "" if keep_new else " (kept original — new is larger)"
            print(
                f"{src.name:16} {format_size(before)} -> {format_size(after)} "
                f"({after / before * 100:5.1f}%){note}"
            )

            if keep_new and not args.dry_run:
                shutil.copyfile(tmp / "out.webp", src)

            total_after += after if keep_new else before
            if keep_new:
                replaced += 1
            else:
                skipped += 1

    print(
        f"\nTotal: {format_size(total_before)} -> {format_size(total_after)} "
        f"({total_after / total_before * 100:.1f}%). "
        f"{replaced} rewritten, {skipped} left alone."
    )
    if args.dry_run:
        print("(dry-run — no files were changed)")


if __name__ == "__main__":
    main()
