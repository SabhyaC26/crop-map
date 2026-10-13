"""Build site/public/data/economics.json: per-county crop yield, price and growing cost.

Yield and price come from UC Davis CalAg's compilation of County Ag Commissioner crop reports.
A map crop can cover several commodity types (wine/table/raisin grapes); each county gets the type
with the most acres, its newest year with tonnage and value, and the growing cost of the closest
UC Davis cost study for that type and region. Growing cost = study cash cost minus land rent and
property tax, scaled to the target year by the USDA prices-paid index. Hand-checked county
figures in data/lookup/economics.json take precedence; a statewide row covers the rest.
"""

from __future__ import annotations

import json
import urllib.request
from collections import defaultdict

from openpyxl import load_workbook

from common import RAW_DIR, REPO_ROOT

LOOKUP = REPO_ROOT / "data" / "lookup" / "economics.json"
OUT = REPO_ROOT / "site" / "public" / "data" / "economics.json"
STATE_TOTAL = "State Total"
# A county's own figure is trusted with at least this many acres, and a yield within this multiple
# of the statewide yield (a variant can widen it, e.g. low-yield premium wine grapes).
MIN_ACRES = 200
YIELD_SANITY = (0.33, 3.0)
# CalAg production units we can convert to tons; carton-type units are skipped.
TONS_PER_UNIT = {"Tons": 1.0, "Lbs": 1 / 2000, "Cwt": 1 / 20, "Bale": 0.24, "500 Lb": 0.25}
UNITS_PER_TON = {"ton": 1, "lb": 2000}


def fetch_calag(url: str, filename: str) -> list[dict]:
    path = RAW_DIR / filename
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 crop-map pipeline"})
        with urllib.request.urlopen(req) as res:
            path.write_bytes(res.read())
    sheet = load_workbook(path, read_only=True).worksheets[0]
    rows = sheet.iter_rows(values_only=True)
    header = next(rows)
    return [dict(zip(header, r)) for r in rows]


def positive(*values: object) -> bool:
    return all(isinstance(v, (int, float)) and v > 0 for v in values)


def growing_cost(study: dict, index: dict[str, float], target: int, label: str) -> tuple[int, list[str]]:
    base = study["cash"] - study["rent"] - study["tax"]
    year = study["year"]
    factor = max(1.0, index[str(target)] / index[str(max(year, min(map(int, index))))])
    cost = round(base * factor)
    steps = [f"Cash costs ${study['cash']:,} ({year} study)"]
    if study["rent"]:
        steps.append(f"− land rent ${study['rent']:,}")
    if study["tax"]:
        steps.append(f"− property tax ${study['tax']:,}")
    if factor > 1.005:
        steps.append(f"× {factor:.2f} {label}, {year}→{target}")
    steps.append(f"= ${cost:,}/acre")
    return cost, steps


def land_cost(study: dict, index: dict[str, float], target: int, label: str) -> tuple[int, list[str], str]:
    """Yearly land cost: the study's cash rent, or its capital charge on owned land, moved to the
    target year by the change in California cropland values."""
    land, year = study["land"], study["year"]
    earliest = min(map(int, index))
    factor = max(1.0, index[str(target)] / index[str(min(max(year, earliest), target))])
    cost = round(land["charge"] * factor)
    if land["basis"] == "owned":
        valued = f" on land valued at ${land['value']:,}/acre" if land.get("value") else ""
        steps = [f"Cost of capital ${land['charge']:,}/yr{valued} ({year} study)"]
    else:
        steps = [f"Land rent ${land['charge']:,} ({year} study)"]
    if land.get("note"):
        steps.append(land["note"])
    if factor > 1.005:
        steps.append(f"× {factor:.2f} {label}, {max(year, earliest)}→{target}")
    steps.append(f"= ${cost:,}/acre")
    return cost, steps, land["basis"]


def main() -> None:
    lookup = json.loads(LOOKUP.read_text(encoding="utf-8"))
    calag, target = lookup["calag"], lookup["targetYear"]
    years: list[int] = calag["years"]
    regions = {name: set(counties) for name, counties in lookup["regions"].items()}

    # (crop, subcommodity, county, year) -> pooled acres / tons / value of usable rows.
    pooled: dict[tuple, list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    for r in fetch_calag(calag["url"], calag["file"]):
        per = TONS_PER_UNIT.get(r["unit"] or "")
        if r["year"] in years and per and positive(r["harvested_acres"], r["production"], r["value"]):
            p = pooled[(r["crop"], r["subcommodity"], r["county"], r["year"])]
            p[0] += r["harvested_acres"]
            p[1] += r["production"] * per
            p[2] += r["value"]
    value_only: dict[tuple, float] = defaultdict(float)  # by-products are often reported as value only
    counties = {k[2] for k in pooled}

    sources = dict(lookup["sources"])
    costs: dict[str, dict] = {}
    for sid, study in lookup["studies"].items():
        cost, steps = growing_cost(study, lookup["inflation"]["values"], target, "farm-cost inflation")
        land, land_steps, basis = land_cost(study, lookup["landIndex"]["values"], target, lookup["landIndex"]["label"])
        costs[sid] = {
            "growingCost": cost,
            "source": sid,
            "steps": steps,
            "caveat": study.get("caveat"),
            "landCost": land,
            "landBasis": basis,
            "landSteps": land_steps,
        }
        sources[sid] = {"label": f"UC Davis cost study: {study['label']}, {study['year']}", "short": "UC Davis", "url": study["url"]}

    def variant_rows(variant: dict, county: str) -> tuple[int, list[float]] | None:
        for year in years:
            total = [0.0, 0.0, 0.0]
            for crop, sub, *rule in variant["match"]:
                p = pooled.get((crop, sub, county, year))
                # Optional $/ton bounds split one reported commodity by market, e.g. "Corn, All"
                # carries grain in some counties and silage tonnage in dairy counties.
                bounds = rule[0] if rule else {}
                if p and bounds.get("minPrice", 0) <= p[2] / p[1] <= bounds.get("maxPrice", float("inf")):
                    total = [a + b for a, b in zip(total, p)]
            if total[0] > 0:
                return year, total
        return None

    def pick_cost(variant: dict, county: str) -> str:
        default = next(c["study"] for c in variant["costs"] if "region" not in c)
        return next((c["study"] for c in variant["costs"] if county in regions.get(c.get("region", ""), ())), default)

    entries: dict[tuple[int, str], dict] = {}
    dropped = []
    crop_units: dict[str, dict] = {}
    for crop in lookup["crops"]:
        cid, unit = crop["cropId"], crop["unit"]
        per_ton = UNITS_PER_TON[unit]
        crop_units[str(cid)] = {"unit": unit}
        multi = len(crop["variants"]) > 1

        def make_entry(v: dict, county: str, year: int, total: list[float], share: float, state: bool) -> dict:
            acres, tons, value = total
            extras = []
            for x in v.get("extras", []):
                xcrop, xsub = x["match"]
                xv = sum(p[2] for (c, s, co, y), p in pooled.items() if (c, s, co, y) == (xcrop, xsub, county, year))
                if xv > 0 and not state:
                    extras.append({"label": x["label"], "perAcre": round(xv / acres)})
            return {
                "cropId": cid,
                "county": county,
                "statewide": state,
                "year": year,
                "source": calag["source"],
                "variant": v["label"] if multi else None,
                "variantShare": round(share, 2) if multi else None,
                "acres": round(acres),
                "cost": pick_cost(v, STATE_TOTAL if state else county),
                "yield": round(tons / acres * per_ton, 2),
                "price": round(value / tons / per_ton, 4),
                "extras": extras,
            }

        # Per type: each county's newest figures, which of them are trustworthy, and a statewide
        # figure pooled from the trustworthy ones.
        by_variant: dict[str, dict[str, tuple[int, list[float]]]] = {}
        trusted: dict[str, set[str]] = {}
        state: dict[str, tuple[int, list[float]]] = {}
        for v in crop["variants"]:
            data = {c: got for c in counties if (got := variant_rows(v, c))}
            by_variant[v["label"]] = data
            sizable = sorted(t[1] / t[0] for _, t in data.values() if t[0] >= MIN_ACRES)
            if not sizable:
                trusted[v["label"]] = set()
                continue
            median = sizable[len(sizable) // 2]
            lo, hi = v.get("yieldRange", YIELD_SANITY)
            # maxPrice: above it the county sells a different market (fresh vs processing) than the cost study.
            max_price = v.get("maxPrice", float("inf"))
            ok = {
                c for c, (_, t) in data.items()
                if t[0] >= MIN_ACRES and lo <= (t[1] / t[0]) / median <= hi and t[2] / t[1] / per_ton <= max_price
            }
            trusted[v["label"]] = ok
            dropped.extend(f"{c} {v['label']}" for c, (_, t) in data.items() if c not in ok and t[0] >= MIN_ACRES)
            if ok:
                total = [sum(data[c][1][i] for c in ok) for i in range(3)]
                state[v["label"]] = (max(data[c][0] for c in ok), total)

        for county in sorted(counties):
            found = [(v, *by_variant[v["label"]][county]) for v in crop["variants"] if county in by_variant[v["label"]]]
            if not found:
                continue
            all_acres = sum(t[0] for _, _, t in found)
            v, year, total = max(found, key=lambda f: f[2][0])
            share = total[0] / all_acres
            if county in trusted[v["label"]]:
                entries[(cid, county)] = make_entry(v, county, year, total, share, False)
            elif v["label"] in state:
                entries[(cid, county)] = make_entry(v, county, *state[v["label"]], share, True)
        if state:
            v = max((v for v in crop["variants"] if v["label"] in state), key=lambda v: state[v["label"]][1][0])
            all_acres = sum(t[0] for _, t in state.values())
            year, total = state[v["label"]]
            entries[(cid, STATE_TOTAL)] = make_entry(v, STATE_TOTAL, year, total, total[0] / all_acres, True)

    for o in lookup["overrides"]:
        crop = next(c for c in lookup["crops"] if c["cropId"] == o["cropId"])
        v = crop["variants"][0]
        entry = {k: val for k, val in o.items() if not k.startswith("_")}
        entry.update({"statewide": False, "variant": None, "variantShare": None, "cost": pick_cost(v, o["county"])})
        entries[(o["cropId"], o["county"])] = entry

    out = {
        "targetYear": target,
        "sources": sources,
        "crops": crop_units,
        "costs": costs,
        "entries": sorted(entries.values(), key=lambda e: (e["cropId"], e["county"])),
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    by_year = defaultdict(int)
    for e in entries.values():
        by_year[e["year"]] += 1
    print(f"{len(dropped)} county figures fell back to statewide (yield vs median): " + "; ".join(dropped))
    print(f"wrote {len(entries)} entries for {len(crop_units)} crops ({dict(sorted(by_year.items()))}) -> {OUT.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
