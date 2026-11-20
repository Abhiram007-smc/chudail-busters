"""CHUDAIL BUSTERS: ghost faces in the walls.

Takes the CC0 Poly Haven "Marble Bust 01" (python3 blender/fetch_assets.py) and turns its head into a screaming ghost
face -> public/models/ghost_face.glb: cut off at the neck, the jaw dragged down into a long scream (a black gaping
mouth), hollow black eyes, black tears, pale grey-white plaster. The game sets these half into the walls, and they
turn to follow you while you are not looking. (The stone statues of her are built in the game from her own model.)

  Blender -b --factory-startup --python blender/build_statues.py
"""
import bpy, bmesh, math, os
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.join(HERE, 'assets')
MODELS = os.path.join(HERE, '..', 'public', 'models')
TMP = os.environ.get('STATUE_TMP') or os.path.join('/tmp', 'chudail_statues')
os.makedirs(TMP, exist_ok=True)


def fresh():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load(name, height, target_tris):
    fresh()
    bpy.ops.import_scene.gltf(filepath=os.path.join(ASSETS, name, f'{name}_1k.gltf'))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    for o in bpy.data.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.parent = None
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    for o in [o for o in bpy.data.objects if o != ob]:
        bpy.data.objects.remove(o, do_unlink=True)
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > target_tris:
        md = ob.modifiers.new('dec', 'DECIMATE'); md.ratio = target_tris / tris
        bpy.ops.object.modifier_apply(modifier='dec')
    # base centred on the origin, standing on z = 0, scaled to height
    vs = [ob.matrix_world @ v.co for v in ob.data.vertices]
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    s = height / (mx.z - mn.z)
    for v in ob.data.vertices:
        v.co = Vector(((v.co.x - (mn.x + mx.x) / 2) * s, (v.co.y - (mn.y + mx.y) / 2) * s, (v.co.z - mn.z) * s))
    ob.data.update()
    print(name, 'tris', tris, '->', sum(len(p.vertices) - 2 for p in ob.data.polygons), 'size', [round((mx[i] - mn[i]) * s, 2) for i in range(3)])
    return ob


def age_textures(ob, darken=0.55, tint=(0.82, 0.86, 0.80), grime=0.55, size=512):
    """Darker, greener-grey stone, dirt pooling low on the model (by UV v, which runs bottom->top on these scans
    only roughly, so the grime is a soft blotchy noise instead), and every texture shrunk to `size`."""
    rng = np.random.default_rng(7)
    for slot in ob.material_slots:
        m = slot.material
        for n in m.node_tree.nodes:
            if n.type != 'TEX_IMAGE' or not n.image:
                continue
            img = n.image
            img.scale(size, size)
            if 'diff' in img.name.lower() or n.outputs[0].links and n.outputs[0].links[0].to_socket.name == 'Base Color':
                px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)
                rgb = px[..., :3]
                lum = rgb.mean(axis=2, keepdims=True)
                rgb = (rgb * 0.45 + lum * 0.55) * np.array(tint, dtype=np.float32) * darken  # desaturate, tint, darken
                # blotchy grime: low-frequency noise
                nz = rng.random((16, 16)).astype(np.float32)
                nz = np.kron(nz, np.ones((size // 16, size // 16), dtype=np.float32))
                k = 9
                for _ in range(2):  # cheap blur
                    nz = (np.roll(nz, k, 0) + np.roll(nz, -k, 0) + np.roll(nz, k, 1) + np.roll(nz, -k, 1) + nz) / 5
                rgb *= (1 - grime * np.clip(nz - 0.35, 0, 1)[..., None] * 1.6)
                px[..., :3] = np.clip(rgb, 0, 1)
                img.pixels = px.ravel().tolist()
            img.filepath_raw = os.path.join(TMP, f'{ob.name}_{img.name}.jpg'.replace(' ', '_'))
            img.file_format = 'JPEG'
            img.save()
        b = m.node_tree.nodes.get('Principled BSDF')
        if b:
            b.inputs['Roughness'].default_value = 0.8


def black(name='tears'):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (0.004, 0.002, 0.002, 1); b.inputs['Roughness'].default_value = 0.12
    return m


def add_tears(bust):
    """Black tears from both eyes, laid onto the face (ray cast from the front, then shrinkwrapped)."""
    dg = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(bust, dg)
    vs = [v.co for v in bust.data.vertices]
    W = max(v.x for v in vs) - min(v.x for v in vs); H = max(v.z for v in vs)
    # the face looks down -Y (glTF +Z forward); find the front of the face at eye height
    m = black()
    made = []
    for sx in (-1, 1):
        x, z0 = sx * 0.115 * W, 0.70 * H
        hit = bvh.ray_cast(Vector((x, -5, z0)), Vector((0, 1, 0)))
        if hit[0] is None:
            continue
        y0 = hit[0].y
        bm = bmesh.new()
        n = 14
        for k in range(n + 1):  # a thin wavering strip running down the cheek
            t = k / n
            z = z0 - t * 0.2 * H
            cx = x + sx * 0.01 * H * math.sin(t * 5) + sx * t * 0.015 * H
            w = 0.006 * H * (1.2 - t * 0.6)
            bm.verts.new((cx - w, y0 - 0.03, z)); bm.verts.new((cx + w, y0 - 0.03, z))
        bm.verts.ensure_lookup_table()
        for k in range(n):
            a, b, c, d = bm.verts[k * 2], bm.verts[k * 2 + 1], bm.verts[k * 2 + 3], bm.verts[k * 2 + 2]
            bm.faces.new((a, b, c, d))
        me = bpy.data.meshes.new('tear'); bm.to_mesh(me); bm.free()
        o = bpy.data.objects.new('tear', me); bpy.context.scene.collection.objects.link(o); o.data.materials.append(m)
        sw = o.modifiers.new('wrap', 'SHRINKWRAP'); sw.target = bust; sw.wrap_method = 'PROJECT'; sw.use_project_y = True
        sw.use_negative_direction = True; sw.use_positive_direction = True; sw.offset = 0.0025
        # a dark, wet eye socket
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022 * H, segments=12, ring_count=8, location=(x, y0 + 0.004, z0 + 0.005))
        eye = bpy.context.active_object; eye.scale = (1.15, 0.45, 0.8); eye.data.materials.append(m)
        made += [o, eye]
    for o in made:
        bpy.context.view_layer.objects.active = o
        for md in list(o.modifiers):
            bpy.ops.object.modifier_apply(modifier=md.name)
    print('tears', len(made))
    return made


def ghostify(bust):
    """Head and neck only; the jaw pulled down into a scream. Features are found from the nose tip (the most forward
    point of the head), so the eyes and mouth land where they really are."""
    vs = bust.data.vertices
    H = max(v.co.z for v in vs)
    head = [v.co for v in vs if v.co.z > 0.62 * H]
    nose = min(head, key=lambda c: c.y).copy()
    cut = nose.z - 0.17
    bm = bmesh.new(); bm.from_mesh(bust.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < cut], context='VERTS')
    mouth = nose.z - 0.032
    for v in bm.verts:  # under the mouth line, at the front, the jaw hangs open much too far
        if v.co.z < mouth and v.co.y < nose.y + 0.09 and abs(v.co.x - nose.x) < 0.075:
            k = min(1.0, (mouth - v.co.z) / 0.035)
            side = max(0.0, 1 - (abs(v.co.x - nose.x) / 0.075) ** 2)
            front = min(1.0, max(0.0, (nose.y + 0.09 - v.co.y) / 0.05))
            v.co.z -= 0.06 * k * side * front
    for v in bm.verts:
        v.co.z -= cut
    bm.to_mesh(bust.data); bm.free(); bust.data.update()
    for slot in bust.material_slots:
        bb = slot.material.node_tree.nodes.get('Principled BSDF')
        if bb:
            bb.inputs['Roughness'].default_value = 0.85
    return Vector((nose.x, nose.y, nose.z - cut))


def cavity(name, loc, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=1, segments=18, ring_count=12, location=loc)
    o = bpy.context.active_object; o.name = name; o.scale = scale; o.data.materials.append(mat)
    return o


def export(path, objs):
    for o in bpy.data.objects:
        o.select_set(o in objs)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_apply=True,
                              export_image_format='JPEG', export_jpeg_quality=80, export_lights=False, export_cameras=False)
    print('EXPORTED', path, round(os.path.getsize(path) / 1e6, 2), 'MB')


# the ghost face
b = load('marble_bust_01', 0.78, 6000)
b.name = 'ghost_face'
age_textures(b, darken=1.0, tint=(0.86, 0.9, 0.95), grime=0.45)  # pale, cold, dirty
nose = ghostify(b)
dg = bpy.context.evaluated_depsgraph_get()
bvh = BVHTree.FromObject(b, dg)
m = black('void')
def front_y(x, z, fallback):
    h = bvh.ray_cast(Vector((x, -5, z)), Vector((0, 1, 0)))
    return h[0].y if h[0] else fallback
mz = nose.z - 0.075  # the middle of the dropped, gaping mouth
parts = [cavity('mouth', (nose.x, front_y(nose.x, mz, nose.y + 0.04) + 0.012, mz), (0.024, 0.022, 0.05), m)]
eye_z = nose.z + 0.05
for sx in (-1, 1):
    ex = nose.x + sx * 0.032
    parts.append(cavity('eye', (ex, front_y(ex, eye_z, nose.y + 0.03) + 0.006, eye_z), (0.02, 0.014, 0.016), m))
tears = []
for sx in (-1, 1):
    bm = bmesh.new(); n = 14
    x0 = nose.x + sx * 0.032
    for k in range(n + 1):
        t = k / n; z = eye_z - 0.01 - t * 0.12
        cx = x0 + sx * 0.006 * math.sin(t * 5) + sx * t * 0.008; w = 0.004 * (1.2 - t * 0.6)
        bm.verts.new((cx - w, nose.y - 0.08, z)); bm.verts.new((cx + w, nose.y - 0.08, z))
    bm.verts.ensure_lookup_table()
    for k in range(n):
        bm.faces.new((bm.verts[k * 2], bm.verts[k * 2 + 1], bm.verts[k * 2 + 3], bm.verts[k * 2 + 2]))
    me = bpy.data.meshes.new('tear'); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new('tear', me); bpy.context.scene.collection.objects.link(o); o.data.materials.append(m)
    sw = o.modifiers.new('wrap', 'SHRINKWRAP'); sw.target = b; sw.wrap_method = 'PROJECT'; sw.use_project_y = True
    sw.use_negative_direction = True; sw.use_positive_direction = True; sw.offset = 0.002
    bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier='wrap')
    tears.append(o)
print('nose', [round(c, 3) for c in nose])
export(os.path.join(MODELS, 'ghost_face.glb'), [b] + parts + tears)
# a look at it, for checking
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); bpy.context.scene.collection.objects.link(cam)
cam.location = (nose.x + 0.12, nose.y - 0.75, nose.z); cam.rotation_euler = (math.radians(90), 0, math.radians(9))
sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sun.data.energy = 3; sun.rotation_euler = (math.radians(50), 0, math.radians(-30)); bpy.context.scene.collection.objects.link(sun)
sc = bpy.context.scene; sc.camera = cam; sc.render.engine = 'BLENDER_EEVEE'; sc.render.resolution_x = sc.render.resolution_y = 480
sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.02, 0.02, 0.025)
sc.render.filepath = os.path.join(TMP, 'ghost_face_preview.png'); bpy.ops.render.render(write_still=True)
print('PREVIEW', sc.render.filepath)
