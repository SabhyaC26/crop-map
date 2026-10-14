import gzip
import importlib.util
import struct
import sys

import pytest

import common

_SPEC = importlib.util.spec_from_file_location("tile_stats_mod", common.REPO_ROOT / "pipeline" / "tile_stats.py")
tile_stats = importlib.util.module_from_spec(_SPEC)
sys.modules[_SPEC.name] = tile_stats
_SPEC.loader.exec_module(tile_stats)


def _encode_varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


def _directory(entries: list[tuple[int, int, int, int | None]]) -> bytes:
    """entries: (tile_id, length, run_length, offset). offset None encodes the contiguous shortcut (value 0)."""
    buf = bytearray(_encode_varint(len(entries)))
    last = 0
    for tile_id, _, _, _ in entries:
        buf += _encode_varint(tile_id - last)
        last = tile_id
    for _, _, run_length, _ in entries:
        buf += _encode_varint(run_length)
    for _, length, _, _ in entries:
        buf += _encode_varint(length)
    for _, _, _, offset in entries:
        buf += _encode_varint(0 if offset is None else offset + 1)
    return bytes(buf)


def _pmtiles(path, root: bytes, leaves: bytes = b"", compression: int = tile_stats.COMPRESSION_NONE) -> None:
    """Minimal PMTiles v3 archive: header, root directory, leaf directories. Tile data is never read."""
    if compression == tile_stats.COMPRESSION_GZIP:
        root = gzip.compress(root)
        leaves = gzip.compress(leaves) if leaves else b""
    header = bytearray(tile_stats.HEADER_BYTES)
    header[0:7] = b"PMTiles"
    header[7] = 3
    root_offset = tile_stats.HEADER_BYTES
    leaf_offset = root_offset + len(root)
    struct.pack_into("<6Q", header, 8, root_offset, len(root), 0, 0, leaf_offset, len(leaves))
    header[97] = compression
    path.write_bytes(bytes(header) + root + leaves)


def test_varint_decodes_single_and_multibyte_values():
    assert tile_stats._varint(b"\x05", 0) == (5, 1)
    assert tile_stats._varint(b"\xac\x02", 0) == (300, 2)
    assert tile_stats._varint(b"\x00\x05", 1) == (5, 2)
    big = 2**40 + 7
    assert tile_stats._varint(_encode_varint(big), 0) == (big, len(_encode_varint(big)))


@pytest.mark.parametrize(
    ("tile_id", "zoom"),
    [(0, 0), (1, 1), (4, 1), (5, 2), (21, 3), (84, 3), (85, 4), (86, 4)],
)
def test_zoom_of_tile_id_uses_pyramid_offsets(tile_id, zoom):
    assert tile_stats._zoom_of(tile_id) == zoom


def test_decode_directory_resolves_deltas_runs_and_contiguous_offsets():
    raw = _directory([(3, 100, 1, 0), (4, 50, 2, None), (9, 25, 1, 500)])
    assert tile_stats._decode_directory(raw) == [
        (3, 0, 100, 1),
        (4, 100, 50, 2),  # value 0 -> previous offset + previous length
        (9, 500, 25, 1),
    ]


def test_tile_sizes_expands_runs_per_zoom(tmp_path):
    path = tmp_path / "tiles.pmtiles"
    _pmtiles(path, _directory([(0, 100, 1, 0), (1, 50, 4, 100), (5, 10, 1, 150)]))
    assert tile_stats.tile_sizes_by_zoom(path) == {0: [100], 1: [50, 50, 50, 50], 2: [10]}


def test_tile_sizes_follows_leaf_directories(tmp_path):
    path = tmp_path / "tiles.pmtiles"
    leaf = _directory([(21, 7, 2, 0), (23, 9, 1, 14)])
    root = _directory([(21, len(leaf), 0, 0)])  # run_length 0 -> pointer to a leaf at offset 0
    _pmtiles(path, root, leaves=leaf)
    sizes = tile_stats.tile_sizes_by_zoom(path)
    assert {zoom: sorted(values) for zoom, values in sizes.items()} == {3: [7, 7, 9]}


def test_tile_sizes_reads_gzip_compressed_directories(tmp_path):
    path = tmp_path / "tiles.pmtiles"
    _pmtiles(path, _directory([(0, 42, 1, 0), (2, 8, 3, 42)]), compression=tile_stats.COMPRESSION_GZIP)
    assert tile_stats.tile_sizes_by_zoom(path) == {0: [42], 1: [8, 8, 8]}


def test_tile_sizes_rejects_unsupported_internal_compression(tmp_path):
    path = tmp_path / "tiles.pmtiles"
    _pmtiles(path, _directory([(0, 1, 1, 0)]), compression=3)  # brotli
    with pytest.raises(SystemExit, match="unsupported internal compression 3"):
        tile_stats.tile_sizes_by_zoom(path)


def test_main_prints_one_row_per_zoom(tmp_path, monkeypatch, capsys):
    path = tmp_path / "tiles.pmtiles"
    _pmtiles(path, _directory([(0, 1024, 1, 0), (1, 2048, 2, None), (2, 4096, 1, None)]))
    monkeypatch.setattr(sys, "argv", ["tile_stats.py", str(path)])
    tile_stats.main()
    lines = capsys.readouterr().out.strip().splitlines()
    assert lines[0].split() == ["zoom", "tiles", "max", "KB", "mean", "KB"]
    assert lines[1].split() == ["0", "1", "1.0", "1.0"]
    assert lines[2].split() == ["1", "3", "4.0", "2.7"]
