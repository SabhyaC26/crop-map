import importlib.util
import json

import geopandas as gpd
import pytest
from shapely.geometry import Polygon, box

import common
import crops

_SPEC = importlib.util.spec_from_file_location("process_mod", common.REPO_ROOT / "pipeline" / "04_process.py")
process_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(process_mod)

LOOKUP = crops.load_lookup()
IDS = {crop.dwr_code: crop.crop_id for crop in LOOKUP}
OUTPUT_SCHEMA = {"crop_id", "other", "acres", "county", "geometry"}


def _source(rows: list[tuple]) -> gpd.GeoDataFrame:
    """rows: (MAIN_CROP, CROPTYP1..4, ACRES, COUNTY)."""
    columns = [common.COL_MAIN_CROP, *common.COL_SEASON_CROPS, common.COL_ACRES, common.COL_COUNTY]
    frame = gpd.GeoDataFrame(
        [dict(zip(columns, row, strict=True)) for row in rows],
        geometry=[box(-121 + i * 0.01, 36, -120.995 + i * 0.01, 36.005) for i in range(len(rows))],
        crs="EPSG:4269",
    )
    return frame


def test_process_frame_schema_and_rules():
    n = common.NULL_TOKEN
    source = _source(
        [
            ("D12", n, "D12", n, n, 12.345, "MONTEREY"),
            ("X", n, "D12", "X", n, 3.0, "Fresno"),  # trailing fallow hides the almonds
            ("X", n, "X", n, n, 4.0, "Fresno"),  # pure fallow: dropped
            ("U", n, "U", n, n, 9.0, n),  # urban: dropped
            ("I4", n, "I4", n, n, 9.0, "Kern"),  # idle: dropped
            ("T30", "G6", "T30", "I1", n, 7.77, "San Benito"),
        ]
    )
    out = process_mod.process_frame(source, LOOKUP)
    assert set(out.columns) == OUTPUT_SCHEMA
    assert out.crs.to_epsg() == 4326
    assert out["crop_id"].tolist() == [IDS["D12"], IDS["D12"], IDS["T30"]]
    assert out["other"].isna().tolist() == [True, True, False]
    assert out["other"].iloc[2] == str(IDS["G6"])
    assert out["acres"].tolist() == [12.3, 3.0, 7.8]
    assert out["county"].tolist() == ["Monterey", "Fresno", "San Benito"]


def test_process_frame_unknown_growing_code_fails_loudly():
    n = common.NULL_TOKEN
    with pytest.raises(KeyError):
        process_mod.process_frame(_source([("ZZ9", n, "ZZ9", n, n, 1.0, "Fresno")]), LOOKUP)


def test_point_frame_uses_ten_acre_threshold_and_points_inside():
    polygon = Polygon([(0, 0), (4, 0), (4, 1), (1, 1), (1, 4), (0, 4)])  # L shape, centroid outside
    fields = gpd.GeoDataFrame(
        {"crop_id": [1, 2], "other": [None, None], "acres": [10.0, 9.9], "county": ["A", "A"]},
        geometry=[polygon, box(10, 10, 11, 11)],
        crs=4326,
    )
    points = process_mod.point_frame(fields)
    assert list(points.columns) == ["crop_id", "acres", "geometry"]
    assert len(points) == 1
    assert polygon.contains(points.geometry.iloc[0])


def test_write_points_sets_zoom_range(tmp_path):
    points = gpd.GeoDataFrame({"crop_id": [3], "acres": [12.5]}, geometry=gpd.points_from_xy([-121.5], [36.5]), crs=4326)
    path = tmp_path / "p.geojsonl"
    process_mod.write_points(points, path)
    feature = json.loads(path.read_text())
    assert feature["tippecanoe"] == {"minzoom": 12, "maxzoom": 14}
    assert feature["properties"] == {"crop_id": 3, "acres": 12.5}


def _shapefile_present() -> None:
    try:
        common.shapefile_path(common.DEFAULT_YEAR)
    except SystemExit:
        pytest.skip("raw shapefile not downloaded")


def test_monterey_row_count_parity_and_schema():
    _shapefile_present()
    attrs = process_mod.read_source(common.DEFAULT_YEAR, "monterey", geometry=False)
    assert len(attrs) == 15_165

    # Independent re-derivation of "excluded" straight from the codes.
    def growing(row) -> bool:
        main = row[common.COL_MAIN_CROP]
        if main == "X":
            real = [c for c in row[list(common.COL_SEASON_CROPS)] if c not in (common.NULL_TOKEN, "X")]
            main = real[-1] if real else "X"
        return not crops.is_excluded(main)

    expected = int(attrs.apply(growing, axis=1).sum())

    source = process_mod.read_source(common.DEFAULT_YEAR, "monterey")
    out = process_mod.process_frame(source, LOOKUP)
    assert len(out) == expected == len(attrs) - int((~attrs.apply(growing, axis=1)).sum())
    assert set(out.columns) == OUTPUT_SCHEMA
    assert set(out["crop_id"]) <= set(IDS.values())
    assert (out["county"] == "Monterey").all()
    assert out.geometry.has_z.sum() == 0
    assert out.geometry.is_valid.mean() > 0.99
    assert out.total_bounds[0] > -122 and out.total_bounds[2] < -120
