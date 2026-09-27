"""
Shared helpers for Blender-built Haunted Gallery rooms (used by build_conservation_lab.py; the
guest suite predates this module and keeps its own copy of the basics).

What a room build produces (paths relative to the repo root, or under --out=DIR):
    art/blender/<name>.blend                      editable source
    client/public/models/rooms/<name>.glb         one merged mesh, TEXCOORD_0 = material UVs,
                                                  TEXCOORD_1 = baked-lighting UVs, LIGHT_* nodes
    client/public/models/rooms/<name>_lightmap.jpg  baked irradiance (Cycles), sRGB-encoded
    client/public/models/rooms/<name>.json        {"lightmap": file, "scale": s}: the game decodes
                                                  lightmap = scale * srgb_to_linear(texel)
    docs/renders/<name>_*.png                     comparison renders

Coordinates: everything is authored in *game-local* metres (x, height y, z) around the room
origin; P() maps them to Blender (x, -z, y) and the glTF export is Y-up, so the GLB drops into the
game at world (origin x, 0, origin z).

Common arguments (after `--`):
    --out=DIR          write everything under DIR (test builds; committed files stay untouched)
    --no-render        skip the comparison renders
    --no-bake          skip the lightmap bake (fast geometry check; the GLB then has no lightmap)
    --only=a,b         render only these shots
    --res=PERCENT      render resolution percentage
    --samples=N        render samples
    --bake-size=PX     lightmap size before the 2x downsample (default 2048 -> 1024 texture)
    --bake-samples=N   Cycles samples per lightmap texel (default 256)
"""
import math
import os
import struct
import sys
import zlib

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
TEX_COMMITTED = os.path.join(ROOT, "art", "blender", "textures")
WALL_H = 3.2          # the game's structural wall height (client/src/world.js WALL_H)
IN = 0.15             # inner wall face offset from the room edge (walls are 0.3 m, centred on it)


def arg(name, default=None):
    return next((a.split("=", 1)[1] for a in ARGS if a.startswith(f"--{name}=")), default)


def flag(name):
    return f"--{name}" in ARGS


class Paths:
    def __init__(self, name):
        out = arg("out")
        self.name = name
        if out:
            out = os.path.abspath(out)
            self.tex_dir = os.path.join(out, "textures")
            self.blend = os.path.join(out, f"{name}.blend")
            self.models = out
            self.renders = os.path.join(out, "renders")
        else:
            self.tex_dir = TEX_COMMITTED
            self.blend = os.path.join(ROOT, "art", "blender", f"{name}.blend")
            self.models = os.path.join(ROOT, "client", "public", "models", "rooms")
            self.renders = os.path.join(ROOT, "docs", "renders")
        self.glb = os.path.join(self.models, f"{name}.glb")
        self.lightmap = os.path.join(self.models, f"{name}_lightmap.jpg")
        self.sidecar = os.path.join(self.models, f"{name}.json")
        for d in (self.tex_dir, self.models, self.renders):
            os.makedirs(d, exist_ok=True)


def P(x, y, z):
    """game-local (x, height, z) -> Blender (x, -z, height)."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------- scene
class Scene:
    """Fresh factory scene with the Export (goes into the game) and RenderOnly collections."""

    def __init__(self):
        bpy.ops.wm.read_factory_settings(use_empty=True)
        self.scene = bpy.context.scene
        self.scene.unit_settings.system = "METRIC"
        self.EXPORT = bpy.data.collections.new("Export")
        self.RENDER_ONLY = bpy.data.collections.new("RenderOnly")
        self.scene.collection.children.link(self.EXPORT)
        self.scene.collection.children.link(self.RENDER_ONLY)


S = None   # set by init()


def init(name):
    global S
    S = Scene()
    return S, Paths(name)


# ---------------------------------------------------------------- procedural textures (numpy)
def smooth_noise(h, w, cells, seed):
    r = np.random.default_rng(seed).random((cells, cells))
    ys, xs = np.arange(h) / h * cells, np.arange(w) / w * cells
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    y1, x1 = (y0 + 1) % cells, (x0 + 1) % cells
    y0 %= cells
    x0 %= cells
    a = r[np.ix_(y0, x0)]; b = r[np.ix_(y0, x1)]; c = r[np.ix_(y1, x0)]; d = r[np.ix_(y1, x1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(h, w, base, seed, octaves=4):
    out, amp, tot = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        out += smooth_noise(h, w, base * 2 ** o, seed + o) * amp
        tot += amp
        amp *= 0.5
    return out / tot


def save_image(tex_dir, name, rgb, alpha=None, fmt="PNG", non_color=False):
    """numpy (h, w, 3) top-down image -> Blender image saved beside the .blend (//textures/)."""
    h, w, _ = rgb.shape
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    if alpha is not None:
        rgba[..., 3] = alpha
    img = bpy.data.images.new(name, w, h, alpha=alpha is not None)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba[::-1].ravel())   # Blender images are bottom-up
    ext = ".png" if fmt == "PNG" else ".jpg"
    img.filepath_raw = os.path.join(tex_dir, name + ext)
    img.file_format = fmt
    img.save()
    img.filepath = "//textures/" + name + ext
    return img


def normal_from_height(hgt, strength=2.0):
    """Tangent-space normal map (OpenGL convention, as glTF expects) from a height field."""
    gy, gx = np.gradient(hgt)
    nx, ny, nz = -gx * strength, gy * strength, np.ones_like(hgt)
    n = np.stack([nx, ny, nz], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def committed_map(tex_dir, base, tint=None, size=None, out=None, non_color=False):
    """A committed CC0 map from art/blender/textures (e.g. 'OldOakFloor_diff'), optionally tinted
    (multiplied) and resized, saved into tex_dir under `out` (default: the same name)."""
    src = os.path.join(TEX_COMMITTED, base + ".jpg")
    if not os.path.exists(src):
        return None
    out = out or base
    dst = os.path.join(tex_dir, out + ".jpg")
    if tint is None and not size:
        if os.path.abspath(src) != os.path.abspath(dst):
            import shutil
            shutil.copyfile(src, dst)
        img = bpy.data.images.load(dst)
    else:
        img = bpy.data.images.load(src)
        px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)   # forces the pixels to load
        if tint is not None:
            px[:, :3] *= np.array(tint, dtype=np.float32)
            img.pixels.foreach_set(px.ravel())
        if size and img.size[0] > size:
            img.scale(size, max(1, int(img.size[1] * size / img.size[0])))
        img.filepath_raw = dst
        img.file_format = "JPEG"
        img.save()
    img.filepath = "//textures/" + out + ".jpg"
    img.name = out
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


# ---------------------------------------------------------------- materials
MATS = {}


def material(name, color=(0.5, 0.5, 0.5), rough=0.6, metal=0.0, img=None, nor=None, rough_img=None, normal=0.8,
             emit=None, emit_strength=0.0, alpha=None, tile=1.0, two_sided=False):
    """Principled material. img/nor/rough_img are Blender images (base colour, normal, roughness)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if img is not None:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if emit is not None:
            nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
    if nor is not None and normal > 0:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = nor
        nor.colorspace_settings.name = "Non-Color"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = normal
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    if rough_img is not None:
        tr = nt.nodes.new("ShaderNodeTexImage")
        tr.image = rough_img
        rough_img.colorspace_settings.name = "Non-Color"
        nt.links.new(tr.outputs["Color"], bsdf.inputs["Roughness"])
    if emit is not None:
        if img is None:
            bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        if hasattr(m, "surface_render_method"):
            m.surface_render_method = "BLENDED"
    m.use_backface_culling = not two_sided
    m["tile"] = tile
    MATS[name] = m
    return m


# ---------------------------------------------------------------- geometry
def world_uv(bm, mat_tile, fit=None):
    """Triplanar world-space UVs (metres / tile) so textures keep their size on any object."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for lp in f.loops:
            co = lp.vert.co
            if fit is not None and ax == 2:
                (x0, y0, sx, sy) = fit
                lp[uv].uv = ((co.x - x0) / sx, (co.y - y0) / sy)
            elif ax == 2:
                lp[uv].uv = (co.x / mat_tile, co.y / mat_tile)
            elif ax == 0:
                lp[uv].uv = (co.y / mat_tile, co.z / mat_tile)
            else:
                lp[uv].uv = (co.x / mat_tile, co.z / mat_tile)


def finish(bm, name, mat, coll=None, fit=None, smooth=False, keep_uv=False):
    if not keep_uv:
        world_uv(bm, mat.get("tile", 1.0), fit)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    (coll or S.EXPORT).objects.link(ob)
    return ob


def _xf(bm, c, rot, tilt=0.0, tilt_axis="X"):
    if tilt:
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Matrix.Rotation(math.radians(tilt), 3, tilt_axis), verts=bm.verts)
    if rot:
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Matrix.Rotation(math.radians(rot), 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*c), verts=bm.verts)


def box(name, c, s, mat, coll=None, bevel=0.0, fit=None, rot=0.0, tilt=0.0, tilt_axis="X"):
    """Box centred at game-local c=(x, y, z) with size s=(sx, height, sz); rot = yaw in degrees
    (about the vertical axis, applied after `tilt` about Blender's X or Y axis)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((s[0], s[2], s[1])), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
    _xf(bm, c, rot, tilt, tilt_axis)
    return finish(bm, name, mat, coll, fit)


def cyl(name, c, r, h, mat, coll=None, seg=16, r2=None, axis="y", smooth=True, rot=0.0):
    """Cylinder (or cone with r2) centred at game-local c, along game axis y (up), x or z."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    if axis == "x":
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Matrix.Rotation(math.radians(90), 3, "Y"), verts=bm.verts)
    elif axis == "z":
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Matrix.Rotation(math.radians(90), 3, "X"), verts=bm.verts)
    _xf(bm, c, rot)
    return finish(bm, name, mat, coll, smooth=smooth)


def sphere(name, c, r, mat, coll=None, seg=12, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
    bmesh.ops.scale(bm, vec=Vector((scale[0], scale[2], scale[1])), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*c), verts=bm.verts)
    return finish(bm, name, mat, coll, smooth=True)


def lathe(name, c, profile, mat, coll=None, seg=20, smooth=True):
    """Surface of revolution about the vertical axis: profile = [(radius, height), ...] bottom to top."""
    bm = bmesh.new()
    rings = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        rings.append([bm.verts.new((r * math.cos(a), r * math.sin(a), y)) for r, y in profile])
    for k in range(seg):
        r0, r1 = rings[k], rings[(k + 1) % seg]
        for j in range(len(profile) - 1):
            bm.faces.new((r0[j], r1[j], r1[j + 1], r0[j + 1]))
    # caps
    if profile[0][0] > 1e-4:
        bm.faces.new([rings[k][0] for k in reversed(range(seg))])
    if profile[-1][0] > 1e-4:
        bm.faces.new([rings[k][-1] for k in range(seg)])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.normal_update()
    bmesh.ops.translate(bm, vec=P(*c), verts=bm.verts)
    return finish(bm, name, mat, coll, smooth=smooth)


def plane(name, c, w, h, mat, facing="z+", coll=None, fit=True):
    """Vertical (facing x+/x-/z+/z-) or horizontal ('up') rectangle with UVs fitted 0..1."""
    bm = bmesh.new()
    hw, hh = w / 2, h / 2
    if facing == "up":
        pts = [(-hw, 0, -hh), (hw, 0, -hh), (hw, 0, hh), (-hw, 0, hh)]
    elif facing in ("z+", "z-"):
        s = 1 if facing == "z+" else -1
        pts = [(-hw * s, -hh, 0), (hw * s, -hh, 0), (hw * s, hh, 0), (-hw * s, hh, 0)]
    else:
        s = 1 if facing == "x+" else -1
        pts = [(0, -hh, hw * s), (0, -hh, -hw * s), (0, hh, -hw * s), (0, hh, hw * s)]
    vs = [bm.verts.new(P(c[0] + x, c[1] + y, c[2] + z)) for x, y, z in pts]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.verify()
    for lp, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
        lp[uv].uv = (u, v)
    bm.normal_update()
    return finish(bm, name, mat, coll, keep_uv=True)


def drape(name, x0, x1, z, y0, y1, mat, folds=7, depth=0.06, axis="x", coll=None, gather=0.0):
    """A hanging fabric panel with sinusoidal folds. Spans x0..x1 at z (axis x) or z0..z1 at x (axis z)."""
    bm = bmesh.new()
    nu, nv = 48, 12
    verts = []
    for j in range(nv + 1):
        t = j / nv
        row = []
        for i in range(nu + 1):
            s = i / nu
            a = x0 + (x1 - x0) * s
            off = depth * math.sin(s * folds * 2 * math.pi) * (1 - gather * (1 - t))
            y = y0 + (y1 - y0) * t
            row.append(bm.verts.new(P(a, y, z + off) if axis == "x" else P(z + off, y, a)))
        verts.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    bm.normal_update()
    return finish(bm, name, mat, coll, smooth=True)


def cloth(name, c, w, d, mat, colliders, res=36, frames=40, pins=None, coll=None, shrink=0.0, mass=0.3, stiff=8.0):
    """A cloth sheet dropped from height c[1] over `colliders` (objects) and baked by Blender's cloth
    simulation. pins: optional list of (x, z) game-local points whose nearest vertices are pinned
    (e.g. a hanging drop cloth). The colliders are left untouched."""
    bm = bmesh.new()
    grid = []
    for j in range(res + 1):
        row = []
        for i in range(res + 1):
            x = c[0] - w / 2 + w * i / res
            z = c[2] - d / 2 + d * j / res
            row.append(bm.verts.new(P(x, c[1], z)))
        grid.append(row)
    for j in range(res):
        for i in range(res):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for lp in f.loops:
            co = lp.vert.co
            lp[uv].uv = ((co.x - (c[0] - w / 2)) / w * w / 0.9, (co.y + c[2] + d / 2) / d * d / 0.9)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    (coll or S.EXPORT).objects.link(ob)
    if pins:
        vg = ob.vertex_groups.new(name="pin")
        idx = []
        for px, pz in pins:
            target = P(px, c[1], pz)
            best = min(range(len(me.vertices)), key=lambda k: (me.vertices[k].co - target).length)
            idx.append(best)
        vg.add(idx, 1.0, "REPLACE")
    added = []
    for o in colliders:
        if not any(m.type == "COLLISION" for m in o.modifiers):
            added.append(o.modifiers.new("Collision", "COLLISION"))
            o.collision.thickness_outer = 0.01
    mod = ob.modifiers.new("Cloth", "CLOTH")
    st = mod.settings
    st.quality = 6
    st.mass = mass
    st.tension_stiffness = st.compression_stiffness = stiff
    st.bending_stiffness = 0.4
    st.shrink_min = shrink
    if pins:
        st.vertex_group_mass = "pin"
    mod.collision_settings.use_self_collision = False
    mod.collision_settings.distance_min = 0.008
    mod.point_cache.frame_start = 1
    mod.point_cache.frame_end = frames
    sc = bpy.context.scene
    for f in range(1, frames + 1):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    baked = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = baked
    bpy.data.meshes.remove(old)
    baked.name = name
    for p in baked.polygons:
        p.use_smooth = True
    for o in colliders:
        for m in list(o.modifiers):
            if m.type == "COLLISION":
                o.modifiers.remove(m)
    sc.frame_set(1)
    return ob


def fit_uv(ob, axis):
    """Fit the object's UVs 0..1 across its face on `axis` (for pictures and windows)."""
    me = ob.data
    xs = [v.co for v in me.vertices]
    if axis == "z":      # plane facing +-x in game terms: game z = -Blender y, height = Blender z
        u0, u1 = min(-v.y for v in xs), max(-v.y for v in xs)
    else:
        u0, u1 = min(v.x for v in xs), max(v.x for v in xs)
    v0, v1 = min(v.z for v in xs), max(v.z for v in xs)
    uvl = me.uv_layers.active.data
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            u = (-co.y if axis == "z" else co.x)
            uvl[li].uv = ((u - u0) / max(1e-6, u1 - u0), (co.z - v0) / max(1e-6, v1 - v0))


def empty(name, c, coll=None):
    ob = bpy.data.objects.new(name, None)
    ob.location = P(*c)
    ob.empty_display_size = 0.15
    (coll or S.EXPORT).objects.link(ob)
    return ob


def add_light(name, kind, c, energy, color, size=0.1, rot=None, coll=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color
    if kind in ("POINT", "SPOT"):
        ld.shadow_soft_size = size
    if kind == "AREA":
        ld.size = size
    ob = bpy.data.objects.new(name, ld)
    ob.location = P(*c)
    if rot:
        ob.rotation_euler = [math.radians(a) for a in rot]
    (coll or S.RENDER_ONLY).objects.link(ob)
    return ob


# ---------------------------------------------------------------- merge, lightmap, export
def merge_export(name, image_limits):
    """Merge the Export collection's meshes into ONE object (one draw call per material in the game),
    scale images to phone sizes and return (merged object, LIGHT_* empties)."""
    # The glTF exporter copies a file-backed image's original bytes, so an in-memory resize alone
    # never reaches the GLB: write phone-sized copies to a scratch folder and point the images at
    # them (the editable .blend was saved before this and keeps the full-size sources).
    import tempfile
    scratch = tempfile.mkdtemp(prefix="hg_room_tex_")
    S.scene.render.image_settings.quality = 85
    for img in bpy.data.images:
        if img.size[0] == 0 and img.filepath:
            img.pixels[0]            # images loaded from disk report size 0 until their pixels load
        if img.size[0] == 0 or img.source != "FILE":
            continue
        limit = image_limits(img.name)
        if img.size[0] > limit:
            img.scale(limit, max(1, int(img.size[1] * limit / img.size[0])))
            fmt = "PNG" if img.filepath.lower().endswith(".png") else "JPEG"
            img.filepath_raw = os.path.join(scratch, img.name + (".png" if fmt == "PNG" else ".jpg"))
            img.file_format = fmt
            img.save()
    merged = bpy.data.collections.new("ExportMerged")
    S.scene.collection.children.link(merged)
    dg = bpy.context.evaluated_depsgraph_get()
    parts, markers = [], []
    for ob in S.EXPORT.all_objects:
        if ob.type == "MESH":
            me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            me.transform(ob.matrix_world)
            # one material UV layer, always called UVMap, so join never adds a second set
            while len(me.uv_layers) > 1:
                me.uv_layers.remove(me.uv_layers[-1])
            if me.uv_layers:
                me.uv_layers[0].name = "UVMap"
            cp = bpy.data.objects.new(ob.name + "_m", me)
            merged.objects.link(cp)
            parts.append(cp)
        elif ob.name.startswith("LIGHT_"):
            e = bpy.data.objects.new(ob.name, None)
            e.location = ob.matrix_world.translation
            merged.objects.link(e)
            markers.append(e)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    room = bpy.context.view_layer.objects.active
    room.name = name
    # merge materials that ended up duplicated (same name up to a .001 suffix)
    base = {}
    for i, slot in enumerate(room.material_slots):
        m = slot.material
        key = m.name.split(".")[0]
        base.setdefault(key, m)
        slot.material = base[key]
    S.EXPORT.hide_render = True
    S.EXPORT.hide_viewport = True
    return merged, room, markers


def cull_hidden_faces(room, rect, wall_gap=0.17):
    """Delete faces nobody can see: undersides resting on (or below) the floor, and faces pressed
    against the structural walls (backs of panelling, pilasters, shelves). rect = local
    [x0, x1, z0, z1] of the room. Frees lightmap space and triangles."""
    import bmesh
    me = room.data
    bm = bmesh.new()
    bm.from_mesh(me)
    x0, x1, z0, z1 = rect
    dead = []
    for f in bm.faces:
        c, n = f.calc_center_median(), f.normal
        gx, gy, gz = c.x, c.z, -c.y             # game-local coordinates
        nx, ny, nz = n.x, n.z, -n.y
        if ny < -0.95 and gy < 0.02:
            dead.append(f)
        elif (nx < -0.95 and x0 - 0.001 < gx < x0 + wall_gap) or (nx > 0.95 and x1 - wall_gap < gx < x1 + 0.001):
            dead.append(f)      # (faces outside the rect, e.g. corridor-side door surrounds, stay)
        elif (nz < -0.95 and z0 - 0.001 < gz < z0 + wall_gap) or (nz > 0.95 and z1 - wall_gap < gz < z1 + 0.001):
            dead.append(f)
    bmesh.ops.delete(bm, geom=dead, context="FACES_ONLY")
    bm.to_mesh(me)
    bm.free()
    print("culled", len(dead), "hidden faces")


def lightmap_uvs(room, margin=0.003):
    """Second UV set ('Lightmap') for baked lighting: smart-projected islands, packed."""
    me = room.data
    lm = me.uv_layers.new(name="Lightmap")
    me.uv_layers["UVMap"].active_render = True
    me.uv_layers.active = lm
    bpy.ops.object.select_all(action="DESELECT")
    room.select_set(True)
    bpy.context.view_layer.objects.active = room
    with bpy.context.temp_override(active_object=room, object=room, selected_objects=[room], selected_editable_objects=[room]):
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=margin, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
        bpy.ops.uv.average_islands_scale()   # texel density proportional to real surface area
        # FRACTION margins: a fixed gap in UV space (the default scales it per island, which
        # left most of the atlas empty with thousands of small props)
        bpy.ops.uv.pack_islands(margin=margin, rotate=True, margin_method="FRACTION", shape_method="CONCAVE")
        bpy.ops.object.mode_set(mode="OBJECT")
    return lm


def bake_lightmap(room, size, samples, margin_px=5):
    """Cycles DIFFUSE (direct + indirect, no colour) = irradiance, baked on the Lightmap UVs."""
    sc = S.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = samples
    sc.cycles.use_denoising = False
    sc.cycles.sample_clamp_indirect = 6.0
    sc.cycles.max_bounces = 6
    sc.cycles.diffuse_bounces = 4
    sc.render.bake.margin = margin_px
    sc.render.bake.margin_type = "EXTEND"
    sc.render.bake.use_selected_to_active = False
    img = bpy.data.images.new("LightmapBake", size, size, float_buffer=True, alpha=False)
    img.colorspace_settings.name = "Non-Color"
    added = []
    for slot in room.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = img
        n.name = "__bake__"
        nt.nodes.active = n
        added.append((nt, n))
    bpy.ops.object.select_all(action="DESELECT")
    room.select_set(True)
    bpy.context.view_layer.objects.active = room
    import time
    t = time.time()
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"}, uv_layer="Lightmap", margin=margin_px, margin_type="EXTEND")
    print(f"lightmap baked {size}px x {samples} spp in {time.time() - t:.0f}s")
    for nt, n in added:
        nt.nodes.remove(n)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(size, size, 4)[::-1, :, :3]   # top-down
    bpy.data.images.remove(img)
    return px


def write_lightmap(px, path, sidecar, downsample=2, quality=90):
    """2x box-downsample (cuts sampling noise), choose an HDR scale, sRGB-encode, save JPEG +
    the sidecar JSON the game reads ({lightmap, scale})."""
    import json
    if downsample > 1:
        h, w, _ = px.shape
        px = px.reshape(h // downsample, downsample, w // downsample, downsample, 3).mean(axis=(1, 3))
    lum = px.mean(axis=-1)
    # headroom for the brightest 2% (pools under lamps); hotter texels (bulbs, flames) clip
    scale = float(np.clip(np.percentile(lum[lum > 1e-4], 98.0) * 1.25, 1.0, 4.0)) if (lum > 1e-4).any() else 1.0
    x = np.clip(px / scale, 0, 1)
    srgb = np.where(x <= 0.0031308, x * 12.92, 1.055 * np.power(x, 1 / 2.4) - 0.055)
    h, w, _ = srgb.shape
    img = bpy.data.images.new("LightmapOut", w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color"   # values are already sRGB-encoded; save them as is
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = srgb
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = path
    img.file_format = "JPEG"
    S.scene.render.image_settings.quality = quality
    img.save()
    bpy.data.images.remove(img)
    with open(sidecar, "w") as f:
        json.dump({"lightmap": os.path.basename(path), "scale": round(scale, 4), "encoding": "srgb"}, f, indent=2)
        f.write("\n")
    print("lightmap", path, os.path.getsize(path), "bytes; scale", round(scale, 3))
    return scale


def optimize_glb(path, keep_lightmap=False):
    """Run tools/assets/optimize-room.mjs (weld, dedup, prune, quantize) on the exported GLB.
    Needs node and tools/assets/node_modules (tools/blender/setup-cloud.sh installs them)."""
    import shutil
    import subprocess
    opt = os.path.join(ROOT, "tools", "assets", "optimize-room.mjs")
    if shutil.which("node") and os.path.isdir(os.path.join(ROOT, "tools", "assets", "node_modules")):
        subprocess.run(["node", opt, path] + (["--keep-lightmap"] if keep_lightmap else []), check=True)
    else:
        print("NOTE: not optimised. Run: (cd tools/assets && npm ci) && node tools/assets/optimize-room.mjs", path,
              "--keep-lightmap" if keep_lightmap else "")


def export_glb(path, objects, keep_lightmap=False):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in objects:
        ob.select_set(True)
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    want = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                export_lights=False, export_cameras=False, export_extras=True, export_image_format="JPEG",
                export_jpeg_quality=82, export_image_quality=82, export_texcoords=True, export_normals=True,
                export_materials="EXPORT", export_tangents=False, export_attributes=False, export_vertex_color="NONE")
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in props})
    print("exported", path, os.path.getsize(path), "bytes")
    optimize_glb(path, keep_lightmap)


# ---------------------------------------------------------------- renders
def setup_render(samples=48, cycles=False):
    sc = S.scene
    if cycles:
        sc.render.engine = "CYCLES"
        sc.cycles.device = "CPU"
        sc.cycles.samples = samples
        sc.cycles.use_denoising = True
    else:
        engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE_NEXT"
        sc.render.engine = engine
        try:
            sc.eevee.taa_render_samples = samples
            sc.eevee.use_raytracing = True
        except Exception:
            pass
    sc.view_settings.view_transform = "AgX"
    looks = [i.identifier for i in sc.view_settings.bl_rna.properties["look"].enum_items]
    sc.view_settings.look = "AgX - Medium High Contrast" if "AgX - Medium High Contrast" in looks else "None"


def camera(name, pos, target, lens=24):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.02
    ob = bpy.data.objects.new(name, cd)
    ob.location = P(*pos)
    direction = P(*target) - P(*pos)
    ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    S.RENDER_ONLY.objects.link(ob)
    return ob


def render_shots(paths, shots):
    sc = S.scene
    only = arg("only")
    pct = int(arg("res", 100))
    for name, pos, target, lens, (w, h) in shots:
        if only and name not in only.split(","):
            continue
        sc.camera = camera(f"Cam_{name}", pos, target, lens)
        sc.render.resolution_x, sc.render.resolution_y = w, h
        sc.render.resolution_percentage = pct
        sc.render.filepath = os.path.join(paths.renders, f"{paths.name}_{name}.png")
        print("rendering", name)
        bpy.ops.render.render(write_still=True)
        print("wrote", sc.render.filepath)


def write_png_rgb(path, rgb8):
    """Minimal PNG writer (uint8 HxWx3), no colour management involved."""
    h, w, _ = rgb8.shape
    raw = b"".join(b"\x00" + rgb8[y].tobytes() for y in range(h))

    def chunk(t, data):
        c = struct.pack(">I", len(data)) + t + data
        return c + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))
