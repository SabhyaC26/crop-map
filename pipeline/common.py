"""Shared constants and helpers for the crop-map pipeline."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from pypdf import PdfReader

REPO_ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = REPO_ROOT / "data" / "raw"
WORK_DIR = REPO_ROOT / "data" / "work"
DOCS_DIR = REPO_ROOT / "docs"
CROP_CODES_DOC = DOCS_DIR / "crop-codes.md"

DEFAULT_YEAR = 2023

_CNRA = "https://data.cnra.ca.gov/dataset/6c3d65e3-35bb-49e1-a51e-49d5a2cf09a9/resource"
LEGEND_URL = (
    f"{_CNRA}/9a00d123-7d5f-46a0-8e89-b6b0591a01f0/download/"
    "2022-dwr-standard-land-use-legend-remote-sensing-version.pdf"
)
LEGEND_FILENAME = "legend.pdf"


@dataclass(frozen=True)
class YearSource:
    url: str
    zip_name: str


# Only 2023 is wired up; add other years' resource URLs here.
YEAR_SOURCES: dict[int, YearSource] = {
    2023: YearSource(
        url=f"{_CNRA}/25d0f174-4bec-4987-a402-602cd1372786/download/i15_crop_mapping_final_2023.zip",
        zip_name="i15_crop_mapping_final_2023.zip",
    ),
}

# Real column names in the 2023 shapefile (see docs/crop-codes.md).
COL_MAIN_CROP = "MAIN_CROP"
COL_SEASON_CROPS = ("CROPTYP1", "CROPTYP2", "CROPTYP3", "CROPTYP4")
COL_SEN_CROP = "SEN_CROP"
COL_EMRG_CROP = "EMRG_CROP"
COL_MULTIUSE = "MULTIUSE"
COL_ACRES = "ACRES"
COL_COUNTY = "COUNTY"
NULL_TOKEN = "****"

MONTEREY_FILTER = f"{COL_COUNTY} = 'Monterey'"


def year_source(year: int) -> YearSource:
    try:
        return YEAR_SOURCES[year]
    except KeyError:
        known = ", ".join(str(y) for y in sorted(YEAR_SOURCES))
        raise SystemExit(f"No source URL configured for year {year} (known: {known})") from None


def raw_dir(year: int) -> Path:
    return RAW_DIR / str(year)


def zip_path(year: int) -> Path:
    return raw_dir(year) / year_source(year).zip_name


def legend_path(year: int) -> Path:
    return raw_dir(year) / LEGEND_FILENAME


def shapefile_path(year: int) -> Path:
    """The .shp inside data/raw/<year>/ (its case differs from the zip name)."""
    matches = sorted(raw_dir(year).glob("*.shp"))
    if not matches:
        raise SystemExit(f"No shapefile in {raw_dir(year)}; run `make download YEAR={year}` first")
    return matches[0]


# --- Legend PDF parsing -------------------------------------------------------------

LEGEND_FIRST_PAGE = 3  # 0-based index of the "AGRICULTURAL CLASSES" page
LEGEND_LAST_PAGE = 10  # inclusive; "NATIVE CLASSES" page

_CLASS_HEADING = re.compile(r"^(YP|[A-Z]{1,2})\s*[-–]\s+(\S.*)$")
_ENTRY_START = re.compile(r"(?:(?<=\s)|^)(\d{1,2})\.?\s+(?=[A-Z\[])")
_PAGE_NUMBER = re.compile(r"^\d{1,2}\s*$")
_SKIP_LINE = re.compile(r"^(Example|II\.|III\.|IV\.|V\.|VI\.|WATER USE FACTOR|\(.*\)\s*$)")

# The PDF text layer splits some words ("Suga r"); repair the ones that occur.
_WORD_FIXES = {
    "Suga r": "Sugar",
    "Safflowe r": "Safflower",
    "Pome granate": "Pomegranate",
    "Fi gs": "Figs",
    "Oran ges": "Oranges",
    "Eucal yptus": "Eucalyptus",
    "Jo joba": "Jojoba",
    "Mixe d": "Mixed",
    "Hybri d": "Hybrid",
    "fiel d": "field",
    "(d ry)": "(dry)",
    "Farmst eads": "Farmsteads",
    "fallo w": "fallow",
    "Hybrid sorghum/Sudan grass": "Hybrid sorghum/Sudan",
}

# Entries whose two-column layout defeats the text extraction.
_NAME_OVERRIDES = {
    ("S", 1): "Farmsteads (with farm residence)",
    ("S", 2): "Livestock feed lot operations",
    ("S", 5): "Farmsteads (without farm residence)",
    ("UR", 4): "Trailer courts",
    ("NW", 2): "Water channel (irrigation and urban delivery)",
    ("NW", 3): "Water channel (drainage)",
}

# Unnumbered class-level entries that the data uses as bare class codes.
_BARE_CLASS_NAMES = {"C": "Citrus", "V": "Grapes", "X": "Unclassified fallow", "YP": "Young perennial fruits and nuts"}


@dataclass(frozen=True)
class Legend:
    classes: dict[str, str]
    subclasses: dict[str, dict[int, str]]

    def describe(self, code: str) -> str:
        """Human name for a DWR code such as `T18`, `D12`, `V` or `UL2`."""
        match = re.fullmatch(r"([A-Z]+?)(\d*)", code)
        if not match:
            return "(unrecognised code)"
        cls, sub = match.group(1), match.group(2)
        cls_name = self.classes.get(cls)
        if cls_name is None:
            return "(not in legend)"
        if not sub:
            return _BARE_CLASS_NAMES.get(cls, cls_name.capitalize())
        sub_name = self.subclasses.get(cls, {}).get(int(sub))
        if sub_name is None:
            return f"{cls_name.capitalize()}: subclass {sub} (not in legend)"
        return f"{cls_name.capitalize()}: {sub_name}"


def _clean_entry_name(raw: str) -> str:
    raw = " ".join(raw.split())
    for broken, fixed in _WORD_FIXES.items():
        raw = raw.replace(broken, fixed)
    if raw.startswith("["):
        inner = raw[1:].split("]")[0]
        inner = re.split(r",?\s*grouped for remote sensing|\s+for remote sensing", inner)[0]
        return f"{inner.strip()} (remote-sensing group)"
    raw = raw.split("[")[0]
    raw = re.sub(r"\([^()]{21,}\)", "", raw)
    raw = re.sub(r"\([^)]*$", "", raw)
    return raw.strip(" .,;")


def parse_legend(pdf: Path) -> Legend:
    """Best-effort class/subclass names from the DWR legend PDF (text layer, two columns)."""
    reader = PdfReader(str(pdf))
    classes: dict[str, str] = {}
    entries: dict[str, dict[int, list[str]]] = {}
    current: str | None = None
    last: tuple[str, int] | None = None

    for page in reader.pages[LEGEND_FIRST_PAGE : LEGEND_LAST_PAGE + 1]:
        for line in (page.extract_text() or "").splitlines():
            line = " ".join(line.split())
            if not line or _PAGE_NUMBER.match(line) or _SKIP_LINE.match(line):
                continue
            heading = _CLASS_HEADING.match(line)
            if heading and not _ENTRY_START.match(line):
                code, title = heading.groups()
                classes[code] = _clean_class_title(title)
                current, last = code, None
                continue
            if current is None:
                continue
            starts = list(_ENTRY_START.finditer(line))
            if not starts:
                if last is not None:
                    entries[last[0]][last[1]].append(line)
                continue
            for i, start in enumerate(starts):
                end = starts[i + 1].start() if i + 1 < len(starts) else len(line)
                number = int(start.group(1))
                entries.setdefault(current, {}).setdefault(number, []).append(line[start.end() : end])
                last = (current, number)

    subclasses = {
        cls: {
            n: _NAME_OVERRIDES.get((cls, n)) or _clean_entry_name(" ".join(parts))
            for n, parts in sorted(subs.items())
        }
        for cls, subs in entries.items()
    }
    return Legend(classes=classes, subclasses=subclasses)


def _clean_class_title(title: str) -> str:
    title = title.split("[")[0]
    return " ".join(title.split()).strip(" .")
