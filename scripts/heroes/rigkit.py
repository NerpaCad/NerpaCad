"""
Shared tools for rigging and animating NerpaCad's heroes (models made in Tripo) in Blender from code.

Frame: metres, Z up, the hero looks along −Y, standing on z = 0. Exported glTF (+Y up) then looks
along +Z: the app turns it with makeBasis(Y, Z, X).
"""
import math

import bpy  # first: mathutils comes with it
import numpy as np
from mathutils import Matrix, Quaternion, Vector

scene = None
rig = None
mesh = None
pbs = None
B = {}


def load(src, turn=0.0, name='Hero'):
    """Import a Tripo glb: one mesh, its seams welded, turned `turn` radians about Z, transforms applied."""
    global scene, mesh
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = 30
    bpy.ops.import_scene.gltf(filepath=src)
    mesh = [o for o in scene.objects if o.type == 'MESH'][0]
    mesh.name = name
    # (the glTF importer leaves objects in quaternion mode: a turn in Euler angles would be ignored)
    mesh.rotation_mode = 'XYZ'
    mesh.rotation_euler.z += turn
    select(mesh)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0001)
    bpy.ops.object.mode_set(mode='OBJECT')
    return mesh


def select(*objs):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]


def decimate(ob, tris):
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if n <= tris:
        return
    select(ob)
    m = ob.modifiers.new('dec', 'DECIMATE')
    m.ratio = tris / n
    m.use_symmetry = True
    m.symmetry_axis = 'X'
    bpy.ops.object.modifier_apply(modifier=m.name)
    print('decimated', n, '->', sum(len(p.vertices) - 2 for p in ob.data.polygons))


def coords(ob=None):
    ob = ob or mesh
    co = np.empty(len(ob.data.vertices) * 3, np.float32)
    ob.data.vertices.foreach_get('co', co)
    return co.reshape(-1, 3)


def base_image(ob=None):
    ob = ob or mesh
    for m in ob.data.materials:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and 'basecolor' in n.image.name.lower():
                return n.image
    for m in ob.data.materials:
        for n in m.node_tree.nodes:
            if n.type == 'TEX_IMAGE' and n.image and n.outputs['Color'].links and n.outputs['Color'].links[0].to_socket.name == 'Base Color':
                return n.image
    return None


# ------------------------------------------------------------------ skeleton


def bone(name, h, t, parent=None, deform=True):
    B[name] = (Vector(h), Vector(t), parent, deform)


def mirror(name, h, t, parent=None, deform=True):
    """A bone on the left (+x) and its twin on the right; `parent` may end in '.?' (the same side)."""
    for s, side in ((1, 'L'), (-1, 'R')):
        hh = Vector((h[0] * s, h[1], h[2]))
        tt = Vector((t[0] * s, t[1], t[2]))
        p = parent.replace('?', side) if parent else None
        bone(f'{name}.{side}', hh, tt, p, deform)


def build_rig():
    global rig, pbs
    arm = bpy.data.armatures.new('Rig')
    rig = bpy.data.objects.new('Rig', arm)
    scene.collection.objects.link(rig)
    select(rig)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (h, t, parent, deform) in B.items():
        eb = arm.edit_bones.new(name)
        eb.head, eb.tail = h, t
        eb.roll = 0
        eb.use_deform = deform
    for name, (h, t, parent, deform) in B.items():
        if parent:
            eb = arm.edit_bones[name]
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = (B[parent][1] - h).length < 1e-6 and deform
    bpy.ops.object.mode_set(mode='OBJECT')
    pbs = rig.pose.bones
    for pb in pbs:
        pb.rotation_mode = 'QUATERNION'
    return rig


def auto_weights(ob=None):
    ob = ob or mesh
    select(rig)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    empty = [v.index for v in ob.data.vertices if not v.groups]
    print('vertices without weights', len(empty))
    return empty


def ik_leg(lower, target, pole, chain=2):
    c = pbs[lower].constraints.new('IK')
    c.target, c.subtarget = rig, target
    c.pole_target, c.pole_subtarget = rig, pole
    c.chain_count = chain
    return c


def damped(bone_name, target):
    t = pbs[bone_name].constraints.new('DAMPED_TRACK')
    t.target, t.subtarget = rig, target


def fit_pole(lower, bones):
    """The pole angle that keeps the rest pose where it is."""
    c = pbs[lower].constraints['IK']
    best = None
    for deg in range(-180, 180, 3):
        c.pole_angle = math.radians(deg)
        bpy.context.view_layer.update()
        e = sum((pbs[b].head - pbs[b].bone.head_local).length + (pbs[b].tail - pbs[b].bone.tail_local).length for b in bones)
        if best is None or e < best[1]:
            best = (deg, e)
    c.pole_angle = math.radians(best[0])
    print('pole', lower, best[0], round(best[1], 5))


# ------------------------------------------------------------------ keys


def rot_world(name, ax=0.0, ay=0.0, az=0.0):
    """A pose rotation given about the world axes (X: pitch, nose down positive; Z: turn left; Y: roll)."""
    pb = pbs[name]
    M = pb.bone.matrix_local.to_3x3()
    R = Matrix.Rotation(az, 3, 'Z') @ Matrix.Rotation(ay, 3, 'Y') @ Matrix.Rotation(ax, 3, 'X')
    pb.rotation_quaternion = (M.inverted() @ R @ M).to_quaternion()
    pb.keyframe_insert('rotation_quaternion')


def loc(name, v):
    """A pose offset in world axes (for bones whose axes are the world's: aimed along +Y, roll 0)."""
    pbs[name].location = Vector(v)
    pbs[name].keyframe_insert('location')


def loc_world(name, v):
    """A pose offset in world axes for any bone."""
    pb = pbs[name]
    M = pb.bone.matrix_local.to_3x3()
    pb.location = M.inverted() @ Vector(v)
    pb.keyframe_insert('location')


def scale(name, s):
    pbs[name].scale = (s, s, s)
    pbs[name].keyframe_insert('scale')


def reset_pose():
    for pb in pbs:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = Quaternion()
        pb.scale = (1, 1, 1)


def new_action(name, frames):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    rig.animation_data_create()
    rig.animation_data.action = act
    scene.frame_start = 0
    scene.frame_end = frames
    return act


def frames(name, n, fn):
    """Key a clip of n frames (n + 1 keys, the last equal to the first for a loop): fn(t in 0…1, frame)."""
    new_action(name, n)
    for f in range(n + 1):
        scene.frame_set(f)
        reset_pose()
        fn(f / n, f)


def smooth(e0, e1, x):
    u = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return u * u * (3 - 2 * u)


def export(path, blend=None, extra=()):
    rig.animation_data.action = bpy.data.actions['idle']
    scene.frame_set(0)
    select(rig, mesh, *extra)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
                              export_def_bones=True, export_optimize_animation_size=False,
                              export_image_format='JPEG', export_jpeg_quality=88)
    if blend:
        bpy.ops.wm.save_as_mainfile(filepath=blend)
    print('exported', path)


def auto_weights_proxy(ob=None, voxel=0.006):
    """Automatic weights through a closed stand-in: a voxel remesh of the model gets the bone-heat
    weights (which fail on models made of overlapping shells), then they are copied over to the model
    from the nearest point of the stand-in."""
    ob = ob or mesh
    proxy = ob.copy()
    proxy.data = ob.data.copy()
    proxy.name = ob.name + '_proxy'
    scene.collection.objects.link(proxy)
    proxy.vertex_groups.clear()
    select(proxy)
    m = proxy.modifiers.new('remesh', 'REMESH')
    m.mode = 'VOXEL'
    m.voxel_size = voxel
    bpy.ops.object.modifier_apply(modifier=m.name)
    select(rig)
    proxy.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    print('proxy without weights', sum(1 for v in proxy.data.vertices if not v.groups), 'of', len(proxy.data.vertices))
    ob.vertex_groups.clear()
    for g in proxy.vertex_groups:
        ob.vertex_groups.new(name=g.name)
    select(ob)
    dt = ob.modifiers.new('weights', 'DATA_TRANSFER')
    dt.object = proxy
    dt.use_vert_data = True
    dt.data_types_verts = {'VGROUP_WEIGHTS'}
    dt.vert_mapping = 'POLYINTERP_NEAREST'
    dt.layers_vgroup_select_src = 'ALL'
    dt.layers_vgroup_select_dst = 'NAME'
    bpy.ops.object.modifier_apply(modifier=dt.name)
    bpy.data.objects.remove(proxy)
    am = ob.modifiers.new('Rig', 'ARMATURE')
    am.object = rig
    ob.parent = rig
    empty = [v.index for v in ob.data.vertices if not v.groups]
    print('vertices without weights', len(empty))
    return empty
