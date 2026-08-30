#!/usr/bin/env python3
"""Generate a minimal valid blue PNG icon without external dependencies."""
import struct, zlib, os, sys

W = H = 512
# Solid blue #2563EB RGB = (37, 99, 235)
def make_pixels():
    rows = bytearray()
    for y in range(H):
        rows.append(0)  # filter byte
        for x in range(W):
            # Gradient: brighter toward center
            cx, cy = W/2, H/2
            dx = (x - cx) / cx
            dy = (y - cy) / cy
            d = 1 - min(1.0, (dx*dx + dy*dy) ** 0.5 * 0.7)
            r = max(0, min(255, int(37 + (80)*d)))
            g = max(0, min(255, int(99 + (100)*d)))
            b = max(0, min(255, int(235 + (20)*d)))
            rows.extend([r, g, b])
    return bytes(rows)

def chunk(tag, data):
    return (struct.pack(">I", len(data)) + tag + data +
            struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff))

def build_png(path):
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack(">IIBBBBB", W, H, 8, 2, 0, 0, 0)  # 8-bit RGB
    raw = make_pixels()
    idat = zlib.compress(raw, 9)
    png = sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
    return len(png)

here = os.path.dirname(os.path.abspath(__file__))
path = os.path.join(here, "icon.png")
size = build_png(path)
print(f"Created icon: {path} ({W}x{H}, {size:,} bytes)")
