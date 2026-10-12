"""Aggregate fields into H3 cells and publish crop-region markers (regions.json) plus a docs/preview."""

from __future__ import annotations

import argparse
import csv
import json
import math
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from xml.sax.saxutils import escape

import geopandas as gpd
import h3
import numpy as np
import pandas as pd

from common import DEFAULT_YEAR, DOCS_DIR, REPO_ROOT, WORK_DIR
from crops import CROPS_JSON, Crop, load_lookup

PLACES_CSV = REPO_ROOT / "data" / "lookup" / "places.csv"
REGIONS_JSON = REPO_ROOT / "site" / "public" / "data" / "regions.json"
REGIONS_DOC = DOCS_DIR / "regions.md"
PREVIEW_SVG = DOCS_DIR / "screens" / "regions-preview.svg"

EXCLUDED_ICONS = frozenset({"seedling", "herb"})
NATIVE_PASTURE = "P4"
MIXED_PASTURE = "P3"
MIXED_PASTURE_WEIGHT = 0.5
# Mild boost for crops that are small statewide so strawberries/dates can win their home cells
# against almonds/corn: weight = (largest featured crop acres / crop acres) ** exponent.
SPECIALTY_EXPONENT = 0.15

SEARCH_RES = 6
SEARCH_ZOOM = 11
SEARCH_ZOOM_WIDE = 10
# A crop covering at least this many coarse cells (each >= COARSE.min_acres of it) is "wide".
WIDE_FOOTPRINT_CELLS = 8
PLACE_MAX_KM = 35.0
VALLEY_KINDS = frozenset({"valley"})
COORD_DECIMALS = 5
EARTH_KM = 6371.0088
FALLBACK_CENTER = (-119.5, 37.2)

_DIRECTIONS = ("East", "North-East", "North", "North-West", "West", "South-West", "South", "South-East")


@dataclass(frozen=True)
class Level:
    name: str
    res: int
    min_acres: float
    max_cells: int
    min_spacing_km: float
    valley_bias: float  # place distance multiplier for valley-kind names (<1 prefers valleys)
    snap_km: float  # snap the centroid onto a field if no field of the crop lies this close


COARSE = Level("coarse", 4, 8000.0, 4, 45.0, 0.6, 3.0)
FINE = Level("fine", 5, 3000.0, 4, 15.0, 0.85, 1.0)


@dataclass(frozen=True)
class Place:
    name: str
    lon: float
    lat: float
    kind: str


@dataclass
class Region:
    crop_id: int
    acres: float
    lon: float
    lat: float
    cells: frozenset[str]
    county: str
    label: str = ""
    id: str = ""
    parent: str | None = None
    rank: int = 0


# --- Geometry helpers -----------------------------------------------------------------


def haversine_km(lat1: float, lon1: float, lat2: np.ndarray | float, lon2: np.ndarray | float) -> np.ndarray:
    p1, p2 = math.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dlmb = np.radians(lon2) - math.radians(lon1)
    a = np.sin(dphi / 2) ** 2 + math.cos(p1) * np.cos(p2) * np.sin(dlmb / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(a))


def bearing_name(lat1: float, lon1: float, lat2: float, lon2: float) -> str:
    dx = (lon2 - lon1) * math.cos(math.radians(lat1))
    dy = lat2 - lat1
    sector = round(math.degrees(math.atan2(dy, dx)) / 45) % 8
    return _DIRECTIONS[sector]


# --- Aggregation ----------------------------------------------------------------------


def read_points(year: int, region: str) -> pd.DataFrame:
    """One representative point per field: lon, lat, crop_id, acres, county."""
    fields = gpd.read_file(WORK_DIR / str(year) / region / "fields.fgb", columns=["crop_id", "acres", "county"])
    reps = fields.geometry.representative_point()
    return pd.DataFrame(
        {
            "crop_id": fields["crop_id"].astype(int).to_numpy(),
            "acres": fields["acres"].astype(float).to_numpy(),
            "county": fields["county"].fillna("").astype(str).to_numpy(),
            "lon": reps.x.to_numpy(),
            "lat": reps.y.to_numpy(),
        }
    )


def cell_ids(points: pd.DataFrame, res: int) -> pd.Series:
    return pd.Series(
        [h3.latlng_to_cell(lat, lon, res) for lat, lon in zip(points["lat"], points["lon"], strict=True)],
        index=points.index,
    )


def featured_weights(crops: list[Crop], statewide_acres: dict[int, float] | None = None) -> dict[int, float]:
    """crop_id -> weight for crops allowed to be a region's top crop."""
    allowed = [c for c in crops if c.icon not in EXCLUDED_ICONS and c.dwr_code != NATIVE_PASTURE]
    totals = {c.crop_id: (statewide_acres or {}).get(c.crop_id, 0.0) for c in allowed}
    biggest = max(totals.values(), default=0.0)
    weights: dict[int, float] = {}
    for crop in allowed:
        specialty = (biggest / totals[crop.crop_id]) ** SPECIALTY_EXPONENT if totals[crop.crop_id] > 0 else 1.0
        weights[crop.crop_id] = specialty * (MIXED_PASTURE_WEIGHT if crop.dwr_code == MIXED_PASTURE else 1.0)
    return weights


def top_crop_per_cell(
    points: pd.DataFrame, cell_col: str, weights: dict[int, float], min_acres: float
) -> pd.DataFrame:
    """Per cell the featured crop with the best weighted acres; cells whose real acres < min_acres drop."""
    featured = points[points["crop_id"].isin(weights)]
    agg = featured.groupby([cell_col, "crop_id"], as_index=False)["acres"].sum()
    agg["score"] = agg["acres"] * agg["crop_id"].map(weights)
    top = agg.sort_values(["score", "crop_id"], ascending=[False, True]).drop_duplicates(cell_col)
    top = top[top["acres"] >= min_acres].rename(columns={cell_col: "cell"})
    return top[["cell", "crop_id", "acres"]].sort_values("cell").reset_index(drop=True)


def connected_components(cells: set[str]) -> list[list[str]]:
    seen: set[str] = set()
    components: list[list[str]] = []
    for start in sorted(cells):
        if start in seen:
            continue
        seen.add(start)
        stack, component = [start], []
        while stack:
            cell = stack.pop()
            component.append(cell)
            for neighbour in h3.grid_disk(cell, 1):
                if neighbour in cells and neighbour not in seen:
                    seen.add(neighbour)
                    stack.append(neighbour)
        components.append(sorted(component))
    return components


def split_cells(cells: list[str], max_cells: int) -> list[list[str]]:
    """Split an oversized component into ceil(n / max_cells) compact chunks (deterministic k-means)."""
    if len(cells) <= max_cells:
        return [cells]
    k = math.ceil(len(cells) / max_cells)
    centers = [h3.cell_to_latlng(cell) for cell in cells]
    scale = math.cos(math.radians(float(np.mean([lat for lat, _ in centers]))))
    xy = np.array([(lng * scale, lat) for lat, lng in centers])

    seeds = [int(np.argmax(np.linalg.norm(xy - xy.mean(axis=0), axis=1)))]
    while len(seeds) < k:
        nearest = np.min(np.linalg.norm(xy[:, None, :] - xy[seeds][None, :, :], axis=2), axis=1)
        seeds.append(int(np.argmax(nearest)))
    means = xy[seeds].copy()
    labels = np.zeros(len(cells), dtype=int)
    for _ in range(30):
        labels = np.argmin(np.linalg.norm(xy[:, None, :] - means[None, :, :], axis=2), axis=1)
        updated = np.array([xy[labels == i].mean(axis=0) if np.any(labels == i) else means[i] for i in range(k)])
        if np.allclose(updated, means):
            break
        means = updated
    return [[cell for cell, label in zip(cells, labels, strict=True) if label == i] for i in range(k) if np.any(labels == i)]


def weighted_point(points: pd.DataFrame) -> tuple[float, float]:
    acres = points["acres"].to_numpy()
    return float(np.average(points["lon"], weights=acres)), float(np.average(points["lat"], weights=acres))


def snap_to_field(lon: float, lat: float, points: pd.DataFrame) -> tuple[float, float, float]:
    """Nearest contributing field point to (lon, lat) and its distance in km."""
    dist = haversine_km(lat, lon, points["lat"].to_numpy(), points["lon"].to_numpy())
    best = int(np.argmin(dist))
    return float(points["lon"].iloc[best]), float(points["lat"].iloc[best]), float(dist[best])


def region_point(points: pd.DataFrame, cells: frozenset[str], res: int, snap_km: float) -> tuple[float, float]:
    """Acreage-weighted centroid, snapped onto a contributing field when it isn't clearly on farmland."""
    lon, lat = weighted_point(points)
    near_lon, near_lat, near_km = snap_to_field(lon, lat, points)
    if h3.latlng_to_cell(lat, lon, res) not in cells or near_km > snap_km:
        return near_lon, near_lat
    return lon, lat


def build_regions(
    points: pd.DataFrame, top: pd.DataFrame, level: Level, cell_col: str
) -> list[Region]:
    """Merge adjacent same-crop cells, cap their size, and place a marker per chunk."""
    regions: list[Region] = []
    by_cell = points.groupby(cell_col)
    cell_groups = {cell: idx for cell, idx in by_cell.indices.items()}
    for crop_id, group in top.groupby("crop_id"):
        for component in connected_components(set(group["cell"])):
            for chunk in split_cells(component, level.max_cells):
                cells = frozenset(chunk)
                rows = np.concatenate([cell_groups[cell] for cell in chunk])
                members = points.iloc[rows]
                members = members[members["crop_id"] == crop_id]
                lon, lat = region_point(members, cells, level.res, level.snap_km)
                counties = members.groupby("county")["acres"].sum()
                regions.append(
                    Region(
                        crop_id=int(crop_id),
                        acres=float(members["acres"].sum()),
                        lon=lon,
                        lat=lat,
                        cells=cells,
                        county=str(counties.idxmax()),
                    )
                )
    return regions


def enforce_spacing(regions: list[Region], min_km: float) -> list[Region]:
    """Greedy by acres: drop any region closer than min_km to a bigger one already kept."""
    kept: list[Region] = []
    for region in sorted(regions, key=lambda r: (-r.acres, r.crop_id, r.lon)):
        if all(haversine_km(region.lat, region.lon, other.lat, other.lon) >= min_km for other in kept):
            kept.append(region)
    return kept


# --- Labels ---------------------------------------------------------------------------


def load_places(path: Path = PLACES_CSV) -> list[Place]:
    with path.open(newline="", encoding="utf-8") as handle:
        return [Place(row["name"], float(row["lon"]), float(row["lat"]), row["kind"]) for row in csv.DictReader(handle)]


def place_candidates(lon: float, lat: float, places: list[Place], valley_bias: float) -> list[tuple[Place, float]]:
    """Places within PLACE_MAX_KM ordered by (bias-weighted) distance."""
    scored = []
    for place in places:
        km = float(haversine_km(lat, lon, place.lat, place.lon))
        if km <= PLACE_MAX_KM:
            scored.append((place, km * (valley_bias if place.kind in VALLEY_KINDS else 1.0)))
    return [(place, score) for place, score in sorted(scored, key=lambda item: item[1])]


def county_label(county: str) -> str:
    return f"{county} County" if county else "California"


def label_regions(
    regions: list[Region], places: list[Place], valley_bias: float, county_centers: dict[str, tuple[float, float]]
) -> None:
    """Largest regions pick first; labels stay unique per level (next place, else a compass prefix)."""
    taken: set[str] = set()
    for region in sorted(regions, key=lambda r: -r.acres):
        candidates = place_candidates(region.lon, region.lat, places, valley_bias)
        free = [place for place, _ in candidates if place.name not in taken]
        county = county_label(region.county)
        if free:
            label = free[0].name
        elif county not in taken:
            label = county
        else:
            anchor_lon, anchor_lat = (candidates[0][0].lon, candidates[0][0].lat) if candidates else county_centers.get(
                region.county, (region.lon, region.lat)
            )
            anchor_name = candidates[0][0].name if candidates else county
            label = f"{bearing_name(anchor_lat, anchor_lon, region.lat, region.lon)} {anchor_name}"
        taken.add(label)
        region.label = label


def label_point(
    lon: float, lat: float, county: str, places: list[Place], valley_bias: float = COARSE.valley_bias
) -> str:
    candidates = place_candidates(lon, lat, places, valley_bias)
    return candidates[0][0].name if candidates else county_label(county)


# --- Level assembly -------------------------------------------------------------------


def compute_level(
    points: pd.DataFrame, level: Level, weights: dict[int, float], places: list[Place], counties: dict
) -> list[Region]:
    cell_col = f"cell{level.res}"
    top = top_crop_per_cell(points, cell_col, weights, level.min_acres)
    regions = enforce_spacing(build_regions(points, top, level, cell_col), level.min_spacing_km)
    label_regions(regions, places, level.valley_bias, counties)
    prefix = level.name[0]
    for rank, region in enumerate(sorted(regions, key=lambda r: (-r.acres, r.crop_id, r.lon)), start=1):
        region.rank, region.id = rank, f"{prefix}{rank}"
    return sorted(regions, key=lambda r: r.rank)


def assign_parents(fine: list[Region], coarse: list[Region]) -> None:
    coarse_cells = {region.id: h3.latlng_to_cell(region.lat, region.lon, COARSE.res) for region in coarse}
    for region in fine:
        neighbourhood = set(h3.grid_disk(h3.latlng_to_cell(region.lat, region.lon, COARSE.res), 1))
        pool = [c for c in coarse if coarse_cells[c.id] in neighbourhood] or coarse
        region.parent = min(pool, key=lambda c: float(haversine_km(region.lat, region.lon, c.lat, c.lon))).id


def wide_crops(top_coarse: pd.DataFrame) -> set[int]:
    counts = top_coarse["crop_id"].value_counts()
    return {int(crop_id) for crop_id, count in counts.items() if count >= WIDE_FOOTPRINT_CELLS}


def compute_search(
    points: pd.DataFrame, crop_ids: list[int], wide: set[int], places: list[Place]
) -> dict[str, dict]:
    """Fly-to target per crop: densest res-6 cell (acreage-weighted point snapped to a field)."""
    search: dict[str, dict] = {}
    cell_col = f"cell{SEARCH_RES}"
    for crop_id in crop_ids:
        crop_points = points[points["crop_id"] == crop_id]
        if crop_points.empty:
            lon, lat = FALLBACK_CENTER
            search[str(crop_id)] = {
                "center": [round(lon, COORD_DECIMALS), round(lat, COORD_DECIMALS)],
                "zoom": SEARCH_ZOOM_WIDE,
                "label": "California",
                "acres_total": 0.0,
            }
            continue
        densest = crop_points.groupby(cell_col)["acres"].sum().idxmax()
        in_cell = crop_points[crop_points[cell_col] == densest]
        lon, lat = weighted_point(in_cell)
        lon, lat, _ = snap_to_field(lon, lat, in_cell)
        county = in_cell.groupby("county")["acres"].sum().idxmax()
        search[str(crop_id)] = {
            "center": [round(lon, COORD_DECIMALS), round(lat, COORD_DECIMALS)],
            "zoom": SEARCH_ZOOM_WIDE if crop_id in wide else SEARCH_ZOOM,
            "label": label_point(lon, lat, county, places),
            "acres_total": round(float(crop_points["acres"].sum()), 1),
        }
    return search


def feature(region: Region, with_parent: bool) -> dict:
    props: dict = {
        "id": region.id,
        "crop_id": region.crop_id,
        "acres": round(region.acres, 1),
        "label": region.label,
        "rank": region.rank,
    }
    if with_parent:
        props["parent"] = region.parent
    return {
        "type": "Feature",
        "properties": props,
        "geometry": {
            "type": "Point",
            "coordinates": [round(region.lon, COORD_DECIMALS), round(region.lat, COORD_DECIMALS)],
        },
    }


def regions_document(coarse: list[Region], fine: list[Region], search: dict[str, dict]) -> dict:
    return {
        "coarse": {"type": "FeatureCollection", "features": [feature(r, False) for r in coarse]},
        "fine": {"type": "FeatureCollection", "features": [feature(r, True) for r in fine]},
        "search": search,
    }


def run(points: pd.DataFrame, crops: list[Crop], places: list[Place]) -> tuple[dict, list[Region], list[Region], dict]:
    for res in (COARSE.res, FINE.res, SEARCH_RES):
        points[f"cell{res}"] = cell_ids(points, res)
    weights = featured_weights(crops, points.groupby("crop_id")["acres"].sum().to_dict())
    counties = {
        county: weighted_point(group) for county, group in points.groupby("county") if county and group["acres"].sum() > 0
    }
    coarse = compute_level(points, COARSE, weights, places, counties)
    fine = compute_level(points, FINE, weights, places, counties)
    assign_parents(fine, coarse)
    top_coarse = top_crop_per_cell(points, f"cell{COARSE.res}", weights, COARSE.min_acres)
    search = compute_search(points, [c.crop_id for c in crops], wide_crops(top_coarse), places)
    return regions_document(coarse, fine, search), coarse, fine, search


# --- Outputs --------------------------------------------------------------------------


def format_acres(acres: float) -> str:
    return f"{acres / 1000:,.0f}k" if acres >= 10_000 else f"{acres:,.0f}"


def write_preview(points: pd.DataFrame, coarse: list[Region], fine: list[Region], colors: dict[int, str], path: Path) -> None:
    lon0, lon1, lat0, lat1 = -124.6, -114.0, 32.4, 42.1
    scale = 100.0  # px per degree of latitude; longitude compressed by cos(37.5 deg)
    kx = scale * math.cos(math.radians(37.5))

    def px(lon: float, lat: float) -> tuple[float, float]:
        return round((lon - lon0) * kx, 1), round((lat1 - lat) * scale, 1)

    width, height = px(lon1, lat0)
    width += 110  # room for labels east of the Imperial/Palo Verde markers
    sample = points.sample(n=min(len(points), 14000), random_state=1)
    dots = "".join(
        f'<circle cx="{x}" cy="{y}" r="0.9"/>' for x, y in (px(lo, la) for lo, la in zip(sample["lon"], sample["lat"], strict=True))
    )
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width:.0f} {height:.0f}" width="{width * 1.6:.0f}" '
        f'height="{height * 1.6:.0f}" font-family="Helvetica, Arial, sans-serif">',
        f'<rect width="100%" height="100%" fill="#f6fbf7"/><g fill="#c9cfcb">{dots}</g>',
    ]
    for level_regions, radius, font, weight in ((fine, 3.2, 6.5, "normal"), (coarse, 7.5, 10, "bold")):
        for region in level_regions:
            x, y = px(region.lon, region.lat)
            color = colors.get(region.crop_id, "#888888")
            parts.append(f'<circle cx="{x}" cy="{y}" r="{radius}" fill="{color}" stroke="#333" stroke-width="{0.5 if radius < 5 else 1}"/>')
            text = escape(f"{region.label} · {format_acres(region.acres)}") if font > 8 else escape(region.label)
            parts.append(
                f'<text x="{x + radius + 2}" y="{y + font / 3}" font-size="{font}" font-weight="{weight}" fill="#222" '
                f'stroke="#fff" stroke-width="2.4" paint-order="stroke">{text}</text>'
            )
    parts.append("</svg>")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(parts), encoding="utf-8")


SAN_JOAQUIN_BOX = (-121.6, -118.6, 35.0, 38.2)  # lon0, lon1, lat0, lat1


def sanity_checks(coarse: list[Region], fine: list[Region], names: dict[int, str]) -> list[tuple[str, bool, str]]:
    """Expectations from the design: well-known crop/place pairs that must appear in the output."""

    def hits(crop_part: str, labels: set[str]) -> list[str]:
        return [
            f"{r.id} {r.label}"
            for r in (*coarse, *fine)
            if crop_part in names.get(r.crop_id, "").lower() and r.label in labels
        ]

    def in_valley(r: Region) -> bool:
        lon0, lon1, lat0, lat1 = SAN_JOAQUIN_BOX
        return lon0 <= r.lon <= lon1 and lat0 <= r.lat <= lat1

    nuts = [r for r in coarse if in_valley(r) and names.get(r.crop_id, "") in {"Almonds", "Pistachios"}]
    checks = [
        ("Lettuce / leafy greens labeled Salinas Valley", hits("lettuce", {"Salinas Valley"})),
        (
            "Strawberries at Pajaro / Watsonville / Castroville / Santa Maria / Oxnard",
            hits("strawberr", {"Pajaro Valley", "Watsonville", "Castroville", "Santa Maria Valley", "Oxnard Plain"}),
        ),
        ("Grapes in Napa / Sonoma", hits("grapes", {"Napa Valley", "Sonoma Valley", "Russian River Valley", "Alexander Valley"})),
        ("Grapes at Lodi", hits("grapes", {"Lodi"})),
        ("Rice at Colusa / Butte area", hits("rice", {"Colusa", "Willows", "Biggs", "Gridley", "Chico", "Oroville"})),
        ("Dates / other crops in Coachella", hits("dates", {"Coachella Valley", "Thermal", "Indio"})),
        ("Alfalfa in Imperial Valley", hits("alfalfa", {"Imperial Valley", "Brawley", "El Centro"})),
    ]
    results = [(text, bool(found), ", ".join(found[:4])) for text, found in checks]
    results.append(("Almond/pistachio chunks across the San Joaquin Valley (coarse, >= 4)", len(nuts) >= 4, f"{len(nuts)} coarse markers"))
    return results


def write_doc(coarse: list[Region], fine: list[Region], crops: list[Crop], places: list[Place], path: Path) -> None:
    names = {crop.crop_id: crop.name for crop in crops}
    lines = [
        "# Crop regions",
        "",
        "Generated by `pipeline/06_regions.py` (`make regions`). Output: `site/public/data/regions.json`",
        "(`coarse` markers for z5-8, `fine` for z8-10, plus `search` fly-to targets per crop).",
        "",
        f"Markers: **{len(coarse)} coarse**, **{len(fine)} fine**; {len(places)} curated places in `data/lookup/places.csv`.",
        "",
        "## Algorithm",
        "",
        "1. One representative point (inside the polygon) per field, assigned to H3 cells at res 4 (coarse, ~1,770 km2)",
        "   and res 5 (fine, ~250 km2); acres are summed per (cell, crop).",
        "2. Only featured crops can win a cell: icons `seedling`/`herb` and Native pasture (P4) are excluded; Mixed",
        f"   pasture (P3) competes at x{MIXED_PASTURE_WEIGHT} weight. Every crop also gets a mild specialty boost",
        f"   (largest crop acres / crop acres) ** {SPECIALTY_EXPONENT} so strawberries or dates can win their home cells over",
        "   almonds/corn. A cell is kept only if the winner's real acres reach",
        f"   the threshold (coarse {COARSE.min_acres:,.0f} ac, fine {FINE.min_acres:,.0f} ac).",
        "3. Edge-adjacent cells with the same top crop are merged (connected components over `h3.grid_disk(cell, 1)`).",
        f"   Components larger than {COARSE.max_cells} (coarse) / {FINE.max_cells} (fine) cells are split into",
        "   ceil(n / cap) compact chunks with a deterministic k-means over cell centres.",
        "4. Marker = acreage-weighted centroid of the region's fields of that crop; if it falls outside the region's cells",
        f"   or farther than {COARSE.snap_km:g} km (coarse) / {FINE.snap_km:g} km (fine) from any contributing field, it snaps to the nearest",
        "   contributing field point.",
        f"5. Minimum spacing: coarse {COARSE.min_spacing_km:g} km, fine {FINE.min_spacing_km:g} km; the smaller of two too-close",
        "   markers is dropped.",
        "6. Labels: nearest curated place within 35 km (valley names count at x"
        f"{COARSE.valley_bias} / x{FINE.valley_bias} distance for coarse / fine), unique per level (next-nearest place, else a compass",
        "   prefix), else `<County> County`.",
        "7. `parent` (fine): the nearest coarse marker among those in the fine marker's res-4 neighbourhood, else the nearest overall.",
        "8. `search`: per crop the densest res-6 cell (~36 km2), centre = acreage-weighted point snapped to a field; zoom 11,",
        f"   or 10 for crops that top at least {WIDE_FOOTPRINT_CELLS} coarse cells (huge contiguous footprints).",
        "",
        "## Coarse regions",
        "",
        "| # | Label | Crop | Acres |",
        "|---|-------|------|------:|",
    ]
    lines += [f"| {r.rank} | {r.label} | {names.get(r.crop_id, r.crop_id)} | {r.acres:,.0f} |" for r in coarse]
    lines += ["", "## Counts", "", "| Level | Markers |", "|---|---:|", f"| coarse | {len(coarse)} |", f"| fine | {len(fine)} |"]
    crop_counts = Counter(names.get(r.crop_id, str(r.crop_id)) for r in fine)
    lines += ["", "Fine markers by crop: " + ", ".join(f"{name} {n}" for name, n in crop_counts.most_common()) + "."]
    lines += ["", "## Sanity checks", "", "| Expectation | Held | Matches |", "|---|:-:|---|"]
    lines += [f"| {text} | {'yes' if ok else 'NO'} | {detail} |" for text, ok, detail in sanity_checks(coarse, fine, names)]
    lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR)
    parser.add_argument("--region", default="statewide")
    args = parser.parse_args()

    crops = load_lookup()
    places = load_places()
    points = read_points(args.year, args.region)
    document, coarse, fine, _ = run(points, crops, places)

    REGIONS_JSON.parent.mkdir(parents=True, exist_ok=True)
    REGIONS_JSON.write_text(json.dumps(document, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    colors = {crop["crop_id"]: crop["color"] for crop in json.loads(CROPS_JSON.read_text(encoding="utf-8"))}
    write_preview(points, coarse, fine, colors, PREVIEW_SVG)
    write_doc(coarse, fine, crops, places, REGIONS_DOC)
    size_kb = REGIONS_JSON.stat().st_size / 1024
    print(f"coarse={len(coarse)} fine={len(fine)} search={len(document['search'])} regions.json={size_kb:.0f} KB")


if __name__ == "__main__":
    main()
