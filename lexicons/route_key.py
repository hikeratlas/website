#!/usr/bin/env python3
"""Route keys, recipe v1: the reference implementation (Python, h3 >= 4).

A route's identity, computed from its line, so no ids are minted: the same
line always gives the same key. Hiker Atlas uses it as the record key of a
com.hikeratlas.temp.fave, and as the routeKey of tracks and reviews
(com.hikeratlas.temp.defs#routeKey; website#130).

The website computes keys too (app/atproto/routeKey.ts) and must agree with
this to the character: route_key_vectors.json holds real routes and their
keys, and both implementations are tested against it. Floating point is done
in the same order in both, with no library sums (Python's sum() of floats
compensates, JavaScript's doesn't) and sqrt rather than hypot.

    route_key(line, shape) -> str     line: [[lon, lat], ...]; shape: b, p or w
    decode(key) -> {centroid, shape, cells}

    python3 route_key.py check route_key_vectors.json
"""
import json
import math
import sys

import h3

VERSION = '1'
RES = 10
ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'  # base64url
SHAPES = 'bpw'  # out-and-back, loop (p), one-way (w)


def metres(a, b):
    """Distance between [lon, lat] points: equirectangular, at their mean
    latitude, 111,320 m a degree."""
    k = math.cos(math.radians((a[1] + b[1]) / 2))
    dx = (a[0] - b[0]) * k
    dy = a[1] - b[1]
    return math.sqrt(dx * dx + dy * dy) * 111320


def _along(line, frac, segs, total):
    """The point at frac of the line's length."""
    goal, run = total * frac, 0.0
    for i, s in enumerate(segs):
        if run + s >= goal and s > 0:
            t = (goal - run) / s
            a, b = line[i], line[i + 1]
            return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
        run += s
    return list(line[-1])


def _cell(p):
    return h3.latlng_to_cell(p[1], p[0], RES)


def _zigzag(v):
    return 2 * v if v >= 0 else -2 * v - 1


def _unzigzag(z):
    return z // 2 if z % 2 == 0 else -(z + 1) // 2


def route_key(line, shape):
    if shape not in SHAPES:
        raise ValueError(f'shape must be one of {SHAPES!r}')
    if len(line) < 2:
        raise ValueError('a line needs two points')
    segs = [metres(a, b) for a, b in zip(line, line[1:])]
    total = 0.0
    for s in segs:
        total += s
    if total == 0:
        total = 1.0
    # Centroid: the mean of 21 points evenly spaced along the line.
    sx = sy = 0.0
    for i in range(21):
        q = _along(line, i / 20, segs, total)
        sx += q[0]
        sy += q[1]
    c = _cell((sx / 21, sy / 21))
    # Its 37 meaningful bits (base cell, then 10 three-bit digits), left-aligned
    # in 42 bits: 7 base64url characters, most significant first, so a key's
    # prefix is a coarser area.
    n = int(c, 16)
    v = (n >> 45) & 0x7F
    for r in range(1, RES + 1):
        v = (v << 3) | ((n >> ((15 - r) * 3)) & 7)
    v <<= 5
    out = [VERSION] + [ABC[(v >> (6 * (6 - k))) & 63] for k in range(7)] + [shape]
    # Line: 9 points evenly spaced along it, as offsets from the centroid's
    # cell in H3's local IJ grid: distinct, sorted, each i then j as zigzag
    # varints, 5 data bits a character, low bits first, 32 = more to come.
    i0, j0 = h3.cell_to_local_ij(c, c)
    offs = sorted({(i - i0, j - j0) for i, j in
                   (h3.cell_to_local_ij(c, _cell(_along(line, k / 8, segs, total))) for k in range(9))})
    for di, dj in offs:
        for z in (_zigzag(di), _zigzag(dj)):
            while True:
                d = z & 31
                z >>= 5
                out.append(ABC[d | (32 if z else 0)])
                if not z:
                    break
    return ''.join(out)


def decode(key):
    """A key's centroid cell, shape, and its points' cells (the centroid's
    first). Raises ValueError for anything not a v1 key."""
    if len(key) < 9 or key[0] != VERSION or key[8] not in SHAPES or any(ch not in ABC for ch in key[1:]):
        raise ValueError('not a v1 route key')
    v = 0
    for ch in key[1:8]:
        v = (v << 6) | ABC.index(ch)
    if v & 31:
        raise ValueError('not a v1 route key')
    v >>= 5
    n = (1 << 59) | (RES << 52) | ((v >> 30) << 45)
    for r in range(1, 16):
        d = (v >> (3 * (RES - r))) & 7 if r <= RES else 7
        n |= d << ((15 - r) * 3)
    c = format(n, 'x')
    if not h3.is_valid_cell(c):
        raise ValueError('not a v1 route key')
    zs, z, shift = [], 0, 0
    for ch in key[9:]:
        d = ABC.index(ch)
        z |= (d & 31) << shift
        shift += 5
        if not d & 32:
            zs.append(z)
            z, shift = 0, 0
    if shift or len(zs) % 2:
        raise ValueError('not a v1 route key')
    i0, j0 = h3.cell_to_local_ij(c, c)
    cells = [h3.local_ij_to_cell(c, i0 + _unzigzag(a), j0 + _unzigzag(b)) for a, b in zip(zs[::2], zs[1::2])]
    return {'centroid': c, 'shape': key[8], 'cells': cells}


if __name__ == '__main__':
    if sys.argv[1:2] == ['check']:
        vs = json.load(open(sys.argv[2]))
        bad = [v['name'] for v in vs['vectors'] if route_key(v['line'], v['shape']) != v['key']]
        print(f"{len(vs['vectors']) - len(bad)}/{len(vs['vectors'])} vectors match" + (f"; differ: {bad}" if bad else ''))
        sys.exit(1 if bad else 0)
    print(__doc__)
