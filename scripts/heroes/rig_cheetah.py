"""
NerpaCad's cheetah Читик (Tripo model): skeleton, automatic weights, clips idle, walk, run, leap,
fall, crouch, crawl. Legs are driven by IK to foot targets (feet stay planted); the exporter
samples the result.

Run: python rig_cheetah.py -- <cheetah_src.glb> <out.glb> [<out.blend>]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import rigkit as K  # noqa: E402
from rigkit import B, bone, rot_world, loc, reset_pose, new_action  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
OUT_BLEND = args[2] if len(args) > 2 else None
TRIS = int(os.environ.get('TRIS', 15000))

mesh = K.load(SRC, name='Cheetah')
co = K.coords(mesh)
K.decimate(mesh, TRIS)
scene = K.scene


def leg_x(y, z, s, dy=0.035, dz=0.02):
    m = (np.abs(co[:, 1] - y) < dy) & (np.abs(co[:, 2] - z) < dz) & (co[:, 0] * s > 0.01)
    return float(np.mean(co[m, 0])) if m.any() else s * 0.065


# ------------------------------------------------------------------ skeleton (metres; looks along −Y)
bone('root', (0, 0, 0), (0, 0.1, 0), deform=False)
bone('body', (0, 0.0, 0.44), (0, 0.06, 0.44), 'root', deform=False)
bone('pelvis', (0, 0.20, 0.44), (0, 0.08, 0.46), 'body')
bone('spine1', (0, 0.08, 0.46), (0, -0.05, 0.47), 'pelvis')
bone('spine2', (0, -0.05, 0.47), (0, -0.17, 0.47), 'spine1')
bone('chest', (0, -0.17, 0.47), (0, -0.24, 0.46), 'spine2')
bone('neck1', (0, -0.24, 0.46), (0, -0.31, 0.52), 'chest')
bone('neck2', (0, -0.31, 0.52), (0, -0.36, 0.56), 'neck1')
bone('head', (0, -0.36, 0.56), (0, -0.50, 0.55), 'neck2')
TAIL = [(0.27, 0.45), (0.31, 0.38), (0.335, 0.30), (0.355, 0.22), (0.38, 0.15), (0.43, 0.11), (0.49, 0.11)]
for i in range(len(TAIL) - 1):
    bone(f'tail{i + 1}', (0, *TAIL[i]), (0, *TAIL[i + 1]), 'pelvis' if i == 0 else f'tail{i}')
LEGS = {}
for s, side in ((1, 'L'), (-1, 'R')):
    # front: shoulder blade, upper arm, forearm, hand, toes
    j = {'scap': (-0.19, 0.49), 'sh': (-0.25, 0.35), 'el': (-0.21, 0.27), 'wr': (-0.235, 0.075), 'ball': (-0.255, 0.025), 'toe': (-0.285, 0.012)}
    P = {k: Vector((leg_x(y, z, s) if z < 0.33 else s * 0.07, y, z)) for k, (y, z) in j.items()}
    bone(f'scapula.{side}', P['scap'], P['sh'], 'chest')
    bone(f'upperarm.{side}', P['sh'], P['el'], f'scapula.{side}')
    bone(f'forearm.{side}', P['el'], P['wr'], f'upperarm.{side}')
    bone(f'hand.{side}', P['wr'], P['ball'], f'forearm.{side}')
    bone(f'fingers.{side}', P['ball'], P['toe'], f'hand.{side}')
    LEGS[f'F{side}'] = dict(s=s, upper=f'upperarm.{side}', lower=f'forearm.{side}', foot=f'hand.{side}', ball=P['ball'], joint=P['wr'], knee_dir=1)
    # hind: thigh, shin, foot, toes
    j = {'hip': (0.20, 0.41), 'kn': (0.14, 0.27), 'hock': (0.265, 0.14), 'ball': (0.225, 0.025), 'toe': (0.185, 0.012)}
    P = {k: Vector((leg_x(y, z, s) if z < 0.33 else s * 0.075, y, z)) for k, (y, z) in j.items()}
    bone(f'thigh.{side}', P['hip'], P['kn'], 'pelvis')
    bone(f'shin.{side}', P['kn'], P['hock'], f'thigh.{side}')
    bone(f'foot.{side}', P['hock'], P['ball'], f'shin.{side}')
    bone(f'toes.{side}', P['ball'], P['toe'], f'foot.{side}')
    LEGS[f'H{side}'] = dict(s=s, upper=f'thigh.{side}', lower=f'shin.{side}', foot=f'foot.{side}', ball=P['ball'], joint=P['hock'], knee_dir=-1)
for k, L in LEGS.items():
    # IK targets (axes = world axes): one at the ball of the foot, one at the ankle riding on it; a pole for the knee
    bone(f'ik.{k}', L['ball'], L['ball'] + Vector((0, 0.03, 0)), 'root', deform=False)
    bone(f'ikj.{k}', L['joint'], L['joint'] + Vector((0, 0.03, 0)), f'ik.{k}', deform=False)
    knee = B[L['upper']][1]
    bone(f'pole.{k}', knee + Vector((0, L['knee_dir'] * 0.25, 0)), knee + Vector((0, L['knee_dir'] * 0.25 + 0.03, 0)), 'body', deform=False)

rig = K.build_rig()
K.auto_weights(mesh)
pbs = K.pbs
for k, L in LEGS.items():
    K.ik_leg(L['lower'], f'ikj.{k}', f'pole.{k}')
    K.damped(L['foot'], f'ik.{k}')
for k, L in LEGS.items():
    K.fit_pole(L['lower'], (L['upper'], L['lower']))

# ------------------------------------------------------------------ clips
def foot_cycle(p, stance, stride, lift):
    """Offset of a foot over one cycle (in place): on the ground it slides back, in the air it swings forward."""
    p %= 1.0
    if p < stance:
        u = p / stance
        return Vector((0, -stride / 2 + stride * u, 0))
    u = (p - stance) / (1 - stance)
    e = 0.5 - 0.5 * math.cos(math.pi * u)
    return Vector((0, stride / 2 - stride * e, lift * math.sin(math.pi * u)))


SPINE = ['pelvis', 'spine1', 'spine2', 'chest']
TAILB = [f'tail{i}' for i in range(1, len(TAIL))]


CROUCH = 0.16  # how much lower the body is crouched, m (the model is 0.68 tall)


def crouched(k, w=0.0):
    """The low pose, k = 0…1: body down (the IK feet stay put), head forward, the tail straight back."""
    loc('body', (0, 0, -CROUCH * k + 0.003 * math.sin(2 * w)))
    rot_world('neck1', ax=0.30 * k)
    rot_world('head', ax=-0.25 * k)
    for i, b in enumerate(TAILB):
        rot_world(b, ax=(0.45 if i == 0 else 0.22) * k, az=0.05 * math.sin(w - 0.5 * i))


def gait(name, frames, phases, stance, stride, lift, bob, flex, head_bob, tail_amp, low=0.0):
    new_action(name, frames)
    for f in range(frames + 1):
        scene.frame_set(f)
        t = f / frames
        reset_pose()
        w = 2 * math.pi * t
        if low:
            crouched(low, w)
        loc('body', (0, 0, bob * math.cos(2 * w) - CROUCH * low))
        # the back arches (gathered) and stretches (extended): rotations add up along the chain
        fl = flex * math.cos(w)
        for b, kf in zip(SPINE, (-1.0, 0.5, 1.0, 0.5)):
            rot_world(b, ax=kf * fl)
        if not low:
            rot_world('neck1', ax=-fl - head_bob * math.sin(2 * w))
            rot_world('neck2', ax=0)
            rot_world('head', ax=head_bob * 0.6 * math.sin(2 * w))
            for i, b in enumerate(TAILB):
                rot_world(b, az=tail_amp * math.sin(w - 0.6 * i), ax=0.04 * math.sin(2 * w - 0.5 * i))
        for k, L in LEGS.items():
            off = foot_cycle(t + phases[k], stance, stride, lift)
            loc(f'ik.{k}', off)
            # toes curl a little while the foot is in the air
            ph = (t + phases[k]) % 1.0
            air = math.sin(math.pi * (ph - stance) / (1 - stance)) if ph >= stance else 0.0
            rot_world('fingers.' + k[1] if k[0] == 'F' else 'toes.' + k[1], ax=-0.5 * air)


def idle(frames=120):
    new_action('idle', frames)
    for f in range(frames + 1):
        scene.frame_set(f)
        t = f / frames
        w = 2 * math.pi * t
        reset_pose()
        loc('body', (0, 0, 0.004 * math.sin(2 * w)))
        rot_world('chest', ax=0.015 * math.sin(2 * w))
        rot_world('neck1', az=0.25 * math.sin(w), ax=0.04 * math.sin(2 * w))
        rot_world('head', az=0.15 * math.sin(w - 0.4), ay=0.08 * math.sin(w))
        for i, b in enumerate(TAILB):
            rot_world(b, az=0.12 * math.sin(w - 0.5 * i) * (0.4 + 0.15 * i))
        for k in LEGS:
            loc(f'ik.{k}', (0, 0, 0))


def mix(a, b, k):
    return {key: tuple(x + (y - x) * k for x, y in zip(a[key], b[key])) for key in a}


# key poses of a leap (the world carries the body along its arc): feet as (dy, dz), body (z, spine, neck, tail)
STAND = {'FL': (0, 0), 'FR': (0, 0), 'HL': (0, 0), 'HR': (0, 0), 'body': (0, 0, 0, 0)}
GATHER = {'FL': (0.02, 0), 'FR': (0.02, 0), 'HL': (-0.02, 0), 'HR': (-0.02, 0), 'body': (-0.07, 0.10, 0.15, 0.1)}
STRETCH = {'FL': (-0.16, 0.13), 'FR': (-0.13, 0.15), 'HL': (0.15, 0.12), 'HR': (0.17, 0.10), 'body': (0.0, -0.12, -0.10, 0.35)}
REACH = {'FL': (-0.06, 0.0), 'FR': (-0.04, 0.02), 'HL': (0.06, 0.12), 'HR': (0.08, 0.10), 'body': (-0.03, 0.06, 0.10, 0.2)}


def keyed(t, keys):
    for (t0, p0), (t1, p1) in zip(keys, keys[1:]):
        if t <= t1:
            return mix(p0, p1, K.smooth(t0, t1, t))
    return keys[-1][1]


def pose_from(p, w=0.0):
    z, spine, neck, tail = p['body']
    loc('body', (0, 0, z))
    for b, kf in zip(SPINE, (-1.0, 0.5, 1.0, 0.5)):
        rot_world(b, ax=kf * spine)
    rot_world('neck1', ax=neck - spine)
    for i, b in enumerate(TAILB):
        rot_world(b, ax=tail * (1.0 if i < 3 else 0.5), az=0.08 * math.sin(w - 0.6 * i))
    for k in LEGS:
        dy, dz = p[k]
        loc(f'ik.{k}', (0, dy, dz))


def leap(frames=17):
    keys = [(0.0, STAND), (0.18, GATHER), (0.32, STRETCH), (0.72, STRETCH), (0.9, REACH), (1.0, STAND)]
    new_action('leap', frames)
    for f in range(frames + 1):
        scene.frame_set(f)
        reset_pose()
        pose_from(keyed(f / frames, keys))


def fall(frames=24):
    new_action('fall', frames)
    for f in range(frames + 1):
        scene.frame_set(f)
        t = f / frames
        w = 2 * math.pi * t
        reset_pose()
        p = {'FL': (-0.07 + 0.02 * math.sin(w), 0.07), 'FR': (-0.06 - 0.02 * math.sin(w), 0.08),
             'HL': (0.04 + 0.02 * math.sin(w + 1), 0.09), 'HR': (0.05 - 0.02 * math.sin(w + 1), 0.08),
             'body': (0.0, -0.05, -0.15, 0.55)}
        pose_from(p, w)


def crouch(frames=60):
    new_action('crouch', frames)
    for f in range(frames + 1):
        scene.frame_set(f)
        reset_pose()
        crouched(1.0, 2 * math.pi * f / frames)
        for k in LEGS:
            loc(f'ik.{k}', (0, 0, 0))


WALK = {'HL': 0.0, 'FL': 0.25, 'HR': 0.5, 'FR': 0.75}
RUN = {'HL': 0.0, 'HR': 0.12, 'FL': 0.5, 'FR': 0.62}
idle()
# strides so that a foot on the ground goes back as fast as the hero goes forward in the app (no sliding):
# stride = speed × stance × period, the model fitted at 250 mm a unit (170 mm tall): walk 220, run 700, crawl 110 mm/s
gait('walk', 18, WALK, stance=0.60, stride=0.317, lift=0.05, bob=0.006, flex=0.03, head_bob=0.03, tail_amp=0.10)
gait('run', 12, RUN, stance=0.35, stride=0.392, lift=0.10, bob=0.025, flex=0.16, head_bob=0.05, tail_amp=0.12)
gait('crawl', 24, WALK, stance=0.66, stride=0.232, lift=0.03, bob=0.003, flex=0.02, head_bob=0.0, tail_amp=0.0, low=1.0)
leap()
fall()
crouch()
K.export(OUT, OUT_BLEND)
