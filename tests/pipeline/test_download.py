import importlib.util
import subprocess
import zipfile
from pathlib import Path

import pytest

import common

_SPEC = importlib.util.spec_from_file_location("download_mod", common.REPO_ROOT / "pipeline" / "01_download.py")
download_mod = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(download_mod)

MEMBERS = {"data.shp": b"0123456789", "sub/data.dbf": b"abcdef"}


def _make_zip(path):
    with zipfile.ZipFile(path, "w") as zf:
        for name, payload in MEMBERS.items():
            zf.writestr(name, payload)
    return path


def test_extraction_complete_requires_every_member(tmp_path):
    archive = _make_zip(tmp_path / "x.zip")
    out = tmp_path / "out"
    assert not download_mod.extraction_complete(archive, out)

    out.mkdir()
    (out / "data.shp").write_bytes(MEMBERS["data.shp"][:4])  # interrupted mid-write
    assert not download_mod.extraction_complete(archive, out)

    (out / "data.shp").write_bytes(MEMBERS["data.shp"])
    assert not download_mod.extraction_complete(archive, out)  # sub/data.dbf still missing

    (out / "sub").mkdir()
    (out / "sub" / "data.dbf").write_bytes(MEMBERS["sub/data.dbf"])
    assert download_mod.extraction_complete(archive, out)


def test_extraction_complete_false_without_archive(tmp_path):
    out = tmp_path / "out"
    out.mkdir()
    (out / "data.shp").write_bytes(b"x")
    assert not download_mod.extraction_complete(tmp_path / "missing.zip", out)


def test_fetch_writes_part_then_renames(tmp_path, monkeypatch):
    dest = tmp_path / "legend.pdf"

    def fake_run(cmd, check):
        assert check is True
        target = Path(cmd[cmd.index("-o") + 1])
        assert target == tmp_path / "legend.pdf.part"
        target.write_bytes(b"%PDF-1.4 complete")
        return subprocess.CompletedProcess(cmd, 0)

    monkeypatch.setattr(download_mod.subprocess, "run", fake_run)
    download_mod.fetch("https://example.invalid/legend.pdf", dest)
    assert dest.read_bytes() == b"%PDF-1.4 complete"
    assert not (tmp_path / "legend.pdf.part").exists()


def test_fetch_failure_leaves_no_final_file(tmp_path, monkeypatch):
    dest = tmp_path / "legend.pdf"

    def failing_run(cmd, check):
        Path(cmd[cmd.index("-o") + 1]).write_bytes(b"%PDF-1.4 trunc")
        raise subprocess.CalledProcessError(18, cmd)  # curl: partial file

    monkeypatch.setattr(download_mod.subprocess, "run", failing_run)
    with pytest.raises(subprocess.CalledProcessError):
        download_mod.fetch("https://example.invalid/legend.pdf", dest)
    assert not dest.exists()
    assert (tmp_path / "legend.pdf.part").exists()


def test_download_year_skips_when_data_present(tmp_path, monkeypatch):
    out = tmp_path / "2023"
    out.mkdir()
    archive = _make_zip(out / "i15.zip")
    for name, payload in MEMBERS.items():
        (out / name).parent.mkdir(parents=True, exist_ok=True)
        (out / name).write_bytes(payload)
    legend = out / "legend.pdf"
    legend.write_bytes(b"%PDF")

    def no_network(url, dest):
        raise AssertionError(f"unexpected download of {url}")

    monkeypatch.setattr(download_mod, "raw_dir", lambda year: out)
    monkeypatch.setattr(download_mod, "zip_path", lambda year: archive)
    monkeypatch.setattr(download_mod, "legend_path", lambda year: legend)
    monkeypatch.setattr(download_mod, "fetch", no_network)
    download_mod.download_year(2023)
