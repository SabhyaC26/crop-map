"""Build the "sticker diorama" overlays drawn around California on the basemap.

  ca-sticker.geojson   California outline (CCW exterior) used for the white die-cut edge and shadow anchor.

The ocean gradient and drop shadow are rasters derived from this outline: see make-sticker-rasters.py.

Sources (public domain), same dir as make-basemap-masks.py expects:
  ne_50m_land.geojson  ne_50m_admin_1_states_provinces.geojson

Usage: python make-sticker-masks.py <ne-dir> <out-dir>      (needs shapely)
"""
import json
import sys
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

WINDOW = box(-146.0, 18.0, -100.0, 57.0)


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
    land = load_union(ne / "ne_50m_land.geojson").intersection(WINDOW)
    california = load_union(
        ne / "ne_50m_admin_1_states_provinces.geojson",
        lambda p: p.get("name") == "California" and p.get("adm0_a3") == "USA",
    )
    # Drop the Channel Islands/specks from the sticker silhouette: keep the mainland piece only.
    california = max(polys(california.intersection(land.buffer(0.02))), key=lambda g: g.area)
    california = california.simplify(0.003, preserve_topology=True)
    sticker = orient(california, sign=1.0)
    write(out / "ca-sticker.geojson", [feature(sticker)])


main(*sys.argv[1:3])
