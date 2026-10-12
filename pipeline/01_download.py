"""Download and unzip the DWR statewide crop-mapping shapefile plus the land-use legend PDF."""

from __future__ import annotations

import argparse
import subprocess
import zipfile
from pathlib import Path

from common import DEFAULT_YEAR, LEGEND_URL, legend_path, raw_dir, year_source, zip_path


def fetch(url: str, dest: Path) -> None:
    """Resumable download via curl; no-op when the server says the file is already complete."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "5",
         "--retry-delay", "3", "-C", "-", "-o", str(dest), url],
        check=True,
    )


def zip_is_valid(path: Path) -> bool:
    try:
        with zipfile.ZipFile(path) as zf:
            return zf.testzip() is None
    except (zipfile.BadZipFile, FileNotFoundError):
        return False


def download_year(year: int) -> None:
    source = year_source(year)
    out = raw_dir(year)
    archive = zip_path(year)

    if list(out.glob("*.shp")):
        print(f"[skip] shapefile already present in {out}")
    else:
        print(f"[get ] {source.url}")
        if not zip_is_valid(archive):
            fetch(source.url, archive)
        if not zip_is_valid(archive):
            archive.unlink(missing_ok=True)
            raise SystemExit(f"{archive} is not a valid zip after download; re-run to retry")
        with zipfile.ZipFile(archive) as zf:
            zf.extractall(out)
        print(f"[ok  ] extracted to {out}")

    legend = legend_path(year)
    if legend.exists() and legend.stat().st_size > 0:
        print(f"[skip] {legend.name} already present")
    else:
        print(f"[get ] {LEGEND_URL}")
        fetch(LEGEND_URL, legend)
        print(f"[ok  ] {legend}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--year", type=int, default=DEFAULT_YEAR)
    download_year(parser.parse_args().year)


if __name__ == "__main__":
    main()
