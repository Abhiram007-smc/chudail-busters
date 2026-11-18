# Builds the game's characters in Blender and exports rigged GLB models.
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python blender/build_characters.py -- <outdir> [<previewdir>]
# Coordinates: Blender Z-up, characters face +Y (becomes -Z in three.js after glTF export).
import bpy, bmesh, math, sys, os, random
from mathutils import Vector, noise, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else os.path.join(os.path.dirname(__file__), '..', 'public', 'models')
PREVIEW = argv[1] if len(argv) > 1 else None
os.makedirs(OUT, exist_ok=True)
random.seed(7)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


# ---------------------------------------------------------------- helpers
def skin_mesh(name, joints, edges, subdiv=2):
    """joints: dict name -> (pos, (rx, ry)); edges: list of (a, b). Returns evaluated, applied mesh object."""
    names = list(joints.keys())
    idx = {n: i for i, n in enumerate(names)}
    me = bpy.data.meshes.new(name)
    me.from_pydata([joints[n][0] for n in names], [(idx[a], idx[b]) for a, b in edges], [])
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    sk = ob.modifiers.new('Skin', 'SKIN')
    sk.use_smooth_shade = True
    sk.branch_smoothing = 0.6
    for i, n in enumerate(names):
        r = joints[n][1]
        me.skin_vertices[0].data[i].radius = r if isinstance(r, tuple) else (r, r)
    me.skin_vertices[0].data[0].use_root = True
    ss = ob.modifiers.new('Sub', 'SUBSURF')
    ss.levels = subdiv; ss.render_levels = subdiv
    dg = bpy.context.evaluated_depsgraph_get()
    new = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    bpy.data.objects.remove(ob)
    out = bpy.data.objects.new(name, new)
    bpy.context.collection.objects.link(out)
    for p in new.polygons:
        p.use_smooth = True
    return out


def displace(ob, fn):
    me = ob.data
    me.update()
    for v in me.vertices:
        d = fn(v.co.copy(), v.normal.copy())
        if d:
            v.co += v.normal * d
    me.update()


def paint(ob, fn, name='Col'):
    me = ob.data
    attr = me.color_attributes.new(name, 'FLOAT_COLOR', 'POINT')
    for v in me.vertices:
        c = fn(v.co.copy(), v.normal.copy())
        attr.data[v.index].color = (c[0], c[1], c[2], 1.0)
    me.color_attributes.active_color = attr
    me.color_attributes.render_color_index = 0


def vc_material(name, rough=0.6):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    attr = nt.nodes.new('ShaderNodeVertexColor')
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    bsdf.inputs['Roughness'].default_value = rough
    return m


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / max(ab.length_squared, 1e-9)))
    return (p - (a + ab * t)).length


def build_armature(name, bones):
    """bones: list of (name, head, tail, parent)."""
    arm = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, arm)
    bpy.context.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for n, h, t, par in bones:
        b = arm.edit_bones.new(n)
        b.head = Vector(h); b.tail = Vector(t)
        b.align_roll(Vector((0, 1, 0)) if abs((b.tail - b.head).normalized().y) < 0.9 else Vector((0, 0, 1)))
        if par:
            b.parent = eb[par]
        eb[n] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return ob


def bind(mesh_ob, arm_ob, bones, forced=None, exclude=()):
    """Distance-based skin weights to the two nearest bones. forced: bone name to use for every vertex."""
    groups = {n: mesh_ob.vertex_groups.new(name=n) for n, *_ in bones}
    segs = [(n, Vector(h), Vector(t)) for n, h, t, _ in bones if n not in exclude]
    for v in mesh_ob.data.vertices:
        if forced:
            groups[forced].add([v.index], 1.0, 'REPLACE'); continue
        ds = sorted(((seg_dist(v.co, a, b), n) for n, a, b in segs))[:2]
        w0 = 1 / (ds[0][0] ** 4 + 1e-7); w1 = 1 / (ds[1][0] ** 4 + 1e-7)
        s = w0 + w1
        groups[ds[0][1]].add([v.index], w0 / s, 'REPLACE')
        if w1 / s > 0.02:
            groups[ds[1][1]].add([v.index], w1 / s, 'REPLACE')
    mod = mesh_ob.modifiers.new('Armature', 'ARMATURE')
    mod.object = arm_ob
    mesh_ob.parent = arm_ob


def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    kw = dict(filepath=path, use_selection=True, export_format='GLB', export_yup=True, export_skins=True,
              export_animations=False, export_apply=False, export_normals=True)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color='ACTIVE')
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print('EXPORTED', path, os.path.getsize(path))


def sym(d):
    """mirror '_L' joints to '_R'"""
    out = dict(d)
    for k, (p, r) in d.items():
        if k.endswith('_L'):
            out[k[:-2] + '_R'] = ((-p[0], p[1], p[2]), r)
    return out


def sym_edges(e):
    out = list(e)
    for a, b in e:
        if a.endswith('_L') or b.endswith('_L'):
            out.append((a.replace('_L', '_R'), b.replace('_L', '_R')))
    return out


def sym_bones(bl):
    out = list(bl)
    for n, h, t, p in bl:
        if n.endswith('_L'):
            out.append((n[:-2] + '_R', (-h[0], h[1], h[2]), (-t[0], t[1], t[2]), p[:-2] + '_R' if p and p.endswith('_L') else p))
    return out


def nz(p, s=1.0):
    return noise.noise(p * s)


# ================================================================ THE HOLLOW (monster)
def build_hollow():
    J = {
        'pelvis': ((0, 0.0, 1.28), (0.11, 0.08)),
        'hip_L': ((0.1, 0.0, 1.22), 0.06),
        'thighmid_L': ((0.11, 0.04, 0.95), 0.042),
        'knee_L': ((0.12, 0.07, 0.68), 0.066),
        'shinmid_L': ((0.12, 0.03, 0.38), 0.034),
        'ankle_L': ((0.12, -0.02, 0.08), 0.032),
        'heel_L': ((0.12, -0.07, 0.03), 0.03),
        'toe_L': ((0.125, 0.2, 0.015), (0.035, 0.018)),
        'waist': ((0, 0.04, 1.46), (0.075, 0.06)),
        'ribs': ((0, 0.12, 1.66), (0.14, 0.1)),
        'chest': ((0, 0.2, 1.86), (0.15, 0.095)),
        'neckb': ((0, 0.3, 2.0), 0.048),
        'neckt': ((0, 0.4, 2.08), 0.038),
        'shoulder_L': ((0.19, 0.24, 1.94), 0.055),
        'uarm_L': ((0.23, 0.29, 1.62), 0.03),
        'elbow_L': ((0.26, 0.34, 1.32), 0.05),
        'farm_L': ((0.26, 0.42, 0.96), 0.024),
        'wrist_L': ((0.25, 0.48, 0.74), 0.024),
        'palm_L': ((0.25, 0.52, 0.65), (0.035, 0.015)),
    }
    E = [('pelvis', 'hip_L'), ('hip_L', 'thighmid_L'), ('thighmid_L', 'knee_L'), ('knee_L', 'shinmid_L'),
         ('shinmid_L', 'ankle_L'), ('ankle_L', 'heel_L'), ('ankle_L', 'toe_L'),
         ('pelvis', 'waist'), ('waist', 'ribs'), ('ribs', 'chest'), ('chest', 'neckb'), ('neckb', 'neckt'),
         ('chest', 'shoulder_L'), ('shoulder_L', 'uarm_L'), ('uarm_L', 'elbow_L'), ('elbow_L', 'farm_L'),
         ('farm_L', 'wrist_L'), ('wrist_L', 'palm_L')]
    # long fingers
    for f in range(4):
        x = 0.25 + (f - 1.5) * 0.017
        J[f'f{f}a_L'] = ((x, 0.545, 0.57), 0.011)
        J[f'f{f}b_L'] = ((x + (f - 1.5) * 0.008, 0.575, 0.44), 0.009)
        J[f'f{f}c_L'] = ((x + (f - 1.5) * 0.012, 0.6, 0.32), 0.005)
        E += [('palm_L', f'f{f}a_L'), (f'f{f}a_L', f'f{f}b_L'), (f'f{f}b_L', f'f{f}c_L')]
    J['th_L'] = ((0.22, 0.54, 0.6), 0.011); J['th2_L'] = ((0.21, 0.58, 0.5), 0.007)
    E += [('palm_L', 'th_L'), ('th_L', 'th2_L')]
    J = sym(J); E = sym_edges(E)
    body = skin_mesh('HollowBody', J, E, subdiv=2)

    def emaciate(co, n):
        x, y, z = co
        d = nz(co, 9) * 0.004
        # ribs: bands sloping down toward the front
        torso = abs(x) < 0.15
        if 1.5 < z < 1.95 and torso:
            ph = (z + 0.1 * (y - 0.15)) / 0.048
            d += 0.011 * max(0.0, math.sin(ph * math.pi * 2)) ** 3 * (1 if abs(x) > 0.025 else 0.3)
            if n.y > 0.3 and abs(x) < 0.03:
                d -= 0.008  # sternum groove
        # sunken stomach under the ribs
        if 1.36 < z < 1.52 and n.y > 0.2 and torso:
            d -= 0.018 * math.sin((z - 1.36) / 0.16 * math.pi)
        # spine knobs down the back
        if 1.3 < z < 2.0 and n.y < -0.4 and abs(x) < 0.035:
            d += 0.012 * max(0.0, math.sin(z / 0.055 * math.pi * 2)) ** 2
        # hip bones jutting
        if 1.22 < z < 1.34 and abs(abs(x) - 0.1) < 0.03 and n.y > 0:
            d += 0.012
        # collar bones
        if 1.88 < z < 1.96 and n.y > 0.3 and 0.03 < abs(x) < 0.15:
            d += 0.009
        return d
    displace(body, emaciate)

    def skin_col(co, n):
        x, y, z = co
        base = Vector((0.66, 0.63, 0.57))
        m = nz(co, 6) * 0.5 + nz(co, 23) * 0.25
        c = base * (0.92 + m * 0.25)
        bruise = max(0.0, nz(co + Vector((3, 1, 2)), 4)) ** 2
        c = c.lerp(Vector((0.35, 0.25, 0.33)), min(0.7, bruise * 1.4))
        # dirt & dark extremities
        if z < 0.25:
            c = c.lerp(Vector((0.12, 0.1, 0.08)), min(0.85, (0.25 - z) * 4))
        tip = 0.0
        if z < 0.6 and abs(x) > 0.18 and y > 0.45:
            tip = min(1.0, (0.6 - z) / 0.35)
        c = c.lerp(Vector((0.08, 0.06, 0.05)), tip * 0.9)  # blackened fingers
        # cavity darkening between ribs & under bones
        if 1.5 < z < 1.95 and abs(x) < 0.15:
            ph = (z + 0.1 * (y - 0.15)) / 0.048
            if math.sin(ph * math.pi * 2) < -0.3:
                c *= 0.72
        if 1.36 < z < 1.52 and n.y > 0.2 and abs(x) < 0.15:
            c *= 0.8
        # dried blood down the chest
        if n.y > 0.3 and 1.45 < z < 1.95 and abs(x - 0.02 * math.sin(z * 9)) < 0.022 + 0.012 * nz(co, 6):
            c = c.lerp(Vector((0.22, 0.02, 0.02)), 0.6)
        return c
    paint(body, skin_col)
    body.data.materials.append(vc_material('HollowSkin', 0.45))

    B = [('hips', (0, 0, 1.2), (0, 0.02, 1.4), None),
         ('spine', (0, 0.02, 1.4), (0, 0.15, 1.75), 'hips'),
         ('chest', (0, 0.15, 1.75), (0, 0.28, 1.98), 'spine'),
         ('neck', (0, 0.28, 1.98), (0, 0.42, 2.09), 'chest'),
         ('head', (0, 0.42, 2.09), (0, 0.55, 2.3), 'neck'),
         ('shoulder_L', (0.03, 0.22, 1.9), (0.19, 0.24, 1.94), 'chest'),
         ('upperarm_L', (0.19, 0.24, 1.94), (0.26, 0.34, 1.32), 'shoulder_L'),
         ('forearm_L', (0.26, 0.34, 1.32), (0.25, 0.48, 0.74), 'upperarm_L'),
         ('hand_L', (0.25, 0.48, 0.74), (0.25, 0.53, 0.62), 'forearm_L'),
         ('fingers_L', (0.25, 0.53, 0.62), (0.25, 0.6, 0.32), 'hand_L'),
         ('thigh_L', (0.1, 0.0, 1.22), (0.12, 0.07, 0.68), 'hips'),
         ('shin_L', (0.12, 0.07, 0.68), (0.12, -0.02, 0.08), 'thigh_L'),
         ('foot_L', (0.12, -0.02, 0.08), (0.125, 0.2, 0.015), 'shin_L')]
    B = sym_bones(B)
    arm = build_armature('HollowRig', B)
    bind(body, arm, B)
    return arm, body


# ================================================================ SURVIVOR
def head_mesh(name, scale, features):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=40, ring_count=28, radius=1.0)
    ob = bpy.context.active_object; ob.name = name
    sx, sy, sz = scale
    me = ob.data
    for v in me.vertices:
        x, y, z = v.co
        # base skull shape: flatter sides, longer back, narrower jaw
        jaw = 1.0 - 0.28 * max(0.0, -z) ** 1.5
        nx, ny, nz_ = x * jaw, y * (1.0 + 0.08 * max(0.0, -y)), z
        if features:
            fy = max(0.0, y)  # front
            # nose
            nd = math.exp(-((x / 0.13) ** 2 + ((z + 0.05) / 0.22) ** 2))
            ny += 0.2 * nd * fy
            # brow ridge
            ny += 0.05 * math.exp(-(((z - 0.22) / 0.07) ** 2)) * fy * (1 - 0.5 * abs(x))
            # eye sockets
            for ex in (-0.34, 0.34):
                e = math.exp(-(((x - ex) / 0.16) ** 2 + ((z - 0.1) / 0.1) ** 2))
                ny -= 0.09 * e * fy
            # cheekbones
            for ex in (-0.5, 0.5):
                ny += 0.04 * math.exp(-(((x - ex) / 0.15) ** 2 + ((z + 0.05) / 0.1) ** 2)) * fy
            # lips + chin
            ny += 0.05 * math.exp(-((x / 0.22) ** 2 + ((z + 0.4) / 0.06) ** 2)) * fy
            ny += 0.06 * math.exp(-((x / 0.25) ** 2 + ((z + 0.72) / 0.12) ** 2)) * fy
            # ears
            for s in (-1, 1):
                if x * s > 0.85:
                    nx += s * 0.1 * math.exp(-((y / 0.18) ** 2 + ((z - 0.02) / 0.22) ** 2))
        v.co = Vector((nx * sx, ny * sy, nz_ * sz))
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    return ob


def build_survivor():
    J = {
        'pelvis': ((0, 0, 0.96), (0.15, 0.11)),
        'hip_L': ((0.09, 0.0, 0.9), 0.082),
        'thighmid_L': ((0.095, 0.01, 0.7), 0.072),
        'knee_L': ((0.1, 0.02, 0.5), 0.056),
        'calf_L': ((0.1, -0.005, 0.32), 0.058),
        'ankle_L': ((0.1, -0.01, 0.1), 0.05),
        'heel_L': ((0.1, -0.06, 0.04), (0.05, 0.04)),
        'toe_L': ((0.1, 0.15, 0.04), (0.055, 0.04)),
        'waist': ((0, 0.0, 1.1), (0.155, 0.11)),
        'chest': ((0, 0.01, 1.3), (0.165, 0.115)),
        'shtop': ((0, 0.0, 1.43), (0.14, 0.095)),
        'neckb': ((0, 0.0, 1.49), 0.064),
        'neckt': ((0, 0.01, 1.55), 0.06),
        'shoulder_L': ((0.175, 0.0, 1.41), 0.062),
        'elbow_L': ((0.205, -0.01, 1.13), 0.046),
        'wrist_L': ((0.22, 0.02, 0.88), 0.034),
        'hand_L': ((0.228, 0.03, 0.8), (0.042, 0.02)),
        'fing_L': ((0.232, 0.035, 0.72), (0.036, 0.014)),
    }
    E = [('pelvis', 'hip_L'), ('hip_L', 'thighmid_L'), ('thighmid_L', 'knee_L'), ('knee_L', 'calf_L'), ('calf_L', 'ankle_L'),
         ('ankle_L', 'heel_L'), ('ankle_L', 'toe_L'), ('pelvis', 'waist'), ('waist', 'chest'), ('chest', 'shtop'),
         ('shtop', 'neckb'), ('neckb', 'neckt'), ('shtop', 'shoulder_L'), ('shoulder_L', 'elbow_L'), ('elbow_L', 'wrist_L'),
         ('wrist_L', 'hand_L'), ('hand_L', 'fing_L')]
    J = sym(J); E = sym_edges(E)
    body = skin_mesh('SurvivorBody', J, E, subdiv=2)

    def folds(co, n):
        x, y, z = co
        d = nz(co, 14) * 0.004
        if 1.0 < z < 1.45:  # jacket: puffier, horizontal quilting
            d += 0.006 + 0.0025 * math.sin(z * 45)
        if 0.12 < z < 0.92 and abs(x) < 0.16:  # trouser creases
            d += 0.004 * math.sin(z * 40 + x * 30)
        if 1.12 < z < 1.42 and abs(x) > 0.18:  # sleeves
            d += 0.002
        return d
    displace(body, folds)
    MARK = Vector((1.0, 0.0, 1.0))  # jacket marker, recoloured per player in game

    def col(co, n):
        x, y, z = co
        if z < 0.13:
            return Vector((0.06, 0.05, 0.045)) * (0.9 + nz(co, 20) * 0.2)  # boots
        if z < 0.94 and abs(x) < 0.17:
            return Vector((0.13, 0.14, 0.17)) * (0.85 + nz(co, 12) * 0.3)  # jeans
        if abs(x) > 0.18 and z < 0.89:
            return Vector((0.62, 0.45, 0.36))  # hands
        if z > 1.475:
            return Vector((0.62, 0.45, 0.36))  # neck
        return MARK
    paint(body, col)
    body.data.materials.append(vc_material('SurvivorMat', 0.75))

    head = head_mesh('SurvivorHead', (0.082, 0.1, 0.116), True)
    head.location = (0, 0.014, 1.655)

    def hcol(co, n):
        x, y, z = co
        skin = Vector((0.66, 0.48, 0.38)) * (0.95 + nz(co, 30) * 0.1)
        # hair: top + back
        if (z > 0.025 and y < 0.07) or (z > 0.075) or (y < -0.03 and z > -0.06):
            return Vector((0.07, 0.05, 0.035)) * (0.8 + nz(co, 60) * 0.4)
        # eyes / brows / lips
        for ex in (-0.027, 0.027):
            dd = math.hypot(x - ex, z - 0.011)
            if y > 0.06 and dd < 0.012:
                return Vector((0.02, 0.02, 0.02)) if dd < 0.006 else Vector((0.85, 0.82, 0.78))
            if y > 0.06 and abs(x - ex) < 0.018 and 0.022 < z < 0.03:
                return Vector((0.08, 0.06, 0.04))
        if y > 0.07 and abs(x) < 0.02 and -0.048 < z < -0.04:
            return Vector((0.45, 0.22, 0.2))
        return skin
    paint(head, hcol)
    head.data.materials.append(body.data.materials[0])
    # hair volume
    displace(head, lambda co, n: 0.008 if ((co.z > 0.025 and co.y < 0.07) or co.z > 0.075 or (co.y < -0.03 and co.z > -0.06)) else 0)
    bpy.ops.object.transform_apply(location=True)

    # backpack
    bpy.ops.mesh.primitive_cube_add(size=1)
    bp = bpy.context.active_object; bp.name = 'Backpack'
    bp.scale = (0.3, 0.14, 0.38); bp.location = (0, -0.17, 1.24)
    bpy.ops.object.transform_apply(location=True, scale=True)
    bev = bp.modifiers.new('Bevel', 'BEVEL'); bev.width = 0.03; bev.segments = 3
    dg = bpy.context.evaluated_depsgraph_get()
    m2 = bpy.data.meshes.new_from_object(bp.evaluated_get(dg)); bpy.data.objects.remove(bp)
    bp = bpy.data.objects.new('Backpack', m2); bpy.context.collection.objects.link(bp)
    paint(bp, lambda co, n: Vector((0.09, 0.1, 0.08)) * (0.9 + nz(co, 25) * 0.2))
    bp.data.materials.append(body.data.materials[0])

    B = [('hips', (0, 0, 0.88), (0, 0, 1.08), None),
         ('spine', (0, 0, 1.08), (0, 0.01, 1.3), 'hips'),
         ('chest', (0, 0.01, 1.3), (0, 0, 1.48), 'spine'),
         ('neck', (0, 0, 1.48), (0, 0.01, 1.57), 'chest'),
         ('head', (0, 0.01, 1.57), (0, 0.01, 1.78), 'neck'),
         ('upperarm_L', (0.175, 0, 1.41), (0.205, -0.01, 1.13), 'chest'),
         ('forearm_L', (0.205, -0.01, 1.13), (0.22, 0.02, 0.88), 'upperarm_L'),
         ('hand_L', (0.22, 0.02, 0.88), (0.232, 0.035, 0.7), 'forearm_L'),
         ('thigh_L', (0.09, 0, 0.9), (0.1, 0.02, 0.5), 'hips'),
         ('shin_L', (0.1, 0.02, 0.5), (0.1, -0.01, 0.1), 'thigh_L'),
         ('foot_L', (0.1, -0.01, 0.1), (0.1, 0.15, 0.04), 'shin_L')]
    B = sym_bones(B)
    arm = build_armature('SurvivorRig', B)
    bind(body, arm, B)
    bind(head, arm, B, forced='head')
    bind(bp, arm, B, forced='chest')
    return arm, body, head, bp


def preview(objs, path, cam_loc, target, lens=50):
    """Quick Eevee render of the given objects for checking against references."""
    for o in bpy.context.scene.objects:
        o.hide_render = o not in objs and o.type not in ('CAMERA', 'LIGHT')
    sc = bpy.context.scene
    try:
        sc.render.engine = 'BLENDER_EEVEE_NEXT'
    except Exception:
        sc.render.engine = 'BLENDER_EEVEE'
    sc.render.resolution_x = 700; sc.render.resolution_y = 900
    if not sc.world:
        sc.world = bpy.data.worlds.new('W')
    sc.world.color = (0.01, 0.01, 0.012)
    cam = bpy.data.objects.get('PrevCam')
    if not cam:
        cam = bpy.data.objects.new('PrevCam', bpy.data.cameras.new('PrevCam')); sc.collection.objects.link(cam)
        key = bpy.data.objects.new('Key', bpy.data.lights.new('Key', 'SPOT')); sc.collection.objects.link(key)
        key.data.energy = 900; key.data.spot_size = 0.9; key.location = (1.2, 3.0, 2.2)
        fill = bpy.data.objects.new('Fill', bpy.data.lights.new('Fill', 'AREA')); sc.collection.objects.link(fill)
        fill.data.energy = 60; fill.location = (-2, 1, 2.5)
        for l in (key, fill):
            l.rotation_euler = (Vector(target) - l.location).to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens
    cam.location = cam_loc
    cam.rotation_euler = (Vector(target) - Vector(cam_loc)).to_track_quat('-Z', 'Y').to_euler()
    sc.camera = cam
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('PREVIEW', path)


reset()
arm, body = build_hollow()
export(os.path.join(OUT, 'hollow.glb'), [arm, body])
if PREVIEW:
    preview([body], os.path.join(PREVIEW, 'hollow_front.png'), (0.6, 3.6, 1.5), (0, 0.2, 1.3))
    preview([body], os.path.join(PREVIEW, 'hollow_side.png'), (3.6, 0.6, 1.5), (0, 0.2, 1.3))

reset()
arm, body, head, bp = build_survivor()
export(os.path.join(OUT, 'survivor.glb'), [arm, body, head, bp])
if PREVIEW:
    preview([body, head, bp], os.path.join(PREVIEW, 'survivor_front.png'), (0.5, 3.0, 1.2), (0, 0, 0.95))
    preview([body, head, bp], os.path.join(PREVIEW, 'survivor_face.png'), (0.15, 0.7, 1.68), (0, 0, 1.66), 60)
print('DONE')
