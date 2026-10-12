"""Inspect the raw shapefile and write docs/crop-codes.md (fields, crop codes, counties, legend)."""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
import pyogrio

from common import (
    COL_ACRES,
    COL_COUNTY,
    COL_EMRG_CROP,
    COL_MAIN_CROP,
    COL_MULTIUSE,
    COL_SEASON_CROPS,
    COL_SEN_CROP,
    CROP_CODES_DOC,
    DEFAULT_YEAR,
    MONTEREY_FILTER,
    NULL_TOKEN,
    REPO_ROOT,
    Legend,
    legend_path,
    parse_legend,
    shapefile_path,
)

CROP_CODE_COLUMNS = (COL_MAIN_CROP, *COL_SEASON_CROPS, COL_SEN_CROP, COL_EMRG_CROP)

MULTIUSE_MEANING = {
    "S": "single crop (one crop in the survey year)",
    "D": "double crop (two consecutive crops)",
    "T": "triple crop (three consecutive crops)",
    "Q": "quadruple crop (four consecutive crops)",
}

COLUMN_NOTES = {
    COL_MAIN_CROP: "**Primary crop code** chosen by Land IQ; one value per polygon, never null. Drives color/icon.",
    "CROPTYP1": "First crop in the sequence for multi-cropped polygons; `****` for single-crop polygons.",
    "CROPTYP2": "Crop of a single-crop polygon (CROPTYP1 is `****` then); second crop of a multi-crop polygon.",
    "CROPTYP3": "Third crop (triple/quad cropping, or a trailing `X` fallow on single-crop polygons).",
    "CROPTYP4": "Fourth crop (quad cropping only).",
    COL_SEN_CROP: "Crop that senesced (was harvested/died back) early in the year; `****` when none.",
    COL_EMRG_CROP: "Crop that emerged late in the year; `****` when none.",
}


def md_table(headers: list[str], rows: list[list[object]]) -> str:
    lines = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    lines += ["| " + " | ".join(str(c) for c in row) + " |" for row in rows]
    return "\n".join(lines)


def fmt_int(n: float) -> str:
    return f"{int(round(n)):,}"


def fmt_acres(n: float) -> str:
    return f"{n:,.1f}"


def field_table(df: pd.DataFrame, dtypes: dict[str, str]) -> str:
    rows = []
    for col in df.columns:
        counts = df[col].value_counts(dropna=False)
        samples = ", ".join(f"`{v}`" for v in counts.index[:4])
        rows.append([f"`{col}`", dtypes[col], fmt_int(df[col].nunique(dropna=False)), samples])
    return md_table(["field", "dtype", "distinct", "most common values"], rows)


def code_table(df: pd.DataFrame, column: str, legend: Legend) -> str:
    grouped = df.groupby(column)[COL_ACRES].agg(["size", "sum"]).sort_values("sum", ascending=False)
    rows = []
    for code, (n, acres) in grouped.iterrows():
        name = "(unset)" if code == NULL_TOKEN else legend.describe(str(code))
        rows.append([f"`{code}`", name, fmt_int(n), fmt_acres(acres)])
    total = grouped["size"].sum(), grouped["sum"].sum()
    rows.append(["**total**", "", fmt_int(total[0]), fmt_acres(total[1])])
    return md_table(["code", "name (from legend)", "polygons", "total acres"], rows)


def class_rollup(df: pd.DataFrame, legend: Legend) -> str:
    classes = df[COL_MAIN_CROP].str.extract(r"^([A-Z]+)")[0]
    grouped = df.groupby(classes)[COL_ACRES].agg(["size", "sum"]).sort_values("sum", ascending=False)
    rows = [
        [f"`{cls}`", legend.classes.get(str(cls), "(not in legend)").capitalize(), fmt_int(n), fmt_acres(acres)]
        for cls, (n, acres) in grouped.iterrows()
    ]
    return md_table(["class", "name", "polygons", "total acres"], rows)


def multiuse_table(df: pd.DataFrame) -> str:
    grouped = df.groupby(COL_MULTIUSE)[COL_ACRES].agg(["size", "sum"])
    rows = [
        [f"`{code}`", MULTIUSE_MEANING.get(str(code), "(undocumented)"), fmt_int(n), fmt_acres(acres)]
        for code, (n, acres) in grouped.iterrows()
    ]
    return md_table(["value", "meaning", "polygons", "total acres"], rows)


def county_table(df: pd.DataFrame) -> str:
    grouped = df.groupby(COL_COUNTY)[COL_ACRES].agg(["size", "sum"]).sort_values("size", ascending=False)
    rows = []
    for county, (n, acres) in grouped.iterrows():
        unassigned = county == NULL_TOKEN
        rows.append(
            [f"`{county}`" if unassigned else county, "outside any county (urban)" if unassigned else "", fmt_int(n), fmt_acres(acres)]
        )
    return md_table(["COUNTY value", "note", "polygons", "total acres"], rows)


def multicrop_stats(df: pd.DataFrame) -> dict[str, float]:
    season = df[list(COL_SEASON_CROPS)]
    main = df[COL_MAIN_CROP]
    is_set = season.ne(NULL_TOKEN)
    others = season.apply(lambda col: col.where(col.ne(main) & col.ne(NULL_TOKEN)))
    sequence = season.where(is_set).ffill(axis=1).iloc[:, -1]
    real = season.where(is_set & season.ne("X"))
    x_main = main == "X"
    x_hidden = x_main & real.notna().any(axis=1)
    return {
        "rows": len(df),
        "main_is_last": float((sequence == main).mean()),
        "x_main_hides_crop": int(x_hidden.sum()),
        "x_main_hides_crop_acres": float(df.loc[x_hidden, COL_ACRES].sum()),
        "main_eq_croptyp2": float((main == df["CROPTYP2"]).mean()),
        "main_in_any": float(season.eq(main, axis=0).any(axis=1).mean()),
        "croptyp1_unset_when_single": float(
            (df.loc[df[COL_MULTIUSE] == "S", "CROPTYP1"] == NULL_TOKEN).mean()
        ),
        "with_other_crops": int(others.notna().any(axis=1).sum()),
        "with_2plus_cols_set": int((is_set.sum(axis=1) >= 2).sum()),
    }


def monterey_bounds(shp: Path) -> list[float]:
    gdf = pyogrio.read_dataframe(shp, where=MONTEREY_FILTER, columns=[COL_COUNTY])
    return [round(float(v), 5) for v in gdf.to_crs(4326).total_bounds]


def legend_table(legend: Legend) -> str:
    rows = []
    for cls, title in legend.classes.items():
        rows.append([f"`{cls}`", f"**{title.capitalize()}**", "class"])
        for number, name in sorted(legend.subclasses.get(cls, {}).items()):
            rows.append([f"`{cls}{number}`", name, "subclass"])
    return md_table(["code", "name", "level"], rows)


def build_doc(year: int) -> str:
    shp = shapefile_path(year)
    info = pyogrio.read_info(shp)
    df = pyogrio.read_dataframe(shp, read_geometry=False)
    dtypes = dict(zip(info["fields"], info["dtypes"], strict=True))
    legend = parse_legend(legend_path(year))
    stats = multicrop_stats(df)
    bounds = monterey_bounds(shp)
    monterey = df[df[COL_COUNTY] == "Monterey"]
    real_counties = df.loc[df[COL_COUNTY] != NULL_TOKEN, COL_COUNTY].nunique()

    out: list[str] = []
    out.append(f"# DWR Statewide Crop Mapping {year}: columns and crop codes\n")
    out.append(
        "_Generated by `pipeline/02_inspect.py` (`make inspect`); do not edit by hand._\n\n"
        f"Source file: `{shp.relative_to(REPO_ROOT)}`. "
        "Code names come from the DWR modified standard land-use legend PDF "
        "(`legend.pdf`, parsed best-effort from its text layer).\n"
    )

    out.append("## Summary\n")
    out.append(
        md_table(
            ["property", "value"],
            [
                ["CRS", f"`{info['crs']}` (NAD83 geographic; reproject to EPSG:4326 for tiles)"],
                ["Geometry", f"{info['geometry_type']} (has Z; drop it when processing)"],
                ["Features (polygons)", fmt_int(info["features"])],
                ["Fields", len(info["fields"])],
                ["Total acres (`ACRES`)", fmt_acres(df[COL_ACRES].sum())],
                ["`UniqueID` unique?", "yes" if df["UniqueID"].is_unique else "no"],
            ],
        )
        + "\n"
    )

    out.append("## Column names to use\n")
    out.append(
        md_table(
            ["purpose", "column", "notes"],
            [
                ["Primary crop code", f"`{COL_MAIN_CROP}`", COLUMN_NOTES[COL_MAIN_CROP]],
                ["Other / multi-crop codes", "`CROPTYP1`..`CROPTYP4`", "Crop sequence for the polygon (see below). Codes equal to `MAIN_CROP` are the primary crop itself."],
                ["Multi-crop flag", f"`{COL_MULTIUSE}`", "`S` single, `D` double, `T` triple, `Q` quad."],
                ["Acres", f"`{COL_ACRES}`", "Polygon area in acres (`Shape_Area` is in square degrees; ignore it)."],
                ["County", f"`{COL_COUNTY}`", "Title-case county name; `****` for polygons outside any county."],
            ],
        )
        + "\n"
    )
    out.append(
        "Conventions in this file:\n\n"
        f"- All attribute columns except `ACRES`, `YR_PLANTED`, `ADOY*`, `MAIN_CROP_` and `Shape_*` are text.\n"
        f"- `{NULL_TOKEN}` is the null token for crop-code, `COUNTY`, `REGION` and `HYDRO_RGN` columns "
        "(`**` for `CLASS*`/`SUBCLASS*`/`PCNT*`, `*` for `SPECOND*`/`IRR_*`). There are no real nulls.\n"
        "- A **code** is a legend class letter(s) plus an optional subclass number, e.g. `D12` = almonds, "
        "`T18` = miscellaneous truck, `V` = grapes (no subclass), `UL2` = urban golf course.\n"
        "- `MAIN_CROP_` (trailing underscore) is **not** a code; it is an undocumented numeric field that looks "
        "like the approximate day-of-year of the main crop (range -92..273). Do not use it.\n"
        "- `CLASS1..4`/`SUBCLASS1..4` split the same crop sequence into class letter and subclass "
        "(`CLASS2`/`SUBCLASS2` hold a single crop's class/subclass); `UCF_ATT` and `LIQ_REPORT` are Land IQ "
        "concatenations of these. Prefer the `CROPTYP*`/`MAIN_CROP` codes.\n"
    )

    out.append("## Multi-crop columns explained\n")
    out.append(multiuse_table(df) + "\n")
    out.append(
        f"- Single-crop polygons (`MULTIUSE=S`): `CROPTYP1` is `{NULL_TOKEN}` for "
        f"{stats['croptyp1_unset_when_single']:.1%} of them and the crop sits in `CROPTYP2`.\n"
        f"- `MAIN_CROP == CROPTYP2` for {stats['main_eq_croptyp2']:.1%} of polygons; "
        f"`MAIN_CROP` equals some `CROPTYP*` value for {stats['main_in_any']:.1%}. "
        f"`MAIN_CROP` is the **last** crop of the `CROPTYP1..4` sequence for {stats['main_is_last']:.1%} of polygons.\n"
        f"- **Caveat:** {fmt_int(stats['x_main_hides_crop'])} polygons "
        f"({fmt_acres(stats['x_main_hides_crop_acres'])} acres, mostly orchards `D12`/`D13`/`C`) have "
        "`MAIN_CROP = 'X'` (unclassified fallow) only because a trailing `X` follows the real crop in `CROPTYP2/3`. "
        "When `MAIN_CROP` is `X` and a non-`X` code exists in `CROPTYP1..4`, the real crop is the last non-`X` code.\n"
        f"- {fmt_int(stats['with_other_crops'])} polygons list at least one `CROPTYP*` code different from "
        f"`MAIN_CROP` (candidates for the popup's \"also grown this year\"); "
        f"{fmt_int(stats['with_2plus_cols_set'])} polygons have two or more `CROPTYP*` set.\n"
        "- Recommended pipeline mapping: primary = `MAIN_CROP`, except when it is `X` and a non-`X` code exists in "
        f"`CROPTYP1..4` (then the last non-`X` code); `crop_ids_other` = the remaining distinct `CROPTYP1..4` codes "
        f"(not `{NULL_TOKEN}`, not `X`) that differ from the primary.\n"
    )

    out.append("## County filtering\n")
    out.append(
        f"- Attribute: `{COL_COUNTY}`; Monterey filter: `{MONTEREY_FILTER}` "
        "(GDAL/OGR SQL where clause; pandas: `df[df.COUNTY == 'Monterey']`).\n"
        f"- Monterey County: **{fmt_int(len(monterey))} polygons**, {fmt_acres(monterey[COL_ACRES].sum())} acres, "
        f"bbox (lon/lat WGS84) `{bounds}`.\n"
        f"- {fmt_int((df[COL_COUNTY] == NULL_TOKEN).sum())} polygons have `COUNTY = '{NULL_TOKEN}'` "
        f"(urban `U`/`UL2` areas outside county assignment); {fmt_int(real_counties)} real counties otherwise appear by name.\n"
    )
    out.append(county_table(df) + "\n")

    out.append("## All fields\n")
    out.append(field_table(df, dtypes) + "\n")

    out.append("## Crop-code columns\n")
    out.append(
        "Polygon counts and acres are per code appearing in that column (a multi-crop polygon's full `ACRES` "
        "is counted under each of its codes; acres are not split between crops).\n"
    )
    for col in CROP_CODE_COLUMNS:
        out.append(f"### `{col}`\n")
        out.append(f"{COLUMN_NOTES[col]} Distinct values: {df[col].nunique()}.\n")
        out.append(code_table(df, col, legend) + "\n")

    out.append("### `MAIN_CROP` by legend class\n")
    out.append(class_rollup(df, legend) + "\n")

    out.append("## Legend: code to class name\n")
    out.append(
        "Parsed from the legend PDF. Codes observed in the data that are absent here are labelled "
        "`(not in legend)` in the tables above.\n"
    )
    out.append(legend_table(legend) + "\n")
    return "\n".join(out)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR)
    year = parser.parse_args().year
    CROP_CODES_DOC.parent.mkdir(parents=True, exist_ok=True)
    CROP_CODES_DOC.write_text(build_doc(year))
    print(f"wrote {CROP_CODES_DOC}")


if __name__ == "__main__":
    main()
