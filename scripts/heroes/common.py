"""
Shared tools for building NerpaCad's heroes in Blender from code (here: the feathers of the
pigeon's flying wings, and the bake of a model's 3D positions into its texture that seal_coat.py uses): lofted bodies, tubes along a
path, flattened blades; one smooth skin over them all; a texture painted from the skin's 3D
positions (baked to the UVs, then coloured in numpy).

Frame: metres, Z up, the hero looks along −Y (Blender's Front view), standing on z = 0.
"""
import math

import bpy  # first: bmesh and mathutils come with it
import bmesh
import numpy as np
from mathutils import Euler, Matrix, Vector

scene = None


def reset(fps=30):
    global scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = fps
    return scene


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


def select_only(ob):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def apply_mod(ob, kind, **kw):
    select_only(ob)
    m = ob.modifiers.new(kind.lower(), kind)
    for k, v in kw.items():
        setattr(m, k, v)
    bpy.ops.object.modifier_apply(modifier=m.name)


def mesh_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def catmull(points, t):
    n = len(points)
    i = min(n - 2, max(0, int(math.floor(t))))
    u = t - i
    p0 = points[max(0, i - 1)]
    p1, p2 = points[i], points[i + 1]
    p3 = points[min(n - 1, i + 2)]
    return [0.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3) for a, b, c, d in zip(p0, p1, p2, p3)]


def loft_y(name, profile, rings=64, seg=32, flat_bottom=3.0, round_top=2.2, floor=0.0015):
    """A body along −Y…+Y: profile rows (y, half width, height above centre, depth below, centre z)."""
    bm = bmesh.new()
    rows = []
    for r in range(rings + 1):
        y, w, up, down, zc = catmull(profile, r / rings * (len(profile) - 1))
        row = []
        for s in range(seg):
            a = 2 * math.pi * s / seg
            ca, sa = math.cos(a), math.sin(a)
            e = 2.0 / (flat_bottom if sa < 0 else round_top)
            x = w * math.copysign(abs(ca) ** e, ca)
            z = zc + (up if sa >= 0 else down) * math.copysign(abs(sa) ** e, sa)
            row.append(bm.verts.new((x, y, max(z, floor))))
        rows.append(row)
    for r in range(rings):
        for s in range(seg):
            bm.faces.new((rows[r][s], rows[r][(s + 1) % seg], rows[r + 1][(s + 1) % seg], rows[r + 1][s]))
    for row, rev in ((rows[0], True), (rows[-1], False)):
        c = bm.verts.new(sum((v.co for v in row), Vector()) / len(row))
        for s in range(seg):
            vs = (c, row[s], row[(s + 1) % seg])
            bm.faces.new(vs[::-1] if rev else vs)
    return mesh_obj(name, bm)


def tube(name, points, radii, steps=48, seg=16, squash=1.0):
    """A round tube along a smooth path through `points` (Catmull–Rom), radius from `radii` (one per point), capped round."""
    pts = [tuple(p) + (r,) for p, r in zip(points, radii)]
    path = [catmull(pts, i / steps * (len(pts) - 1)) for i in range(steps + 1)]
    bm = bmesh.new()
    rows = []
    prev_side = None
    for i, (x, y, z, r) in enumerate(path):
        p = Vector((x, y, z))
        a = Vector(path[min(i + 1, steps)][:3]) - Vector(path[max(i - 1, 0)][:3])
        a.normalize()
        ref = Vector((1, 0, 0)) if abs(a.x) < 0.9 else Vector((0, 1, 0))
        side = (a.cross(ref)).normalized() if prev_side is None else (prev_side - a * prev_side.dot(a)).normalized()
        prev_side = side
        up = a.cross(side).normalized()
        rows.append([bm.verts.new(p + (side * math.cos(2 * math.pi * k / seg) * squash + up * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
    for r0, r1 in zip(rows, rows[1:]):
        for k in range(seg):
            bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
    for row, i, rev in ((rows[0], 0, True), (rows[-1], steps, False)):
        end = Vector(path[i][:3])
        d = (Vector(path[1][:3]) - Vector(path[0][:3])) if rev else (Vector(path[-1][:3]) - Vector(path[-2][:3]))
        d.normalize()
        c = bm.verts.new(end + d * (path[i][3] * 0.6) * (-1 if rev else 1))
        for k in range(seg):
            vs = (c, row[k], row[(k + 1) % seg])
            bm.faces.new(vs[::-1] if rev else vs)
    return mesh_obj(name, bm)


def ellipsoid(name, center, radii, rot=(0, 0, 0), seg=(32, 16)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
    bmesh.ops.scale(bm, vec=Vector(radii), verts=bm.verts)
    bmesh.ops.rotate(bm, cent=Vector(), matrix=Euler(rot).to_matrix(), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    return mesh_obj(name, bm)


def blade(name, root, tip, width, thick, taper=0.55, up_hint=(0, 0, 1), bend=0.0, seg=(32, 16)):
    """A flattened rounded blade from root to tip, narrower toward the tip; `bend` curls it along `up`."""
    root, tip = Vector(root), Vector(tip)
    d = tip - root
    length = d.length
    d.normalize()
    side = d.cross(Vector(up_hint))
    if side.length < 1e-6:
        side = Vector((1, 0, 0))
    side.normalize()
    up = side.cross(d).normalized()
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=1.0)
    for v in bm.verts:
        a, b, c = v.co
        t = (a + 1) / 2
        k = 1 - taper * t ** 1.5
        v.co = root + d * (t * length) + side * (b * width * k) + up * (c * thick * (1 - 0.4 * t) + bend * length * t * t)
    return mesh_obj(name, bm)


def join(objs, name):
    select_only(objs[0])
    for o in objs[1:]:
        o.select_set(True)
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


def skin(parts, name, voxel, smooth=(0.6, 6), tris=4000):
    """One closed smooth skin over overlapping parts: voxel remesh, smoothing, decimation."""
    ob = join(parts, name)
    apply_mod(ob, 'REMESH', mode='VOXEL', voxel_size=voxel)
    if smooth:
        apply_mod(ob, 'SMOOTH', factor=smooth[0], iterations=smooth[1])
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    apply_mod(ob, 'DECIMATE', decimate_type='COLLAPSE', ratio=min(1.0, tris / n), use_symmetry=True, symmetry_axis='X')
    apply_mod(ob, 'TRIANGULATE')
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


def srgb(h):
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def material(name, color, rough=0.75, emit=None, image=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*srgb(color), 1) if isinstance(color, str) else (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = 0.0
    if emit:
        b.inputs['Emission Color'].default_value = (*srgb(emit), 1)
        b.inputs['Emission Strength'].default_value = 1.0
    if image is not None:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    return m


def sphere_part(name, center, r, mat, seg=(16, 10), scale=(1, 1, 1), rot=None):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg[0], v_segments=seg[1], radius=r)
    bmesh.ops.scale(bm, vec=Vector(scale), verts=bm.verts)
    if rot is not None:
        bmesh.ops.rotate(bm, cent=Vector(), matrix=rot, verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector(center), verts=bm.verts)
    ob = mesh_obj(name, bm)
    for p in ob.data.polygons:
        p.use_smooth = True
    ob.data.materials.append(mat)
    return ob


# ------------------------------------------------------------------ painting


def unwrap(ob, margin=0.012):
    select_only(ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin)
    bpy.ops.object.mode_set(mode='OBJECT')


def bake_positions(ob, size):
    """Per texel: the skin's object-space position and normal (and which texels are covered)."""
    lo = Vector([min(v.co[i] for v in ob.data.vertices) for i in range(3)]) - Vector((0.01,) * 3)
    hi = Vector([max(v.co[i] for v in ob.data.vertices) for i in range(3)]) + Vector((0.01,) * 3)
    span = hi - lo
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 1
    sc.render.bake.margin = 0
    sc.render.bake.use_clear = False
    saved = list(ob.data.materials)
    out = {}
    for what in ('pos', 'nor'):
        m = bpy.data.materials.new('bake_' + what)
        m.use_nodes = True
        nt = m.node_tree
        for n in list(nt.nodes):
            nt.nodes.remove(n)
        o = nt.nodes.new('ShaderNodeOutputMaterial')
        em = nt.nodes.new('ShaderNodeEmission')
        tc = nt.nodes.new('ShaderNodeTexCoord')
        if what == 'pos':
            mp = nt.nodes.new('ShaderNodeMapping')
            mp.vector_type = 'TEXTURE'  # the inverse mapping: (v − location) / scale
            mp.inputs['Location'].default_value = lo
            mp.inputs['Scale'].default_value = span
            nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
            nt.links.new(mp.outputs['Vector'], em.inputs['Color'])
        else:
            vm = nt.nodes.new('ShaderNodeVectorMath')
            vm.operation = 'MULTIPLY_ADD'
            vm.inputs[1].default_value = (0.5, 0.5, 0.5)
            vm.inputs[2].default_value = (0.5, 0.5, 0.5)
            nt.links.new(tc.outputs['Normal'], vm.inputs[0])
            nt.links.new(vm.outputs['Vector'], em.inputs['Color'])
        nt.links.new(em.outputs[0], o.inputs[0])
        img = bpy.data.images.new('bake_' + what, size, size, float_buffer=True, alpha=True)
        # a sentinel where nothing is baked (the bake writes alpha 1 everywhere)
        img.pixels[:] = np.full(size * size * 4, -1.0, dtype=np.float32)
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        nt.nodes.active = t
        ob.data.materials.clear()
        ob.data.materials.append(m)
        select_only(ob)
        bpy.ops.object.bake(type='EMIT', margin=0)
        a = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
        out[what] = a
    ob.data.materials.clear()
    for m in saved:
        ob.data.materials.append(m)
    # texels on an island's edge are only partly covered: their colour is premultiplied by the coverage
    covered = out['pos'][..., 0] > -0.5
    print('bake coverage', float(covered.mean()))
    pos = out['pos'][..., :3] * np.array(span) + np.array(lo)
    nor = out['nor'][..., :3] * 2 - 1
    return pos, nor, covered


def dilate(rgb, covered, steps=8):
    """Grow the painted islands outward so seams do not show the empty background."""
    rgb = rgb.copy()
    cov = covered.copy()
    for _ in range(steps):
        acc = np.zeros_like(rgb)
        cnt = np.zeros(cov.shape, dtype=np.float32)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            sh = np.roll(np.roll(cov, dy, 0), dx, 1)
            acc += np.roll(np.roll(rgb, dy, 0), dx, 1) * sh[..., None]
            cnt += sh
        grow = (~cov) & (cnt > 0)
        rgb[grow] = acc[grow] / cnt[grow][:, None]
        cov = cov | grow
    # what is still empty: the average colour, so far-off mip levels do not bleed a stray colour
    rgb[~cov] = rgb[covered].mean(axis=0)
    return rgb


def to_image(name, rgb, path):
    size = rgb.shape[0]
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = np.ones((size, size, 4), dtype=np.float32)
    px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels[:] = px.ravel()
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def hex_lin(h):
    """A colour as stored in a texture (sRGB values, 0…1)."""
    return np.array([int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)], dtype=np.float32)


def cells(p, cell, seed=0):
    """Distance to the nearest jittered feature point of a 3D grid (Worley F1), and that point's id hash."""
    q = p / cell
    base = np.floor(q)
    best = np.full(p.shape[:-1], 9.0, dtype=np.float32)
    best_h = np.zeros(p.shape[:-1], dtype=np.float32)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                g = base + np.array((dx, dy, dz))
                h = np.sin(g @ np.array((127.1, 311.7, 74.7)) + seed * 13.1) * 43758.5453
                h2 = np.sin(g @ np.array((269.5, 183.3, 246.1)) + seed * 7.3) * 43758.5453
                h3 = np.sin(g @ np.array((113.5, 271.9, 124.6)) + seed * 3.7) * 43758.5453
                j = np.stack((h - np.floor(h), h2 - np.floor(h2), h3 - np.floor(h3)), -1)
                f = g + 0.15 + 0.7 * j
                d = np.linalg.norm(f - q, axis=-1)
                take = d < best
                best = np.where(take, d, best)
                best_h = np.where(take, j[..., 0], best_h)
    return best, best_h


def seg_dist(p, a, b):
    a, b = np.array(a), np.array(b)
    ab = b - a
    t = np.clip(((p - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(p - (a + t[..., None] * ab), axis=-1), t


def smoothstep(e0, e1, x):
    u = np.clip((x - e0) / (e1 - e0), 0, 1)
    return u * u * (3 - 2 * u)


# ------------------------------------------------------------------ implicit bodies (smooth blends)


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def sd_ellipsoid(c, r, rot=(0, 0, 0)):
    c = np.array(c, np.float32)
    r = np.array(r, np.float32)
    R = np.array(Euler(rot).to_matrix(), np.float32)

    def f(P):
        q = (P - c) @ R
        k0 = np.linalg.norm(q / r, axis=-1)
        k1 = np.maximum(np.linalg.norm(q / (r * r), axis=-1), 1e-9)
        return k0 * (k0 - 1) / k1
    rad = float(r.max())
    return f, c - rad, c + rad


def _round_cone(P, a, b, r1, r2):
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pa = P - a
    y = pa @ ba
    z = y - l2
    q = pa * l2 - y[..., None] * ba
    x2 = (q * q).sum(-1)
    y2 = y * y * l2
    z2 = z * z * l2
    k = np.sign(rr) * rr * rr * x2
    d1 = np.sqrt(x2 + z2) * il2 - r2
    d2 = np.sqrt(x2 + y2) * il2 - r1
    d3 = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d1, np.where(np.sign(y) * a2 * y2 < k, d2, d3))


def sd_chain(points, radii, k=0.0):
    """Round cones through the points (a limb, a neck, a tail), joined smoothly."""
    pts = [np.array(p, np.float32) for p in points]

    def f(P):
        d = None
        for a, b, r1, r2 in zip(pts, pts[1:], radii, radii[1:]):
            e = _round_cone(P, a, b, r1, r2)
            d = e if d is None else smin(d, e, k)
        return d
    m = max(radii)
    lo = np.min(pts, axis=0) - m
    hi = np.max(pts, axis=0) + m
    return f, lo, hi


class Field:
    """A signed distance field on a grid symmetric about x = 0; shapes are blended in one at a time."""

    def __init__(self, lo, hi, voxel):
        n = np.ceil((np.array(hi) - np.array(lo)) / voxel).astype(int) + 1
        nx = int(np.ceil(max(abs(lo[0]), abs(hi[0])) / voxel)) * 2 + 1
        n[0] = nx
        self.lo = np.array((-(nx - 1) / 2 * voxel, lo[1], lo[2]), np.float32)
        self.v = voxel
        self.n = n
        self.d = np.full(tuple(n), 1.0, np.float32)

    def _sub(self, blo, bhi):
        i0 = np.clip(np.floor((blo - self.lo) / self.v).astype(int), 0, self.n)
        i1 = np.clip(np.ceil((bhi - self.lo) / self.v).astype(int) + 1, 0, self.n)
        sl = tuple(slice(int(a), int(b)) for a, b in zip(i0, i1))
        ax = [self.lo[k] + np.arange(i0[k], i1[k], dtype=np.float32) * self.v for k in range(3)]
        P = np.stack(np.meshgrid(*ax, indexing='ij'), -1)
        return sl, P

    def add(self, shape, k=0.0, op='union'):
        f, lo, hi = shape
        m = 3.0 * abs(k) + 0.012
        sl, P = self._sub(np.array(lo) - m, np.array(hi) + m)
        if P.size == 0:
            return
        d = f(P).astype(np.float32)
        if op == 'union':
            self.d[sl] = smin(self.d[sl], d, k)
        else:  # carve
            self.d[sl] = smax(self.d[sl], -d, k)

    def sample(self, P):
        """The field at points (nearest voxel)."""
        i = np.clip(np.round((P - self.lo) / self.v).astype(int), 0, self.n - 1)
        return self.d[i[..., 0], i[..., 1], i[..., 2]]

    def mesh(self, name, field=None):
        from skimage.measure import marching_cubes
        d = self.d if field is None else field
        verts, faces, _, _ = marching_cubes(d, level=0.0, spacing=(self.v,) * 3)
        verts = verts + self.lo
        # outward faces: the volume must come out positive
        tri = verts[faces]
        vol = np.einsum('ij,ij->i', tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6
        if vol < 0:
            faces = faces[:, ::-1]
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(map(float, v)) for v in verts], [], [tuple(map(int, f)) for f in faces])
        me.update()
        return link(bpy.data.objects.new(name, me))


def finish(ob, smooth=(0.5, 4), tris=20000):
    """A marching-cubes skin made light and smooth: relaxed, decimated symmetrically, triangulated."""
    if smooth:
        apply_mod(ob, 'SMOOTH', factor=smooth[0], iterations=smooth[1])
    n = len(ob.data.polygons)
    if tris and n > tris:
        apply_mod(ob, 'DECIMATE', decimate_type='COLLAPSE', ratio=tris / n, use_symmetry=True, symmetry_axis='X')
    apply_mod(ob, 'TRIANGULATE')
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob
