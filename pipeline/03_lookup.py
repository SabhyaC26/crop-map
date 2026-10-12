"""Validate data/lookup/crops.csv and export site/public/data/crops.json."""

from __future__ import annotations

import json

from crops import CROPS_JSON, LOOKUP_CSV, crops_json_rows, load_lookup, validate_lookup


def main() -> None:
    crops = load_lookup()
    problems = validate_lookup(crops)
    if problems:
        raise SystemExit(f"{LOOKUP_CSV} is invalid:\n  " + "\n  ".join(problems))
    CROPS_JSON.parent.mkdir(parents=True, exist_ok=True)
    CROPS_JSON.write_text(json.dumps(crops_json_rows(crops), ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"validated {len(crops)} crops; wrote {CROPS_JSON.relative_to(CROPS_JSON.parents[3])}")


if __name__ == "__main__":
    main()
