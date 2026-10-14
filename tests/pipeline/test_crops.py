import math

import pandas as pd
import pytest

import common
import crops


def _row(main: object, *seasons: object) -> pd.Series:
    padded = [*seasons, *([common.NULL_TOKEN] * (4 - len(seasons)))]
    return pd.Series({common.COL_MAIN_CROP: main, **dict(zip(common.COL_SEASON_CROPS, padded, strict=True))})


def _crop(**overrides) -> crops.Crop:
    fields = {
        "dwr_code": "D12",
        "crop_id": 12,
        "name": "Almonds",
        "icon": "almond",
        "color": "#8a6d3b",
        "group": "Orchards",
        "harvest": "",
        "source": "DWR",
    }
    return crops.Crop(**{**fields, **overrides})


def _write_csv(path, header: str, rows: list[str]) -> None:
    path.write_text("\n".join([header, *rows]) + "\n", encoding="utf-8")


HEADER = ",".join(crops.LOOKUP_COLUMNS)


def test_load_lookup_parses_rows_and_casts_crop_id(tmp_path):
    path = tmp_path / "crops.csv"
    _write_csv(path, HEADER, ["D12,12,Almonds,almond,#8a6d3b,Orchards,111111111111,DWR"])
    (crop,) = crops.load_lookup(path)
    assert crop == _crop(harvest="111111111111")
    assert isinstance(crop.crop_id, int)


def test_load_lookup_rejects_wrong_columns(tmp_path):
    path = tmp_path / "crops.csv"
    _write_csv(path, "dwr_code,crop_id,name", ["D12,12,Almonds"])
    with pytest.raises(ValueError, match="columns must be"):
        crops.load_lookup(path)


def test_load_lookup_rejects_non_numeric_crop_id(tmp_path):
    path = tmp_path / "crops.csv"
    _write_csv(path, HEADER, ["D12,twelve,Almonds,almond,#8a6d3b,Orchards,,DWR"])
    with pytest.raises(ValueError):
        crops.load_lookup(path)


def test_validate_flags_empty_dwr_code_and_missing_name_or_source():
    problems = crops.validate_lookup([_crop(dwr_code=""), _crop(dwr_code="D13", name="", source="")])
    assert any("empty dwr_code" in p for p in problems)
    assert any("name and source are required" in p for p in problems)


def test_validate_flags_duplicate_dwr_code():
    problems = crops.validate_lookup([_crop(crop_id=12), _crop(crop_id=13)])
    assert any("duplicate dwr_code" in p for p in problems)


def test_validate_crop_id_boundaries():
    assert crops.validate_lookup([_crop(crop_id=1)]) == []
    assert crops.validate_lookup([_crop(crop_id=255)]) == []
    assert any("outside 1..255" in p for p in crops.validate_lookup([_crop(crop_id=0)]))
    assert any("outside 1..255" in p for p in crops.validate_lookup([_crop(crop_id=256)]))


def test_validate_accepts_valid_crop_with_empty_harvest():
    assert crops.validate_lookup([_crop(harvest="")]) == []


def test_validate_rejects_uppercase_color():
    assert any("not #rrggbb" in p for p in crops.validate_lookup([_crop(color="#8A6D3B")]))


def test_is_excluded_is_a_full_match_not_a_prefix():
    # "IX" starts with I but has no digits; "XY" starts with X but is not fallow.
    assert not crops.is_excluded("IX")
    assert not crops.is_excluded("XY")
    assert not crops.is_excluded("D12X")


def test_primary_treats_whitespace_and_null_token_as_missing():
    assert crops.primary_code(_row("  D12 ")) == "D12"
    assert crops.primary_code(_row(common.NULL_TOKEN, "T30")) == "T30"


def test_primary_treats_non_string_values_as_missing():
    assert crops.primary_code(_row(float("nan"), "G6", "X")) == "G6"
    assert crops.primary_code(_row(None, None, None, None, None)) == crops.FALLOW


def test_primary_for_null_main_with_trailing_fallow():
    assert crops.primary_code(_row(common.NULL_TOKEN, "D12", "X")) == "D12"


def test_other_codes_ignores_nulls_whitespace_and_duplicates_of_primary():
    row = _row("D12", " D12 ", common.NULL_TOKEN, "G6", "G6")
    assert crops.other_codes(row, "D12") == ["G6"]


def test_other_codes_skips_excluded_codes_but_keeps_order():
    assert crops.other_codes(_row("T30", "S3", "G6", "T4"), "T30") == ["G6", "T4"]
    assert crops.other_codes(_row("T30", "U", "NV1", "G6"), "T30") == ["G6"]


def test_crops_json_maps_harvest_string_to_month_flags():
    (row,) = crops.crops_json_rows([_crop(harvest="100000000001")])
    assert row["harvest"] == [True, *([False] * 10), True]
    assert row["harvest"] == [bool(int(c)) for c in "100000000001"]


def test_crops_json_empty_harvest_is_null_and_keeps_group():
    (row,) = crops.crops_json_rows([_crop(harvest="", group="Field crops")])
    assert row["harvest"] is None
    assert row["group"] == "Field crops"
    assert "source" not in row and "color" in row


def test_clean_is_none_for_non_strings_and_blank_strings():
    assert crops._clean(None) is None
    assert crops._clean(math.nan) is None
    assert crops._clean("   ") is None
    assert crops._clean(common.NULL_TOKEN) is None
    assert crops._clean(" T30 ") == "T30"
