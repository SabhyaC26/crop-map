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
SEARCH_ZOOM_TIGHT = 12
SEARCH_WIDE_ACRES = 60_000.0  # hotspots bigger than this fly to zoom 10
SEARCH_TIGHT_ACRES = 1_500.0  # hotspots smaller than this fly to zoom 12
SEARCH_MAX_PLACES = 5
SEARCH_MIN_SHARE = 0.05  # a later hotspot needs this share of the crop's statewide acres
SEARCH_HOTSPOT_KM = 20.0  # cells within this distance of the densest cell join its hotspot
SEARCH_SPACING_KM = 25.0  # hotspot centres stay at least this far apart
SEARCH_PROMINENT_KM = 30.0
SEARCH_OTHER_KM = 25.0
BBOX_PAD_DEG = 0.15
PLACE_MAX_KM = 35.0
COARSE_PROMINENT_KM = 45.0
PROMINENT = 1
DIVERSITY_MAX_USED = 2  # a coarse top crop may be used by this many higher-ranked regions before we look for an alternative
DIVERSITY_MIN_SHARE = 0.35  # alternative crop needs this share of the leader's real acres in the region
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


COARSE = Level("coarse", 4, 6000.0, 4, 45.0, 1.0, 3.0)
FINE = Level("fine", 5, 3000.0, 4, 15.0, 0.85, 1.0)


@dataclass(frozen=True)
class Place:
    name: str
    lon: float
    lat: float
    kind: str
    prominence: int = 2


@dataclass
class Region:
    crop_id: int
    acres: float
    lon: float
    lat: float
    cells: frozenset[str]
    county: str
    label: str = ""
    switched_from: int | None = None
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


def featured_weights(
    crops: list[Crop], statewide_acres: dict[int, float] | None = None, *, allow_mixed_pasture: bool = True
) -> dict[int, float]:
    """crop_id -> weight for crops allowed to be a region's top crop."""
    excluded_codes = {NATIVE_PASTURE} | (set() if allow_mixed_pasture else {MIXED_PASTURE})
    allowed = [c for c in crops if c.icon not in EXCLUDED_ICONS and c.dwr_code not in excluded_codes]
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


def cell_index(points: pd.DataFrame, cell_col: str) -> dict[str, np.ndarray]:
    """cell -> positional row indices into `points`."""
    return dict(points.groupby(cell_col).indices)


def crop_members(points: pd.DataFrame, index: dict[str, np.ndarray], cells: frozenset[str]) -> pd.DataFrame:
    return points.iloc[np.concatenate([index[cell] for cell in cells if cell in index])]


def make_region(
    points: pd.DataFrame, index: dict[str, np.ndarray], cells: frozenset[str], crop_id: int, level: Level
) -> Region:
    """Marker for `crop_id` over `cells`: acreage-weighted centroid snapped onto farmland."""
    members = crop_members(points, index, cells)
    members = members[members["crop_id"] == crop_id]
    lon, lat = region_point(members, cells, level.res, level.snap_km)
    counties = members.groupby("county")["acres"].sum()
    return Region(
        crop_id=int(crop_id),
        acres=float(members["acres"].sum()),
        lon=lon,
        lat=lat,
        cells=cells,
        county=str(counties.idxmax()),
    )


def build_regions(
    points: pd.DataFrame, top: pd.DataFrame, level: Level, index: dict[str, np.ndarray]
) -> list[Region]:
    """Merge adjacent same-crop cells, cap their size, and place a marker per chunk."""
    regions: list[Region] = []
    for crop_id, group in top.groupby("crop_id"):
        for component in connected_components(set(group["cell"])):
            for chunk in split_cells(component, level.max_cells):
                regions.append(make_region(points, index, frozenset(chunk), int(crop_id), level))
    return regions


def diversify(
    regions: list[Region],
    points: pd.DataFrame,
    index: dict[str, np.ndarray],
    weights: dict[int, float],
    level: Level,
) -> list[Region]:
    """Rank-ordered pass: a crop already topping DIVERSITY_MAX_USED bigger regions yields to the best
    alternative featured crop that has >= DIVERSITY_MIN_SHARE of the leader's real acres in the region."""
    used: Counter[int] = Counter()
    result: list[Region] = []
    for region in sorted(regions, key=lambda r: (-r.acres, r.crop_id, r.lon)):
        if used[region.crop_id] >= DIVERSITY_MAX_USED:
            members = crop_members(points, index, region.cells)
            acres = members[members["crop_id"].isin(weights)].groupby("crop_id")["acres"].sum()
            alternatives = [
                (crop_id, total)
                for crop_id, total in acres.items()
                if crop_id != region.crop_id
                and total >= DIVERSITY_MIN_SHARE * region.acres
                and used[crop_id] < DIVERSITY_MAX_USED
            ]
            if alternatives:
                crop_id, _ = max(alternatives, key=lambda item: (item[1] * weights[item[0]], -item[0]))
                switched = make_region(points, index, region.cells, int(crop_id), level)
                switched.switched_from = region.crop_id
                region = switched
        used[region.crop_id] += 1
        result.append(region)
    return result


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
        return [
            Place(row["name"], float(row["lon"]), float(row["lat"]), row["kind"], int(row["prominence"]))
            for row in csv.DictReader(handle)
        ]


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


def coarse_label_candidates(lon: float, lat: float, county: str, places: list[Place]) -> list[str]:
    """State-scale names, best first: prominent places within 45 km by distance, else other places within 35 km."""
    ranked = sorted(
        ((float(haversine_km(lat, lon, place.lat, place.lon)), place) for place in places),
        key=lambda item: item[0],
    )
    prominent = [place.name for km, place in ranked if place.prominence == PROMINENT and km <= COARSE_PROMINENT_KM]
    if prominent:
        return prominent
    others = [place.name for km, place in ranked if place.prominence != PROMINENT and km <= PLACE_MAX_KM]
    return others or [county_label(county)]


def label_point(lon: float, lat: float, county: str, places: list[Place]) -> str:
    return coarse_label_candidates(lon, lat, county, places)[0]


def label_coarse(regions: list[Region], places: list[Place]) -> list[Region]:
    """Largest first; a taken name moves to the next prominent place, then the county, else the smaller marker drops."""
    taken: set[str] = set()
    kept: list[Region] = []
    for region in sorted(regions, key=lambda r: (-r.acres, r.crop_id, r.lon)):
        names = coarse_label_candidates(region.lon, region.lat, region.county, places)
        free = [name for name in names if name not in taken]
        if not free and county_label(region.county) not in taken:
            free = [county_label(region.county)]
        if not free:
            continue
        region.label = free[0]
        taken.add(region.label)
        kept.append(region)
    return kept


# --- Level assembly -------------------------------------------------------------------


def rank_regions(regions: list[Region], prefix: str) -> list[Region]:
    ordered = sorted(regions, key=lambda r: (-r.acres, r.crop_id, r.lon))
    for rank, region in enumerate(ordered, start=1):
        region.rank, region.id = rank, f"{prefix}{rank}"
    return ordered


def compute_fine(points: pd.DataFrame, weights: dict[int, float], places: list[Place], counties: dict) -> list[Region]:
    cell_col = f"cell{FINE.res}"
    top = top_crop_per_cell(points, cell_col, weights, FINE.min_acres)
    index = cell_index(points, cell_col)
    regions = enforce_spacing(build_regions(points, top, FINE, index), FINE.min_spacing_km)
    label_regions(regions, places, FINE.valley_bias, counties)
    return rank_regions(regions, "f")


def compute_coarse(points: pd.DataFrame, weights: dict[int, float], places: list[Place]) -> list[Region]:
    cell_col = f"cell{COARSE.res}"
    top = top_crop_per_cell(points, cell_col, weights, COARSE.min_acres)
    index = cell_index(points, cell_col)
    regions = enforce_spacing(build_regions(points, top, COARSE, index), COARSE.min_spacing_km)
    regions = enforce_spacing(diversify(regions, points, index, weights, COARSE), COARSE.min_spacing_km)
    return rank_regions(label_coarse(regions, places), "c")


def assign_parents(fine: list[Region], coarse: list[Region]) -> None:
    coarse_cells = {region.id: h3.latlng_to_cell(region.lat, region.lon, COARSE.res) for region in coarse}
    for region in fine:
        neighbourhood = set(h3.grid_disk(h3.latlng_to_cell(region.lat, region.lon, COARSE.res), 1))
        pool = [c for c in coarse if coarse_cells[c.id] in neighbourhood] or coarse
        region.parent = min(pool, key=lambda c: float(haversine_km(region.lat, region.lon, c.lat, c.lon))).id


@dataclass
class Hotspot:
    lon: float
    lat: float
    acres: float
    county: str
    label: str = ""


def find_hotspots(crop_points: pd.DataFrame) -> list[Hotspot]:
    """Greedy hotspots for one crop: densest res-6 cell, fields within SEARCH_HOTSPOT_KM of it, then suppress
    everything within SEARCH_SPACING_KM of the hotspot centre. Stops at SEARCH_MAX_PLACES or when the next
    hotspot holds < SEARCH_MIN_SHARE of the crop's statewide acres; the largest hotspot is always kept."""
    total = float(crop_points["acres"].sum())
    cell_col = f"cell{SEARCH_RES}"
    remaining = crop_points
    hotspots: list[Hotspot] = []
    while len(hotspots) < SEARCH_MAX_PLACES and not remaining.empty:
        densest = remaining.groupby(cell_col)["acres"].sum().idxmax()
        seed_lat, seed_lon = h3.cell_to_latlng(densest)
        dist = haversine_km(seed_lat, seed_lon, remaining["lat"].to_numpy(), remaining["lon"].to_numpy())
        members = remaining[dist <= SEARCH_HOTSPOT_KM]
        acres = float(members["acres"].sum())
        if hotspots and acres < SEARCH_MIN_SHARE * total:
            break
        lon, lat = weighted_point(members)
        lon, lat, _ = snap_to_field(lon, lat, members)
        county = str(members.groupby("county")["acres"].sum().idxmax())
        hotspots.append(Hotspot(lon, lat, acres, county))
        far = haversine_km(lat, lon, remaining["lat"].to_numpy(), remaining["lon"].to_numpy()) >= SEARCH_SPACING_KM
        remaining = remaining[far]
    # The densest-cell seed isn't always the biggest hotspot: keep the largest plus any other >= the share floor.
    largest = max(hotspots, key=lambda h: h.acres)
    return [h for h in hotspots if h is largest or h.acres >= SEARCH_MIN_SHARE * total]


def hotspot_label_candidates(hotspot: Hotspot, places: list[Place]) -> list[str]:
    """Prominence-1 places within SEARCH_PROMINENT_KM, then prominence-2 within SEARCH_OTHER_KM, nearest first."""
    ranked = sorted(
        ((float(haversine_km(hotspot.lat, hotspot.lon, p.lat, p.lon)), p) for p in places),
        key=lambda item: item[0],
    )
    first = [p.name for km, p in ranked if p.prominence == PROMINENT and km <= SEARCH_PROMINENT_KM]
    second = [p.name for km, p in ranked if p.prominence != PROMINENT and km <= SEARCH_OTHER_KM]
    return [*first, *second, county_label(hotspot.county)]


def label_hotspots(hotspots: list[Hotspot], places: list[Place]) -> list[Hotspot]:
    """Largest first, labels unique per crop; a hotspot whose every candidate (county included) is taken merges into
    the hotspot that holds the label."""
    kept: dict[str, Hotspot] = {}
    for hotspot in sorted(hotspots, key=lambda h: -h.acres):
        candidates = hotspot_label_candidates(hotspot, places)
        free = next((name for name in candidates if name not in kept), None)
        if free is None:
            kept[candidates[-1]].acres += hotspot.acres
            continue
        hotspot.label = free
        kept[free] = hotspot
    return sorted(kept.values(), key=lambda h: -h.acres)


def hotspot_zoom(acres: float) -> int:
    if acres > SEARCH_WIDE_ACRES:
        return SEARCH_ZOOM_WIDE
    return SEARCH_ZOOM_TIGHT if acres < SEARCH_TIGHT_ACRES else SEARCH_ZOOM


def search_bbox(centers: list[list[float]]) -> list[float]:
    lons, lats = [c[0] for c in centers], [c[1] for c in centers]
    return [
        round(min(lons) - BBOX_PAD_DEG, COORD_DECIMALS),
        round(min(lats) - BBOX_PAD_DEG, COORD_DECIMALS),
        round(max(lons) + BBOX_PAD_DEG, COORD_DECIMALS),
        round(max(lats) + BBOX_PAD_DEG, COORD_DECIMALS),
    ]


def compute_search(points: pd.DataFrame, crop_ids: list[int], places: list[Place]) -> dict[str, dict]:
    """Fly-to targets per crop: up to 5 hotspots (`places`), the largest doubling as the primary center/zoom/label."""
    search: dict[str, dict] = {}
    by_crop = {int(crop_id): group for crop_id, group in points.groupby("crop_id")}
    for crop_id in crop_ids:
        crop_points = by_crop.get(crop_id)
        if crop_points is None or crop_points.empty:
            lon, lat = FALLBACK_CENTER
            hotspots = [Hotspot(lon, lat, 0.0, "", "California")]
            total = 0.0
        else:
            hotspots = label_hotspots(find_hotspots(crop_points), places)
            total = round(float(crop_points["acres"].sum()), 1)
        listed = [
            {
                "center": [round(h.lon, COORD_DECIMALS), round(h.lat, COORD_DECIMALS)],
                "zoom": SEARCH_ZOOM_WIDE if total == 0.0 else hotspot_zoom(h.acres),
                "label": h.label,
                "acres": round(h.acres, 1),
            }
            for h in hotspots
        ]
        primary = listed[0]
        search[str(crop_id)] = {
            "center": primary["center"],
            "zoom": primary["zoom"],
            "label": primary["label"],
            "acres_total": total,
            "places": listed,
            "bbox": search_bbox([p["center"] for p in listed]),
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
    statewide = points.groupby("crop_id")["acres"].sum().to_dict()
    weights = featured_weights(crops, statewide)
    coarse_weights = featured_weights(crops, statewide, allow_mixed_pasture=False)
    counties = {
        county: weighted_point(group) for county, group in points.groupby("county") if county and group["acres"].sum() > 0
    }
    coarse = compute_coarse(points, coarse_weights, places)
    fine = compute_fine(points, weights, places, counties)
    assign_parents(fine, coarse)
    search = compute_search(points, [c.crop_id for c in crops], places)
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
        f"   pasture (P3) is excluded at coarse level and competes at x{MIXED_PASTURE_WEIGHT} weight at fine level. Every crop also gets a mild specialty boost",
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
        f"6. Coarse diversity (rank order): a crop already topping {DIVERSITY_MAX_USED} bigger coarse regions yields to the best alternative",
        f"   featured crop (not itself overused) holding >= {DIVERSITY_MIN_SHARE:.0%} of the leader's real acres in that region; the marker is",
        "   recomputed for the new crop and spacing is re-enforced.",
        f"7. Coarse labels: nearest prominence-1 place within {COARSE_PROMINENT_KM:g} km, else nearest other place within {PLACE_MAX_KM:g} km, else",
        "   `<County> County`; a taken name moves to the next prominent place, then the county, else the smaller marker is dropped (no compass words).",
        f"   Fine labels: nearest place within {PLACE_MAX_KM:g} km (valleys count at x{FINE.valley_bias} distance), unique per level",
        "   (next-nearest place, else a compass prefix), else `<County> County`.",
        "8. `parent` (fine): the nearest coarse marker among those in the fine marker's res-4 neighbourhood, else the nearest overall.",
        "9. `search` (per crop, all crops): up to 5 `places` (hotspots). Crop acres are summed on res-6 H3 cells (~36 km2);",
        f"   the densest cell seeds a hotspot of all its fields within {SEARCH_HOTSPOT_KM:g} km, centre = acreage-weighted point snapped",
        f"   to the nearest of those fields; every field within {SEARCH_SPACING_KM:g} km of the centre is then suppressed and the",
        f"   next-densest cell seeds the next hotspot. Stops at {SEARCH_MAX_PLACES} hotspots or when the next one holds",
        f"   < {SEARCH_MIN_SHARE:.0%} of the crop's statewide acres (the largest is always kept). Hotspots are sorted by acres.",
        f"   Zoom 11; 10 above {SEARCH_WIDE_ACRES:,.0f} ac; 12 below {SEARCH_TIGHT_ACRES:,.0f} ac. Label: nearest prominence-1 place within",
        f"   {SEARCH_PROMINENT_KM:g} km, else nearest other place within {SEARCH_OTHER_KM:g} km, else `<County> County`; labels are unique per",
        "   crop (next candidate, else the hotspot merges into the one holding the county label).",
        "   `places[0]` is also the entry's primary `center`/`zoom`/`label`; `bbox` = [w, s, e, n] around all place centres padded",
        f"   {BBOX_PAD_DEG}\u00b0.",
        "",
        "## Coarse regions",
        "",
        "| # | Label | Crop | Acres |",
        "|---|-------|------|------:|",
    ]
    lines += [f"| {r.rank} | {r.label} | {names.get(r.crop_id, r.crop_id)} | {r.acres:,.0f} |" for r in coarse]
    switched = [r for r in coarse if r.switched_from is not None]
    lines += ["", f"Distinct coarse crops: **{len({r.crop_id for r in coarse})}**. Diversity switches ({len(switched)}):", ""]
    lines += [
        f"- {r.label}: {names.get(r.switched_from, r.switched_from)} -> {names.get(r.crop_id, r.crop_id)}" for r in switched
    ] or ["- none"]
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
