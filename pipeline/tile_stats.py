"""Per-zoom tile counts and max/mean compressed tile size of a PMTiles v3 archive."""

from __future__ import annotations

import argparse
import gzip
import struct
from collections import defaultdict
from pathlib import Path

HEADER_BYTES = 127
COMPRESSION_NONE = 1
COMPRESSION_GZIP = 2


def _varint(buf: bytes, pos: int) -> tuple[int, int]:
    result = shift = 0
    while True:
        byte = buf[pos]
        pos += 1
        result |= (byte & 0x7F) << shift
        if byte < 0x80:
            return result, pos
        shift += 7


def _decode_directory(buf: bytes) -> list[tuple[int, int, int, int]]:
    """Entries as (tile_id, offset, length, run_length)."""
    count, pos = _varint(buf, 0)
    tile_ids, run_lengths, lengths, offsets = [], [], [], []
    last = 0
    for _ in range(count):
        delta, pos = _varint(buf, pos)
        last += delta
        tile_ids.append(last)
    for _ in range(count):
        value, pos = _varint(buf, pos)
        run_lengths.append(value)
    for _ in range(count):
        value, pos = _varint(buf, pos)
        lengths.append(value)
    for i in range(count):
        value, pos = _varint(buf, pos)
        offsets.append(offsets[i - 1] + lengths[i - 1] if value == 0 and i > 0 else value - 1)
    return list(zip(tile_ids, offsets, lengths, run_lengths, strict=True))


def _zoom_of(tile_id: int) -> int:
    zoom = 0
    while tile_id >= ((4 ** (zoom + 1)) - 1) // 3:
        zoom += 1
    return zoom


def tile_sizes_by_zoom(path: Path) -> dict[int, list[int]]:
    with path.open("rb") as handle:
        header = handle.read(HEADER_BYTES)
        root_offset, root_length, _meta_off, _meta_len, leaf_offset, _leaf_length = struct.unpack("<6Q", header[8:56])
        internal_compression = header[97]

        def read_dir(offset: int, length: int) -> list[tuple[int, int, int, int]]:
            handle.seek(offset)
            raw = handle.read(length)
            if internal_compression == COMPRESSION_GZIP:
                raw = gzip.decompress(raw)
            elif internal_compression != COMPRESSION_NONE:
                raise SystemExit(f"unsupported internal compression {internal_compression}")
            return _decode_directory(raw)

        sizes: dict[int, list[int]] = defaultdict(list)
        stack = read_dir(root_offset, root_length)
        while stack:
            tile_id, offset, length, run_length = stack.pop()
            if run_length == 0:
                stack.extend(read_dir(leaf_offset + offset, length))
            else:
                sizes[_zoom_of(tile_id)].extend([length] * run_length)
    return sizes


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pmtiles", type=Path)
    args = parser.parse_args()
    sizes = tile_sizes_by_zoom(args.pmtiles)
    print(f"{'zoom':>4} {'tiles':>8} {'max KB':>9} {'mean KB':>9}")
    for zoom in sorted(sizes):
        zoom_sizes = sizes[zoom]
        print(f"{zoom:>4} {len(zoom_sizes):>8,} {max(zoom_sizes) / 1024:>9.1f} {sum(zoom_sizes) / len(zoom_sizes) / 1024:>9.1f}")


if __name__ == "__main__":
    main()
