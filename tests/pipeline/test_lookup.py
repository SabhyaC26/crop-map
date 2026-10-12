import json
from pathlib import Path

import pandas as pd
import pyogrio
import pytest

import common
import crops

LOOKUP = crops.load_lookup()
CODES = {crop.dwr_code for crop in LOOKUP}
CODE_COLUMNS = [common.COL_MAIN_CROP, *common.COL_SEASON_CROPS]


def _row(main: str, *seasons: str) -> pd.Series:
    padded = [*seasons, *([common.NULL_TOKEN] * (4 - len(seasons)))]
    return pd.Series({common.COL_MAIN_CROP: main, **dict(zip(common.COL_SEASON_CROPS, padded, strict=True))})


def test_lookup_is_valid():
    assert crops.validate_lookup(LOOKUP) == []


def test_lookup_fields_match_contract():
    assert len({crop.crop_id for crop in LOOKUP}) == len(LOOKUP)
    for crop in LOOKUP:
        assert crop.icon in crops.ICON_SLUGS
        assert crop.color.startswith("#") and len(crop.color) == 7
        assert crop.harvest == "" or (len(crop.harvest) == 12 and set(crop.harvest) <= {"0", "1"})
        assert crop.source


def test_validate_catches_bad_rows():
    good = LOOKUP[0]
    bad = [
        crops.Crop("Z1", good.crop_id, "Dup id", "not_an_icon", "red", "x", "101", "src"),
        crops.Crop("U", 300, "Excluded", good.icon, good.color, "x", "", "src"),
    ]
    problems = " | ".join(crops.validate_lookup([good, *bad]))
    for fragment in ("duplicate crop_id", "unknown icon", "not #rrggbb", "harvest", "outside 1..255", "excluded code"):
        assert fragment in problems


@pytest.mark.parametrize("code", ["U", "UL2", "UR3", "UC1", "UI9", "UV4", "I1", "I2", "I4", "X", "S3", "NV1", "NW2"])
def test_excluded_codes(code):
    assert crops.is_excluded(code)


@pytest.mark.parametrize("code", ["D12", "V", "C", "C7", "YP", "P1", "T32", "R1", "G2", "F16"])
def test_growing_codes_not_excluded(code):
    assert not crops.is_excluded(code)


def test_primary_is_main_crop():
    assert crops.primary_code(_row("D12", "D12")) == "D12"
    assert crops.primary_code(_row("T30", "G6", "T30")) == "T30"
    assert crops.primary_code(_row("I4", "I4")) == "I4"


def test_primary_for_trailing_fallow_uses_last_real_crop():
    assert crops.primary_code(_row("X", "****", "D12", "X")) == "D12"
    assert crops.primary_code(_row("X", "T30", "G6", "X")) == "G6"
    assert crops.primary_code(_row("X", "****", "X", "****")) == "X"


def test_other_codes():
    row = _row("T30", "G6", "T30", "I1", "G6")
    assert crops.other_codes(row, "T30") == ["G6"]
    assert crops.other_codes(_row("D12", "D12"), "D12") == []
    assert crops.other_codes(_row("D12", "X", "D12", "X"), "D12") == []
    assert crops.other_codes(_row("X", "D12", "X"), "D12") == []
    assert crops.other_codes(_row("F16", "T4", "T30", "F16", "T4"), "F16") == ["T4", "T30"]


def test_crops_json_export_shape():
    rows = crops.crops_json_rows(LOOKUP)
    almond = next(r for r in rows if r["dwr_code"] == "D12")
    assert set(almond) == {"crop_id", "dwr_code", "name", "icon", "color", "group", "harvest"}
    assert len(almond["harvest"]) == 12 and all(isinstance(m, bool) for m in almond["harvest"])
    assert next(r for r in rows if r["dwr_code"] == "P3")["harvest"] is None


def test_committed_crops_json_matches_lookup():
    path = crops.CROPS_JSON
    assert path.exists(), "run `make lookup`"
    assert json.loads(path.read_text()) == crops.crops_json_rows(LOOKUP)


def _shapefile() -> Path:
    try:
        return common.shapefile_path(common.DEFAULT_YEAR)
    except SystemExit:
        pytest.skip("raw shapefile not downloaded")


def test_every_growing_code_in_data_has_lookup_row():
    shp = _shapefile()
    seen: set[str] = set()
    for column in CODE_COLUMNS:
        frame = pyogrio.read_dataframe(shp, columns=[column], read_geometry=False)
        seen |= set(frame[column].unique())
    growing = {code for code in seen if code != common.NULL_TOKEN and not crops.is_excluded(code)}
    assert growing - CODES == set()
