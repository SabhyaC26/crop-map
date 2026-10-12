import importlib.util
from pathlib import Path

import geopandas as gpd
import pandas as pd
import pyogrio
import pytest
from shapely.geometry import box

import common

_SPEC = importlib.util.spec_from_file_location("inspect_mod", common.REPO_ROOT / "pipeline" / "02_inspect.py")
inspect_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(inspect_mod)

LEGEND = common.Legend(
    classes={"D": "DECIDUOUS FRUITS AND NUTS", "V": "VINEYARDS", "X": "UNCLASSIFIED FALLOW"},
    subclasses={"D": {12: "Almonds"}},
)


def _frame() -> pd.DataFrame:
    return pd.DataFrame(
        {
            "MAIN_CROP": ["D12", "D12", "V", "X"],
            "CROPTYP1": ["****", "****", "****", "D12"],
            "CROPTYP2": ["D12", "D12", "V", "X"],
            "CROPTYP3": ["****", "****", "****", "****"],
            "CROPTYP4": ["****", "****", "****", "****"],
            "MULTIUSE": ["S", "S", "S", "D"],
            "ACRES": [10.0, 5.5, 3.0, 2.0],
            "COUNTY": ["Monterey", "Monterey", "Fresno", "Fresno"],
        }
    )


def test_code_table_lists_codes_counts_and_acres():
    table = inspect_mod.code_table(_frame(), "MAIN_CROP", LEGEND)
    assert "| code | name (from legend) | polygons | total acres |" in table
    assert "| `D12` | Deciduous fruits and nuts: Almonds | 2 | 15.5 |" in table
    assert "| `V` | Grapes | 1 | 3.0 |" in table
    assert "**total**" in table


def test_code_table_marks_null_token():
    assert "(unset)" in inspect_mod.code_table(_frame(), "CROPTYP1", LEGEND)


def test_multicrop_stats_flags_x_hiding_a_crop():
    stats = inspect_mod.multicrop_stats(_frame())
    assert stats["x_main_hides_crop"] == 1
    assert stats["with_other_crops"] == 1


@pytest.fixture
def synthetic_inputs(tmp_path, monkeypatch):
    """Write a tiny real shapefile and patch build_doc's inputs so it runs without the 2023 data."""
    monkeypatch.setattr(inspect_mod, "REPO_ROOT", tmp_path)
    shp = tmp_path / "synthetic.shp"
    frame = _frame().assign(
        SEN_CROP=["****"] * 4,
        EMRG_CROP=["****"] * 4,
        UniqueID=range(4),
        COUNTY=["Monterey", "Monterey", "Fresno", "Fresno"],
    )
    gdf = gpd.GeoDataFrame(frame, geometry=[box(i, 0, i + 1, 1) for i in range(4)], crs="EPSG:3310")
    pyogrio.write_dataframe(gdf, shp)
    monkeypatch.setattr(inspect_mod, "shapefile_path", lambda year: shp)
    monkeypatch.setattr(inspect_mod, "parse_legend", lambda pdf: LEGEND)
    return shp


def test_build_doc_renders_codes_table_and_column_names(synthetic_inputs):
    doc = inspect_mod.build_doc(2023)
    assert "## Column names to use" in doc
    assert "| Primary crop code | `MAIN_CROP` |" in doc
    assert "### `MAIN_CROP`" in doc
    assert "| code | name (from legend) | polygons | total acres |" in doc
    assert "| `D12` | Deciduous fruits and nuts: Almonds | 2 | 15.5 |" in doc
    assert "| `V` | Grapes | 1 | 3.0 |" in doc
    assert "(CROPTYP1 is `****` then)" in doc


def test_build_doc_counts_real_counties_excluding_null_token(synthetic_inputs):
    # No `****` county in the fixture: a `nunique() - 1` count would wrongly report 1.
    doc = inspect_mod.build_doc(2023)
    assert "2 real counties otherwise appear by name" in doc


def test_committed_doc_has_codes_table():
    doc = common.CROP_CODES_DOC
    if not doc.exists():
        pytest.skip("docs/crop-codes.md not generated")
    text = Path(doc).read_text()
    assert "| code | name (from legend) | polygons | total acres |" in text
    assert "`MAIN_CROP`" in text and "`COUNTY = 'Monterey'`" in text
