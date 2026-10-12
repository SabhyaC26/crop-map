"""Crop lookup table (data/lookup/crops.csv) and the code -> crop_id rules."""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from common import COL_MAIN_CROP, COL_SEASON_CROPS, NULL_TOKEN, REPO_ROOT

LOOKUP_CSV = REPO_ROOT / "data" / "lookup" / "crops.csv"
CROPS_JSON = REPO_ROOT / "site" / "public" / "data" / "crops.json"

LOOKUP_COLUMNS = ("dwr_code", "crop_id", "name", "icon", "color", "group", "harvest", "source")

ICON_SLUGS = frozenset(
    """lettuce broccoli carrot onion garlic potato tomato bell_pepper hot_pepper cucumber melon
    watermelon corn strawberry blueberry grapes olive avocado orange lemon peach cherries apple pear
    kiwi rice sunflower beans tulip seedling herb cow
    almond pistachio walnut date pomegranate wheat alfalfa cotton""".split()
)

FALLOW = "X"

# Not "growing": urban (U*), semi-ag (S*), native (N*), idle (I1/I2/I4) and pure fallow (X).
_EXCLUDED = re.compile(r"U[A-Z]*\d*|S\d*|N[A-Z]*\d*|I\d+|X")

_COLOR = re.compile(r"#[0-9a-f]{6}")
_HARVEST = re.compile(r"[01]{12}")


def is_excluded(code: str) -> bool:
    return _EXCLUDED.fullmatch(code) is not None


@dataclass(frozen=True)
class Crop:
    dwr_code: str
    crop_id: int
    name: str
    icon: str
    color: str
    group: str
    harvest: str
    source: str


def load_lookup(path: Path = LOOKUP_CSV) -> list[Crop]:
    with path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        if tuple(reader.fieldnames or ()) != LOOKUP_COLUMNS:
            raise ValueError(f"{path}: columns must be {','.join(LOOKUP_COLUMNS)}")
        return [Crop(**{**row, "crop_id": int(row["crop_id"])}) for row in reader]


def validate_lookup(crops: list[Crop]) -> list[str]:
    """Return human-readable problems (empty list = valid)."""
    problems: list[str] = []
    seen_ids: set[int] = set()
    seen_codes: set[str] = set()
    for crop in crops:
        label = crop.dwr_code or f"id {crop.crop_id}"
        if not crop.dwr_code:
            problems.append(f"{label}: empty dwr_code")
        if crop.dwr_code in seen_codes:
            problems.append(f"{label}: duplicate dwr_code")
        seen_codes.add(crop.dwr_code)
        if not 1 <= crop.crop_id <= 255:
            problems.append(f"{label}: crop_id {crop.crop_id} outside 1..255")
        if crop.crop_id in seen_ids:
            problems.append(f"{label}: duplicate crop_id {crop.crop_id}")
        seen_ids.add(crop.crop_id)
        if crop.icon not in ICON_SLUGS:
            problems.append(f"{label}: unknown icon '{crop.icon}'")
        if not _COLOR.fullmatch(crop.color):
            problems.append(f"{label}: color '{crop.color}' is not #rrggbb")
        if crop.harvest and not _HARVEST.fullmatch(crop.harvest):
            problems.append(f"{label}: harvest '{crop.harvest}' must be 12 chars of 0/1 or empty")
        if not crop.name or not crop.source:
            problems.append(f"{label}: name and source are required")
        if is_excluded(crop.dwr_code):
            problems.append(f"{label}: excluded code must not have a lookup row")
    return problems


def crops_json_rows(crops: list[Crop]) -> list[dict]:
    return [
        {
            "crop_id": crop.crop_id,
            "dwr_code": crop.dwr_code,
            "name": crop.name,
            "icon": crop.icon,
            "color": crop.color,
            "group": crop.group,
            "harvest": [char == "1" for char in crop.harvest] if crop.harvest else None,
        }
        for crop in crops
    ]


def _clean(code: object) -> str | None:
    if not isinstance(code, str):
        return None
    code = code.strip()
    return None if not code or code == NULL_TOKEN else code


def _season_codes(row: pd.Series) -> list[str]:
    return [code for col in COL_SEASON_CROPS if (code := _clean(row[col]))]


def primary_code(row: pd.Series) -> str:
    """MAIN_CROP, unless a trailing fallow `X` hid the real crop (then the last non-X code)."""
    main = _clean(row[COL_MAIN_CROP]) or FALLOW
    if main != FALLOW:
        return main
    real = [code for code in _season_codes(row) if code != FALLOW]
    return real[-1] if real else FALLOW


def other_codes(row: pd.Series, primary: str) -> list[str]:
    """Distinct remaining growing codes from CROPTYP1..4, in sequence order."""
    others: list[str] = []
    for code in _season_codes(row):
        if code != primary and not is_excluded(code) and code not in others:
            others.append(code)
    return others
