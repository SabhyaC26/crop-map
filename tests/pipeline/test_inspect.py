import importlib.util
from pathlib import Path

import pandas as pd
import pytest

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


def test_committed_doc_has_codes_table():
    doc = common.CROP_CODES_DOC
    if not doc.exists():
        pytest.skip("docs/crop-codes.md not generated")
    text = Path(doc).read_text()
    assert "| code | name (from legend) | polygons | total acres |" in text
    assert "`MAIN_CROP`" in text and "`COUNTY = 'Monterey'`" in text
