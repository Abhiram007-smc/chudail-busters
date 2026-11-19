"""CHUDAIL BUSTERS: intro cut scene.

A car full of friends on a snowy mountain road at night. The street lights flicker and die one by one, then a
truck's high beams come out of the dark in their lane: head-on. (The game fades to black, a ringing, and the
players wake up on the floor of the house.)

Build the scene and save it:
  Blender -b --factory-startup --python blender/build_intro.py -- /path/intro.blend
Render frames (PNG, resumable):
  Blender -b /path/intro.blend -a
Encode the frames to public/video/intro.mp4:
  Blender -b --factory-startup --python blender/encode_intro.py -- /path/intro_frames public/video/intro.mp4

Everything is made here from primitives (no downloaded assets). Shot timing lives in SHOTS / IMPACT and is mirrored
in public/main.js (INTRO) for the sound cues.
"""
import bpy, bmesh, math, random, sys
from mathutils import Vector

random.seed(7)
FPS = 24
SHOTS = {'A': (1, 150), 'B': (151, 300), 'C': (301, 390), 'D': (391, 622)}
IMPACT = 620
F_END = 390  # the movie is the outside shots A-C; the inside of the car (D) is played live in the game with the
             # players' own characters seated (public/intro.js), using intro_car.glb / intro_truck.glb exported below

import os
ASSETS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'assets')  # python3 blender/fetch_assets.py
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/intro.blend'
PREVIEW = '--preview' in argv


# ---------------------------------------------------------------- road geometry
def cx(y):  # road centreline x at y
    return 7.0 * math.sin(y / 95.0) + 2.0 * math.sin(y / 37.0)


def slope(y):
    return cx(y + 0.5) - cx(y - 0.5)


def heading(y):  # rotation about Z that turns local +Y onto the road direction
    return math.atan2(-slope(y), 1.0)


def lane_point(y, off):  # off < 0 = left of the travel direction (+Y); India drives on the left
    d = slope(y); n = math.hypot(d, 1.0)
    return Vector((cx(y) - off * (-1.0 / n) * -1 if False else cx(y) + off * (1.0 / n), y - off * (d / n), 0.0))


def terrain_z(x, y):
    d = x - cx(y)
    a = abs(d)
    if a < 3.7:
        return 0.0
    if a < 5.2:  # ploughed snow bank
        return 0.42 * math.sin((a - 3.7) / 1.5 * math.pi * 0.5)
    n = 1.4 * math.sin(x * 0.11 + y * 0.05) * math.sin(y * 0.031 - x * 0.07) + 0.6 * math.sin(x * 0.37) * math.sin(y * 0.29)
    if d > 0:  # mountain side rises
        return 0.42 + (a - 5.2) * 0.42 + n * min(1.0, (a - 5.2) / 15.0) * 2.5
    return 0.42 - (a - 5.2) * 0.38 + n * min(1.0, (a - 5.2) / 15.0) * 1.5  # valley side falls away


# ---------------------------------------------------------------- helpers
def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def mat(name, color=(0.5, 0.5, 0.5), rough=0.5, metal=0.0, emit=None, strength=0.0, alpha=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes.get('Principled BSDF')
    b.inputs['Base Color'].default_value = (*color, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        b.inputs['Alpha'].default_value = alpha
        try:
            m.surface_render_method = 'BLENDED'
        except Exception:
            pass
    return m


def obj_from_bm(name, bm, material=None, parent=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    if material:
        o.data.materials.append(material)
    if parent:
        o.parent = parent
    return o


def box(name, size, loc, material, parent=None, bevel=0.0, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    o = obj_from_bm(name, bm, material, parent)
    o.location = loc; o.rotation_euler = rot
    if bevel:
        md = o.modifiers.new('bevel', 'BEVEL'); md.width = bevel; md.segments = 3; md.limit_method = 'ANGLE'
    return o


def cyl(name, r, h, loc, material, parent=None, rot=(0, 0, 0), verts=24):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=h)
    o = obj_from_bm(name, bm, material, parent)
    o.location = loc; o.rotation_euler = rot
    return o


def empty(name, loc=(0, 0, 0), parent=None):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.location = loc
    if parent:
        e.parent = parent
    return e


def spot(name, loc, rot, energy, color, size_deg, blend, parent=None, radius=0.05):
    ld = bpy.data.lights.new(name, 'SPOT')
    ld.energy = energy; ld.color = color; ld.spot_size = math.radians(size_deg); ld.spot_blend = blend
    ld.shadow_soft_size = radius
    o = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc; o.rotation_euler = rot
    if parent:
        o.parent = parent
    return o


def point(name, loc, energy, color, parent=None, radius=0.1):
    ld = bpy.data.lights.new(name, 'POINT')
    ld.energy = energy; ld.color = color; ld.shadow_soft_size = radius
    o = bpy.data.objects.new(name, ld)
    bpy.context.scene.collection.objects.link(o)
    o.location = loc
    if parent:
        o.parent = parent
    return o


def key(obj, path, frame, value, interp='LINEAR'):
    setattr(obj, path, value) if not isinstance(path, tuple) else None
    obj.keyframe_insert(data_path=path, frame=frame)
    fc = None
    ad = obj.animation_data
    if ad and ad.action:
        for f in _fcurves(ad.action):
            if f.data_path == path:
                for k in f.keyframe_points:
                    if int(round(k.co[0])) == frame:
                        k.interpolation = interp


def _fcurves(action):
    # Blender 5 stores fcurves in layered actions (layers -> strips -> channelbags)
    try:
        return list(action.fcurves)
    except Exception:
        out = []
        for layer in action.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out.extend(cb.fcurves)
        return out


def pbr_maps(nt, bsdf, folder, vec, bump=0.6):
    """Wire Poly Haven diffuse / roughness / normal maps (fetched by fetch_assets.py) into a Principled BSDF."""
    def img(fn, color=True):
        path = os.path.join(ASSETS, folder, fn)
        if not os.path.exists(path):
            print('MISSING ASSET', path); return None
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = bpy.data.images.load(path)
        if not color:
            t.image.colorspace_settings.name = 'Non-Color'
        nt.links.new(vec, t.inputs['Vector'])
        return t
    d, r, n = img('diff.jpg'), img('rough.jpg', False), img('nor.jpg', False)
    if r:
        nt.links.new(r.outputs['Color'], bsdf.inputs['Roughness'])
    if n:
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = bump
        nt.links.new(n.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return d


# ---------------------------------------------------------------- scene
clear()
sc = bpy.context.scene
sc.render.engine = 'BLENDER_EEVEE'
sc.render.fps = FPS
sc.frame_start = 1
sc.frame_end = F_END
sc.render.resolution_x, sc.render.resolution_y = (1280, 720)
sc.render.resolution_percentage = 50 if PREVIEW else 100
sc.render.use_motion_blur = True
sc.render.motion_blur_shutter = 0.5
ee = sc.eevee
ee.taa_render_samples = 16 if PREVIEW else 48
ee.volumetric_end = 220.0
ee.volumetric_tile_size = '8'
ee.volumetric_samples = 64
ee.use_volumetric_shadows = True
ee.use_shadows = True
for vt, look in (('AgX', 'AgX - Punchy'), ('AgX', 'None'), ('Filmic', 'None')):
    try:
        sc.view_settings.view_transform = vt
        sc.view_settings.look = look
        break
    except Exception:
        continue
sc.view_settings.exposure = 1.1

# world: almost black blue night, thick cold fog
w = bpy.data.worlds.new('night'); sc.world = w; w.use_nodes = True
wn = w.node_tree.nodes; wl = w.node_tree.links
wn['Background'].inputs['Color'].default_value = (0.007, 0.011, 0.022, 1)
wn['Background'].inputs['Strength'].default_value = 1.0
vol = wn.new('ShaderNodeVolumePrincipled')
vol.inputs['Density'].default_value = 0.016
vol.inputs['Anisotropy'].default_value = 0.35
vol.inputs['Color'].default_value = (0.75, 0.8, 0.9, 1)
wl.new(vol.outputs[0], wn['World Output'].inputs['Volume'])

# faint moonlight so the hills read as silhouettes
moon_d = bpy.data.lights.new('moon', 'SUN'); moon_d.energy = 0.32; moon_d.color = (0.6, 0.7, 1.0)
moon = bpy.data.objects.new('moon', moon_d); sc.collection.objects.link(moon); moon.rotation_euler = (math.radians(50), 0, math.radians(30))

# ---------------------------------------------------------------- materials
M_SNOW = mat('snow', (0.78, 0.82, 0.9), 0.75)
_n = M_SNOW.node_tree; _b = _n.nodes['Principled BSDF']
_tc = _n.nodes.new('ShaderNodeTexCoord'); _mp = _n.nodes.new('ShaderNodeMapping'); _mp.inputs['Scale'].default_value = (0.3, 0.3, 0.3)
_n.links.new(_tc.outputs['Object'], _mp.inputs['Vector'])
_d = pbr_maps(_n, _b, 'snow_02', _mp.outputs['Vector'], 0.8)
if _d:
    _tint = _n.nodes.new('ShaderNodeMix'); _tint.data_type = 'RGBA'; _tint.blend_type = 'MULTIPLY'; _tint.inputs[0].default_value = 1.0
    _tint.inputs[7].default_value = (0.86, 0.9, 1.0, 1)
    _n.links.new(_d.outputs['Color'], _tint.inputs[6]); _n.links.new(_tint.outputs[2], _b.inputs['Base Color'])
M_ASPH = bpy.data.materials.new('asphalt'); M_ASPH.use_nodes = True
nt = M_ASPH.node_tree; bs = nt.nodes['Principled BSDF']
uvn = nt.nodes.new('ShaderNodeTexCoord'); sep = nt.nodes.new('ShaderNodeSeparateXYZ')
nt.links.new(uvn.outputs['UV'], sep.inputs[0])
noi = nt.nodes.new('ShaderNodeTexNoise'); noi.inputs['Scale'].default_value = 3.0
nt.links.new(uvn.outputs['UV'], noi.inputs['Vector'])
# snow mask: heavy at the edges, two dark wet tyre tracks per lane
sub = nt.nodes.new('ShaderNodeMath'); sub.operation = 'SUBTRACT'; sub.inputs[1].default_value = 0.5
nt.links.new(sep.outputs['X'], sub.inputs[0])
ab = nt.nodes.new('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; nt.links.new(sub.outputs[0], ab.inputs[0])
sn = nt.nodes.new('ShaderNodeMath'); sn.operation = 'SINE'
mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 31.4
nt.links.new(sep.outputs['X'], mul.inputs[0]); nt.links.new(mul.outputs[0], sn.inputs[0])
edge = nt.nodes.new('ShaderNodeMath'); edge.operation = 'MULTIPLY_ADD'; edge.inputs[1].default_value = 2.6; edge.inputs[2].default_value = -0.75
nt.links.new(ab.outputs[0], edge.inputs[0])
add = nt.nodes.new('ShaderNodeMath'); add.operation = 'MULTIPLY_ADD'; add.inputs[1].default_value = 0.25
nt.links.new(sn.outputs[0], add.inputs[0]); nt.links.new(edge.outputs[0], add.inputs[2])
add2 = nt.nodes.new('ShaderNodeMath'); add2.operation = 'MULTIPLY_ADD'; add2.inputs[1].default_value = 0.5
nt.links.new(noi.outputs['Fac'], add2.inputs[0]); nt.links.new(add.outputs[0], add2.inputs[2])
cl = nt.nodes.new('ShaderNodeClamp'); nt.links.new(add2.outputs[0], cl.inputs[0])
mixc = nt.nodes.new('ShaderNodeMix'); mixc.data_type = 'RGBA'
mixc.inputs[6].default_value = (0.022, 0.022, 0.025, 1); mixc.inputs[7].default_value = (0.7, 0.74, 0.82, 1)
nt.links.new(cl.outputs[0], mixc.inputs[0]); nt.links.new(mixc.outputs[2], bs.inputs['Base Color'])
_rmap = nt.nodes.new('ShaderNodeMapping'); _rmap.inputs['Scale'].default_value = (2.5, 3.2, 1)
nt.links.new(uvn.outputs['UV'], _rmap.inputs['Vector'])
_rd = pbr_maps(nt, bs, 'asphalt_snow', _rmap.outputs['Vector'], 0.9)
if _rd:  # scanned snowy asphalt in the wheel tracks, packed snow towards the edges
    _dark = nt.nodes.new('ShaderNodeMix'); _dark.data_type = 'RGBA'; _dark.blend_type = 'MULTIPLY'; _dark.inputs[0].default_value = 1.0
    _dark.inputs[7].default_value = (0.45, 0.45, 0.5, 1)
    nt.links.new(_rd.outputs['Color'], _dark.inputs[6]); nt.links.new(_dark.outputs[2], mixc.inputs[6])


M_LINE = mat('roadline', (0.75, 0.72, 0.6), 0.5)
M_METAL = mat('galv', (0.35, 0.36, 0.38), 0.35, 0.9)
M_POLE = mat('pole', (0.12, 0.12, 0.13), 0.5, 0.6)
M_BARK = mat('bark', (0.05, 0.035, 0.025), 0.9)
M_PINE = bpy.data.materials.new('pine'); M_PINE.use_nodes = True
pn = M_PINE.node_tree; pb = pn.nodes['Principled BSDF']
geo = pn.nodes.new('ShaderNodeNewGeometry'); sxyz = pn.nodes.new('ShaderNodeSeparateXYZ')
pn.links.new(geo.outputs['Normal'], sxyz.inputs[0])
mr = pn.nodes.new('ShaderNodeMapRange'); mr.inputs[1].default_value = 0.35; mr.inputs[2].default_value = 0.7
pn.links.new(sxyz.outputs['Z'], mr.inputs[0])
pm = pn.nodes.new('ShaderNodeMix'); pm.data_type = 'RGBA'
pm.inputs[6].default_value = (0.01, 0.03, 0.018, 1); pm.inputs[7].default_value = (0.75, 0.8, 0.88, 1)
pn.links.new(mr.outputs[0], pm.inputs[0]); pn.links.new(pm.outputs[2], pb.inputs['Base Color'])
pb.inputs['Roughness'].default_value = 0.85

# ---------------------------------------------------------------- terrain + road
Y0, Y1 = -60, 660
bm = bmesh.new()
STEP = 3.0
xs = [x * STEP for x in range(-60, 61)]
ys = [Y0 + j * STEP for j in range(int((Y1 - Y0) / STEP) + 1)]
grid = []
for y in ys:
    row = []
    for x in xs:
        xx = x + cx(y)  # follow the road so the bank stays aligned
        row.append(bm.verts.new((xx, y, terrain_z(xx, y) - 0.03)))
    grid.append(row)
for j in range(len(ys) - 1):
    for i in range(len(xs) - 1):
        bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
terrain = obj_from_bm('terrain', bm, M_SNOW)
for p in terrain.data.polygons:
    p.use_smooth = True

bm = bmesh.new(); uvl = bm.loops.layers.uv.new()
HW = 3.7
rows = []
for y in range(Y0, Y1 + 1, 2):
    d = slope(y); n = math.hypot(d, 1)
    nx, ny = 1 / n, -d / n  # right-hand normal of the road direction
    rows.append((bm.verts.new((cx(y) - nx * HW, y - ny * HW, 0.0)), bm.verts.new((cx(y) + nx * HW, y + ny * HW, 0.0)), y))
for k in range(len(rows) - 1):
    a, b, y = rows[k]; c, dd, y2 = rows[k + 1]
    f = bm.faces.new((a, b, dd, c))
    v0, v1 = (y - Y0) / 8.0, (y2 - Y0) / 8.0
    for loop, uv in zip(f.loops, ((0, v0), (1, v0), (1, v1), (0, v1))):
        loop[uvl].uv = uv
road = obj_from_bm('road', bm, M_ASPH)

# dashed centre line
bm = bmesh.new()
for y in range(Y0, Y1, 12):
    for k, yy in enumerate((y, y + 3.5)):
        pass
    p0, p1 = Vector((cx(y), y, 0.012)), Vector((cx(y + 3.5), y + 3.5, 0.012))
    dirv = (p1 - p0).normalized(); side = Vector((dirv.y, -dirv.x, 0)) * 0.07
    vs = [bm.verts.new(p0 - side), bm.verts.new(p0 + side), bm.verts.new(p1 + side), bm.verts.new(p1 - side)]
    bm.faces.new(vs)
obj_from_bm('centreline', bm, M_LINE)

# guard rail on the valley (left) side
bm = bmesh.new()
for y in range(Y0, Y1, 4):
    d = slope(y); n = math.hypot(d, 1)
    base = Vector((cx(y) - (1 / n) * 4.4, y + (d / n) * 4.4, 0.25))
    bmesh.ops.create_cube(bm, size=1.0, matrix=__import__('mathutils').Matrix.Translation(base + Vector((0, 0, 0.35))) @ __import__('mathutils').Matrix.Diagonal((0.1, 0.1, 0.8, 1)))
prev = None
for y in range(Y0, Y1 + 1, 2):
    d = slope(y); n = math.hypot(d, 1)
    p = Vector((cx(y) - (1 / n) * 4.35, y + (d / n) * 4.35, 0))
    vlow, vhigh = bm.verts.new(p + Vector((0, 0, 0.6))), bm.verts.new(p + Vector((0, 0, 0.9)))
    if prev:
        bm.faces.new((prev[0], prev[1], vhigh, vlow))
    prev = (vlow, vhigh)
rail = obj_from_bm('guardrail', bm, M_METAL)

# ---------------------------------------------------------------- pines
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.18, radius2=0.12, depth=1.6,
                      matrix=__import__('mathutils').Matrix.Translation((0, 0, 0.8)))
trunk_me = bpy.data.meshes.new('pine_trunk'); bm.to_mesh(trunk_me); bm.free()
bm = bmesh.new()
for k, (r, h, z) in enumerate(((2.2, 3.2, 1.4), (1.7, 2.8, 3.0), (1.2, 2.4, 4.5), (0.7, 2.0, 5.9))):
    bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=r, radius2=0.02, depth=h,
                          matrix=__import__('mathutils').Matrix.Translation((0, 0, z + h / 2)))
crown_me = bpy.data.meshes.new('pine_crown'); bm.to_mesh(crown_me); bm.free()
crown_me.materials.append(M_PINE); trunk_me.materials.append(M_BARK)
pines = 0
for t in range(4000):
    if pines >= 420:
        break
    y = random.uniform(Y0 + 10, Y1 - 10)
    side = 1 if random.random() < 0.55 else -1
    off = random.uniform(8, 120) * side
    x = cx(y) + off
    if abs(off) < 8:
        continue
    s = random.uniform(0.7, 1.6)
    z = terrain_z(x, y) - 0.2
    for me, nm in ((trunk_me, 'trunk'), (crown_me, 'crown')):
        o = bpy.data.objects.new(f'pine_{nm}_{pines}', me); sc.collection.objects.link(o)
        o.location = (x, y, z); o.scale = (s, s, s * random.uniform(0.9, 1.25)); o.rotation_euler.z = random.uniform(0, 6.28)
    pines += 1

# ---------------------------------------------------------------- street lamps (mountain side)
# Poly Haven "Street Lamp 01" (CC0), an old Victorian lantern post; falls back to a simple post if not fetched
SODIUM = (1.0, 0.55, 0.2)
LAMP_H = 4.8
lamp_mesh = None
_gltf = os.path.join(ASSETS, 'street_lamp_01', 'street_lamp_01_1k.gltf')
if os.path.exists(_gltf):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=_gltf)
    imported = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in bpy.data.objects:
        o.select_set(False)
    for o in imported:
        o.select_set(True)
    bpy.context.view_layer.objects.active = imported[0]
    if len(imported) > 1:
        bpy.ops.object.join()
    lo = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    zs = [v.co.z for v in lo.data.vertices]; h = max(zs) - min(zs)
    xs_ = [v.co.x for v in lo.data.vertices]; ys_ = [v.co.y for v in lo.data.vertices]
    cx0, cy0, z0 = (max(xs_) + min(xs_)) / 2, (max(ys_) + min(ys_)) / 2, min(zs)
    k = LAMP_H / h
    for v in lo.data.vertices:
        v.co = Vector(((v.co.x - cx0) * k, (v.co.y - cy0) * k, (v.co.z - z0) * k))
    lamp_mesh = lo.data
    for m_ in lamp_mesh.materials:  # see-through lantern glass
        b_ = m_.node_tree.nodes.get('Principled BSDF') if m_ and m_.use_nodes else None
        if b_ and ('glass' in m_.name.lower() or b_.inputs['Transmission Weight'].default_value > 0.3 or b_.inputs['Alpha'].default_value < 1):
            b_.inputs['Alpha'].default_value = 0.15; b_.inputs['Roughness'].default_value = 0.08
            m_.surface_render_method = 'BLENDED'; print('LAMP GLASS', m_.name)
    bpy.data.objects.remove(lo)
    print('LAMP ASSET height', round(h, 2), '-> scaled to', LAMP_H)
lamps = []
for k, y in enumerate(range(20, 640, 32)):
    d = slope(y); n = math.hypot(d, 1)
    rx, ry = 1 / n, -d / n
    base = Vector((cx(y) + rx * 4.9, y + ry * 4.9, 0.25))
    root = empty(f'lamp_{k}', base)
    root.rotation_euler.z = heading(y)
    if lamp_mesh:
        o = bpy.data.objects.new(f'lamp_post_{k}', lamp_mesh); sc.collection.objects.link(o); o.parent = root
        o.visible_shadow = False  # the lantern's glass and frame would otherwise trap the light inside
    else:
        cyl(f'lamp_pole_{k}', 0.08, LAMP_H, (0, 0, LAMP_H / 2), M_POLE, root)
    lm = mat(f'lamp_glow_{k}', (0.2, 0.2, 0.2), 0.4, emit=SODIUM, strength=30.0)
    bulb = bpy.ops.mesh.primitive_uv_sphere_add(radius=0.11, location=(0, 0, 0))
    bo = bpy.context.active_object; bo.name = f'lamp_bulb_{k}'; bo.data.materials.append(lm); bo.parent = root
    bo.location = (0, 0, LAMP_H * 0.86); bo.visible_shadow = False
    L = point(f'lamp_light_{k}', (0, 0, LAMP_H * 0.86), 700, SODIUM, root, radius=0.12)
    lamps.append({'y': y, 'light': L, 'mat': lm})


def lamp_set(lp, frame, on):
    L, m = lp['light'], lp['mat']
    L.data.energy = 700 if on else 0.0
    L.data.keyframe_insert('energy', frame=frame)
    s = m.node_tree.nodes['Principled BSDF'].inputs['Emission Strength']
    s.default_value = 30.0 if on else 0.0
    s.keyframe_insert('default_value', frame=frame)


def flicker(lp, f0, f1, end_on):
    f = f0
    while f < f1:
        lamp_set(lp, f, random.random() < 0.45)
        f += random.choice((1, 1, 2, 3, 4))
    lamp_set(lp, f1, end_on)


for lp in lamps:
    lamp_set(lp, 1, lp['y'] < 320)  # the far stretch of road is already dark
# a couple of sick lamps buzzing on and off the whole time
for lp in lamps:
    if lp['y'] in (116, 148):
        flicker(lp, 1, 300, True)
# while the car drives under them (shot C), the lamps ahead die one after another
dying = [lp for lp in lamps if 200 <= lp['y'] < 320]
for k, lp in enumerate(dying):
    f0 = 312 + k * 14
    flicker(lp, f0, f0 + 12, False)
# make every keyframe constant (no fading between on/off)
for L in [lp['light'].data for lp in lamps] + [lp['mat'].node_tree for lp in lamps]:
    ad = L.animation_data
    if ad and ad.action:
        for fc in _fcurves(ad.action):
            for kp in fc.keyframe_points:
                kp.interpolation = 'CONSTANT'

# ---------------------------------------------------------------- the car (an old SUV, right-hand drive)
CAR = empty('CAR')
M_PAINT = mat('paint', (0.28, 0.02, 0.025), 0.28, 0.6)
M_GLASS = mat('glass', (0.02, 0.03, 0.035), 0.05, 0.0, alpha=0.18)
M_RUBBER = mat('rubber', (0.015, 0.015, 0.015), 0.7)
M_CHROME = mat('chrome', (0.7, 0.7, 0.72), 0.15, 1.0)
M_HEAD = mat('car_head', (1, 1, 1), 0.2, emit=(1.0, 0.95, 0.85), strength=40)
M_TAIL = mat('car_tail', (0.3, 0, 0), 0.3, emit=(1.0, 0.02, 0.02), strength=8)
M_DASH = mat('dash', (0.02, 0.02, 0.022), 0.6)
M_GAUGE = mat('gauge', (0, 0, 0), 0.5, emit=(0.25, 0.8, 1.0), strength=2.5)
M_GAUGE2 = mat('gauge2', (0, 0, 0), 0.5, emit=(1.0, 0.55, 0.15), strength=1.5)
M_SEAT = mat('seat', (0.03, 0.025, 0.022), 0.8)
M_SKIN = mat('silhouette', (0.02, 0.018, 0.02), 0.85)
M_HAIR = mat('hair_dark', (0.008, 0.006, 0.005), 0.5)

def extrude_profile(name, prof, width, material, parent, bevel=0.05, open_face=None):
    """Side profile [(y, z), ...] (counter-clockwise) extruded across x; open_face=i leaves out the face i -> i+1."""
    bm = bmesh.new()
    left = [bm.verts.new((-width / 2, y, z)) for y, z in prof]
    right = [bm.verts.new((width / 2, y, z)) for y, z in prof]
    bm.faces.new(list(reversed(left))); bm.faces.new(right)
    n = len(prof)
    for i in range(n):
        j = (i + 1) % n
        if i == open_face:
            continue
        bm.faces.new((left[i], left[j], right[j], right[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = obj_from_bm(name, bm, material, parent)
    if bevel:
        md = o.modifiers.new('bevel', 'BEVEL'); md.width = bevel; md.segments = 3; md.limit_method = 'ANGLE'
    return o


# lower body: wedge hood, upright tail (an old boxy SUV)
# open on top (face 4) so the cabin can be seen into; the paint is double-sided
extrude_profile('car_body', [(-2.3, 0.32), (2.3, 0.32), (2.34, 0.62), (2.25, 0.93), (1.25, 1.1), (-2.28, 1.12), (-2.33, 0.75)], 1.92, M_PAINT, CAR, 0.07, open_face=4)
for (x, y) in ((-0.97, 1.45), (0.97, 1.45), (-0.97, -1.45), (0.97, -1.45)):  # dark wheel arches
    cyl(f'car_arch_{x}_{y}', 0.47, 0.06, (x, y, 0.42), M_RUBBER, CAR, rot=(0, math.radians(90), 0))
# outside shots: a solid cabin with glossy dark glass all round and a painted roof
M_TINT = mat('tint', (0.004, 0.005, 0.007), 0.04, 0.0)
CABIN_OUT = [extrude_profile('car_cabin_glass', [(-2.22, 1.1), (1.2, 1.1), (0.45, 1.8), (-2.12, 1.83)], 1.76, M_TINT, CAR, 0.05),
             box('car_roof_out', (1.72, 2.55, 0.08), (0, -0.84, 1.86), M_PAINT, CAR, bevel=0.03)]
# inside shot: roof, pillars and see-through glass instead
CABIN_IN = []
CABIN_IN.append(box('car_roof', (1.72, 3.05, 0.07), (0, -0.72, 1.86), M_PAINT, CAR, bevel=0.03))
for x in (-0.83, 0.83):
    CABIN_IN.append(box(f'car_apillar_{x}', (0.07, 0.07, 0.86), (x, 0.88, 1.47), M_PAINT, CAR, rot=(math.radians(-38), 0, 0)))
    CABIN_IN.append(box(f'car_bpillar_{x}', (0.07, 0.1, 0.8), (x, -0.4, 1.47), M_PAINT, CAR))
    CABIN_IN.append(box(f'car_cpillar_{x}', (0.07, 0.1, 0.8), (x, -2.16, 1.47), M_PAINT, CAR, rot=(math.radians(8), 0, 0)))
    CABIN_IN.append(box(f'car_sideglass_{x}', (0.02, 2.95, 0.62), (x, -0.72, 1.45), M_GLASS, CAR))
    CABIN_IN.append(box(f'car_doorpanel_{x}', (0.05, 3.0, 0.62), (x * 1.06, -0.72, 0.82), M_DASH, CAR))
ws = box('car_windshield', (1.62, 1.08, 0.02), (0, 0.9, 1.47), M_GLASS, CAR, rot=(math.radians(-52), 0, 0))
CABIN_IN.append(ws)
CABIN_IN.append(box('car_rearglass', (1.6, 0.7, 0.02), (0, -2.22, 1.48), M_GLASS, CAR, rot=(math.radians(80), 0, 0)))
for (x, y) in ((-0.88, 1.45), (0.88, 1.45), (-0.88, -1.45), (0.88, -1.45)):
    cyl(f'car_wheel_{x}_{y}', 0.38, 0.26, (x, y, 0.38), M_RUBBER, CAR, rot=(0, math.radians(90), 0))
    cyl(f'car_hub_{x}_{y}', 0.2, 0.27, (x, y, 0.38), M_CHROME, CAR, rot=(0, math.radians(90), 0), verts=12)
box('car_grille', (1.3, 0.05, 0.28), (0, 2.31, 0.78), M_CHROME, CAR)
box('car_bumper', (1.98, 0.2, 0.22), (0, 2.33, 0.45), M_RUBBER, CAR, bevel=0.05)
for x in (-0.66, 0.66):
    box(f'car_headlamp_{x}', (0.36, 0.06, 0.16), (x, 2.31, 0.86), M_HEAD, CAR, bevel=0.03)
    spot(f'car_beam_{x}', (x, 2.4, 0.86), (math.radians(86), 0, 0), 600, (1.0, 0.95, 0.86), 62, 0.45, CAR)
    box(f'car_taillamp_{x}', (0.3, 0.05, 0.14), (x, -2.31, 0.95), M_TAIL, CAR, bevel=0.02)
point('car_tailglow', (0, -2.6, 0.9), 15, (1, 0.05, 0.02), CAR, radius=0.3)
# interior
box('car_dash', (1.7, 0.5, 0.26), (0, 0.62, 1.05), M_DASH, CAR, bevel=0.05)
for x, mt in ((0.3, M_GAUGE), (0.52, M_GAUGE2)):
    cyl(f'car_gauge_{x}', 0.07, 0.01, (x, 0.36, 1.16), mt, CAR, rot=(math.radians(70), 0, 0), verts=20)
cyl('car_radio', 0.05, 0.01, (-0.05, 0.36, 1.1), M_GAUGE2, CAR, rot=(math.radians(70), 0, 0), verts=16)
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=False, segments=24, radius=0.19)
sw = obj_from_bm('car_steering', bm, M_RUBBER, CAR)
sw.location = (0.4, 0.3, 1.22); sw.rotation_euler = (math.radians(60), 0, 0)
sk = sw.modifiers.new('skin', 'SKIN')
for v in sw.data.skin_vertices[0].data:
    v.radius = (0.018, 0.018)
point('car_dashglow', (0.2, 0.25, 1.3), 6.0, (0.3, 0.75, 1.0), CAR, radius=0.25)
# a 7-seater: two in front (right-hand drive), a bench of three, one more in the back.
# The empties seat_0..seat_5 mark where each player's character sits (hip point); seat_0 is the driver.
box('car_floor', (1.8, 4.0, 0.06), (0, -0.4, 0.48), M_DASH, CAR)
SEATS = [(0.42, -0.2), (-0.42, -0.2), (-0.52, -1.05), (0.52, -1.05), (0.0, -1.05), (0.38, -1.85), (-0.38, -1.85)]
for k, (x, y) in enumerate(SEATS):
    wdt = 0.5 if k < 2 or k > 4 else 0.46
    box(f'car_cushion_{k}', (wdt, 0.5, 0.14), (x, y, 0.76), M_SEAT, CAR, bevel=0.04)
    box(f'car_seatback_{k}', (wdt, 0.12, 0.66), (x, y - 0.3, 1.1), M_SEAT, CAR, bevel=0.05, rot=(math.radians(-12), 0, 0))
    if k < 2 or k > 4:
        box(f'car_headrest_{k}', (0.24, 0.1, 0.16), (x, y - 0.38, 1.53), M_SEAT, CAR, bevel=0.03)
    if k < 6:
        empty(f'seat_{k}', (x, y + 0.02, 0.86), CAR)
box('car_mirror', (0.24, 0.03, 0.07), (0, 0.72, 1.78), M_DASH, CAR)
# wipers, pivoting at the bottom of the windshield
wipers = []
for x in (-0.55, 0.15):
    piv = empty(f'wiper_pivot_{x}', (x, 1.22, 1.13), CAR)
    piv.rotation_euler = (math.radians(-52), 0, 0)
    arm = box(f'wiper_{x}', (0.025, 0.012, 0.66), (0, 0, 0.33), M_RUBBER, piv)
    wipers.append(piv)

# ---------------------------------------------------------------- the truck (decorated goods carrier)
TRUCK = empty('TRUCK')
M_CAB = mat('truck_cab', (0.75, 0.25, 0.02), 0.35, 0.3)
M_TRIM = mat('truck_trim', (0.85, 0.65, 0.05), 0.3, 0.6)
M_TARP = mat('truck_tarp', (0.03, 0.12, 0.1), 0.85)
M_THEAD = mat('truck_head', (1, 1, 1), 0.2, emit=(0.85, 0.92, 1.0), strength=120)
M_AMBER = mat('truck_amber', (0.3, 0.15, 0), 0.3, emit=(1.0, 0.45, 0.05), strength=25)
box('truck_cab', (2.5, 2.4, 2.4), (0, 3.4, 1.9), M_CAB, TRUCK, bevel=0.08)
box('truck_cabglass', (2.2, 0.04, 0.9), (0, 4.62, 2.5), M_GLASS, TRUCK)
box('truck_trim', (2.52, 0.05, 0.22), (0, 4.62, 1.55), M_TRIM, TRUCK)
box('truck_bumper', (2.6, 0.3, 0.35), (0, 4.65, 0.75), M_METAL, TRUCK)
box('truck_grille', (1.6, 0.05, 0.7), (0, 4.62, 1.15), M_CHROME, TRUCK)
box('truck_cargo', (2.55, 7.2, 3.0), (0, -1.9, 2.15), M_TARP, TRUCK, bevel=0.05)
box('truck_chassis', (1.2, 9.5, 0.4), (0, 0.0, 0.75), M_RUBBER, TRUCK)
for (x, y) in ((-1.05, 3.2), (1.05, 3.2), (-1.05, -2.4), (1.05, -2.4), (-1.05, -3.9), (1.05, -3.9)):
    cyl(f'truck_wheel_{x}_{y}', 0.52, 0.4, (x, y, 0.52), M_RUBBER, TRUCK, rot=(0, math.radians(90), 0))
for x in (-0.9, 0.9):
    box(f'truck_headlamp_{x}', (0.42, 0.06, 0.3), (x, 4.66, 1.15), M_THEAD, TRUCK, bevel=0.04)
    spot(f'truck_beam_{x}', (x, 4.8, 1.15), (math.radians(88), 0, 0), 4200, (0.85, 0.92, 1.0), 48, 0.35, TRUCK)
for k in range(5):
    box(f'truck_marker_{k}', (0.12, 0.08, 0.08), (-0.9 + k * 0.45, 4.6, 3.15), M_AMBER, TRUCK)

# ---------------------------------------------------------------- export the car and truck for the live inside shot
MODELS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'models')


def export_glb(root, path, skip=()):
    def walk(o):
        yield o
        for c in o.children:
            yield from walk(c)
    for o in bpy.data.objects:
        o.select_set(False)
    for o in walk(root):
        if o not in skip and o.type in ('MESH', 'EMPTY'):
            o.hide_render = False
            o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_lights=False, export_cameras=False, export_animations=False, export_extras=False)
    print('EXPORTED', path, round(os.path.getsize(path) / 1e6, 2), 'MB')


if '--export' in argv:
    export_glb(CAR, os.path.join(MODELS, 'intro_car.glb'), skip=set(CABIN_OUT))
    export_glb(TRUCK, os.path.join(MODELS, 'intro_truck.glb'))

# ---------------------------------------------------------------- motion
CAR_V, CAR_Y0 = 15.0, 10.0


def car_y(f):
    return CAR_Y0 + CAR_V * (f - 1) / FPS


def car_off(f):  # in the last second the driver yanks the wheel, too late
    k = max(0.0, min(1.0, (f - 596) / 24.0))
    return -1.85 + k * k * 1.1


def road_pos(y, off):
    d = slope(y); n = math.hypot(d, 1)
    return Vector((cx(y) + off / n, y - off * d / n, 0.0))


for f in range(1, F_END + 1, 3):
    y = car_y(f)
    p = road_pos(y, car_off(f))
    CAR.location = p + Vector((0, 0, 0.0 + 0.012 * math.sin(f * 0.9)))
    yaw = heading(y) + (-(car_off(f + 3) - car_off(f)) * 0.25)
    CAR.rotation_euler = (0.004 * math.sin(f * 0.7), 0.006 * math.sin(f * 0.53), yaw)
    CAR.keyframe_insert('location', frame=f); CAR.keyframe_insert('rotation_euler', frame=f)

TRUCK_V = 19.0
meet = car_y(IMPACT) + 2.3 + 4.75
for f in list(range(380, F_END + 1, 3)) + [IMPACT]:
    y = meet + TRUCK_V * (IMPACT - f) / FPS
    TRUCK.location = road_pos(y, car_off(IMPACT))
    TRUCK.rotation_euler = (0, 0, heading(y) + math.pi)
    TRUCK.keyframe_insert('location', frame=f); TRUCK.keyframe_insert('rotation_euler', frame=f)
TRUCK.location = (0, 2000, -50); TRUCK.keyframe_insert('location', frame=1)
TRUCK.keyframe_insert('location', frame=377)

# wipers sweep during the inside shot
for piv in wipers:
    f = SHOTS['D'][0] - 20
    k = 0
    while f < F_END:
        piv.rotation_euler = (math.radians(-52), math.radians(-72 if k % 2 else 0), 0)
        piv.keyframe_insert('rotation_euler', frame=int(f))
        f += 13; k += 1

# ---------------------------------------------------------------- snow
# Geometry Nodes, not particles: every flake's position is a pure function of time (falls, wraps back to the top,
# drifts), so any frame renders correctly on its own with no simulation to bake.
flake_bm = bmesh.new()
bmesh.ops.create_icosphere(flake_bm, subdivisions=1, radius=0.03)
flake = obj_from_bm('flake', flake_bm, mat('flake', (0.95, 0.97, 1.0), 0.6, emit=(0.8, 0.86, 1.0), strength=0.15))
flake.hide_render = True; flake.location = (0, -500, -100)


def snow_nodes(count, box_min, box_max):
    g = bpy.data.node_groups.new('snowfall', 'GeometryNodeTree')
    g.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    g.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N, L = g.nodes, g.links
    gin, gout = N.new('NodeGroupInput'), N.new('NodeGroupOutput')

    def sock(node, name, kind, out=False):
        for so in (node.outputs if out else node.inputs):
            if so.name == name and (kind is None or so.type == kind):
                return so
        raise KeyError(name)

    def math(op, a=None, b=None, c=None):
        m = N.new('ShaderNodeMath'); m.operation = op
        for i, v in enumerate((a, b, c)):
            if v is None:
                continue
            if isinstance(v, (int, float)):
                m.inputs[i].default_value = v
            else:
                L.new(v, m.inputs[i])
        return m.outputs[0]

    pts = N.new('GeometryNodePoints'); pts.inputs['Count'].default_value = count
    rv = N.new('FunctionNodeRandomValue'); rv.data_type = 'FLOAT_VECTOR'
    sock(rv, 'Min', 'VECTOR').default_value = box_min; sock(rv, 'Max', 'VECTOR').default_value = box_max
    L.new(sock(rv, 'Value', 'VECTOR', True), pts.inputs['Position'])
    sp = N.new('FunctionNodeRandomValue'); sp.data_type = 'FLOAT'
    sock(sp, 'Min', 'VALUE').default_value = 0.9; sock(sp, 'Max', 'VALUE').default_value = 1.7
    sock(sp, 'Seed', 'INT').default_value = 3
    t = N.new('GeometryNodeInputSceneTime')
    pos = N.new('GeometryNodeInputPosition'); sep = N.new('ShaderNodeSeparateXYZ'); L.new(pos.outputs[0], sep.inputs[0])
    idn = N.new('GeometryNodeInputIndex')
    fall = math('MULTIPLY', t.outputs['Seconds'], sock(sp, 'Value', 'VALUE', True))
    z = math('WRAP', math('SUBTRACT', sep.outputs['Z'], fall), box_max[2], box_min[2])
    ph = math('ADD', math('MULTIPLY', t.outputs['Seconds'], 0.8), math('MULTIPLY', idn.outputs[0], 1.37))
    x = math('ADD', sep.outputs['X'], math('MULTIPLY', math('SINE', ph), 0.35))
    x = math('ADD', x, math('MULTIPLY', t.outputs['Seconds'], 0.9))  # steady wind across the road
    x = math('WRAP', x, box_max[0], box_min[0])
    comb = N.new('ShaderNodeCombineXYZ')
    L.new(x, comb.inputs['X']); L.new(sep.outputs['Y'], comb.inputs['Y']); L.new(z, comb.inputs['Z'])
    setp = N.new('GeometryNodeSetPosition'); L.new(pts.outputs[0], setp.inputs['Geometry']); L.new(comb.outputs[0], setp.inputs['Position'])
    oi = N.new('GeometryNodeObjectInfo'); oi.inputs['Object'].default_value = flake
    inst = N.new('GeometryNodeInstanceOnPoints')
    L.new(setp.outputs[0], inst.inputs['Points']); L.new(oi.outputs['Geometry'], inst.inputs['Instance'])
    ss = N.new('FunctionNodeRandomValue'); ss.data_type = 'FLOAT'
    sock(ss, 'Min', 'VALUE').default_value = 0.5; sock(ss, 'Max', 'VALUE').default_value = 1.5; sock(ss, 'Seed', 'INT').default_value = 9
    L.new(sock(ss, 'Value', 'VALUE', True), inst.inputs['Scale'])
    L.new(inst.outputs[0], gout.inputs[0])
    return g


SNOW_N = 40000 if PREVIEW else 110000
snow_holder = obj_from_bm('snowfall', bmesh.new())
md = snow_holder.modifiers.new('snow', 'NODES'); md.node_group = snow_nodes(SNOW_N, (-32, -20, -0.5), (32, 440, 21))

# ---------------------------------------------------------------- cameras
def cam(name, lens):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_start = 0.05; cd.clip_end = 600
    o = bpy.data.objects.new(name, cd); sc.collection.objects.link(o)
    return o


def track(o, target):
    c = o.constraints.new('TRACK_TO'); c.target = target; c.track_axis = 'TRACK_NEGATIVE_Z'; c.up_axis = 'UP_Y'


def shake(o, path, amount, f0, f1, freq=0.6, seed=0):
    rnd = random.Random(seed)
    base = list(getattr(o, path))
    for f in range(f0, f1 + 1, 2):
        a = amount(f) if callable(amount) else amount
        setattr(o, path, [b + a * rnd.uniform(-1, 1) for b in base])
        o.keyframe_insert(path, frame=f)
    setattr(o, path, base)


# A: high on the mountain side, the car's lights come up the road towards us
camA = cam('camA', 32)
camA.location = (cx(115) + 15, 115, 7.5); camA.keyframe_insert('location', frame=1)
camA.location = (cx(115) + 13, 119, 6.5); camA.keyframe_insert('location', frame=150)
tA = empty('camA_target', parent=CAR); tA.location = (0, 6, 0.5)
track(camA, tA)
# B: low at the roadside under a flickering lamp; the car comes at us, rushes past, its tail lights fade into the snow
camB = cam('camB', 26)
_by = 172
_bp = road_pos(_by, 3.9)
camB.location = (_bp.x, _bp.y, 0.75)
tB = empty('camB_target', (0, 0.4, 0.9), CAR)
track(camB, tB)
shake(camB, 'location', 0.012, 151, 300, seed=2)
# C: chase camera behind and above; the lights ahead die one by one
camC = cam('camC', 30)
camC.parent = CAR; camC.location = (0.6, -9.5, 3.1)
tC = empty('camC_target', (0, 22, 0.6), CAR)
track(camC, tC)
shake(camC, 'location', 0.025, 301, 390, seed=3)
# D: inside, from the back seat between the front seats
camD = cam('camD', 24)
camD.parent = CAR; camD.location = (0.0, -0.95, 1.6); camD.rotation_euler = (math.radians(82), 0, 0)
shake(camD, 'rotation_euler', lambda f: 0.002 + max(0, (f - 560) / 60) * 0.02, 391, 619, seed=4)
# blinding white at the moment of impact
flash = box('impact_flash', (3, 3, 0.01), (0, 0, -0.3), mat('flash', (1, 1, 1), 0.5, emit=(1, 1, 1), strength=0.0), camD)
fs = flash.data.materials[0].node_tree.nodes['Principled BSDF'].inputs['Emission Strength']
for f, v in ((1, 0.0), (IMPACT - 2, 0.0), (IMPACT, 60.0), (F_END, 200.0)):
    fs.default_value = v; fs.keyframe_insert('default_value', frame=f)
for f, hidden in ((1, True), (IMPACT - 2, False)):  # only exists for the crash itself
    flash.hide_render = hidden; flash.keyframe_insert('hide_render', frame=f)
    flash.hide_viewport = hidden; flash.keyframe_insert('hide_viewport', frame=f)

for f, inside in ((1, False), (SHOTS['D'][0], True)):
    for o in CABIN_OUT:
        o.hide_render = inside; o.keyframe_insert('hide_render', frame=f)
    for o in CABIN_IN:
        o.hide_render = not inside; o.keyframe_insert('hide_render', frame=f)
for name, (f0, f1) in SHOTS.items():
    mk = sc.timeline_markers.new(name, frame=f0)
    mk.camera = {'A': camA, 'B': camB, 'C': camC, 'D': camD}[name]
sc.camera = camA

# ---------------------------------------------------------------- compositor: bloom on lamps and headlights
try:
    tree = bpy.data.node_groups.new('intro_comp', 'CompositorNodeTree')
    tree.interface.new_socket(name='Image', in_out='OUTPUT', socket_type='NodeSocketColor')
    rl = tree.nodes.new('CompositorNodeRLayers')
    gl = tree.nodes.new('CompositorNodeGlare')
    for typ in ('Bloom', 'Fog Glow'):
        try:
            gl.inputs['Type'].default_value = typ
            break
        except Exception:
            continue
    for nm, v in (('Threshold', 0.8), ('Strength', 0.9), ('Size', 0.9)):
        if nm in gl.inputs:
            gl.inputs[nm].default_value = v
    out = tree.nodes.new('NodeGroupOutput')
    tree.links.new(rl.outputs['Image'], gl.inputs['Image'])
    tree.links.new(gl.outputs['Image'], out.inputs['Image'])
    sc.compositing_node_group = tree
    sc.render.use_compositing = True
except Exception as e:
    print('COMPOSITOR SKIPPED:', e)

# ---------------------------------------------------------------- output
frames = bpy.path.abspath('//') if bpy.data.filepath else ''
sc.render.filepath = '//intro_frames/'
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGB'
sc.render.image_settings.compression = 20
sc.render.use_overwrite = False
sc.render.use_placeholder = True
bpy.ops.wm.save_as_mainfile(filepath=OUT)
print('SAVED', OUT, 'frames', F_END, 'pines', pines, 'lamps', len(lamps))
