"""Build the "sticker diorama" overlays drawn around California on the basemap.

  ca-sticker.geojson   California outline (CCW exterior) used for the white die-cut edge and shadow anchor.
  ca-shadow.geojson    Stacked, progressively wider "raised" shadow rings (offset SE of CA, CA itself cut out).
  ocean-bands.geojson  Nested bands of ocean by distance from the coast (property `d` in degrees), turquoise
                       near shore to deep blue offshore. Drawn as stacked fills, widest first.
  ocean-lines.geojson  Faint concentric "water lines" parallel to the coast.

Sources (public domain), same dir as make-basemap-masks.py expects:
  ne_50m_ocean.geojson  ne_50m_land.geojson  ne_50m_admin_1_states_provinces.geojson

Usage: python make-sticker-masks.py <ne-dir> <out-dir>      (needs shapely)
"""
import json
import sys
from pathlib import Path

from shapely import affinity
from shapely.geometry import MultiLineString, box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

WINDOW = box(-146.0, 18.0, -100.0, 57.0)
# Geographic offset of the raised shadow (lon, lat degrees): down and to the right.
SHADOW_OFFSET = (0.075, -0.12)
SHADOW_RINGS = [0.01, 0.03, 0.055, 0.085, 0.12, 0.16, 0.21, 0.27]  # buffer radii, degrees (soft falloff when stacked)
BAND_DISTANCES = [5.0, 3.4, 2.3, 1.55, 1.1, 0.8, 0.58, 0.42, 0.3, 0.2, 0.12, 0.06]  # degrees, widest first
LINE_DISTANCES = [0.3, 0.55, 0.9, 1.35]


def load_union(path, pick=lambda props: True):
    data = json.loads(Path(path).read_text())
    geoms = [shape(f["geometry"]).buffer(0) for f in data["features"] if pick(f["properties"])]
    return unary_union(geoms)


def polys(geom):
    return [geom] if geom.geom_type == "Polygon" else list(getattr(geom, "geoms", []))


def feature(geom, **props):
    return {"type": "Feature", "properties": props, "geometry": mapping(geom)}


def write(path, features):
    text = json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":"))
    Path(path).write_text(text)
    print(path, f"{len(text) / 1024:.0f} KB")


def main(ne_dir, out_dir):
    ne, out = Path(ne_dir), Path(out_dir)
    ocean = load_union(ne / "ne_50m_ocean.geojson").intersection(WINDOW)
    land = load_union(ne / "ne_50m_land.geojson").intersection(WINDOW)
    # Offshore islands (Channel Islands etc.) would spawn blobby rings; bands follow the big landmasses only.
    mainland = unary_union([g for g in polys(land) if g.area > 0.5])
    california = load_union(
        ne / "ne_50m_admin_1_states_provinces.geojson",
        lambda p: p.get("name") == "California" and p.get("adm0_a3") == "USA",
    )
    # Drop the Channel Islands/specks from the sticker silhouette: keep the mainland piece only.
    california = max(polys(california.intersection(land.buffer(0.02))), key=lambda g: g.area)
    california = california.simplify(0.003, preserve_topology=True)
    sticker = orient(california, sign=1.0)
    write(out / "ca-sticker.geojson", [feature(sticker)])

    shifted = affinity.translate(california, *SHADOW_OFFSET)
    rings = []
    for r in SHADOW_RINGS:
        ring = shifted.buffer(r, 6).difference(california).simplify(0.004)
        rings.append(feature(ring, r=r))
    write(out / "ca-shadow.geojson", rings)

    bands = []
    for d in BAND_DISTANCES:
        band = ocean.intersection(mainland.buffer(d, 8)).simplify(0.012, preserve_topology=True)
        bands.append(feature(band, d=d))
    write(out / "ocean-bands.geojson", bands)

    lines = []
    for d in LINE_DISTANCES:
        edge = mainland.buffer(d, 8).boundary.intersection(ocean.buffer(-0.01))
        edge = edge.intersection(WINDOW.buffer(-0.2)).simplify(0.006)
        if not edge.is_empty:
            lines.append(feature(MultiLineString([g for g in getattr(edge, "geoms", [edge]) if g.geom_type == "LineString"]), d=d))
    write(out / "ocean-lines.geojson", lines)


main(*sys.argv[1:3])
