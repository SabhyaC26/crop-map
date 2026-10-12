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


def test_coarse_weights_exclude_mixed_pasture():
    coarse = regions.featured_weights(LOOKUP, allow_mixed_pasture=False)
    assert IDS["P3"] not in coarse and IDS["P4"] not in coarse
    assert IDS["P3"] in regions.featured_weights(LOOKUP)


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


def test_coarse_label_prefers_prominent_then_other_then_county():
    places = [
        regions.Place("Near Hamlet", -120.00, 37.00, "town", 2),
        regions.Place("Famous City", -120.30, 37.00, "town", 1),  # ~27 km away
        regions.Place("Far City", -121.00, 37.00, "town", 1),
    ]
    assert regions.label_point(-120.0, 37.0, "Fresno", places) == "Famous City"
    assert regions.label_point(-120.2, 37.0, "Fresno", places[:1]) == "Near Hamlet"
    assert regions.label_point(-110.0, 37.0, "Fresno", places) == "Fresno County"


def test_label_coarse_dedups_without_compass_words():
    places = [regions.Place("Only City", -120.0, 37.0, "town", 1)]
    found = [regions.Region(1, 100 - 10 * i, -120.0 + i * 0.3, 37.0, frozenset(), "Fresno") for i in range(4)]
    kept = regions.label_coarse(found, places)
    labels = [r.label for r in kept]
    assert labels == ["Only City", "Fresno County"]  # third+ duplicates drop
    assert not any(word in label for label in labels for word in ("North", "South", "East", "West"))


def test_diversify_switch_requires_share_threshold():
    almond, rice = IDS["D12"], IDS["R1"]
    # One res-4 cell holds both crops; two earlier almond regions already exist elsewhere.
    base = [(almond, -123.0 + i * 1.5, 37.0, 5000.0) for i in range(2)]
    for share, expect_switch in ((0.40, True), (0.30, False)):
        rows = [*base, (almond, -119.0, 37.0, 4000.0), (rice, -119.0, 37.0, 4000.0 * share)]
        points = _points(rows)
        index = regions.cell_index(points, "cell4")
        weights = {almond: 1.0, rice: 1.0}
        level = regions.COARSE
        built = [
            regions.make_region(points, index, frozenset({points["cell4"].iloc[i]}), almond, level) for i in range(3)
        ]
        result = regions.diversify(built, points, index, weights, level)
        if expect_switch:
            third = next(r for r in result if r.switched_from is not None)
            assert third.crop_id == rice and third.switched_from == almond and third.acres == 1600.0
        else:
            assert all(r.switched_from is None for r in result)


def test_label_regions_are_unique():
    places = [regions.Place("Only Place", -120.0, 37.0, "town")]
    found = [regions.Region(1, 100 - i, -120.0 + i * 0.01, 37.0, frozenset(), "Fresno") for i in range(3)]
    regions.label_regions(found, places, 1.0, {})
    assert len({r.label for r in found}) == 3
    assert found[0].label == "Only Place"


def test_places_csv_is_wellformed():
    places = regions.load_places()
    assert {p.prominence for p in places} == {1, 2}
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
        assert set(entry) == {"center", "zoom", "label", "acres_total", "places", "bbox"}
        assert len(entry["center"]) == 2 and 10 <= entry["zoom"] <= 12
        assert entry["label"] and entry["acres_total"] >= 0


@needs_output
def test_search_places_schema():
    search = _load_document()["search"]
    for crop_id, entry in search.items():
        listed = entry["places"]
        assert 1 <= len(listed) <= regions.SEARCH_MAX_PLACES, crop_id
        assert [p["acres"] for p in listed] == sorted((p["acres"] for p in listed), reverse=True), crop_id
        assert len({p["label"] for p in listed}) == len(listed), crop_id
        for place in listed:
            assert set(place) == {"center", "zoom", "label", "acres"}
            assert place["label"] and place["acres"] >= 0 and 10 <= place["zoom"] <= 12
            assert all(c == round(c, 5) for c in place["center"])
        first = listed[0]
        assert (entry["center"], entry["zoom"], entry["label"]) == (first["center"], first["zoom"], first["label"])
        if entry["acres_total"] > 0:
            assert all(p["acres"] >= regions.SEARCH_MIN_SHARE * entry["acres_total"] for p in listed[1:]), crop_id
        for i, place in enumerate(listed):
            for other in listed[i + 1 :]:
                km = float(
                    regions.haversine_km(
                        place["center"][1], place["center"][0], other["center"][1], other["center"][0]
                    )
                )
                assert km >= regions.SEARCH_SPACING_KM - 0.05, (crop_id, place["label"], other["label"])


@needs_output
def test_search_bbox_contains_every_place():
    for crop_id, entry in _load_document()["search"].items():
        west, south, east, north = entry["bbox"]
        assert west < east and south < north
        for place in entry["places"]:
            lon, lat = place["center"]
            assert west <= lon <= east and south <= lat <= north, crop_id
        assert entry["bbox"] == regions.search_bbox([p["center"] for p in entry["places"]])


@needs_output
def test_search_known_multi_destination_crops():
    search = _load_document()["search"]
    by_name = {crop.name: str(crop.crop_id) for crop in LOOKUP}
    avocado_labels = {p["label"] for p in search[by_name["Avocados"]]["places"]}
    assert avocado_labels & {"Temecula Valley", "Escondido"} and avocado_labels & {"Oxnard Plain", "Ventura"}
    date_labels = {p["label"] for p in search[by_name["Dates"]]["places"]}
    assert "Coachella Valley" in date_labels


def _hotspot_points(rows: list[tuple[float, float, float]]) -> pd.DataFrame:
    frame = pd.DataFrame(rows, columns=["lon", "lat", "acres"])
    frame["county"] = "Testland"
    frame["cell6"] = regions.cell_ids(frame, 6)
    return frame


def test_find_hotspots_spacing_and_share_rule():
    rows = [
        (-120.0, 37.0, 1000.0),
        (-120.02, 37.01, 500.0),  # joins the first hotspot
        (-119.0, 37.0, 600.0),  # ~89 km away, 600 / 2250 > 5%
        (-118.0, 37.0, 50.0),  # < 5% of the crop
    ]
    found = regions.find_hotspots(_hotspot_points(rows))
    assert [round(h.acres) for h in found] == [1500, 600]
    assert float(regions.haversine_km(found[0].lat, found[0].lon, found[1].lat, found[1].lon)) >= 25.0


def test_find_hotspots_always_keeps_one():
    found = regions.find_hotspots(_hotspot_points([(-120.0, 37.0, 10.0)]))
    assert len(found) == 1 and found[0].acres == 10.0


def test_label_hotspots_dedups_and_merges():
    places = [regions.Place("Only City", -120.0, 37.0, "town", 1)]
    spots = [regions.Hotspot(-120.0 + 0.3 * i, 37.0, 100.0 - 10 * i, "Fresno") for i in range(3)]
    kept = regions.label_hotspots(spots, places)
    assert [h.label for h in kept] == ["Fresno County", "Only City"]
    assert kept[0].acres == 90.0 + 80.0  # third hotspot merged into the county-labelled one
    assert kept[1].acres == 100.0


def test_hotspot_zoom_thresholds():
    assert regions.hotspot_zoom(60_001) == 10
    assert regions.hotspot_zoom(60_000) == 11
    assert regions.hotspot_zoom(1_499) == 12
    assert regions.hotspot_zoom(1_500) == 11


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


@needs_output
def test_coarse_art_direction():
    document = _load_document()
    names = {crop.crop_id: crop.name for crop in LOOKUP}
    coarse = [f["properties"] for f in document["coarse"]["features"]]
    assert IDS["P3"] not in {p["crop_id"] for p in coarse}
    assert len({p["crop_id"] for p in coarse}) >= 10, {names[p["crop_id"]] for p in coarse}
    assert len({p["label"] for p in coarse}) == len(coarse)
    assert not any(label.split()[0] in {"North", "South", "East", "West", "North-West", "North-East", "South-West", "South-East"} for label in (p["label"] for p in coarse))
    counts = {}
    for p in coarse:
        counts[p["crop_id"]] = counts.get(p["crop_id"], 0) + 1
    assert max(counts.values()) <= 4
