"""Download and unzip the DWR statewide crop-mapping shapefile plus the land-use legend PDF."""

from __future__ import annotations

import argparse
import os
import subprocess
import zipfile
from pathlib import Path

from common import DEFAULT_YEAR, LEGEND_URL, legend_path, raw_dir, year_source, zip_path


def fetch(url: str, dest: Path) -> None:
    """Resumable download via curl into `<dest>.part`; renamed to `dest` only after curl succeeds."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    part = dest.with_name(dest.name + ".part")
    subprocess.run(
        ["curl", "--fail", "--location", "--silent", "--show-error", "--retry", "5",
         "--retry-delay", "3", "-C", "-", "-o", str(part), url],
        check=True,
    )
    os.replace(part, dest)


def zip_is_valid(path: Path) -> bool:
    try:
        with zipfile.ZipFile(path) as zf:
            return zf.testzip() is None
    except (zipfile.BadZipFile, FileNotFoundError):
        return False


def extraction_complete(archive: Path, out: Path) -> bool:
    """True only when every file member of `archive` is present under `out` at its full size.

    An interrupted extractall leaves some members missing or short, so a single *.shp
    existing is not proof that the extraction finished.
    """
    try:
        with zipfile.ZipFile(archive) as zf:
            members = [info for info in zf.infolist() if not info.is_dir()]
            for info in members:
                target = out / info.filename
                if not target.is_file() or target.stat().st_size != info.file_size:
                    return False
            return True
    except (zipfile.BadZipFile, FileNotFoundError):
        return False


def download_year(year: int) -> None:
    source = year_source(year)
    out = raw_dir(year)
    archive = zip_path(year)

    if extraction_complete(archive, out):
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
        if not extraction_complete(archive, out):
            raise SystemExit(f"extraction of {archive} into {out} is incomplete; re-run to retry")
        print(f"[ok  ] extracted to {out}")

    legend = legend_path(year)
    if legend.is_file() and legend.stat().st_size > 0:
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
