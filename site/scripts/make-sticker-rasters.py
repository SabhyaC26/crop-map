"""Render the two smooth rasters that make California read as a raised sticker on the Pacific.

  ocean-gradient.png  Turquoise at the shore fading to deep blue offshore, transparent over land.
  ca-shadow.png       Soft raised drop shadow (offset down-right, California itself cut out).

Both are MapLibre `image` sources, so rows are evenly spaced in Web Mercator y. They replace stacks of
nested vector rings, which read as terraced steps; a raster gradient has none. Keep the *_BOUNDS
constants in sync with site/src/style/basemap.ts.

Usage (from repo root): uv run python site/scripts/make-sticker-rasters.py
"""
from __future__ import annotations

import json
import math
import struct
import zlib
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import shapely
from shapely import affinity
from shapely.geometry import LineString, Polygon, shape
from shapely.strtree import STRtree

DATA = Path(__file__).resolve().parent.parent / "public" / "data"

# Distances are measured in lat-degree units around mid-California.
LON_SCALE = math.cos(math.radians(37.0))
EDGE_FADE_PX = 0.8  # antialiasing width of the coastline / shadow cut-out, in pixels
ISLAND_AREA = 0.5  # square degrees: smaller ocean holes are islands (they get no glow of their own)


@dataclass(frozen=True)
class Bounds:
    west: float
    east: float
    south: float
    north: float
    px_per_deg: int


OCEAN_BOUNDS = Bounds(-148.0, -112.0, 24.0, 51.0, 36)
SHADOW_BOUNDS = Bounds(-127.0, -112.0, 31.0, 43.5, 70)

# Ocean ramp: (distance from the mainland coast in degrees, colour), shore -> deep.
OCEAN_STOPS = [
    (0.0, (201, 247, 238)),
    (0.35, (124, 213, 242)),
    (1.4, (78, 166, 243)),
    (4.2, (50, 130, 228)),
]

SHADOW_OFFSET = (0.075, -0.12)  # (lon, lat) degrees: down and to the right
SHADOW_SIGMA = 0.13  # degrees of gaussian softness
SHADOW_ALPHA = 0.36
SHADOW_RGB = (45, 58, 140)


def merc_y(lat: float) -> float:
    return math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))


def lat_of(y: np.ndarray) -> np.ndarray:
    return np.degrees(2 * np.arctan(np.exp(y)) - math.pi / 2)


class Grid:
    """Pixel centres of an image whose rows are evenly spaced in Mercator y, in lon-scaled degrees."""

    def __init__(self, b: Bounds) -> None:
        self.width = round((b.east - b.west) * b.px_per_deg)
        y0, y1 = merc_y(b.south), merc_y(b.north)
        self.height = round(self.width * (y1 - y0) / math.radians(b.east - b.west))
        xs = b.west + (np.arange(self.width) + 0.5) / self.width * (b.east - b.west)
        ys = lat_of(y1 - (np.arange(self.height) + 0.5) / self.height * (y1 - y0))
        gx, gy = np.meshgrid(xs * LON_SCALE, ys)
        self.x, self.y = gx.ravel(), gy.ravel()
        # Degrees per pixel (lat units), for turning distances into antialiased coverage.
        self.deg_per_px = (np.hypot(np.gradient(gx, axis=1), np.gradient(gy, axis=0)) / math.sqrt(2)).ravel()


def scaled(geom):
    return shapely.transform(geom, lambda c: c * [LON_SCALE, 1.0])


def boundary_tree(geom) -> STRtree:
    polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    segments = []
    for p in polys:
        for ring in (p.exterior, *p.interiors):
            c = np.asarray(ring.coords)
            segments += [LineString([c[i], c[i + 1]]) for i in range(len(c) - 1)]
    return STRtree(segments)


def signed_distance(geom, grid: Grid) -> np.ndarray:
    """Distance to the polygon edge, positive inside."""
    pts = shapely.points(grid.x, grid.y)
    _, dist = boundary_tree(geom).query_nearest(pts, return_distance=True, all_matches=False)
    return np.where(shapely.contains_xy(geom, grid.x, grid.y), dist, -dist)


def coverage(sd_px: np.ndarray) -> np.ndarray:
    return np.clip(0.5 + sd_px / EDGE_FADE_PX, 0, 1)


def normal_cdf(x: np.ndarray) -> np.ndarray:
    return 0.5 * (1 + np.tanh(0.7978845608 * (x + 0.044715 * x**3)))


def encode_png(rgba: np.ndarray) -> bytes:
    h = rgba.shape[0]
    # PNG "Sub" filter: gradients become runs of tiny deltas, which deflate well.
    raw = b"".join(
        b"\x01" + np.diff(rgba[y].astype(np.int16), axis=0, prepend=0).astype(np.uint8).tobytes() for y in range(h)
    )

    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body))

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", rgba.shape[1], h, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


def write_png(name: str, rgba: np.ndarray, grid: Grid) -> None:
    out = DATA / name
    out.write_bytes(encode_png(rgba.reshape(grid.height, grid.width, 4)))
    print(f"{out.name}: {grid.width}x{grid.height}, {out.stat().st_size / 1024:.0f} KB")


def load_union(path: Path):
    fc = json.loads(path.read_text())
    return shapely.union_all([shape(f["geometry"]).buffer(0) for f in fc["features"]])


def ocean_gradient() -> None:
    b = OCEAN_BOUNDS
    ocean = load_union(DATA / "ocean-mask.geojson").intersection(shapely.box(b.west - 1, b.south - 1, b.east + 1, b.north + 1))
    ocean = scaled(ocean)
    parts = list(ocean.geoms) if ocean.geom_type == "MultiPolygon" else [ocean]
    filled = shapely.union_all([Polygon(p.exterior, [h for h in p.interiors if Polygon(h).area > ISLAND_AREA]) for p in parts])

    grid = Grid(b)
    # Coverage follows the real coast (islands stay land); the colour ramp follows the mainland coast only.
    alpha = coverage(signed_distance(ocean, grid) / grid.deg_per_px)
    depth = np.abs(signed_distance(filled, grid))
    rgba = np.zeros((grid.x.size, 4), dtype=np.uint8)
    for c in range(3):
        rgba[:, c] = np.round(np.interp(depth, [s[0] for s in OCEAN_STOPS], [s[1][c] for s in OCEAN_STOPS]))
    rgba[:, 3] = np.round(alpha * 255)
    write_png("ocean-gradient.png", rgba, grid)


def sticker_shadow() -> None:
    fc = json.loads((DATA / "ca-sticker.geojson").read_text())
    california = scaled(shape(fc["features"][0]["geometry"]))
    shifted = scaled(affinity.translate(shape(fc["features"][0]["geometry"]), *SHADOW_OFFSET))

    grid = Grid(SHADOW_BOUNDS)
    blurred = normal_cdf(signed_distance(shifted, grid) / SHADOW_SIGMA)
    cutout = 1 - coverage(signed_distance(california, grid) / grid.deg_per_px)
    rgba = np.zeros((grid.x.size, 4), dtype=np.uint8)
    rgba[:, :3] = SHADOW_RGB
    rgba[:, 3] = np.round(blurred * cutout * SHADOW_ALPHA * 255)
    write_png("ca-shadow.png", rgba, grid)


if __name__ == "__main__":
    ocean_gradient()
    sticker_shadow()
