"""CHUDAIL BUSTERS: after the crash, she drags you into the house (plays right after the intro's crash).

  E1  you lie in the snow, the wreck burning behind you; she steps over you and reaches down
  E2  your view as she drags you by the ankle through the snow towards the old house (her feet point backwards)
  E3  up the porch steps, the door swings open on darkness, she pulls you in

Build:   Blender -b --factory-startup --python blender/build_drag.py -- /path/drag.blend [--preview]
Render:  Blender -b /path/drag.blend -a          (PNG frames next to the .blend in drag_frames/)
Encode:  Blender -b --factory-startup --python blender/encode_intro.py -- /path/drag_frames public/video/drag.mp4
Uses public/models/hollow.glb (the game's Chudail body + rig, made by build_characters.py) and the Poly Haven
snow texture fetched by blender/fetch_assets.py. Timing is mirrored in public/intro.js (DRAG cues).
"""
import bpy, bmesh, math, os, random, sys
from mathutils import Vector, Matrix, Euler

random.seed(11)
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
HOLLOW = os.path.join(HERE, '..', 'public', 'models', 'hollow.glb')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/drag.blend'
PREVIEW = '--preview' in argv
FPS = 24
E1, E2, E3 = (1, 84), (85, 236), (237, 300)
F_END = 300
HOUSE_Y = 12.0  # the crash happened right by the old house

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.fps = FPS; sc.frame_start = 1; sc.frame_end = F_END
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
sc.render.resolution_percentage = 50 if PREVIEW else 100
sc.render.use_motion_blur = True; sc.render.motion_blur_shutter = 0.6
ee = sc.eevee
ee.taa_render_samples = 16 if PREVIEW else 48
ee.volumetric_end = 120.0; ee.volumetric_tile_size = '8'; ee.volumetric_samples = 64; ee.use_volumetric_shadows = False
for vt, look in (('AgX', 'AgX - Punchy'), ('AgX', 'None'), ('Filmic', 'None')):
    try:
        sc.view_settings.view_transform = vt; sc.view_settings.look = look; break
    except Exception:
        continue
sc.view_settings.exposure = 1.0


# ---------------------------------------------------------------- helpers
def mat(name, color=(0.5, 0.5, 0.5), rough=0.5, metal=0.0, emit=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    return m


def link(o):
    sc.collection.objects.link(o); return o


def from_bm(name, bm, material=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me))
    if material:
        o.data.materials.append(material)
    return o


def box(name, size, loc, material, rot=(0, 0, 0), bevel=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    o = from_bm(name, bm, material); o.location = loc; o.rotation_euler = rot
    if bevel:
        md = o.modifiers.new('bv', 'BEVEL'); md.width = bevel; md.segments = 2
    return o


def cyl(name, r1, r2, h, loc, material, rot=(0, 0, 0), seg=16):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r1, radius2=r2, depth=h)
    o = from_bm(name, bm, material); o.location = loc; o.rotation_euler = rot
    return o


def light(kind, name, loc, energy, color, size=0.2, rot=(0, 0, 0), spot=None):
    d = bpy.data.lights.new(name, kind); d.energy = energy; d.color = color; d.shadow_soft_size = size
    if spot:
        d.spot_size, d.spot_blend = spot
    o = link(bpy.data.objects.new(name, d)); o.location = loc; o.rotation_euler = rot
    return o


def pbr(m, folder, scale=0.3, tint=(1, 1, 1), bump=0.7):
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeTexCoord'); mp = nt.nodes.new('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs['Object'], mp.inputs['Vector'])
    def img(fn, color=True):
        p = os.path.join(ASSETS, folder, fn)
        if not os.path.exists(p):
            return None
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(p)
        if not color:
            t.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(mp.outputs['Vector'], t.inputs['Vector']); return t
    d, r, n = img('diff.jpg'), img('rough.jpg', False), img('nor.jpg', False)
    if d:
        mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
        mix.inputs[7].default_value = (*tint, 1); nt.links.new(d.outputs['Color'], mix.inputs[6]); nt.links.new(mix.outputs[2], b.inputs['Base Color'])
    if r:
        nt.links.new(r.outputs['Color'], b.inputs['Roughness'])
    if n:
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = bump
        nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])


def key_seq(obj, path, frames_values, interp='BEZIER'):
    for f, v in frames_values:
        setattr(obj, path, v); obj.keyframe_insert(path, frame=f)


# ---------------------------------------------------------------- world: night, cold fog
w = bpy.data.worlds.new('night'); sc.world = w; w.use_nodes = True
wn = w.node_tree.nodes
wn['Background'].inputs['Color'].default_value = (0.006, 0.009, 0.018, 1)
# fog as a big volume box (a world volume blacked out the whole scene in this file)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 15, 8)); fogbox = bpy.context.active_object; fogbox.name = 'fog'; fogbox.scale = (90, 110, 18)
fm = bpy.data.materials.new('fog'); fm.use_nodes = True; fnt = fm.node_tree; fnt.nodes.remove(fnt.nodes['Principled BSDF'])
pv = fnt.nodes.new('ShaderNodeVolumePrincipled'); pv.inputs['Density'].default_value = 0.014; pv.inputs['Anisotropy'].default_value = 0.4
pv.inputs['Color'].default_value = (0.78, 0.82, 0.9, 1)
fnt.links.new(pv.outputs[0], fnt.nodes['Material Output'].inputs['Volume']); fogbox.data.materials.append(fm)
moon = light('SUN', 'moon', (0, 0, 20), 1.0, (0.6, 0.7, 1.0), rot=(math.radians(55), 0, math.radians(200)))

# ---------------------------------------------------------------- ground: snow, the trench she drags you through
M_SNOW = mat('snow', (0.8, 0.84, 0.92), 0.7)
pbr(M_SNOW, 'snow_02', 0.35, (0.88, 0.92, 1.0), 0.9)
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=160, y_segments=200, size=1.0)
for v in bm.verts:
    x, y = v.co.x * 80, v.co.y * 100 + 10
    trench = -0.12 * math.exp(-(x * x) / 0.35) if -2 < y < HOUSE_Y - 4 else 0
    drift = 0.25 * math.sin(x * 0.4 + y * 0.13) * math.sin(y * 0.21) + 0.08 * math.sin(x * 2.1) * math.sin(y * 1.7)
    v.co = Vector((x, y, drift * min(1, abs(x) / 3) + trench))
ground = from_bm('ground', bm, M_SNOW)
for p in ground.data.polygons:
    p.use_smooth = True

# ---------------------------------------------------------------- the house: an old hill-station mansion
M_WALL = mat('wall', (0.06, 0.055, 0.05), 0.9)
M_TRIM = mat('trim', (0.16, 0.15, 0.13), 0.8)
M_ROOF = bpy.data.materials.new('roof'); M_ROOF.use_nodes = True
rn = M_ROOF.node_tree; rb = rn.nodes['Principled BSDF']
geo = rn.nodes.new('ShaderNodeNewGeometry'); sxyz = rn.nodes.new('ShaderNodeSeparateXYZ'); rn.links.new(geo.outputs['Normal'], sxyz.inputs[0])
mr = rn.nodes.new('ShaderNodeMapRange'); mr.inputs[1].default_value = 0.35; mr.inputs[2].default_value = 0.65; rn.links.new(sxyz.outputs['Z'], mr.inputs[0])
rm = rn.nodes.new('ShaderNodeMix'); rm.data_type = 'RGBA'; rm.inputs[6].default_value = (0.03, 0.03, 0.035, 1); rm.inputs[7].default_value = (0.72, 0.76, 0.84, 1)
rn.links.new(mr.outputs[0], rm.inputs[0]); rn.links.new(rm.outputs[2], rb.inputs['Base Color']); rb.inputs['Roughness'].default_value = 0.8
M_GLASS = mat('window', (0.01, 0.012, 0.015), 0.08)
M_LIT = mat('lit_window', (0.2, 0.1, 0.03), 0.4, emit=(1.0, 0.45, 0.12), strength=2.2)
M_DOOR = mat('door', (0.07, 0.035, 0.02), 0.6)
M_VOID = bpy.data.materials.new('void'); M_VOID.use_nodes = True  # pure black: reflects nothing
_vn = M_VOID.node_tree; _vn.nodes.remove(_vn.nodes['Principled BSDF'])
_em = _vn.nodes.new('ShaderNodeEmission'); _em.inputs['Color'].default_value = (0, 0, 0, 1); _em.inputs['Strength'].default_value = 0
_vn.links.new(_em.outputs[0], _vn.nodes['Material Output'].inputs['Surface'])
HW, HD, HH = 9.0, 5.5, 7.6  # half width, half depth, wall height
box('house_body', (HW * 2, HD * 2, HH), (0, HOUSE_Y + HD, HH / 2), M_WALL)
box('house_band', (HW * 2 + 0.2, HD * 2 + 0.2, 0.25), (0, HOUSE_Y + HD, HH / 2), M_TRIM)
# gabled roof: a long prism
bm = bmesh.new()
pts = [(-HW - 0.6, HOUSE_Y - 0.6, HH), (HW + 0.6, HOUSE_Y - 0.6, HH), (HW + 0.6, HOUSE_Y + HD * 2 + 0.6, HH),
       (-HW - 0.6, HOUSE_Y + HD * 2 + 0.6, HH), (-HW - 0.6, HOUSE_Y + HD, HH + 4.2), (HW + 0.6, HOUSE_Y + HD, HH + 4.2)]
vs = [bm.verts.new(p) for p in pts]
for f in ((0, 1, 5, 4), (3, 2, 5, 4), (0, 3, 4), (1, 2, 5), (0, 1, 2, 3)):
    bm.faces.new([vs[i] for i in f])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
from_bm('house_roof', bm, M_ROOF)
box('chimney', (1.0, 1.0, 3.2), (-5.5, HOUSE_Y + HD + 1.5, HH + 3.6), M_WALL)
# front gable over the porch
bm = bmesh.new()
gp = [(-2.8, HOUSE_Y - 2.6, HH * 0.52), (2.8, HOUSE_Y - 2.6, HH * 0.52), (0, HOUSE_Y - 2.6, HH * 0.52 + 1.6),
      (-2.8, HOUSE_Y, HH * 0.52), (2.8, HOUSE_Y, HH * 0.52), (0, HOUSE_Y, HH * 0.52 + 1.6)]
gv = [bm.verts.new(p) for p in gp]
for f in ((0, 1, 2), (3, 5, 4), (0, 2, 5, 3), (1, 4, 5, 2), (0, 3, 4, 1)):
    bm.faces.new([gv[i] for i in f])
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
from_bm('porch_roof', bm, M_ROOF)
for x in (-2.5, -0.9, 0.9, 2.5):
    cyl(f'column_{x}', 0.14, 0.12, HH * 0.52, (x, HOUSE_Y - 2.4, HH * 0.26), M_TRIM)
for k in range(4):  # steps up to the porch
    box(f'step_{k}', (3.4, 0.45, 0.2), (0, HOUSE_Y - 3.2 + k * 0.4 - 1.2, 0.1 + k * 0.2), M_TRIM)
box('porch_floor', (5.8, 2.6, 0.9), (0, HOUSE_Y - 1.3, 0.45), M_TRIM)
# windows: two rows; one upstairs is dimly lit
for row, z in enumerate((2.3, 5.6)):
    for x in (-7.2, -4.8, 4.8, 7.2) + ((-2.0, 2.0) if row else ()):
        lit = (row == 1 and x == 4.8)
        box(f'win_{row}_{x}', (1.1, 0.1, 1.7), (x, HOUSE_Y - 0.03, z), M_LIT if lit else M_GLASS)
        box(f'winframe_{row}_{x}', (1.35, 0.12, 0.12), (x, HOUSE_Y - 0.06, z - 0.92), M_TRIM)
light('POINT', 'window_glow', (4.8, HOUSE_Y + 0.6, 5.6), 160, (1.0, 0.5, 0.15), size=0.5)
# the door: swings open on nothing
box('doorframe', (2.0, 0.2, 2.9), (0, HOUSE_Y - 0.02, 1.35 + 0.9), M_TRIM)
box('doorway_void', (1.6, 3.0, 2.6), (0, HOUSE_Y + 1.4, 1.3 + 0.9), M_VOID)
hinge = link(bpy.data.objects.new('door_hinge', None)); hinge.location = (-0.78, HOUSE_Y - 0.1, 0.9)
door = box('door', (1.56, 0.08, 2.55), (0.78, 0, 1.275), M_DOOR, bevel=0.01); door.parent = hinge
for k in range(3):
    box(f'door_panel_{k}', (1.2, 0.03, 0.6), (0.78, -0.05, 0.5 + k * 0.8), M_TRIM).parent = hinge
key_seq(hinge, 'rotation_euler', [(1, Euler((0, 0, 0))), (246, Euler((0, 0, 0))), (262, Euler((0, 0, math.radians(-105))))])
porch_lamp = light('POINT', 'porch_lamp', (0, HOUSE_Y - 1.0, HH * 0.5), 90, (1.0, 0.6, 0.25), size=0.1)
for f in range(1, F_END + 1, 2):  # an old bulb, buzzing on and off
    porch_lamp.data.energy = 90 if random.random() < 0.7 else 5
    porch_lamp.data.keyframe_insert('energy', frame=f)

# ---------------------------------------------------------------- pines and the wreck behind you
M_PINE = mat('pine', (0.012, 0.025, 0.016), 0.9)
bm = bmesh.new()
for r, h, z in ((2.2, 3.2, 1.2), (1.7, 2.8, 2.8), (1.2, 2.4, 4.3), (0.7, 2.0, 5.7)):
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r, radius2=0.02, depth=h, matrix=Matrix.Translation((0, 0, z + h / 2)))
pine_me = bpy.data.meshes.new('pine'); bm.to_mesh(pine_me); bm.free(); pine_me.materials.append(M_PINE)
for k in range(140):
    x = random.choice((-1, 1)) * random.uniform(6, 45); y = random.uniform(-25, 70)
    if abs(x) < 12 and HOUSE_Y - 4 < y < HOUSE_Y + 14:
        continue
    o = link(bpy.data.objects.new(f'pine_{k}', pine_me)); o.location = (x, y, -0.1); s = random.uniform(0.8, 1.7); o.scale = (s, s, s * 1.1)
# the wreck: its headlights still on, burning
M_CAR = mat('wreck', (0.2, 0.02, 0.02), 0.4, 0.5)
wreck = box('wreck', (1.9, 4.5, 1.4), (1.5, -10, 0.55), M_CAR, rot=(0, math.radians(70), math.radians(25)), bevel=0.08)
light('SPOT', 'wreck_beam', (2.6, -8.4, 0.9), 900, (1.0, 0.95, 0.85), size=0.05, rot=(math.radians(80), 0, math.radians(-150)), spot=(math.radians(55), 0.4))
fire = light('POINT', 'fire', (1.2, -9.5, 1.2), 1500, (1.0, 0.42, 0.1), size=0.6)
for f in range(1, F_END + 1, 2):
    fire.data.energy = random.uniform(900, 2200); fire.data.keyframe_insert('energy', frame=f)

# ---------------------------------------------------------------- her: the game's Chudail body + rig, with head, hair and gown
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=HOLLOW)
new = [o for o in bpy.data.objects if o not in before]
rig = next(o for o in new if o.type == 'ARMATURE')
body = next(o for o in new if o.type == 'MESH')
M_SKIN = mat('her_skin', (0.7, 0.68, 0.64), 0.45)
M_SKIN.node_tree.nodes['Principled BSDF'].inputs['Subsurface Weight'].default_value = 0.15
body.data.materials.clear(); body.data.materials.append(M_SKIN)
rig.name = 'HER'
bpy.context.view_layer.update()
PB = rig.pose.bones
names = [b.name for b in PB]
print('BONES', names)


def bone_world(name, head=True):
    b = rig.data.bones[name]
    return rig.matrix_world @ (b.head_local if head else b.tail_local)


def attach(obj, bone):
    """Parent obj to a bone of her rig, keeping its current world transform."""
    mw = obj.matrix_world.copy()
    obj.parent = rig; obj.parent_type = 'BONE'; obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = mw


# head: long pale face, dark sunken eyes, a mouth that hangs open
hp = bone_world('head'); ht = bone_world('head', False)
hc = (hp + ht) / 2 + Vector((0, 0.02, 0.05))
bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=32, ring_count=20, location=hc)
head = bpy.context.active_object; head.name = 'her_head'; head.scale = (0.1, 0.115, 0.15)
bpy.ops.object.shade_smooth(); head.data.materials.append(M_SKIN)
M_EYE = mat('eye_hole', (0, 0, 0), 0.9)
M_GLINT = mat('glint', (1, 1, 1), 0.2, emit=(1.0, 0.95, 0.9), strength=6)
parts = [head]
for sx in (-1, 1):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.024, location=hc + Vector((sx * 0.04, 0.095, 0.025)))
    e = bpy.context.active_object; e.data.materials.append(M_EYE); e.scale = (1, 0.6, 1.3); parts.append(e)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.004, location=hc + Vector((sx * 0.04, 0.11, 0.028)))
    g = bpy.context.active_object; g.data.materials.append(M_GLINT); parts.append(g)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.03, location=hc + Vector((0, 0.1, -0.075)))
mo = bpy.context.active_object; mo.data.materials.append(M_EYE); mo.scale = (0.7, 0.5, 1.9); parts.append(mo)
# hair: a hundred long wet strands from the crown, down past her waist
M_HAIR = mat('hair', (0.006, 0.005, 0.004), 0.32)
for k in range(110):
    a = random.uniform(0, math.tau)
    if math.cos(a) > 0.75 and random.random() < 0.5:  # a few strands fall over the face, most go down the back
        continue
    r = 0.095
    start = hc + Vector((math.sin(a) * r, math.cos(a) * r * 0.9 - 0.01, 0.1 + random.uniform(-0.03, 0.03)))
    cd = bpy.data.curves.new(f'strand{k}', 'CURVE'); cd.dimensions = '3D'; cd.bevel_depth = random.uniform(0.004, 0.009); cd.bevel_resolution = 1
    sp = cd.splines.new('POLY'); n = 8; sp.points.add(n - 1)
    out = Vector((math.sin(a), math.cos(a) * 0.9, 0)) * random.uniform(0.02, 0.06)
    length = random.uniform(0.9, 1.35)
    for i in range(n):
        f = i / (n - 1)
        p = start + out * min(1, f * 4) + Vector((random.uniform(-0.03, 0.03), random.uniform(-0.03, 0.03) - 0.05 * f, -length * f))
        sp.points[i].co = (*p, 1)
        sp.points[i].radius = 1.0 - 0.6 * f
    o = link(bpy.data.objects.new(f'hair_{k}', cd)); o.data.materials.append(M_HAIR); parts.append(o)
for o in parts:
    attach(o, 'head')
# the torn white gown
M_GOWN = mat('gown', (0.55, 0.53, 0.48), 0.85)
M_GOWN.node_tree.nodes['Principled BSDF'].inputs['Subsurface Weight'].default_value = 0.1
bm = bmesh.new()
z0, z1 = bone_world('chest').z + 0.05, 0.42
rings = 14
for i in range(rings + 1):
    f = i / rings; z = z0 + (z1 - z0) * f; rr = 0.17 + 0.2 * f
    for j in range(24):
        a = j / 24 * math.tau
        jag = random.uniform(0, 0.28) if i == rings else 0
        bm.verts.new((math.sin(a) * rr * 1.1, math.cos(a) * rr * 0.85 + 0.08, z + jag + random.uniform(-0.01, 0.01)))
bm.verts.ensure_lookup_table()
for i in range(rings):
    for j in range(24):
        a, b = i * 24 + j, i * 24 + (j + 1) % 24
        if i == rings - 1 and random.random() < 0.25:
            continue  # torn away
        bm.faces.new((bm.verts[a], bm.verts[b], bm.verts[b + 24], bm.verts[a + 24]))
gown = from_bm('gown', bm, M_GOWN)
gown.location = (bone_world('hips').x, bone_world('hips').y, 0)
gown.modifiers.new('solid', 'SOLIDIFY').thickness = 0.008
for p in gown.data.polygons:
    p.use_smooth = True
attach(gown, 'spine')

# ---------------------------------------------------------------- your legs (E2: dragged by the right ankle)
M_JEANS = mat('jeans', (0.05, 0.08, 0.16), 0.75)
M_SHOE = mat('shoe', (0.02, 0.02, 0.02), 0.6)
legs = link(bpy.data.objects.new('your_legs', None))
for sx in (-1, 1):
    lg = cyl(f'leg_{sx}', 0.062, 0.048, 0.95, (sx * 0.11, 0.475, 0), M_JEANS, rot=(math.radians(-90), 0, 0))
    lg.parent = legs
    sh = box(f'shoe_{sx}', (0.1, 0.12, 0.26), (sx * 0.11, 1.0, 0.08), M_SHOE, bevel=0.02); sh.parent = legs

# ---------------------------------------------------------------- animation
def pose(frame, name, rx=0.0, ry=0.0, rz=0.0):
    if name not in PB:
        return
    b = PB[name]; b.rotation_mode = 'XYZ'; b.rotation_euler = (rx, ry, rz); b.keyframe_insert('rotation_euler', frame=frame)


def her_at(frame, loc, yaw):
    rig.location = loc; rig.rotation_euler = (0, 0, yaw)
    rig.keyframe_insert('location', frame=frame); rig.keyframe_insert('rotation_euler', frame=frame)


cam_d = bpy.data.cameras.new('cam'); cam_d.lens = 18; cam_d.clip_start = 0.02; cam_d.clip_end = 300
cam_d.dof.use_dof = True; cam_d.dof.aperture_fstop = 2.0
cam = link(bpy.data.objects.new('cam', cam_d)); sc.camera = cam
focus = link(bpy.data.objects.new('focus', None)); cam_d.dof.focus_object = focus
# the burning wreck behind you: a warm flickering glow that follows the camera (lights her, your legs)
glow = light('POINT', 'fire_fill', (0, 0, 0), 260, (1.0, 0.45, 0.15), size=0.8)
glow.parent = cam; glow.location = (0.4, 1.4, 2.2)
for f in range(1, F_END + 1, 2):
    glow.data.energy = random.uniform(170, 320) * (0.2 if f > 246 else 1); glow.data.keyframe_insert('energy', frame=f)

# E1: on your back in the snow, looking up; the wreck burns behind her as she walks out of its glow and leans over you
for f in range(E1[0], E1[1] + 1, 2):
    k = (f - E1[0]) / (E1[1] - E1[0])
    cam.location = (0.05 * math.sin(f * 0.13), -2.0, 0.22 + 0.01 * math.sin(f * 0.4))
    cam.rotation_euler = (math.radians(112 + 4 * math.sin(f * 0.05) + 6 * k), math.radians(3 * math.sin(f * 0.07)), math.radians(180))
    cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_euler', frame=f)
    walk = min(1, k * 1.5)
    her_at(f, (0.1, -8.0 + 4.3 * walk, 0), 0.0)  # facing you
    sw = math.sin(f * 0.3) * (1 - walk) * 0.5
    for s_, sfx in ((1, '_L'), (-1, '_R')):
        pose(f, 'thigh' + sfx, sw * s_, 0, 0)
        pose(f, 'shin' + sfx, -abs(sw) * 0.8, 0, 0)
        pose(f, 'foot' + sfx, 0, 0, math.pi)  # her feet point backwards
    lean = max(0, (k - 0.6) / 0.4)
    pose(f, 'spine', 0.45 * lean, 0, 0); pose(f, 'chest', 0.3 * lean, 0, 0)
    pose(f, 'neck', 0.3 + 0.35 * lean, 0, 0.08 * math.sin(f * 0.6))
    pose(f, 'head', 0.25, 0, 0.55 * lean)
    pose(f, 'upperarm_R', 0.9 * lean, 0, 0); pose(f, 'forearm_R', 0.3 * lean, 0, 0)
    pose(f, 'fingers_R', 0.5 + 0.3 * math.sin(f * 0.9), 0, 0)
    focus.location = (0.1, -8.0 + 4.6 * walk, 1.8 - 0.4 * lean); focus.keyframe_insert('location', frame=f)
legs.hide_render = True; legs.keyframe_insert('hide_render', frame=1)
legs.hide_render = False; legs.keyframe_insert('hide_render', frame=E2[0])

# E2 + E3: dragged on your back to the house; you look down your body at her, the house ahead
y0, y1 = -2.0, HOUSE_Y + 1.0  # ends inside the dark doorway
for f in range(E2[0], F_END + 1, 2):
    tt = (f - E2[0]) / FPS
    k = (f - E2[0]) / (F_END - E2[0])
    y = y0 + (y1 - y0) * k
    stepz = 0.0
    sy = HOUSE_Y - 4.4
    if y > sy:  # up the porch steps: thump, thump
        stepz = min(0.9, math.floor((y - sy) / 0.4 + 1) * 0.2) + 0.04 * math.sin(f * 2.1)
    bob = 0.025 * abs(math.sin(f * 0.42))
    near = min(1, max(0, (y - (sy - 1.6)) / 1.6))  # at the steps: lifted, looking up at the door
    cam.location = (0.03 * math.sin(f * 0.21), y, 0.26 + stepz + bob + 0.45 * near)
    cam.rotation_euler = (math.radians(88 + 7 * near + 2.5 * math.sin(f * 0.42)), math.radians(4 * math.sin(f * 0.19)), 0)
    cam.keyframe_insert('location', frame=f); cam.keyframe_insert('rotation_euler', frame=f)
    legs.location = (0, y + 0.95, 0.08 + stepz); legs.rotation_euler = (math.radians(22), 0, 0)  # ankles lifted to her hand
    legs.keyframe_insert('location', frame=f); legs.keyframe_insert('rotation_euler', frame=f)
    # she walks ahead, facing the house, one arm back gripping your ankle
    ph = tt * 4.6
    her_at(f, (0.12, y + 2.45, stepz), 0.0)
    for s_, sfx in ((1, '_L'), (-1, '_R')):
        a = math.sin(ph + (0 if s_ > 0 else math.pi))
        pose(f, 'thigh' + sfx, 0.45 * a, 0, 0)
        pose(f, 'shin' + sfx, -0.6 * max(0, -a), 0, 0)
        pose(f, 'foot' + sfx, 0, 0, math.pi)
    pose(f, 'spine', 0.18, 0, 0.05 * math.sin(ph)); pose(f, 'chest', 0.08, 0, 0)
    pose(f, 'neck', 0.25, 0, 0); pose(f, 'head', 0.1, 0.25 * math.sin(tt * 0.9), 0.35)
    pose(f, 'upperarm_R', -0.75, 0, -0.2); pose(f, 'forearm_R', -0.15, 0, 0); pose(f, 'fingers_R', 0.9, 0, 0)
    pose(f, 'upperarm_L', -0.1 + 0.15 * math.sin(ph), 0, 0); pose(f, 'forearm_L', -0.2, 0, 0)
    focus.location = (0.2, y + 2.4, 1.1); focus.keyframe_insert('location', frame=f)

# ---------------------------------------------------------------- snow falling (no simulation: a pure function of time)
fl_bm = bmesh.new(); bmesh.ops.create_icosphere(fl_bm, subdivisions=1, radius=0.018)
flake = from_bm('flake', fl_bm, mat('flake', (0.95, 0.97, 1.0), 0.6, emit=(0.8, 0.86, 1.0), strength=0.12)); flake.hide_render = True
g = bpy.data.node_groups.new('snowfall', 'GeometryNodeTree')
g.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
g.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
N, L = g.nodes, g.links
gout = N.new('NodeGroupOutput'); N.new('NodeGroupInput')
pts = N.new('GeometryNodePoints'); pts.inputs['Count'].default_value = 30000 if PREVIEW else 70000
rv = N.new('FunctionNodeRandomValue'); rv.data_type = 'FLOAT_VECTOR'
vmin = [s for s in rv.inputs if s.name == 'Min' and s.type == 'VECTOR'][0]; vmax = [s for s in rv.inputs if s.name == 'Max' and s.type == 'VECTOR'][0]
vmin.default_value = (-18, -16, -0.2); vmax.default_value = (18, HOUSE_Y + 4, 14)
L.new([s for s in rv.outputs if s.type == 'VECTOR'][0], pts.inputs['Position'])
tm = N.new('GeometryNodeInputSceneTime'); pos = N.new('GeometryNodeInputPosition'); sep = N.new('ShaderNodeSeparateXYZ'); L.new(pos.outputs[0], sep.inputs[0])
def m_(op, a, b=None, c=None):
    m = N.new('ShaderNodeMath'); m.operation = op
    for i, v in enumerate((a, b, c)):
        if v is None: continue
        if isinstance(v, (int, float)): m.inputs[i].default_value = v
        else: L.new(v, m.inputs[i])
    return m.outputs[0]
z = m_('WRAP', m_('SUBTRACT', sep.outputs['Z'], m_('MULTIPLY', tm.outputs['Seconds'], 1.1)), 14, -0.2)
x = m_('WRAP', m_('ADD', sep.outputs['X'], m_('MULTIPLY', tm.outputs['Seconds'], 0.7)), 18, -18)
cb = N.new('ShaderNodeCombineXYZ'); L.new(x, cb.inputs['X']); L.new(sep.outputs['Y'], cb.inputs['Y']); L.new(z, cb.inputs['Z'])
setp = N.new('GeometryNodeSetPosition'); L.new(pts.outputs[0], setp.inputs['Geometry']); L.new(cb.outputs[0], setp.inputs['Position'])
oi = N.new('GeometryNodeObjectInfo'); oi.inputs['Object'].default_value = flake
ins = N.new('GeometryNodeInstanceOnPoints'); L.new(setp.outputs[0], ins.inputs['Points']); L.new(oi.outputs['Geometry'], ins.inputs['Instance'])
L.new(ins.outputs[0], gout.inputs[0])
holder = from_bm('snowfall', bmesh.new()); holder.modifiers.new('snow', 'NODES').node_group = g

# ---------------------------------------------------------------- bloom + output
try:
    tree = bpy.data.node_groups.new('drag_comp', 'CompositorNodeTree')
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = tree.nodes.new('CompositorNodeRLayers'); gl = tree.nodes.new('CompositorNodeGlare'); out = tree.nodes.new('NodeGroupOutput')
    for typ in ('Bloom', 'Fog Glow'):
        try:
            gl.inputs['Type'].default_value = typ; break
        except Exception:
            continue
    gl.inputs['Threshold'].default_value = 0.8; gl.inputs['Strength'].default_value = 0.8
    tree.links.new(rl.outputs['Image'], gl.inputs['Image']); tree.links.new(gl.outputs['Image'], out.inputs['Image'])
    sc.compositing_node_group = tree; sc.render.use_compositing = True
except Exception as e:
    print('COMPOSITOR SKIPPED', e)
sc.render.filepath = '//drag_frames/'
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGB'; sc.render.image_settings.compression = 20
sc.render.use_overwrite = False; sc.render.use_placeholder = True
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('SAVED', OUT)
