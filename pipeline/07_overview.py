"""Build the low-zoom "crop confetti" dot-density source for site/public/data/overview.pmtiles.

Each field contributes ~acres / ACRES_PER_DOT random points inside its polygon (stochastic
rounding, so small fields count proportionally). Dots get a random tippecanoe.minzoom with a
geometric distribution, so the on-screen dot density stays roughly constant while zooming in.

Isolated farmland is suppressed so the whole-California view reads as a few smooth glowing valleys
instead of stray blobs: each dot is scored by how many dots sit within a ~0.35 degree box around it, and
sparse dots only appear once you are zoomed in (or never, when almost nothing grows nearby). Dots outside
the California outline are dropped. A third of the dots are flagged `g` and carry the soft glow.

Usage: uv run python pipeline/07_overview.py [--year 2023] [--region statewide] [--acres-per-dot 60]
"""

from __future__ import annotations

import argparse
import json
import math
import subprocess
import tempfile
from pathlib import Path

import geopandas as gpd
import numpy as np
import shapely
import shapely.prepared

from common import DEFAULT_YEAR, REPO_ROOT, WORK_DIR

OUT_PMTILES = REPO_ROOT / "site" / "public" / "data" / "overview.pmtiles"
MIN_ZOOM = 4
FULL_ZOOM = 8  # every dot is visible from this zoom up
MAX_ZOOM = 9
ZOOM_RATIO = 1.6  # dot count grows 1.6x per zoom level (screen density falls slowly as you zoom in)
SEED = 20231012

CA_OUTLINE = REPO_ROOT / "site" / "public" / "data" / "ca-sticker.geojson"
CELL_DEG = 0.05
SMOOTH_CELLS = 3  # density window radius in cells: a (2*3+1)=7 cell box, ~0.35 degrees
# Dots per window (7x7 cells); the busiest Central Valley windows hold ~3500.
DENSE_MIN = 700  # at or above: a real farming region, thinned normally from MIN_ZOOM
SPARSE_MIN = 220  # between SPARSE_MIN and DENSE_MIN: only from SPARSE_ZOOM
SPARSE_ZOOM = 7
GLOW_SHARE = 0.33  # fraction of dots flagged `g`: the soft glow layer draws only these (big blurred circles are the costly part)
STRAY_ZOOM = 8  # below SPARSE_MIN: lone orchards and hobby farms, only visible when zoomed in


def sample_dots(fields: gpd.GeoDataFrame, acres_per_dot: float, rng: np.random.Generator):
    """Yield (crop_id, x, y) for random points inside each field."""
    geoms = fields.geometry.to_numpy()
    crops = fields["crop_id"].to_numpy()
    acres = fields["acres"].to_numpy()
    expected = acres / acres_per_dot
    counts = np.floor(expected).astype(int) + (rng.random(len(fields)) < (expected % 1))
    for geom, crop, n in zip(geoms, crops, counts, strict=True):
        if n == 0 or geom is None or geom.is_empty:
            continue
        minx, miny, maxx, maxy = geom.bounds
        prepared = shapely.prepared.prep(geom)
        found = 0
        for _ in range(40):
            xs = rng.uniform(minx, maxx, max(8, 3 * (n - found)))
            ys = rng.uniform(miny, maxy, len(xs))
            mask = shapely.contains_xy(prepared.context, xs, ys)
            for x, y in zip(xs[mask][: n - found], ys[mask][: n - found], strict=True):
                yield int(crop), float(x), float(y)
            found += int(mask.sum())
            if found >= n:
                break


def dot_minzoom(rng: np.random.Generator) -> int:
    """Geometric with ratio 1/ZOOM_RATIO: 62% of dots visible at FULL_ZOOM-1, 39% at -2, 24% at -3, ..."""
    u = rng.random()
    drop = int(math.floor(-math.log(max(u, 1e-9)) / math.log(ZOOM_RATIO)))
    return max(MIN_ZOOM, FULL_ZOOM - drop)


def window_density(xs: np.ndarray, ys: np.ndarray) -> np.ndarray:
    """Dots within +-SMOOTH_CELLS grid cells of each dot (box filter over a CELL_DEG grid)."""
    ix = np.floor((xs - xs.min()) / CELL_DEG).astype(int)
    iy = np.floor((ys - ys.min()) / CELL_DEG).astype(int)
    grid = np.zeros((ix.max() + 1, iy.max() + 1), dtype=np.int64)
    np.add.at(grid, (ix, iy), 1)
    r = SMOOTH_CELLS
    padded = np.pad(grid, r)
    csum = padded.cumsum(axis=0).cumsum(axis=1)
    csum = np.pad(csum, ((1, 0), (1, 0)))
    w = 2 * r + 1
    box = csum[w:, w:] - csum[:-w, w:] - csum[w:, :-w] + csum[:-w, :-w]
    return box[ix, iy]


def load_outline():
    data = json.loads(CA_OUTLINE.read_text())
    return shapely.union_all([shapely.geometry.shape(f["geometry"]) for f in data["features"]])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, default=DEFAULT_YEAR)
    ap.add_argument("--region", default="statewide")
    ap.add_argument("--acres-per-dot", type=float, default=60.0)
    args = ap.parse_args()

    work = WORK_DIR / str(args.year) / args.region
    fields = gpd.read_file(work / "fields.fgb", columns=["crop_id", "acres"])
    fields = fields[fields["crop_id"].notna() & (fields["acres"] > 0)]
    rng = np.random.default_rng(SEED)

    dots = np.array(list(sample_dots(fields, args.acres_per_dot, rng)), dtype=float)
    crops, xs, ys = dots[:, 0].astype(int), dots[:, 1], dots[:, 2]
    inside = shapely.contains_xy(load_outline(), xs, ys)
    crops, xs, ys = crops[inside], xs[inside], ys[inside]
    density = window_density(xs, ys)
    floor_zoom = np.where(density >= DENSE_MIN, MIN_ZOOM, np.where(density >= SPARSE_MIN, SPARSE_ZOOM, STRAY_ZOOM))
    print(
        f"{len(dots)} sampled, {int((~inside).sum())} outside CA, "
        f"{int((density < DENSE_MIN).sum())} sparse (of {len(xs)})"
    )

    tmp = tempfile.TemporaryDirectory(prefix="overview-")
    dots_path = Path(tmp.name) / "dots.geojsonl"
    with dots_path.open("w") as fh:
        for crop, x, y, zmin in zip(crops, xs, ys, floor_zoom, strict=True):
            feature = {
                "type": "Feature",
                "properties": {"crop_id": int(crop), "g": int(rng.random() < GLOW_SHARE)},
                "tippecanoe": {"minzoom": max(int(zmin), dot_minzoom(rng)), "maxzoom": MAX_ZOOM},
                "geometry": {"type": "Point", "coordinates": [round(float(x), 5), round(float(y), 5)]},
            }
            fh.write(json.dumps(feature, separators=(",", ":")) + "\n")
    print(f"{len(xs)} dots -> {dots_path}")

    OUT_PMTILES.parent.mkdir(parents=True, exist_ok=True)
    if OUT_PMTILES.is_symlink():
        raise SystemExit(f"{OUT_PMTILES} is a symlink; refusing to write through it")
    subprocess.run(
        [
            "tippecanoe", "-o", str(OUT_PMTILES), "--force", "-Q",
            f"-Z{MIN_ZOOM}", f"-z{MAX_ZOOM}", "-r1",
            "--drop-densest-as-needed",
            "-l", "overview",
            str(dots_path),
        ],
        check=True,
    )
    tmp.cleanup()
    print(f"{OUT_PMTILES} ({Path(OUT_PMTILES).stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
