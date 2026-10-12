"""Build the low-zoom fallback masks used around the basemap.pmtiles California extract.

  ocean-mask.geojson   Natural Earth ocean, so the Pacific stays blue where the extract has no tiles.
  outside-ca.geojson   Natural Earth land minus California, drawn as a soft veil so neighbouring
                       states recede and the extract's tile edge is never visible.

Sources (public domain), from https://github.com/nvkelso/natural-earth-vector/tree/master/geojson:
  ne_50m_ocean.geojson  ne_50m_land.geojson  ne_50m_admin_1_states_provinces.geojson

Usage: python make-basemap-masks.py <ne-dir> <out-dir>      (needs shapely)
"""
import json
import sys
from pathlib import Path

from shapely.geometry import box, mapping, shape
from shapely.ops import unary_union

WINDOW = box(-165.0, 5.0, -70.0, 64.0)


def load_union(path, pick=lambda props: True):
    data = json.loads(Path(path).read_text())
    geoms = [shape(f["geometry"]).buffer(0) for f in data["features"] if pick(f["properties"])]
    return unary_union(geoms)


def write(path, geom, simplify):
    geom = geom.simplify(simplify, preserve_topology=True)
    fc = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {}, "geometry": mapping(geom)}]}
    text = json.dumps(fc, separators=(",", ":"))
    Path(path).write_text(text)
    print(path, f"{len(text) / 1024:.0f} KB")


def main(ne_dir, out_dir):
    ne, out = Path(ne_dir), Path(out_dir)
    ocean = load_union(ne / "ne_50m_ocean.geojson").intersection(WINDOW)
    land = load_union(ne / "ne_50m_land.geojson").intersection(WINDOW)
    california = load_union(
        ne / "ne_50m_admin_1_states_provinces.geojson",
        lambda p: p.get("name") == "California" and p.get("adm0_a3") == "USA",
    )
    outside = land.difference(california.buffer(0.03))
    write(out / "ocean-mask.geojson", ocean, 0.004)
    write(out / "outside-ca.geojson", outside, 0.004)


main(*sys.argv[1:3])
