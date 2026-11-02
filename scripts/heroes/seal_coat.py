"""
The Tripo seal's back is blurred in its texture (seen from above, the texture had little to go on):
repaint the upward-facing coat with crisp spots like the ones on its sides (rings and dots), on the
blurred tone that was there, blended into the original where the side begins.
"""
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as C  # noqa: E402


def blur(a, r):
    """A box blur of radius r texels, twice (close to a gaussian); a: H×W×k."""
    for _ in range(2):
        for ax in (0, 1):
            c = np.cumsum(np.pad(a, [(r + 1, r) if i == ax else (0, 0) for i in range(a.ndim)], mode='edge'), axis=ax)
            hi = np.take(c, np.arange(2 * r + 1, c.shape[ax]), axis=ax)
            lo = np.take(c, np.arange(0, c.shape[ax] - 2 * r - 1), axis=ax)
            a = (hi - lo) / (2 * r + 1)
    return a


def repaint(ob, img, head_y=-0.33, debug=None):
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    rgb = px[..., :3].copy()
    pos, nor, covered = C.bake_positions(ob, W)
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    nz = nor[..., 2]
    # which coat to redo: facing up, not the face (eyes, nose, mouth are at the front of the head)
    face = (y < head_y - 0.06) & (nor[..., 1] < -0.25)
    mask = C.smoothstep(0.30, 0.62, nz) * (~face) * covered
    # the colours of the sides: the coat's tone and the dark of its spots
    side = covered & (np.abs(nz) < 0.3) & (z > 0.08) & (~face)
    lum = rgb[..., :3].mean(-1)
    base_tone = np.median(rgb[side], axis=0)
    dark = np.percentile(rgb[side].reshape(-1, 3), 4, axis=0)
    light = np.percentile(rgb[side].reshape(-1, 3), 80, axis=0)
    print('tones', base_tone, dark, light)
    # the tone that was there, without its smudges: a wide blur of the original
    # (one tone for all: a blur across the texture would mix in the islands next to each one)
    tone = base_tone[None, None, :] * np.ones_like(rgb)
    # nothing light is repainted (the muzzle, the pale belly showing at the edges)
    lum_soft = blur(lum[..., None] * covered[..., None], 6)[..., 0] / np.maximum(blur(covered[..., None].astype(np.float32), 6)[..., 0], 1e-3)
    mask = mask * C.smoothstep(0.58, 0.46, lum_soft)
    # a gentle shading: a little darker along the spine, as on the toy
    spine = C.smoothstep(0.75, 0.97, nz)[..., None]
    new = tone * (1 - 0.10 * spine)
    # spots: open rings with a lighter middle, and dots
    d, h = C.cells(pos, 0.042, seed=7)
    q = pos / 0.042
    ang = np.arctan2(q[..., 1] - np.round(q[..., 1]), q[..., 0] - np.round(q[..., 0]))
    r = 0.30 + 0.12 * h
    ring = (h < 0.5) & (np.abs(d - r) < 0.06) & (np.sin(ang * 1.0 + h * 40) > -0.55)
    inner = (h < 0.5) & (d < r - 0.045)
    dot = (h >= 0.5) & (h < 0.9) & (d < 0.14 + 0.15 * (h - 0.5))
    d2, h2 = C.cells(pos, 0.021, seed=11)
    small = (h2 < 0.65) & (d2 < 0.17)
    new = np.where(inner[..., None], new * 0.55 + light * 0.45 * 0.9, new)
    new = np.where((ring | dot)[..., None], dark, new)
    new = np.where((small & ~inner & ~ring)[..., None], new * 0.35 + dark * 0.65, new)
    out = rgb * (1 - mask[..., None]) + new * mask[..., None]
    # the islands grown outward again over their margins (the old margins have the old colours,
    # which would show as thin lines along the seams)
    grown = C.dilate(out, covered, 12)
    out = np.where(covered[..., None], out, grown)
    px[..., :3] = np.clip(out, 0, 1)
    img.pixels[:] = px.ravel()
    img.update()
    img.pack()
    if debug:
        from PIL import Image
        Image.fromarray((np.clip(out[::-1], 0, 1) * 255).astype(np.uint8)).resize((1024, 1024)).save(debug)
    print('repainted', float(mask.mean()))
