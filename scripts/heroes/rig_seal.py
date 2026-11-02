"""
NerpaCad's seal (Tripo model): the back's coat repainted crisp, a skeleton, clips idle / walk / swim.

Run: python rig_seal.py -- <seal_src.glb> <out.glb> [<out.blend>]
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy  # noqa: E402

import rigkit as K  # noqa: E402
import seal_coat  # noqa: E402
from rigkit import bone, mirror, rot_world, loc, smooth  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = args[0], args[1]
OUT_BLEND = args[2] if len(args) > 2 else None
TRIS = int(os.environ.get('TRIS', 15000))

ob = K.load(SRC, turn=math.pi, name='Seal')  # the file looks along +Y: turned to look along −Y
seal_coat.repaint(ob, K.base_image(ob))
K.decimate(ob, TRIS)

# ------------------------------------------------------------------ skeleton (looks along −Y)
bone('root', (0, 0, 0), (0, 0.1, 0), deform=False)
bone('body', (0, 0.0, 0.14), (0, 0.06, 0.14), 'root', deform=False)
bone('hips', (0, 0.20, 0.11), (0, 0.05, 0.14), 'body')
bone('spine', (0, 0.05, 0.14), (0, -0.08, 0.16), 'hips')
bone('chest', (0, -0.08, 0.16), (0, -0.19, 0.20), 'spine')
bone('neck', (0, -0.19, 0.20), (0, -0.28, 0.30), 'chest')
bone('head', (0, -0.28, 0.30), (0, -0.47, 0.38), 'neck')
bone('tail1', (0, 0.20, 0.11), (0, 0.31, 0.09), 'hips')
bone('tail2', (0, 0.31, 0.09), (0, 0.40, 0.075), 'tail1')
mirror('fin', (0.02, 0.40, 0.075), (0.075, 0.50, 0.07), 'tail2')
mirror('flipper', (0.13, -0.17, 0.10), (0.22, -0.11, 0.06), 'chest')
mirror('flipper2', (0.22, -0.11, 0.06), (0.30, -0.03, 0.04), 'flipper.?')
K.build_rig()
K.auto_weights_proxy(ob)

SPINE = ['hips', 'spine', 'chest']


def idle(t, f):
    w = 2 * math.pi * t
    loc('body', (0, 0, 0.003 * math.sin(2 * w)))
    rot_world('chest', ax=-0.02 * math.sin(2 * w))
    rot_world('neck', az=0.30 * math.sin(w), ax=0.05 * math.sin(2 * w + 0.5))
    rot_world('head', az=0.12 * math.sin(w - 0.6), ay=0.10 * math.sin(w))
    rot_world('tail1', ax=-0.05 - 0.05 * math.sin(2 * w))
    rot_world('tail2', ax=-0.10 - 0.08 * math.sin(2 * w - 0.6))
    for s, side in ((1, 'L'), (-1, 'R')):
        rot_world(f'fin.{side}', az=s * 0.12 * math.sin(2 * w), ax=-0.1 * math.sin(2 * w - 1.0))
        rot_world(f'flipper.{side}', ay=s * 0.10 * math.sin(2 * w + s))


def walk(t, f):
    """The galumph: the chest lifts and the hind end comes after it, the flippers push."""
    w = 2 * math.pi * t
    a = math.sin(w)
    b = math.sin(w - 1.6)
    loc('body', (0, 0, 0.018 * max(0.0, a) - 0.004))
    # the wave runs from the chest to the tail: the chest's end up, then the hips' end
    rot_world('hips', ax=0.10 * b)
    rot_world('spine', ax=-0.10 * a - 0.04 * b)
    rot_world('chest', ax=-0.12 * a)
    rot_world('neck', ax=0.16 * a)
    rot_world('head', ax=0.05 * a)
    rot_world('tail1', ax=-0.18 * b - 0.05)
    rot_world('tail2', ax=-0.20 * math.sin(w - 2.4) - 0.08)
    for s, side in ((1, 'L'), (-1, 'R')):
        # the flippers swing back as the chest comes down on them, forward as it lifts
        rot_world(f'flipper.{side}', az=s * 0.35 * a, ax=0.25 * a)
        rot_world(f'flipper2.{side}', ax=0.20 * math.sin(w - 0.5))
        rot_world(f'fin.{side}', az=s * 0.10 * b)


def swim(t, f):
    """Swimming: the body sways side to side, the hind flippers sweep, the fore flippers held in."""
    w = 2 * math.pi * t
    for i, b in enumerate(['chest', 'spine', 'hips', 'tail1', 'tail2']):
        rot_world(b, az=(0.06 + 0.07 * i) * math.sin(w - 0.7 * i) * (1 if i < 2 else 1.2), ax=-0.03 * math.sin(2 * w - i))
    rot_world('neck', az=-0.10 * math.sin(w + 0.4))
    rot_world('head', ax=-0.10)
    for s, side in ((1, 'L'), (-1, 'R')):
        rot_world(f'flipper.{side}', az=s * 0.55, ay=s * 0.25 + 0.10 * math.sin(w))
        rot_world(f'fin.{side}', az=0.30 * math.sin(w - 3.2), ax=0.12 * math.sin(2 * w))


K.frames('idle', 120, idle)
K.frames('walk', 30, walk)
K.frames('swim', 48, swim)
K.export(OUT, OUT_BLEND)
