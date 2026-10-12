"""Turn the raw DWR shapefile into growing-field polygons + icon points (FlatGeobuf for tippecanoe)."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pyogrio

from common import (
    COL_ACRES,
    COL_COUNTY,
    COL_MAIN_CROP,
    COL_SEASON_CROPS,
    DEFAULT_YEAR,
    MONTEREY_FILTER,
    WORK_DIR,
    shapefile_path,
)
from crops import Crop, is_excluded, load_lookup, other_codes, primary_code, validate_lookup

REGIONS: dict[str, str | None] = {"statewide": None, "monterey": MONTEREY_FILTER}
SOURCE_COLUMNS = [COL_MAIN_CROP, *COL_SEASON_CROPS, COL_ACRES, COL_COUNTY]
CODE_COLUMNS = [COL_MAIN_CROP, *COL_SEASON_CROPS]
OUTPUT_COLUMNS = ["crop_id", "other", "acres", "county"]
POINT_MIN_ACRES = 10.0
FIELDS_FILENAME = "fields.fgb"
POINTS_FILENAME = "field_points.geojsonl"
POINTS_MIN_ZOOM = 12


def work_dir(year: int, region: str):
    return WORK_DIR / str(year) / region


def read_source(year: int, region: str, *, geometry: bool = True) -> gpd.GeoDataFrame | pd.DataFrame:
    return pyogrio.read_dataframe(
        shapefile_path(year),
        columns=SOURCE_COLUMNS,
        where=REGIONS[region],
        read_geometry=geometry,
        force_2d=geometry,
    )


def _resolve_codes(source: pd.DataFrame, crop_ids: dict[str, int]) -> pd.DataFrame:
    """Per distinct code combination (a few thousand) -> primary crop_id and `other` string."""
    combos = source[CODE_COLUMNS].drop_duplicates().reset_index(drop=True)
    primaries = [primary_code(row) for _, row in combos.iterrows()]
    combos["crop_id"] = [None if is_excluded(code) else crop_ids[code] for code in primaries]
    combos["other"] = [
        ",".join(str(crop_ids[c]) for c in other_codes(row, primary)) or None
        for (_, row), primary in zip(combos.iterrows(), primaries, strict=True)
    ]
    return combos


def process_frame(source: gpd.GeoDataFrame, lookup: list[Crop]) -> gpd.GeoDataFrame:
    """Filter to growing fields and shape them into the fields.pmtiles property schema."""
    crop_ids = {crop.dwr_code: crop.crop_id for crop in lookup}
    combos = _resolve_codes(source, crop_ids)
    resolved = source.merge(combos, on=CODE_COLUMNS, how="left", sort=False)
    resolved = resolved[resolved["crop_id"].notna()]
    out = gpd.GeoDataFrame(
        {
            "crop_id": resolved["crop_id"].astype("int32").to_numpy(),
            "other": resolved["other"].to_numpy(),
            "acres": resolved[COL_ACRES].round(1).to_numpy(),
            "county": resolved[COL_COUNTY].str.title().to_numpy(),
        },
        geometry=resolved.geometry.to_numpy(),
        crs=source.crs,
    )
    return out.to_crs(4326).reset_index(drop=True)[[*OUTPUT_COLUMNS, "geometry"]]


def point_frame(fields: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    big = fields[fields["acres"] >= POINT_MIN_ACRES]
    return gpd.GeoDataFrame(
        {"crop_id": big["crop_id"].to_numpy(), "acres": big["acres"].to_numpy()},
        geometry=big.geometry.representative_point().to_numpy(),
        crs=fields.crs,
    )


def write_points(points: gpd.GeoDataFrame, path: Path) -> None:
    """GeoJSON sequence: only this format can carry a per-feature tippecanoe minzoom."""
    with path.open("w", encoding="utf-8") as handle:
        for crop_id, acres, geom in zip(points["crop_id"], points["acres"], points.geometry, strict=True):
            feature = {
                "type": "Feature",
                "properties": {"crop_id": int(crop_id), "acres": float(acres)},
                "tippecanoe": {"minzoom": POINTS_MIN_ZOOM, "maxzoom": 14},
                "geometry": {"type": "Point", "coordinates": [round(geom.x, 7), round(geom.y, 7)]},
            }
            handle.write(json.dumps(feature, separators=(",", ":")) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR)
    parser.add_argument("--region", choices=sorted(REGIONS), default="statewide")
    args = parser.parse_args()

    lookup = load_lookup()
    problems = validate_lookup(lookup)
    if problems:
        raise SystemExit("crops.csv is invalid:\n  " + "\n  ".join(problems))

    started = time.monotonic()
    source = read_source(args.year, args.region)
    fields = process_frame(source, lookup)
    points = point_frame(fields)

    out_dir = work_dir(args.year, args.region)
    out_dir.mkdir(parents=True, exist_ok=True)
    # tippecanoe turns FlatGeobuf integer columns into strings; a double column becomes a tile number.
    tippecanoe_fields = fields.astype({"crop_id": "float64"})
    pyogrio.write_dataframe(tippecanoe_fields, out_dir / FIELDS_FILENAME, driver="FlatGeobuf", promote_to_multi=True)
    write_points(points, out_dir / POINTS_FILENAME)
    print(
        f"{args.region}: {len(source):,} source polygons -> {len(fields):,} growing fields "
        f"({len(source) - len(fields):,} excluded), {len(points):,} points >= {POINT_MIN_ACRES:g} ac "
        f"in {time.monotonic() - started:.1f}s -> {out_dir}"
    )


if __name__ == "__main__":
    main()
