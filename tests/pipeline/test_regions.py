import importlib.util
import json
import sys

import h3
import numpy as np
import pandas as pd
import pytest

import common
import crops

_SPEC = importlib.util.spec_from_file_location("regions_mod", common.REPO_ROOT / "pipeline" / "06_regions.py")
regions = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = regions  # dataclasses resolve annotations through sys.modules
_SPEC.loader.exec_module(regions)

LOOKUP = crops.load_lookup()
IDS = {crop.dwr_code: crop.crop_id for crop in LOOKUP}
REGIONS_JSON = regions.REGIONS_JSON

needs_output = pytest.mark.skipif(not REGIONS_JSON.exists(), reason="run `make regions` first")


def _points(rows: list[tuple[int, float, float, float]]) -> pd.DataFrame:
    """rows: (crop_id, lon, lat, acres)."""
    frame = pd.DataFrame(rows, columns=["crop_id", "lon", "lat", "acres"])
    frame["county"] = "Testland"
    frame["cell4"] = regions.cell_ids(frame, 4)
    frame["cell5"] = regions.cell_ids(frame, 5)
    return frame


def test_featured_weights_exclude_seedling_herb_and_native_pasture():
    weights = regions.featured_weights(LOOKUP)
    by_id = {crop.crop_id: crop for crop in LOOKUP}
    assert IDS["P4"] not in weights
    assert all(by_id[crop_id].icon not in regions.EXCLUDED_ICONS for crop_id in weights)
    assert weights[IDS["P3"]] == regions.MIXED_PASTURE_WEIGHT
    assert weights[IDS["D12"]] == 1.0


def test_specialty_weight_favours_small_crops():
    weights = regions.featured_weights(LOOKUP, {IDS["D12"]: 1_000_000.0, IDS["T20"]: 10_000.0})
    assert weights[IDS["D12"]] == 1.0
    assert weights[IDS["T20"]] > 1.0


def test_top_crop_applies_weights_and_threshold():
    almond, pasture, native = IDS["D12"], IDS["P3"], IDS["P4"]
    points = _points(
        [
            (almond, -120.0, 37.0, 1000.0),
            (pasture, -120.0, 37.0, 1800.0),  # 1800 * 0.5 < 1000: almonds win
            (native, -120.0, 37.0, 9000.0),  # not featured
            (pasture, -122.0, 40.0, 900.0),  # below threshold
            (pasture, -118.0, 35.0, 4000.0),  # 4000 * 0.5 = 2000 beats nothing else
        ]
    )
    weights = regions.featured_weights(LOOKUP)
    top = regions.top_crop_per_cell(points, "cell4", weights, 1000.0)
    by_cell = dict(zip(top["cell"], zip(top["crop_id"], top["acres"], strict=True), strict=True))
    assert by_cell[points["cell4"].iloc[0]] == (almond, 1000.0)
    assert by_cell[points["cell4"].iloc[4]] == (pasture, 4000.0)
    assert points["cell4"].iloc[3] not in by_cell
    assert len(top) == 2


def test_resolution_changes_cell_granularity():
    points = _points([(1, -120.0, 37.0, 10.0), (1, -120.1, 37.05, 10.0)])
    assert h3.get_resolution(points["cell4"].iloc[0]) == 4
    assert h3.get_resolution(points["cell5"].iloc[0]) == 5
    assert points["cell5"].nunique() >= points["cell4"].nunique()


def test_components_merge_adjacent_cells_only():
    origin = h3.latlng_to_cell(37.0, -120.0, 4)
    ring = [c for c in h3.grid_disk(origin, 1) if c != origin]
    far = h3.latlng_to_cell(40.0, -122.0, 4)
    components = regions.connected_components({origin, ring[0], far})
    assert sorted(len(c) for c in components) == [1, 2]


def test_split_cells_caps_chunk_size_and_keeps_all_cells():
    origin = h3.latlng_to_cell(37.0, -120.0, 4)
    cells = sorted(h3.grid_disk(origin, 2))  # 19 cells
    chunks = regions.split_cells(cells, 4)
    assert len(chunks) == 5
    assert sorted(c for chunk in chunks for c in chunk) == cells
    assert max(len(chunk) for chunk in chunks) <= 7  # compact, not guaranteed exact
    assert regions.split_cells(cells[:4], 4) == [cells[:4]]


def test_region_point_snaps_off_empty_ground():
    # Two fields 100 km apart in different cells: the centroid lands between them, outside both.
    points = _points([(1, -120.0, 37.0, 100.0), (1, -121.0, 37.5, 100.0)])
    cells = frozenset(points["cell4"])
    lon, lat = regions.region_point(points, cells, 4, snap_km=3.0)
    assert (lon, lat) in {(-120.0, 37.0), (-121.0, 37.5)}


def test_spacing_drops_the_smaller_close_marker():
    def region(lon: float, acres: float) -> regions.Region:
        return regions.Region(1, acres, lon, 37.0, frozenset(), "X")

    kept = regions.enforce_spacing([region(-120.0, 10), region(-119.9, 50), region(-118.0, 5)], 45.0)
    assert [r.acres for r in kept] == [50, 5]


def test_label_prefers_valley_then_county_fallback():
    places = [
        regions.Place("Smalltown", -120.00, 37.00, "town"),
        regions.Place("Big Valley", -120.05, 37.00, "valley"),
    ]
    assert regions.label_point(-120.03, 37.0, "Fresno", places, valley_bias=0.5) == "Big Valley"
    assert regions.label_point(-110.0, 37.0, "Fresno", places) == "Fresno County"


def test_label_regions_are_unique():
    places = [regions.Place("Only Place", -120.0, 37.0, "town")]
    found = [regions.Region(1, 100 - i, -120.0 + i * 0.01, 37.0, frozenset(), "Fresno") for i in range(3)]
    regions.label_regions(found, places, 1.0, {})
    assert len({r.label for r in found}) == 3
    assert found[0].label == "Only Place"


def test_places_csv_is_wellformed():
    places = regions.load_places()
    assert 80 <= len(places) <= 200
    assert len({p.name for p in places}) == len(places)
    assert all(-125 < p.lon < -114 and 32 < p.lat < 42.5 for p in places)


def _load_document() -> dict:
    return json.loads(REGIONS_JSON.read_text(encoding="utf-8"))


@needs_output
def test_regions_json_schema():
    document = _load_document()
    assert set(document) == {"coarse", "fine", "search"}
    crop_ids = {crop.crop_id for crop in LOOKUP}
    for level in ("coarse", "fine"):
        collection = document[level]
        assert collection["type"] == "FeatureCollection"
        ids = [f["properties"]["id"] for f in collection["features"]]
        assert len(set(ids)) == len(ids) > 0
        ranks = sorted(f["properties"]["rank"] for f in collection["features"])
        assert ranks == list(range(1, len(ids) + 1))
        previous = float("inf")
        for feat in sorted(collection["features"], key=lambda f: f["properties"]["rank"]):
            props = feat["properties"]
            assert isinstance(props["id"], str) and isinstance(props["label"], str) and props["label"]
            assert isinstance(props["crop_id"], int) and props["crop_id"] in crop_ids
            assert isinstance(props["acres"], (int, float)) and props["acres"] <= previous
            previous = props["acres"]
            assert ("parent" in props) == (level == "fine")
            lon, lat = feat["geometry"]["coordinates"]
            assert feat["geometry"]["type"] == "Point"
            assert -125 < lon < -114 and 32 < lat < 42.5
            assert lon == round(lon, 5) and lat == round(lat, 5)
    coarse_ids = {f["properties"]["id"] for f in document["coarse"]["features"]}
    assert all(f["properties"]["parent"] in coarse_ids for f in document["fine"]["features"])


@needs_output
def test_regions_json_search_covers_every_crop():
    document = _load_document()
    search = document["search"]
    assert set(search) == {str(crop.crop_id) for crop in LOOKUP}
    for entry in search.values():
        assert set(entry) == {"center", "zoom", "label", "acres_total"}
        assert len(entry["center"]) == 2 and 10 <= entry["zoom"] <= 12
        assert entry["label"] and entry["acres_total"] >= 0


@needs_output
def test_regions_json_is_small_and_spacing_holds():
    assert REGIONS_JSON.stat().st_size < 1_000_000
    document = _load_document()
    for level, config in (("coarse", regions.COARSE), ("fine", regions.FINE)):
        coords = [f["geometry"]["coordinates"] for f in document[level]["features"]]
        for i, (lon, lat) in enumerate(coords):
            others = np.array(coords[i + 1 :])
            if len(others):
                distances = regions.haversine_km(lat, lon, others[:, 1], others[:, 0])
                assert distances.min() >= config.min_spacing_km - 0.05, (level, i)


@needs_output
def test_marker_counts_within_targets():
    document = _load_document()
    assert 20 <= len(document["coarse"]["features"]) <= 35
    assert 70 <= len(document["fine"]["features"]) <= 160
