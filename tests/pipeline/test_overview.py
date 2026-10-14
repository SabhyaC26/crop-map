import argparse
import importlib.util
import json
import sys

import geopandas as gpd
import numpy as np
import pytest
from shapely.geometry import Point, Polygon, box

import common

_SPEC = importlib.util.spec_from_file_location("overview_mod", common.REPO_ROOT / "pipeline" / "07_overview.py")
overview_mod = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = overview_mod
_SPEC.loader.exec_module(overview_mod)


def _fields(rows: list[tuple[int, float, object]]) -> gpd.GeoDataFrame:
    """rows: (crop_id, acres, geometry)."""
    return gpd.GeoDataFrame(
        {"crop_id": [r[0] for r in rows], "acres": [r[1] for r in rows]},
        geometry=[r[2] for r in rows],
        crs="EPSG:4326",
    )


def _write_inputs(tmp_path, year: int, region: str, fields: gpd.GeoDataFrame, outline) -> None:
    work = tmp_path / "work" / str(year) / region
    work.mkdir(parents=True)
    fields.to_file(work / "fields.fgb", driver="FlatGeobuf")
    outline_path = tmp_path / "ca.geojson"
    outline_path.write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {}, "geometry": outline.__geo_interface__}
    ]}))


def _patch_inputs(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(overview_mod, "WORK_DIR", tmp_path / "work")
    monkeypatch.setattr(overview_mod, "CA_OUTLINE", tmp_path / "ca.geojson")


def _args() -> argparse.Namespace:
    return argparse.Namespace(year=2023, region="statewide", acres_per_dot=60.0)


def _read_dots(path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_dot_minzoom_is_geometric_and_clamped():
    rng = np.random.default_rng(0)
    zooms = np.array([overview_mod.dot_minzoom(rng) for _ in range(20_000)])
    assert zooms.min() == overview_mod.MIN_ZOOM and zooms.max() == overview_mod.FULL_ZOOM
    # P(minzoom <= FULL_ZOOM - 1) = 1 / ZOOM_RATIO, the rule the module docstring describes.
    assert np.mean(zooms <= overview_mod.FULL_ZOOM - 1) == pytest.approx(1 / overview_mod.ZOOM_RATIO, abs=0.02)
    assert np.mean(zooms <= overview_mod.FULL_ZOOM - 2) == pytest.approx(overview_mod.ZOOM_RATIO**-2, abs=0.02)


def test_window_density_matches_brute_force_cell_count():
    rng = np.random.default_rng(1)
    xs, ys = rng.uniform(0, 0.6, 300), rng.uniform(0, 0.6, 300)
    cells_x = np.floor((xs - xs.min()) / overview_mod.CELL_DEG).astype(int)
    cells_y = np.floor((ys - ys.min()) / overview_mod.CELL_DEG).astype(int)
    r = overview_mod.SMOOTH_CELLS
    brute = np.array(
        [
            np.sum((np.abs(cells_x - cells_x[i]) <= r) & (np.abs(cells_y - cells_y[i]) <= r))
            for i in range(len(xs))
        ]
    )
    assert np.array_equal(overview_mod.window_density(xs, ys), brute)


def test_window_density_isolated_point_counts_only_itself():
    density = overview_mod.window_density(np.array([0.0, 5.0]), np.array([0.0, 5.0]))
    assert density.tolist() == [1, 1]


def test_sample_dots_hits_quota_inside_polygon_only():
    l_shape = Polygon([(0, 0), (4, 0), (4, 1), (1, 1), (1, 4), (0, 4)])
    fields = _fields([(7, 10.0, l_shape), (9, 0.0, box(10, 10, 11, 11))])
    dots = list(overview_mod.sample_dots(fields, acres_per_dot=1.0, rng=np.random.default_rng(0)))
    assert len(dots) == 10  # acres / acres_per_dot, zero-acre field contributes nothing
    assert {crop for crop, _, _ in dots} == {7}
    assert all(l_shape.contains(Point(x, y)) for _, x, y in dots)


def test_load_outline_unions_overlapping_features(tmp_path, monkeypatch):
    path = tmp_path / "ca.geojson"
    features = [box(0, 0, 1, 1), box(0.5, 0, 1.5, 1)]
    path.write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {}, "geometry": geom.__geo_interface__} for geom in features
    ]}))
    monkeypatch.setattr(overview_mod, "CA_OUTLINE", path)
    assert overview_mod.load_outline().area == pytest.approx(1.5)


def test_write_dots_keeps_only_dots_inside_outline(tmp_path, monkeypatch, capsys):
    outline = box(-121.0, 36.0, -119.5, 38.0)
    fields = _fields(
        [
            (12, 600.0, box(-120.0, 37.0, -119.9, 37.1)),  # fully inside
            (14, 600.0, box(-119.6, 37.0, -119.4, 37.1)),  # straddles the eastern edge
        ]
    )
    _write_inputs(tmp_path, 2023, "statewide", fields, outline)
    _patch_inputs(monkeypatch, tmp_path)
    dots_path = tmp_path / "dots.geojsonl"
    overview_mod.write_dots(_args(), dots_path)

    dots = _read_dots(dots_path)
    assert 10 < len(dots) < 20
    assert all(outline.covers(Point(*d["geometry"]["coordinates"])) for d in dots)
    assert {d["properties"]["crop_id"] for d in dots} <= {12, 14}
    assert all(d["properties"]["g"] in (0, 1) for d in dots)
    assert all(d["tippecanoe"]["maxzoom"] == overview_mod.MAX_ZOOM for d in dots)
    assert "outside CA" in capsys.readouterr().out


def test_write_dots_hides_isolated_farmland_until_stray_zoom(tmp_path, monkeypatch):
    fields = _fields([(12, 600.0, box(-120.0, 37.0, -119.9, 37.1))])
    _write_inputs(tmp_path, 2023, "statewide", fields, box(-121.0, 36.0, -119.0, 38.0))
    _patch_inputs(monkeypatch, tmp_path)
    dots_path = tmp_path / "dots.geojsonl"
    overview_mod.write_dots(_args(), dots_path)

    zooms = [d["tippecanoe"]["minzoom"] for d in _read_dots(dots_path)]
    assert len(zooms) == 10
    assert min(zooms) >= overview_mod.STRAY_ZOOM


def test_write_dots_dense_farming_region_shows_from_min_zoom(tmp_path, monkeypatch):
    # 800 dots in one ~0.1 degree box: far above DENSE_MIN, so thinning starts at MIN_ZOOM.
    fields = _fields([(12, 48_000.0, box(-120.0, 37.0, -119.9, 37.1))])
    _write_inputs(tmp_path, 2023, "statewide", fields, box(-121.0, 36.0, -119.0, 38.0))
    _patch_inputs(monkeypatch, tmp_path)
    dots_path = tmp_path / "dots.geojsonl"
    overview_mod.write_dots(_args(), dots_path)

    zooms = [d["tippecanoe"]["minzoom"] for d in _read_dots(dots_path)]
    assert len(zooms) == 800
    assert min(zooms) == overview_mod.MIN_ZOOM
    assert max(zooms) <= overview_mod.FULL_ZOOM


def test_main_refuses_to_write_through_symlink(tmp_path, monkeypatch):
    keep = tmp_path / "dots.geojsonl"
    keep.write_text("")
    target = tmp_path / "real.pmtiles"
    target.write_bytes(b"")
    link = tmp_path / "overview.pmtiles"
    link.symlink_to(target)
    monkeypatch.setattr(sys, "argv", ["07_overview.py", "--keep-dots", str(keep), "--out", str(link)])

    def no_tippecanoe(*args, **kwargs):
        raise AssertionError("tippecanoe must not run")

    monkeypatch.setattr(overview_mod.subprocess, "run", no_tippecanoe)
    with pytest.raises(SystemExit, match="symlink"):
        overview_mod.main()


def test_main_reuses_dots_and_passes_zoom_flags_to_tippecanoe(tmp_path, monkeypatch):
    keep = tmp_path / "dots.geojsonl"
    keep.write_text("")
    out = tmp_path / "site" / "overview.pmtiles"
    monkeypatch.setattr(sys, "argv", [
        "07_overview.py", "--keep-dots", str(keep), "--out", str(out), "--low-detail", "11",
    ])

    def must_reuse(*args, **kwargs):
        raise AssertionError("existing --keep-dots file must be reused, not regenerated")

    calls: list[tuple[list[str], dict]] = []

    def fake_run(cmd, **kwargs):
        calls.append((cmd, kwargs))
        out.write_bytes(b"pmtiles")

    monkeypatch.setattr(overview_mod, "write_dots", must_reuse)
    monkeypatch.setattr(overview_mod.subprocess, "run", fake_run)
    overview_mod.main()

    (cmd, kwargs), = calls
    assert kwargs.get("check") is True
    assert cmd[0] == "tippecanoe"
    assert cmd[cmd.index("-o") + 1] == str(out)
    assert {"-Z4", "-z9", "-D11", "--drop-densest-as-needed"} <= set(cmd)
    assert cmd[cmd.index("-l") + 1] == "overview"
    assert cmd[-1] == str(keep)
