"""Build the approved iron, leather and hardwood collection in metres."""
import math, json, sys
import bpy
import numpy as np
from pathlib import Path
from types import SimpleNamespace
ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / 'art/raw/weapons/export'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
N = 1024
col = np.ones((N,N,4), dtype=np.float32)
orm = col.copy()
normal = col.copy()
for k, source in enumerate(['metal_plate','metal_plate','brown_leather','rough_wood','brown_leather']):
    lo,hi = round(k*N/5),round((k+1)*N/5)
    for channel, target in [('colour',col),('orm',orm),('normal',normal)]:
        image=bpy.data.images.load(str(ROOT/'art/raw/weapons/sources'/(source+'-'+channel+'.jpg')),check_existing=False)
        image.scale(N,hi-lo)
        pixels=np.array(image.pixels[:],dtype=np.float32).reshape(hi-lo,N,4)
        target[lo:hi]=pixels
        bpy.data.images.remove(image)
    if k==1: col[lo:hi,:,:3]*=.55
    if k==2: col[lo:hi,:,:3]*=.42
    if k==4: col[lo:hi,:,:3]*=.85
images = []
for name, pixels in [('colour', col), ('orm', orm), ('normal', normal)]:
    img = bpy.data.images.new(name, width=N, height=N, alpha=True)
    img.colorspace_settings.name = 'sRGB' if name == 'colour' else 'Non-Color'
    img.pixels.foreach_set(pixels.ravel())
    img.filepath_raw = str(OUT / (name + '.png'))
    img.file_format = 'PNG'
    img.save()
    images.append(img)
mat = bpy.data.materials.new('Worn iron, leather and hardwood')
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
bs = nodes.get('Principled BSDF')
tex = []
for img in images:
    node = nodes.new('ShaderNodeTexImage')
    node.image = img
    tex.append(node)
links.new(tex[0].outputs['Color'], bs.inputs['Base Color'])
sep = nodes.new('ShaderNodeSeparateColor')
links.new(tex[1].outputs['Color'], sep.inputs[0])
links.new(sep.outputs['Green'], bs.inputs['Roughness'])
links.new(sep.outputs['Blue'], bs.inputs['Metallic'])
nm = nodes.new('ShaderNodeNormalMap')
links.new(tex[2].outputs['Color'], nm.inputs['Color'])
links.new(nm.outputs['Normal'], bs.inputs['Normal'])
parts = []

def mesh(name, verts, faces, material=0, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    if name=='Fullered tapered blade':
        blade_mat=mat.copy();blade_mat.name='Blade metal';obj.data.materials[0]=blade_mat
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    uv = data.uv_layers.new()
    for poly in data.polygons:
        for li in poly.loop_indices:
            p = data.vertices[data.loops[li].vertex_index].co
            uv.data[li].uv = ((p.x * 9 + p.y * 13) % 1, (material + 0.08 + p.z * 1.1 % 1 * 0.84) / 5)
    if bevel:
        mod = obj.modifiers.new('Rounded worn edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.select_set(False)
    parts.append(obj)
    return obj

def loft(name, rings, sides=24, material=0, cap=True):
    verts = []
    for z, rx, ry in rings:
        verts.extend([(rx * math.cos(i * 2 * math.pi / sides), ry * math.sin(i * 2 * math.pi / sides), z) for i in range(sides)])
    faces = []
    for j in range(len(rings) - 1):
        for i in range(sides):
            a = j * sides + i
            b = j * sides + (i + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if cap:
        faces.extend([tuple(reversed(range(sides))), tuple(((len(rings) - 1) * sides + i for i in range(sides)))])
    return mesh(name, verts, faces, material)

def band(name, z, radius, width, material=2):
    return loft(name, [(z - width / 2, radius * 0.97, radius * 0.76), (z - width * 0.35, radius, radius * 0.8), (z + width * 0.35, radius, radius * 0.8), (z + width / 2, radius * 0.97, radius * 0.76)], 24, material)

def bar(name, z, span, depth, height, material=1):
    bevel = min(0.003, depth * 0.22, height * 0.22)
    cross = [(-span / 2 + bevel, -depth / 2), (span / 2 - bevel, -depth / 2), (span / 2, -depth / 2 + bevel), (span / 2, depth / 2 - bevel), (span / 2 - bevel, depth / 2), (-span / 2 + bevel, depth / 2), (-span / 2, depth / 2 - bevel), (-span / 2, -depth / 2 + bevel)]
    verts = [(x, y, z + h + (.012*(abs(x)/(span/2))**2 if name=='Crossguard' else 0)) for h in [-height / 2, -height / 2 + bevel, height / 2 - bevel, height / 2] for x, y in cross]
    faces = [(j * 8 + i, j * 8 + (i + 1) % 8, (j + 1) * 8 + (i + 1) % 8, (j + 1) * 8 + i) for j in range(3) for i in range(8)]
    faces += [tuple(reversed(range(8))), tuple((24 + i for i in range(8)))]
    return mesh(name, verts, faces, material)

def blade(length, guard, width, knife=False):
    verts = []
    faces = []
    steps = 65
    section = [(-1, 0), (-0.72, 0.72), (-0.34, 1), (-0.17, 0.54), (0.17, 0.54), (0.34, 1), (0.72, 0.72), (1, 0), (0.72, -0.72), (0.34, -1), (0.17, -0.54), (-0.17, -0.54), (-0.34, -1), (-0.72, -0.72)]
    section = list(reversed(section))
    for j in range(steps):
        t = j / (steps - 1)
        taper = (1 - 0.24 * t) * min(1, (1 - t) * 9 + 0.003)
        for i, (sx, sy) in enumerate(section):
            nick = 0.0015 if j in [17, 31, 43] and i == 0 else 0
            xx = sx * (width / 2 * taper - nick)
            if knife:
                xx += 0.006 * t * t
            verts.append((xx, sy * 0.0032 * (1 - 0.72 * t), guard + length * t))
    n = len(section)
    for j in range(steps - 1):
        for i in range(n):
            a = j * n + i
            b = j * n + (i + 1) % n
            faces.append((a, b, b + n, a + n))
    faces.extend([tuple(reversed(range(n))), tuple(((steps - 1) * n + i for i in range(n)))])
    mesh('Fullered tapered blade', verts, faces, 0)

def marker(name, z):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location.z = z
    return o

def export(name, tip):
    markers = [marker('Grip', 0), marker('Tip', tip)]
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts + markers:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(OUT / (name + '.glb')), export_format='GLB', use_selection=True, export_yup=True, export_apply=True)
    stats = {'triangles': sum((sum((len(p.vertices) - 2 for p in o.data.polygons)) for o in parts)), 'grip': [0, 0, 0], 'tip': [0, tip, 0]}
    print(name, stats)
    manifests[name] = stats
    for o in parts + markers:
        bpy.data.objects.remove(o, do_unlink=True)
    parts.clear()
manifests = {}
for name, length, blade_len, width, knife in [('worn-iron-sword', 0.95, 0.75, 0.05, False), ('long-knife', 0.52, 0.36, 0.04, True), ('deserter-sword', 1.0, 0.8, 0.053, False)]:
    guard = (length - blade_len) / 2
    bottom = guard - (length - blade_len)
    blade(blade_len, guard, width, knife)
    loft('Grip core', [(bottom + 0.025, 0.014, 0.01), (guard - 0.015, 0.016, 0.011)], 24, 3 if knife else 2)
    for j in range(18):
        band('Grip wrap', bottom + 0.03 + j * (guard - bottom - 0.05) / 18, 0.016, 0.007, 2 if not knife else 3)
    bar('Crossguard', guard, 0.084 if knife else 0.205, 0.026, 0.018)
    if knife:
        for z in [bottom + 0.04, guard - 0.04]:
            band('Iron repair bands', z, 0.017, 0.015, 1)
        band('Butt cap', bottom + 0.008, 0.017, 0.016, 1)
    else:
        pom = loft('Disc pommel' if name == 'worn-iron-sword' else 'Faceted pommel', [(bottom, 0.017, 0.011), (bottom + 0.006, 0.026, 0.012), (bottom + 0.03, 0.026, 0.012), (bottom + 0.036, 0.017, 0.011)], 32 if name == 'worn-iron-sword' else 8, 1)
    export(name, guard + blade_len)
rings = []
for j in range(48):
    z = 0.1 + 0.78 * j / 47
    taper = 1 - 0.23 * j / 47
    rings.append((z, 0.034 * taper, 0.016 * taper))
loft('Leather over wooden core', rings, 24, 2, False)
loft('Iron chape', [(0.825, 0.027, 0.014), (0.855, 0.027, 0.014), (0.88, 0.01, 0.008)], 24, 1)
loft('Iron throat', [(0.14, 0.034, 0.016), (0.1, 0.035, 0.017), (0.1, 0.03, 0.012), (0.15, 0.03, 0.012)], 32, 1, False)
for z in [0.25, 0.62]:
    loft('Suspension band', [(z - 0.015, 0.035, 0.018), (z + 0.015, 0.035, 0.018)], 24, 2, False)
    bar('Suspension buckle', z, 0.09, 0.024, 0.022, 1)
for j in range(42):
    z = 0.15 + j * 0.015
    bar('Leather seam stitch', z, 0.003, 0.002, 0.004, 4).location.x = 0.031 * (1 - 0.23 * (z - 0.1) / 0.78)
# Closed diagonal baldric around an elliptical torso, expressed in the carry frame.
v=[]
angle=math.atan2(.4,-.9165)
for j in range(65):
    t=j*math.tau/64
    x=.25*math.cos(t); depth=.15*math.sin(t); height=1.20+.60*x
    for dh in [-.025,.025]:
        dx=x+.20; dy=height+dh-1.57
        lx=math.cos(angle)*dx-math.sin(angle)*dy
        lz=math.sin(angle)*dx+math.cos(angle)*dy
        v.append((lx,-(depth+.23),lz))
strap=mesh('Curved torso baldric',v,[(j*2,j*2+1,j*2+3,j*2+2) for j in range(64)],2)
solid=strap.modifiers.new('Leather thickness','SOLIDIFY');solid.thickness=.003
bpy.context.view_layer.objects.active=strap
bpy.ops.object.modifier_apply(modifier=solid.name)
export('back-scabbard', 0.88)
loft('Hardwood cudgel', [(-0.08 + j * 0.62 / 40, 0.017 + 0.029 * (j / 40) ** 1.8, 0.014 + 0.024 * (j / 40) ** 1.8) for j in range(41)], 24, 3)
for j in range(12):
    band('Leather grip ridges', -0.065 + j * 0.0135, 0.019, 0.007, 2)
for j in range(7):
    band('Rawhide head binding', 0.25 + j * 0.033, 0.034 + j * 0.0018, 0.014, 4)
export('bound-club', 0.54)
(OUT / 'manifest.json').write_text(json.dumps(manifests, indent=2))
