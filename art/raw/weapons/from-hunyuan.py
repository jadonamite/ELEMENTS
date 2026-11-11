# Turns the raw Hunyuan weapon models into game-size GLBs.
#   blender -b --python from-hunyuan.py -- --raw <dir with *.glb> --out <export dir> [--only name ...]
# Then: node compress-blender.mjs <dir holding @gltf-transform> (meshopt + webp into client/public).
#
# Per model: stand it along +Y (Blender +Z) with the grip at the origin, scale it to its real
# length, straighten the blade, decimate, unwrap, bake colour / normal / roughness / metal from the
# raw mesh at 1K, and add the Grip and Tip empties the game reads.
import bpy, bmesh, sys, os, math, json
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(flag, default=None):
    return argv[argv.index(flag) + 1] if flag in argv else default
RAW = arg('--raw')
OUT = arg('--out')
ONLY = argv[argv.index('--only') + 1:] if '--only' in argv else None
WORK = os.path.join(OUT, '_work')
os.makedirs(WORK, exist_ok=True)

# kind: blade (sword or knife), club, scabbard. grip_end: which end of the raw model is the hilt.
SPECS = {
    'worn-iron-sword': dict(raw='worn_iron_sword', length=0.95, tris=5500, kind='blade'),
    'deserter-sword':  dict(raw='deserter_sword',  length=1.00, tris=5500, kind='blade'),
    'long-knife':      dict(raw='long_knife',      length=0.52, tris=4500, kind='blade'),
    'bound-club':      dict(raw='bound_club',      length=0.62, tris=4500, kind='club'),
    'back-scabbard':   dict(raw='back_scabbard',   length=0.78, tris=4500, kind='scabbard'),
}
ORDER = ['worn-iron-sword', 'deserter-sword', 'long-knife', 'bound-club', 'back-scabbard']
TEX = 1024
STATE = {}
REPORT = {}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def load_raw(path):
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.parent = None
    return obj


def read_points(obj):
    n = len(obj.data.vertices)
    a = np.empty(n * 3, dtype=np.float64)
    obj.data.vertices.foreach_get('co', a)
    m = np.array(obj.matrix_world)
    return a.reshape(-1, 3) @ m[:3, :3].T + m[:3, 3]


def write_points(obj, pts):
    obj.matrix_world = obj.matrix_world.__class__.Identity(4)
    obj.data.vertices.foreach_set('co', pts.astype(np.float32).ravel())
    obj.data.update()


def end_size(q, lo, hi, frac=0.04):
    """Mean cross-section (width x thickness) of the first and last slice of the long axis."""
    span = hi - lo
    out = []
    for sel in (q[:, 0] < lo + span * frac, q[:, 0] > hi - span * frac):
        s = q[sel]
        out.append(float((s[:, 1].max() - s[:, 1].min()) * (s[:, 2].max() - s[:, 2].min())) if len(s) else 0.0)
    return out


def align(obj, spec):
    """Long axis -> +Z, width -> X, thickness -> Y, hilt end at low Z, metres, grip at z = 0."""
    P = read_points(obj)
    c = P.mean(axis=0)
    _, _, vt = np.linalg.svd(P[::7] - c, full_matrices=False)
    q = (P - c) @ vt.T
    lo, hi = q[:, 0].min(), q[:, 0].max()
    first, last = end_size(q, lo, hi)
    # The hilt is the bulky end of a sword, knife or scabbard mouth; a club's grip is the slim end.
    grip_low = (first > last) if spec['kind'] != 'club' else (first < last)
    if not grip_low:
        q[:, 0] *= -1
        q[:, 1] *= -1  # keep the frame right-handed
        lo, hi = -hi, -lo
    q[:, 0] -= lo
    scale = spec['length'] / (hi - lo)
    q *= scale
    # q columns are (long, wide, thin): reorder to Blender (X wide, Y thin, Z long)
    pts = np.stack([q[:, 1], q[:, 2], q[:, 0]], axis=1)
    REPORT.setdefault(spec['name'], {})['raw_to_game_scale'] = round(float(scale), 4)
    return pts


def slices(pts, step=0.01):
    z = pts[:, 2]
    edges = np.arange(0.0, z.max() + step, step)
    idx = np.digitize(z, edges) - 1
    return edges, idx


def find_guard(pts, limit):
    """Z of the widest slice within the first `limit` metres from the hilt end: the crossguard."""
    edges, idx = slices(pts)
    best, where = 0.0, 0.0
    for i in range(len(edges) - 1):
        if edges[i] > limit:
            break
        s = pts[idx == i]
        if len(s) == 0:
            continue
        w = s[:, 0].max() - s[:, 0].min()
        if w > best:
            best, where = w, (edges[i] + edges[i + 1]) / 2
    return where, best


def centreline(pts, z0, axis=1, step=0.015):
    edges = np.arange(z0, pts[:, 2].max() + step, step)
    idx = np.digitize(pts[:, 2], edges) - 1
    zs, ms = [], []
    for i in range(len(edges) - 1):
        s = pts[idx == i]
        if len(s) < 20:
            continue
        zs.append((edges[i] + edges[i + 1]) / 2)
        ms.append((s[:, axis].max() + s[:, axis].min()) / 2)
    return np.array(zs), np.array(ms)


def straighten(pts, guard_z):
    """Remove the bow along the blade by subtracting a fitted quadratic, anchored at the guard."""
    z0 = guard_z + 0.02
    zs, ms = centreline(pts, z0)
    if len(zs) < 6:
        return pts, 0.0, 0.0
    coef = np.polyfit(zs, ms, 2)
    fit = np.polyval(coef, zs)
    before = float(np.ptp(ms - np.polyval(np.polyfit(zs, ms, 1), zs)))
    z = pts[:, 2]
    ramp = np.clip((z - guard_z) / 0.04, 0.0, 1.0)
    ramp = ramp * ramp * (3 - 2 * ramp)
    ref = np.polyval(coef, z0)
    out = pts.copy()
    out[:, 1] -= ramp * (np.polyval(coef, z) - ref)
    zs2, ms2 = centreline(out, z0)
    after = float(np.ptp(ms2 - np.polyval(np.polyfit(zs2, ms2, 1), zs2)))
    return out, before, after


def smooth_marker(name, location, parent=None):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = 'PLAIN_AXES'
    e.empty_display_size = 0.03
    e.location = location
    bpy.context.scene.collection.objects.link(e)
    return e


def weld(obj):
    """The glTF import splits vertices along texture seams; join them so the mesh is one surface."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    while obj.data.uv_layers:
        obj.data.uv_layers.remove(obj.data.uv_layers[0])
    bpy.ops.mesh.customdata_custom_splitnormals_clear()
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=1e-5)
    bpy.ops.object.mode_set(mode='OBJECT')


def decimate_to(obj, tris):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    now = len(obj.data.polygons)
    if now > tris * 25:
        m = obj.modifiers.new('stage1', 'DECIMATE')
        m.ratio = (tris * 12) / now
        bpy.ops.object.modifier_apply(modifier=m.name)
        now = len(obj.data.polygons)
    m = obj.modifiers.new('stage2', 'DECIMATE')
    m.ratio = tris / now
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.quads_convert_to_tris(quad_method='BEAUTY')
    bpy.ops.object.mode_set(mode='OBJECT')


def shade(obj, degrees=35):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(degrees))


def unwrap(obj, v_floor=0.0):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.006, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode='OBJECT')
    if v_floor > 0:
        uv = obj.data.uv_layers.active.data
        for d in uv:
            d.uv[1] = v_floor + d.uv[1] * (1.0 - v_floor)


def new_image(name, colour, srgb):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    img.generated_color = colour
    img.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    return img


def emit_from(mat, socket):
    """Route one Principled input into an Emission shader so Cycles can bake it unlit."""
    nt = mat.node_tree
    pb = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    out = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial')
    em = nt.nodes.new('ShaderNodeEmission')
    inp = pb.inputs[socket]
    if inp.is_linked:
        nt.links.new(inp.links[0].from_socket, em.inputs['Color'])
    else:
        v = inp.default_value
        em.inputs['Color'].default_value = tuple(v) if hasattr(v, '__len__') else (v, v, v, 1.0)
    nt.links.new(em.outputs['Emission'], out.inputs['Surface'])
    return pb, out, em


def bake_pass(high, low, kind, socket, image):
    sc = bpy.context.scene
    for slot in high.data.materials:
        pass
    saved = []
    if kind == 'EMIT':
        for mat in high.data.materials:
            nt = mat.node_tree
            out = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeOutputMaterial')
            old = out.inputs['Surface'].links[0].from_socket if out.inputs['Surface'].is_linked else None
            pb, out, em = emit_from(mat, socket)
            saved.append((mat, out, old, em))
    nt = low.data.materials[0].node_tree
    node = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeTexImage')
    node.image = image
    nt.nodes.active = node
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    b = sc.render.bake
    b.use_selected_to_active = True
    b.cage_extrusion = 0.012
    b.max_ray_distance = 0.03
    b.margin = 8
    b.margin_type = 'EXTEND'
    b.target = 'IMAGE_TEXTURES'
    if kind == 'NORMAL':
        b.normal_space = 'TANGENT'
        bpy.ops.object.bake(type='NORMAL')
    else:
        bpy.ops.object.bake(type='EMIT')
    for mat, out, old, em in saved:
        if old:
            mat.node_tree.links.new(old, out.inputs['Surface'])
        mat.node_tree.nodes.remove(em)


def pixels(img):
    a = np.empty(len(img.pixels), dtype=np.float32)
    img.pixels.foreach_get(a)
    return a.reshape(TEX, TEX, 4)


def save_png(img, path):
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()


def bake_all(high, low, name):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 4
    sc.cycles.use_denoising = False
    mat = bpy.data.materials.new(name + '_bake')
    mat.use_nodes = True
    low.data.materials.clear()
    low.data.materials.append(mat)
    mat.node_tree.nodes.new('ShaderNodeTexImage')
    col = new_image(name + '_colour', (0.5, 0.5, 0.5, 1), True)
    nor = new_image(name + '_normal', (0.5, 0.5, 1, 1), False)
    rou = new_image(name + '_rough', (0.5, 0.5, 0.5, 1), False)
    met = new_image(name + '_metal', (0, 0, 0, 1), False)
    bake_pass(high, low, 'EMIT', 'Base Color', col)
    bake_pass(high, low, 'NORMAL', None, nor)
    bake_pass(high, low, 'EMIT', 'Roughness', rou)
    bake_pass(high, low, 'EMIT', 'Metallic', met)
    return col, nor, rou, met


def finish_material(low, name, col, nor, rou, met, extra=None):
    """Colour map, normal map and one packed occlusion/roughness/metal map, as glTF expects."""
    paths = {}
    for k, img in (('colour', col), ('normal', nor)):
        paths[k] = os.path.join(WORK, f'{name}_{k}.png')
        save_png(img, paths[k])
    r, m = pixels(rou)[..., 0], pixels(met)[..., 0]
    orm = np.ones((TEX, TEX, 4), dtype=np.float32)
    orm[..., 0] = 1.0
    orm[..., 1] = r
    orm[..., 2] = m
    oi = bpy.data.images.new(name + '_orm', TEX, TEX, alpha=False)
    oi.colorspace_settings.name = 'Non-Color'
    oi.pixels.foreach_set(orm.ravel())
    paths['orm'] = os.path.join(WORK, f'{name}_orm.png')
    save_png(oi, paths['orm'])
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    pb = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(pb.outputs['BSDF'], out.inputs['Surface'])
    def tex(path, srgb):
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = bpy.data.images.load(path)
        t.image.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
        return t
    nt.links.new(tex(paths['colour'], True).outputs['Color'], pb.inputs['Base Color'])
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    nt.links.new(tex(paths['orm'], False).outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], pb.inputs['Roughness'])
    nt.links.new(sep.outputs['Blue'], pb.inputs['Metallic'])
    nm = nt.nodes.new('ShaderNodeNormalMap')
    nt.links.new(tex(paths['normal'], False).outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], pb.inputs['Normal'])
    low.data.materials.clear()
    low.data.materials.append(mat)
    return paths


STRAP_THICKNESS = 0.004


def leather_patch(low, tip_z):
    """UV pixel box inside the largest flat face of the scabbard's middle: its own leather."""
    uv = low.data.uv_layers.active.data
    best = None
    for p in low.data.polygons:
        if abs(p.normal.y) < 0.85 or not (tip_z * 0.45 < p.center.z < tip_z * 0.65):
            continue
        if best is None or p.area > best.area:
            best = p
    pts = np.array([uv[i].uv[:] for i in best.loop_indices]) * TEX
    c = pts.mean(axis=0)
    r = min(np.linalg.norm(c - pts[(k + 1) % 3] + 0) for k in range(3)) * 0.35
    edge = []
    for k in range(3):
        a, b = pts[k], pts[(k + 1) % 3]
        d = b - a
        edge.append(abs(d[0] * (c[1] - a[1]) - d[1] * (c[0] - a[0])) / max(np.linalg.norm(d), 1e-6))
    h = int(max(6, min(min(edge) * 0.8, 40)))
    return int(c[0]) - h, int(c[1]) - h, 2 * h


def fill_strip(imgs, box, strip):
    """Tile the leather patch over the strap's reserved rows (mirrored so seams do not show)."""
    x0, y0, n = box
    rows = int(strip * TEX) - 4
    for k, img in enumerate(imgs):
        a = pixels(img)
        patch = a[y0:y0 + n, x0:x0 + n].copy()
        if k == 1:  # normal map: flat, the strap is thin and smooth
            patch[:] = (0.5, 0.5, 1.0, 1.0)
        tile = np.concatenate([patch, patch[:, ::-1]], axis=1)
        tile = np.concatenate([tile, tile[::-1]], axis=0)
        reps_x = TEX // tile.shape[1] + 1
        reps_y = rows // tile.shape[0] + 1
        full = np.tile(tile, (reps_y, reps_x, 1))
        a[2:2 + rows, :] = full[:rows, :TEX]
        img.pixels.foreach_set(a.ravel())
        img.update()


def add_baldric(low, imgs, tip_z, strip):
    """A closed band round the chest in the scabbard's own frame, textured from its leather."""
    fit = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'strap-fit.json')))
    ring = fit['ring']
    n = len(ring)
    fill_strip(imgs, leather_patch(low, tip_z), strip)
    # glTF (x, y, z) -> Blender (x, -z, y)
    conv = lambda v: (v[0], -v[2], v[1])
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new(low.data.uv_layers.active.name)
    top = [bm.verts.new(conv(r[0])) for r in ring]
    bot = [bm.verts.new(conv(r[1])) for r in ring]
    centre = np.mean([conv(r[0]) for r in ring], axis=0)
    v0, v1 = 0.012, strip - 0.012
    for j in range(n):
        k = (j + 1) % n
        f = bm.faces.new((top[j], top[k], bot[k], bot[j]))
        u0, u1 = 0.02 + 0.96 * j / n, 0.02 + 0.96 * (j + 1) / n
        for loop, uv in zip(f.loops, ((u0, v1), (u1, v1), (u1, v0), (u0, v0))):
            loop[uvl].uv = uv
        out = np.array(f.calc_center_median()) - centre
        if np.dot(np.array(f.normal), out) < 0:
            f.normal_flip()
    mesh = bpy.data.meshes.new('baldric')
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new('baldric', mesh)
    bpy.context.scene.collection.objects.link(obj)
    sol = obj.modifiers.new('thick', 'SOLIDIFY')
    sol.thickness = STRAP_THICKNESS
    sol.offset = -1.0
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=sol.name)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(60))
    low.select_set(True)
    bpy.context.view_layer.objects.active = low
    bpy.ops.object.join()


def export(name, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name + '.glb'), export_format='GLB', use_selection=True,
                              export_yup=True, export_apply=False, export_image_format='AUTO')


def build(name):
    spec = dict(SPECS[name], name=name)
    reset()
    high = load_raw(os.path.join(RAW, spec['raw'] + '.glb'))
    pts = align(high, spec)
    info = REPORT.setdefault(name, {})
    guard_z = 0.0
    if spec['kind'] == 'blade':
        guard_z, guard_w = find_guard(pts, spec['length'] * 0.4)
        pts, before, after = straighten(pts, guard_z)
        info.update(guard_z=round(float(guard_z), 4), guard_width=round(float(guard_w), 4),
                    bow_before_m=round(before, 4), bow_after_m=round(after, 4))
        grip_z = guard_z / 2 + 0.01
        STATE['throat'] = guard_z - grip_z if name == 'worn-iron-sword' else STATE.get('throat')
    elif spec['kind'] == 'club':
        grip_z = 0.13
    else:
        grip_z = None
    if spec['kind'] == 'scabbard':
        # The sheathed sword's hilt sits at this origin, so the mouth starts at the sword's guard.
        throat = STATE.get('throat') or 0.0925
        pts[:, 2] += throat
        grip_z = 0.0
        tip_z = pts[:, 2].max()
        info['throat_above_grip'] = round(float(throat), 4)
    else:
        pts[:, 2] -= grip_z
        tip_z = pts[:, 2].max()
    write_points(high, pts)
    bpy.ops.object.select_all(action='DESELECT')
    high.select_set(True)
    bpy.context.view_layer.objects.active = high
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    low = high.copy()
    low.data = high.data.copy()
    low.name = name
    bpy.context.scene.collection.objects.link(low)
    weld(low)
    decimate_to(low, spec['tris'])
    shade(low)
    strip = 0.2 if spec['kind'] == 'scabbard' else 0.0
    unwrap(low, v_floor=strip)
    col, nor, rou, met = bake_all(high, low, name)
    if spec['kind'] == 'scabbard':
        add_baldric(low, (col, nor, rou, met), tip_z, strip)
    finish_material(low, name, col, nor, rou, met)
    grip = smooth_marker('Grip', (0, 0, 0))
    tip = smooth_marker('Tip', (0, 0, float(tip_z)))
    bpy.data.objects.remove(high, do_unlink=True)
    info.update(triangles=sum(len(p.vertices) - 2 for p in low.data.polygons), tip_z=round(float(tip_z), 4))
    export(name, [low, grip, tip])
    return low


if __name__ == '__main__':
    for n in ORDER:
        if ONLY and n not in ONLY:
            continue
        build(n)
    with open(os.path.join(OUT, 'report.json'), 'w') as f:
        json.dump(REPORT, f, indent=1)
    print('REPORT', json.dumps(REPORT))
