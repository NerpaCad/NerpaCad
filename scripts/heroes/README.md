# Heroes: rigging and animation

The heroes' models (`src/renderer/assets/robots/seal.glb`, `cheetah.glb`, `pigeon.glb`) were made
with Tripo AI from NerpaCad's concept art and rigged and animated by these scripts, with Blender
as a Python module (`pip install bpy`, Blender 4.2 or newer; `pip install scikit-image` is not needed):

```
python rig_seal.py    -- seal_src.glb    seal.glb    [seal.blend]
python rig_cheetah.py -- cheetah_src.glb cheetah.glb [cheetah.blend]
python rig_pigeon.py  -- pigeon_src.glb  pigeon.glb  [pigeon.blend]
```

`*_src.glb` are the models as Tripo exported them (not kept in the repository). `TRIS=15000` (the
default) sets how many triangles the model keeps; `FLY_TEX=pigeon-fly.jpg` makes
`rig_pigeon.py` also write the pigeon's texture for flight (its folded wings painted over).

- `rigkit.py` — loading, decimation, bones, automatic weights (straight or through a closed
  stand-in), IK legs, keys in world axes, glTF export.
- `seal_coat.py` — repaints the seal's back, which came out blurred, with crisp spots.
- `common.py` — the feathers of the pigeon's flying wings and the bake of 3D positions into a texture.

Clips: seal — idle, walk, swim; cheetah — idle, walk, run, leap, fall, crouch, crawl; pigeon —
idle, walk, takeoff, flapping, gliding, landing (its flying wings are hidden on the ground; while
they are out the app presses the body's folded wings in with the shape key `WingsIn` and shows
`pigeon-fly.jpg`).

Walking and running strides match the heroes' speeds in the app, so feet on the ground do not slide:
stride = speed × the part of the cycle the foot is down × the cycle's length.
