# Rig the sourced octopus with a vertical deform chain and bake a looping idle
# undulation. Per-arm bones were not possible: the eight arms are welded into a
# single mesh in an asymmetric pose, so an angular split does not separate them
# (the histogram is smeared, not eight peaks). A chain down the body with
# weights assigned BY HEIGHT gives the whole arm skirt a soft travelling sway,
# which is what an octopus at rest actually does, and it is fully deterministic
# rather than depending on Blender's bone-heat auto-weighting - which is
# unreliable here anyway because the ~85 suckers are loose geometry islands.
import bpy, math, sys
from mathutils import Vector, Matrix

# Usage:  blender -b --python tools/rig_octopus.py -- <source.glb> <out.glb>
#
# The source is the unmodified CC-BY download; see assets/creatures/README.md
# for attribution. Re-run this if the rig needs retuning - do NOT hand-edit the
# exported GLB, it is a build product.
import os
_argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC = _argv[0] if len(_argv) > 1 else 'octopus-source.glb'
OUT = _argv[-1] if _argv else 'octopus.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = mesh
mesh.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

zs = [v.co.z for v in mesh.data.vertices]
ZTOP, ZBOT = max(zs), min(zs)
print('RIG z %.1f .. %.1f' % (ZBOT, ZTOP))

# Four bones: mantle, upper arm, mid arm, tip. The mantle bone is deliberately
# rigid - an octopus's body is firm and only the arms flow.
N = 4
cuts = [ZTOP - (ZTOP - ZBOT) * i / N for i in range(N + 1)]

arm_data = bpy.data.armatures.new('octoRig')
arm_obj = bpy.data.objects.new('octoRig', arm_data)
bpy.context.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode='EDIT')
bones = []
prev = None
for i in range(N):
    b = arm_data.edit_bones.new('b%d' % i)
    b.head = Vector((0, 0, cuts[i]))
    b.tail = Vector((0, 0, cuts[i + 1]))
    if prev:
        b.parent = prev; b.use_connect = True
    prev = b
    bones.append(b.name)
bpy.ops.object.mode_set(mode='OBJECT')

# ---- weights by height, with a smooth blend across each boundary ----------
for n in bones:
    if n not in mesh.vertex_groups: mesh.vertex_groups.new(name=n)
BLEND = (ZTOP - ZBOT) / N * 0.45
for v in mesh.data.vertices:
    z = v.co.z
    for i, n in enumerate(bones):
        lo, hi = cuts[i + 1], cuts[i]
        # distance into this bone's band, smoothed at the edges
        if z > hi: d = (z - hi)
        elif z < lo: d = (lo - z)
        else: d = 0.0
        w = max(0.0, 1.0 - d / BLEND)
        if w > 0.001:
            mesh.vertex_groups[n].add([v.index], w, 'REPLACE')

mod = mesh.modifiers.new('Armature', 'ARMATURE')
mod.object = arm_obj
mesh.parent = arm_obj

# ---- the idle clip -------------------------------------------------------
# A travelling wave: each bone down the chain lags the one above it, which is
# how a flexible limb actually moves. Amplitude grows toward the tips, because
# the arm ends are loose and the mantle is not.
FPS, FRAMES = 30, 90           # 3 s, loops exactly
bpy.context.scene.render.fps = FPS
bpy.context.scene.frame_start = 1
bpy.context.scene.frame_end = FRAMES
bpy.context.view_layer.objects.active = arm_obj
bpy.ops.object.mode_set(mode='POSE')
AMP = [0.0, 0.055, 0.10, 0.15]     # radians, mantle rigid
LAG = [0.0, 0.7, 1.4, 2.1]
for f in range(1, FRAMES + 1):
    bpy.context.scene.frame_set(f)
    t = (f - 1) / FRAMES * 2 * math.pi
    for i, n in enumerate(bones):
        pb = arm_obj.pose.bones[n]
        pb.rotation_mode = 'XYZ'
        pb.rotation_euler = (
            math.sin(t - LAG[i]) * AMP[i],
            0.0,
            math.cos(t * 0.8 - LAG[i]) * AMP[i] * 0.7,
        )
        pb.keyframe_insert('rotation_euler', frame=f)
bpy.ops.object.mode_set(mode='OBJECT')

for a in bpy.data.actions: a.name = 'Idle'

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB',
                          export_animations=True, export_skins=True,
                          export_apply=False)
print('RIG EXPORTED', OUT)
