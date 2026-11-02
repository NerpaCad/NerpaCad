"""
NerpaCad's pigeon Геннадий (Tripo model) with spread wings of separate feathers for flying.

The Tripo body has its wings folded (they are part of its surface). For flight a pair of wings made
of feathers (as in the earlier hand-made pigeon) comes out at the shoulders: hidden (scale 0) on
the ground, unfolding in the takeoff, flapping and gliding in the air, folding away on landing.

Clips: idle, walk, takeoff, flapping, gliding, landing.
Run: python rig_pigeon.py -- <pigeon_src.glb> <out.glb> [<out.blend>]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import common as C  # noqa: E402
import rigkit as K  # noqa: E402
from rigkit import bone, mirror, rot_world, loc, scale  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
OUT_BLEND = args[2] if len(args) > 2 else None
TRIS = int(os.environ.get('TRIS', 15000))

body = K.load(SRC, name='Pigeon')
co = K.coords(body)
K.decimate(body, TRIS)
scene = K.scene


def side_x(y, z, s, dy=0.03, dz=0.02, default=0.06):
    m = (np.abs(co[:, 1] - y) < dy) & (np.abs(co[:, 2] - z) < dz) & (co[:, 0] * s > 0.005)
    return float(np.mean(co[m, 0])) if m.any() else s * default


# the body's tone (most of the texture): the feathers take shades of it
img = K.base_image(body)
px = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)[..., :3]
TONE = np.median(px.reshape(-1, 3), axis=0)
print('tone', TONE)


def shade(k):
    """A texture value (sRGB) made into a material colour (linear)."""
    c = np.clip(TONE * k, 0, 1)
    return tuple(float(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4) for x in c)


# ------------------------------------------------------------------ the wings (built spread, as in make_pigeon2.py)
WK = 4.3  # the hand-made pigeon was 4.3 times smaller
SHOULDER = Vector((0.13, -0.20, 0.58))
N_COV, N_SEC, N_PRI = 8, 8, 9
SEC_LEN = 0.062
PRI_LEN = [0.082 + 0.048 * (j / (N_PRI - 1)) ** 0.8 for j in range(N_PRI)]
ARM = [(0.0, 0.0), (0.045, 0.006), (0.088, 0.000), (0.120, 0.004)]  # shoulder, elbow, wrist, the hand's tip (u, v)
FOLD_ARM = ((0.0, 0.0), (0.034, 0.008), (0.006, 0.024), (0.052, 0.032))


def lerp(p, q, t):
    return (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t)


COV_LENS = []
for i in range(N_COV):
    t = i / (N_COV - 1)
    sh, el, wr, _ = FOLD_ARM
    r = lerp(sh, el, t * 2) if t < 0.5 else lerp(el, wr, (t - 0.5) * 2)
    r = (r[0] + 0.004, r[1] + 0.004)
    COV_LENS.append(max(0.03, 0.056 + 0.020 * math.sin(math.pi * min(1.0, r[1] / 0.030)) - r[0]))


def rot_in(a, b, ang):
    return a * math.cos(ang) + b * math.sin(ang)


def segment(u):
    return 'humerus' if u < 0.045 else 'forearm' if u < 0.088 else 'hand'


M_COV = C.material('WingCovert', shade(0.97), rough=0.85)
M_SEC = C.material('WingFeather', shade(0.85), rough=0.85)
M_PRI = C.material('WingTip', shade(0.72), rough=0.85)


def wing(s):
    """One wing (s = 1 left, −1 right), spread flat along ±x, in the scene's frame; each piece names its bone."""
    A = Vector((s * 0.99, 0.12, 0.0)).normalized()  # along the span, a little swept back
    Bv = Vector((0, 1, 0))
    Bv = (Bv - A * Bv.dot(A)).normalized()  # along the chord, back
    N = Vector((0, 0, 1))
    O = Vector((0, 0, 0))

    def P(u, v, w=0.0):
        return O + A * u + Bv * v + N * w

    parts = []

    def feather(name, root, d, length, width, mat, thick=0.0013, taper=0.25, bend=-0.035, seg='forearm'):
        ob = C.blade(name, root, root + d.normalized() * length, width, thick, taper=taper, up_hint=tuple(N), bend=bend, seg=(14, 3))
        ob.data.materials.append(mat)
        parts.append((ob, seg))

    for i in range(N_SEC):
        t = i / (N_SEC - 1)
        r = lerp((0.018, 0.004), ARM[2], t)
        feather('Secondary', P(*r, -0.0003 * i), rot_in(Bv, A, math.radians(-12 + 16 * t)), SEC_LEN, 0.0165, M_SEC, seg=segment(r[0]))
    for j in range(N_PRI):
        t = j / (N_PRI - 1)
        r = lerp(ARM[2], ARM[3], t)
        feather('Primary', P(*r, -0.0026 - 0.0003 * j), rot_in(Bv, A, math.radians(10 + 68 * t ** 0.9)), PRI_LEN[j], 0.0145, M_PRI, seg='hand')
    for i in range(N_COV):
        t = i / (N_COV - 1)
        r = lerp((0.004, -0.003), (0.104, -0.001), t)
        feather('Covert', P(*r, 0.0030 + 0.0002 * i), rot_in(Bv, A, math.radians(-6 + 22 * t)), COV_LENS[i] + 0.006, 0.026, M_COV, thick=0.0015, seg=segment(r[0]))
    arm = C.tube('Arm', [tuple(P(u, v, -0.0005)) for u, v in ARM], [0.0085, 0.0062, 0.0048, 0.0028], steps=12, seg=8)
    arm.data.materials.append(M_COV)
    parts.append((arm, None))
    side = 'L' if s > 0 else 'R'
    for ob, seg in parts:
        for p in ob.data.polygons:
            p.use_smooth = True
        # into the big pigeon: scaled, at its shoulder
        ob.data.transform(Matrix.Scale(WK, 4))
        ob.data.transform(Matrix.Translation(Vector((SHOULDER.x * s, SHOULDER.y, SHOULDER.z))))
        names = [f'{b}.{side}' for b in ('humerus', 'forearm', 'hand')]
        vg = {n: ob.vertex_groups.new(name=n) for n in names}
        for v in ob.data.vertices:
            if seg:
                vg[f'{seg}.{side}'].add([v.index], 1.0, 'REPLACE')
            else:
                u = (v.co - Vector((SHOULDER.x * s, SHOULDER.y, SHOULDER.z))).dot(A) / WK
                vg[f'{segment(u)}.{side}'].add([v.index], 1.0, 'REPLACE')
    return [ob for ob, _ in parts]


pieces = wing(1) + wing(-1)
wings = C.join(pieces, 'Wings')

# the outline of the folded wing painted on the body's side (y, z), m
FOLD_OUTLINE = [(-0.33, 0.42), (-0.28, 0.55), (-0.18, 0.61), (-0.05, 0.585), (0.06, 0.51), (0.16, 0.43), (0.30, 0.34),
                (0.45, 0.28), (0.45, 0.245), (0.30, 0.265), (0.16, 0.265), (0.05, 0.245), (-0.10, 0.245), (-0.22, 0.275), (-0.30, 0.335)]


# ------------------------------------------------------------------ the folded wings pressed in (for flight)
# A shape key `WingsIn`: the folded wings of the body lie on the body's round side instead of
# standing off it. The app turns it on while the pigeon flies (its feather wings are out then).
bco = K.coords(body)


def outline_dist(y, z):
    """Inside the outline, and the distance to it (m)."""
    poly = np.array(FOLD_OUTLINE)
    inside = np.zeros(y.shape, bool)
    dist = np.full(y.shape, 9.0)
    p = np.stack([y, z], -1)
    for (y0, z0), (y1, z1) in zip(poly, np.roll(poly, -1, 0)):
        inside ^= ((z0 > z) != (z1 > z)) & (y < (y1 - y0) * (z - z0) / (z1 - z0 + 1e-12) + y0)
        a, b = np.array([y0, z0]), np.array([y1, z1])
        t = np.clip(((p - a) @ (b - a)) / ((b - a) @ (b - a)), 0, 1)
        dist = np.minimum(dist, np.linalg.norm(p - (a + t[:, None] * (b - a)), axis=-1))
    return inside, dist


ins, dist = outline_dist(bco[:, 1], bco[:, 2])
# the wing and its raised edge, on the body's sides (not the back between the wings, not past the tail's root)
region = (ins | (dist < 0.05)) & (np.abs(bco[:, 0]) > 0.04) & (bco[:, 1] < 0.17)
# the surface over it filled smoothly from the body around it (biharmonic: it keeps the body's curve)
import scipy.sparse as sp  # noqa: E402
from scipy.sparse.linalg import spsolve  # noqa: E402
nv = len(bco)
ed = np.empty(len(body.data.edges) * 2, np.int64)
body.data.edges.foreach_get('vertices', ed)
ed = ed.reshape(-1, 2)
Adj = sp.coo_matrix((np.ones(len(ed) * 2), (np.r_[ed[:, 0], ed[:, 1]], np.r_[ed[:, 1], ed[:, 0]])), shape=(nv, nv)).tocsr()
deg = np.asarray(Adj.sum(1)).ravel()
L = sp.identity(nv) - sp.diags(1 / np.maximum(deg, 1)) @ Adj
M = (L @ L).tocsr()
R = np.where(region)[0]
F = np.where(~region)[0]
rhs = -(M[R][:, F] @ bco[F])
filled = np.stack([spsolve(M[R][:, R].tocsc(), rhs[:, k]) for k in range(3)], -1)
moved = bco.copy()
moved[R] = filled
dd = np.linalg.norm(moved - bco, axis=-1)
print('wings pressed in: vertices', len(R), 'deepest', float(dd.max()), 'mean', float(dd[R].mean()))

# its texture for flight: the folded wing painted over with the body's grey around it (the app
# shows it while the wings are pressed in)
FLY_TEX = os.environ.get('FLY_TEX')
if FLY_TEX:
    W = img.size[0]
    tpos, _, tcov = C.bake_positions(body, W)
    tins, tdist = outline_dist(tpos[..., 1].ravel(), tpos[..., 2].ravel())
    treg = ((tins | (tdist < 0.05)).reshape(tpos.shape[:2]) & (np.abs(tpos[..., 0]) > 0.04) & (tpos[..., 1] < 0.17) & tcov)
    pix = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], W, 4)[..., :3]
    # each painted-over texel: the colour of the body around it in 3D (its nearest texels outside the wing)
    from scipy.spatial import cKDTree
    keep = tcov & ~treg & (tpos[..., 2] > 0.2) & (tpos[..., 1] < 0.25)
    tree = cKDTree(tpos[keep])
    kcol = pix[keep]
    q = tpos[treg]
    dq, iq = tree.query(q, k=24)
    w = 1 / np.maximum(dq, 1e-4)
    col = (kcol[iq] * w[..., None]).sum(1) / w.sum(1, keepdims=True)
    out = pix.copy()
    out[treg] = col
    # the islands' margins as well, so no old colour shows along the seams
    out = np.where(tcov[..., None], out, C.dilate(out, tcov, 16))
    from PIL import Image as PImage
    PImage.fromarray((np.clip(out[::-1], 0, 1) * 255).astype(np.uint8)).save(FLY_TEX, quality=88)
    print('flight texture', FLY_TEX, int(treg.sum()))


# ------------------------------------------------------------------ skeleton (looks along −Y)
bone('root', (0, 0, 0), (0, 0.1, 0), deform=False)
bone('body', (0, -0.05, 0.40), (0, 0.01, 0.40), 'root', deform=False)
bone('hips', (0, 0.12, 0.30), (0, -0.08, 0.38), 'body')
bone('chest', (0, -0.08, 0.38), (0, -0.27, 0.50), 'hips')
bone('neck', (0, -0.27, 0.50), (0, -0.32, 0.66), 'chest')
bone('head', (0, -0.32, 0.66), (0, -0.44, 0.80), 'neck')
bone('tail1', (0, 0.12, 0.27), (0, 0.29, 0.20), 'hips')
bone('tail2', (0, 0.29, 0.20), (0, 0.47, 0.13), 'tail1')
LEGS = {}
for s, side in ((1, 'L'), (-1, 'R')):
    hip = Vector((s * 0.075, -0.12, 0.30))
    knee = Vector((side_x(-0.18, 0.15, s), -0.175, 0.16))
    ankle = Vector((side_x(-0.235, 0.05, s), -0.235, 0.035))
    toe = Vector((ankle.x, -0.31, 0.012))
    bone(f'thigh.{side}', hip, knee, 'hips')
    bone(f'shank.{side}', knee, ankle, f'thigh.{side}')
    bone(f'toes.{side}', ankle, toe, f'shank.{side}')
    bone(f'ik.{side}', ankle, ankle + Vector((0, 0.03, 0)), 'root', deform=False)
    bone(f'pole.{side}', knee + Vector((0, -0.25, 0)), knee + Vector((0, -0.22, 0)), 'body', deform=False)
    LEGS[side] = dict(s=s, upper=f'thigh.{side}', lower=f'shank.{side}')
    # the wing's arm: shoulder → elbow → wrist → the hand's tip, along the spread wing
    A = Vector((s * 0.99, 0.12, 0.0)).normalized()
    Bv = (Vector((0, 1, 0)) - A * A.y).normalized()
    pts = [Vector((SHOULDER.x * s, SHOULDER.y, SHOULDER.z)) + (A * u + Bv * v) * WK for u, v in ARM]
    bone(f'shoulder.{side}', pts[0] - A * 0.05, pts[0], 'chest')
    bone(f'humerus.{side}', pts[0], pts[1], f'shoulder.{side}')
    bone(f'forearm.{side}', pts[1], pts[2], f'humerus.{side}')
    bone(f'hand.{side}', pts[2], pts[3], f'forearm.{side}')
rig = K.build_rig()
# the body: automatic weights from its own bones only (the wing bones are for the feathers)
WING_BONES = ('shoulder', 'humerus', 'forearm', 'hand')
for side in 'LR':
    for b in WING_BONES:
        rig.data.bones[f'{b}.{side}'].use_deform = False
K.auto_weights_proxy(body)
body.shape_key_add(name='Basis')
key = body.shape_key_add(name='WingsIn')
key.data.foreach_set('co', moved.astype(np.float32).ravel())
for side in 'LR':
    for b in WING_BONES:
        rig.data.bones[f'{b}.{side}'].use_deform = True
# the wings: their own groups
mod = wings.modifiers.new('Rig', 'ARMATURE')
mod.object = rig
wings.parent = rig
pbs = K.pbs
for side, L in LEGS.items():
    K.ik_leg(L['lower'], f'ik.{side}', f'pole.{side}')
for side, L in LEGS.items():
    K.fit_pole(L['lower'], (L['upper'], L['lower']))


# ------------------------------------------------------------------ poses
def legs(dy=0.0, dz=0.0, tuck=0.0):
    """Feet on the ground (offsets), or tucked back under the tail in flight (tuck 0…1)."""
    for side in 'LR':
        loc(f'ik.{side}', (0, dy + 0.20 * tuck, dz + 0.17 * tuck))
        rot_world(f'toes.{side}', ax=-1.0 * tuck)


def wings_at(open_, up=0.0, sweep=0.0, bend=0.0):
    """open_ 0 (hidden, folded back) … 1 (spread); up: raised (rad, + = tips up); sweep: tips back (rad)."""
    k = max(0.0, min(1.0, open_))
    for s, side in ((1, 'L'), (-1, 'R')):
        scale(f'shoulder.{side}', max(0.001, k))
        # folding: the wing turns back along the body as it shrinks
        rot_world(f'shoulder.{side}', ay=-s * up, az=s * (sweep + 1.3 * (1 - k)))
        rot_world(f'forearm.{side}', ay=s * bend)
        rot_world(f'hand.{side}', ay=s * bend * 1.3, az=s * 0.15 * (1 - k))


def idle(t, f):
    w = 2 * math.pi * t
    loc('body', (0, 0, 0.004 * math.sin(2 * w)))
    rot_world('chest', ax=-0.02 * math.sin(2 * w))
    rot_world('neck', az=0.35 * math.sin(w), ax=0.05 * math.sin(2 * w))
    rot_world('head', az=0.20 * math.sin(w - 0.5), ay=0.15 * math.sin(w))
    rot_world('tail1', ax=0.06 * math.sin(4 * w))
    legs()
    wings_at(0)


STEP = 0.074  # half a step: the foot on the ground goes back as fast as the pigeon walks (90 mm/s at 122 mm a unit)


def walk(t, f):
    """Two steps a cycle; the head pokes forward and holds still, the famous pigeon bob."""
    w = 2 * math.pi * t
    loc('body', (0, 0, 0.012 * abs(math.sin(w))))
    rot_world('hips', az=0.06 * math.sin(w))
    for i, side in enumerate('LR'):
        ph = (t + 0.5 * i) % 1.0
        if ph < 0.5:  # on the ground, sliding back
            dy, dz = -STEP + 2 * STEP * ph / 0.5, 0.0
        else:
            u = (ph - 0.5) / 0.5
            dy, dz = STEP - 2 * STEP * (0.5 - 0.5 * math.cos(math.pi * u)), 0.045 * math.sin(math.pi * u)
        loc(f'ik.{side}', (0, dy, dz))
        rot_world(f'toes.{side}', ax=-0.6 * (dz / 0.045))
    # the bob: thrust forward quickly (first fifth of each step), then held while the body catches up
    p = (2 * t) % 1.0
    poke = math.sin(math.pi * min(1.0, p / 0.2)) if p < 0.2 else 0.0
    back = (p - 0.2) / 0.8 if p >= 0.2 else 0.0
    rot_world('neck', ax=0.30 * poke - 0.20 * back + 0.10)
    rot_world('head', ax=-0.30 * poke + 0.20 * back - 0.10)
    rot_world('tail1', ax=0.05 * math.sin(2 * w))
    wings_at(0)


def flapping(t, f):
    w = 2 * math.pi * t
    loc('body', (0, 0, -0.02 * math.sin(w)))
    rot_world('hips', ax=0.10)
    rot_world('neck', ax=-0.15)
    rot_world('head', ax=0.10)
    rot_world('tail1', ax=-0.10)
    legs(tuck=1)
    up = 0.55 * math.sin(w)  # down-stroke when the sine falls
    wings_at(1, up=up + 0.15, sweep=0.10 + 0.12 * math.cos(w), bend=-0.25 * math.cos(w))


def gliding(t, f):
    w = 2 * math.pi * t
    loc('body', (0, 0, 0.008 * math.sin(w)))
    rot_world('hips', ax=0.08 + 0.02 * math.sin(w), ay=0.04 * math.sin(w))
    rot_world('neck', ax=-0.12)
    rot_world('head', ax=0.08, az=0.10 * math.sin(w))
    rot_world('tail1', ax=-0.08 + 0.03 * math.sin(w))
    legs(tuck=1)
    wings_at(1, up=0.18 + 0.03 * math.sin(w), sweep=0.05)


def takeoff(t, f):
    """A crouch, a spring up, the wings opening into the first strokes (played once)."""
    crouch = math.sin(math.pi * min(1.0, t / 0.25)) if t < 0.25 else 0.0
    loc('body', (0, 0, -0.08 * crouch))
    rot_world('hips', ax=0.18 * crouch + 0.10 * K.smooth(0.25, 0.5, t))
    rot_world('neck', ax=0.25 * crouch - 0.15 * K.smooth(0.25, 0.5, t))
    legs(tuck=K.smooth(0.35, 0.8, t))
    k = K.smooth(0.15, 0.45, t)
    beat = max(0.0, t - 0.4) / 0.6 * 2.5 * 2 * math.pi
    up = 0.9 * (1 - K.smooth(0.3, 0.5, t)) + (0.55 * math.sin(beat) if t > 0.4 else 0.9)
    wings_at(k, up=up, sweep=0.1, bend=-0.2 * math.cos(beat))


def landing(t, f):
    """Touching down (played once): wings braking forward, legs reaching, then folding away."""
    flare = 1 - K.smooth(0.55, 0.85, t)
    rot_world('hips', ax=-0.20 * flare)
    rot_world('neck', ax=0.15 * flare)
    rot_world('tail1', ax=0.35 * flare)
    legs(dy=-0.06 * flare, tuck=0.0)
    k = 1 - K.smooth(0.6, 0.95, t)
    wings_at(k, up=0.75 * math.sin(math.pi * min(1.0, t / 0.5)) + 0.2, sweep=-0.35 * flare, bend=-0.2 * flare)


K.frames('idle', 120, idle)
K.frames('walk', 12, walk)
K.frames('takeoff', 24, takeoff)
K.frames('flapping', 10, flapping)
K.frames('gliding', 60, gliding)
K.frames('landing', 18, landing)
K.export(OUT, OUT_BLEND, extra=(wings,))
