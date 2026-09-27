"""
Guest suite (Guest Bedroom + new Guest Bathroom) for Haunted Gallery, built in Blender.

    blender --background --factory-startup --python tools/blender/build_guest_suite.py -- [--no-render]
            [--only=room_level,...] [--out=DIR] [--res=PERCENT] [--samples=N] [--overwrite-committed]

    --out=DIR      write the .blend, textures, GLB and renders under DIR instead of the repo
                   (use it for test runs so the committed files stay untouched)
    --res=PERCENT  render at a percentage of the shot size (e.g. 25 for a quick check)
    --samples=N    EEVEE render samples (default 48)

Poly Haven sources are read from assets-src/polyhaven/ (tools/assets/fetch-polyhaven.mjs). When that
folder is missing (e.g. a cloud session), the tinted/resized maps already committed in
art/blender/textures/ are used instead, and the placed furniture is appended from the committed
art/blender/guest_suite.blend. That route needs --out=DIR (or --overwrite-committed) so it can't
replace the committed files by accident.

Cloud sessions (no Blender download): tools/blender/setup-cloud.sh, then
    tools/blender/blender-py tools/blender/build_guest_suite.py -- --out=/tmp/gs --only=room_level --res=25

Writes (paths relative to the repo root):
    art/blender/guest_suite.blend             editable source (textures in art/blender/textures/)
    client/public/models/rooms/guest_suite.glb   game-ready export (render-only helpers excluded)
    docs/renders/guest_suite_*.png            bird's-eye, room level, inside the wardrobe, under the bed

Coordinates: everything is authored in *game-local* metres around the Guest Bedroom centre
(game x, height y, game z - 72). The glTF export is Y-up, so the GLB drops straight into the
game at world (0, 0, 70.5). Layout matches server/src/game/data.ts (guest_bedroom, guest_bath):
    bedroom  x -4.5..4.5, z 66..75    (hallway door: south wall, x -1..1)
    bathroom x 0.5..4.5,  z 76..80.5  (door from the bedroom: passage x 2..4, z 75..76)
Walls are 0.3 m thick and centred on those edges (inner faces 0.15 m inside), as in the game.
"""
import math
import os
import shutil
import subprocess
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def arg(name, default=None):
    return next((a.split("=", 1)[1] for a in ARGS if a.startswith(f"--{name}=")), default)


TEX_COMMITTED = os.path.join(ROOT, "art", "blender", "textures")
BLEND_COMMITTED = os.path.join(ROOT, "art", "blender", "guest_suite.blend")
OUT = arg("out")
if OUT:
    OUT = os.path.abspath(OUT)
    TEX_DIR = os.path.join(OUT, "textures")
    BLEND = os.path.join(OUT, "guest_suite.blend")
    GLB = os.path.join(OUT, "guest_suite.glb")
    RENDERS = os.path.join(OUT, "renders")
else:
    TEX_DIR = TEX_COMMITTED
    BLEND = BLEND_COMMITTED
    GLB = os.path.join(ROOT, "client", "public", "models", "rooms", "guest_suite.glb")
    RENDERS = os.path.join(ROOT, "docs", "renders")
PH = os.path.join(ROOT, "assets-src", "polyhaven")
if not OUT and not os.path.isdir(PH) and "--overwrite-committed" not in ARGS:
    sys.exit("assets-src/polyhaven/ is missing, so this run would rebuild from the committed files and "
             "overwrite them. Pass --out=DIR for a test build, or --overwrite-committed to replace them.")
Z0 = 70.5            # game z of the local origin
WALL_H = 3.2
IN = 0.15            # inner wall face offset from the room edge
for d in (TEX_DIR, os.path.dirname(GLB), RENDERS):
    os.makedirs(d, exist_ok=True)


# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = "METRIC"
EXPORT = bpy.data.collections.new("Export")        # goes into the game
RENDER_ONLY = bpy.data.collections.new("RenderOnly")  # structural walls, hallway, door leaves, lights
scene.collection.children.link(EXPORT)
scene.collection.children.link(RENDER_ONLY)


def P(x, y, z):
    """game-local (x, height, z) -> Blender (x, -z, height)."""
    return Vector((x, -z, y))


# ---------------------------------------------------------------- procedural textures (numpy)
rng = np.random.default_rng(1966)


def smooth_noise(h, w, cells, seed, tile=True):
    r = np.random.default_rng(seed).random((cells, cells))
    ys, xs = np.arange(h) / h * cells, np.arange(w) / w * cells
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    fy, fx = ys - y0, xs - x0
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    y1, x1 = (y0 + 1) % cells, (x0 + 1) % cells
    y0 %= cells; x0 %= cells
    a = r[np.ix_(y0, x0)]; b = r[np.ix_(y0, x1)]; c = r[np.ix_(y1, x0)]; d = r[np.ix_(y1, x1)]
    top = a + (b - a) * fx[None, :]; bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(h, w, base, seed, octaves=4):
    out, amp, tot = np.zeros((h, w)), 1.0, 0.0
    for o in range(octaves):
        out += smooth_noise(h, w, base * 2 ** o, seed + o) * amp
        tot += amp; amp *= 0.5
    return out / tot


def save_image(name, rgb, alpha=None):
    h, w, _ = rgb.shape
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(rgb, 0, 1)
    if alpha is not None:
        rgba[..., 3] = alpha
    img = bpy.data.images.new(name, w, h, alpha=alpha is not None)
    img.pixels.foreach_set(rgba[::-1].ravel())   # Blender images are bottom-up
    path = os.path.join(TEX_DIR, name + ".png")
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.filepath = "//textures/" + name + ".png"
    return img


def tex_planks(s=1024):
    """Dark oak floorboards, tileable over 1.6 m (8 boards of 0.2 m)."""
    rows = 8
    u = np.arange(s) / s
    v = np.arange(s) / s
    U, V = np.meshgrid(u, v)
    row = np.floor(V * rows).astype(int)
    lv = V * rows - row
    grainN = fbm(s, s, 8, 11)
    grain = 0.5 + 0.5 * np.sin((lv * 9 + grainN * 6 + row * 1.7) * math.pi * 2 + U * 3)
    fine = fbm(s, s, 64, 12, 3)
    tone = np.array([rng.uniform(0.75, 1.15) for _ in range(rows)])[row]
    base = np.array([0.26, 0.15, 0.075])
    col = base[None, None, :] * (tone * (0.82 + 0.3 * grain * 0.6 + 0.25 * fine))[..., None]
    # board seams (long edges) and staggered butt joints
    seam = (lv < 0.03) | (lv > 0.97)
    offs = np.array([rng.uniform(0, 1) for _ in range(rows)])[row]
    butt = (np.abs(((U + offs) % 0.5) - 0.0) < 0.004) | (np.abs(((U + offs) % 0.5) - 0.5) < 0.004)
    col[seam | butt] *= 0.35
    # wear: lighter traffic paths, darker corners
    wear = fbm(s, s, 3, 13, 2)
    col *= (0.85 + 0.3 * wear)[..., None]
    return save_image("oak_planks", col)


def tex_damask(s=512):
    """Faded blue damask wallpaper, tileable over 0.6 m."""
    u = np.arange(s) / s
    U, V = np.meshgrid(u, u)
    mask = np.zeros((s, s))
    for cx, cy in [(0.5, 0.5), (0.0, 0.0), (1.0, 0.0), (0.0, 1.0), (1.0, 1.0)]:
        x, y = U - cx, V - cy
        leaf = (np.abs(x) / 0.1) ** 1.6 + (np.abs(y) / 0.34) ** 2 < 1
        inner = (np.abs(x) / 0.06) ** 1.6 + (np.abs(y) / 0.26) ** 2 < 1
        mask += leaf & ~inner
        mask += ((np.abs(x) / 0.025) ** 2 + (y / 0.2) ** 2 < 1)
        for sx in (-1, 1):
            for sy in (-1, 1):
                d = np.hypot(x - sx * 0.17, y - sy * 0.08)
                mask += (np.abs(d - 0.07) < 0.012) & (sy * (y - sy * 0.08) > -0.03)
                mask += np.hypot(x - sx * 0.23, y - sy * 0.2) < 0.022
        cross = np.hypot(x, y) < 0.045
        mask += cross
    mask = np.clip(mask, 0, 1)
    age = fbm(s, s, 4, 21)
    bg = np.array([0.075, 0.10, 0.19])
    fg = np.array([0.33, 0.37, 0.48])
    col = bg + (fg - bg) * (mask * 0.85)[..., None]
    col *= (0.78 + 0.35 * age)[..., None]
    stain = np.clip(fbm(s, s, 2, 22) - 0.55, 0, 1) * 1.2
    col = col * (1 - stain[..., None] * 0.5) + np.array([0.22, 0.18, 0.12]) * stain[..., None] * 0.3
    return save_image("blue_damask", col)


def tex_wood_panel(s=512):
    """Walnut wainscot grain (vertical), tileable over 1 m."""
    u = np.arange(s) / s
    U, V = np.meshgrid(u, u)
    n = fbm(s, s, 6, 31)
    grain = 0.5 + 0.5 * np.sin((U * 22 + n * 5) * math.pi * 2)
    col = np.array([0.16, 0.085, 0.045]) * (0.75 + 0.35 * grain)[..., None]
    col *= (0.85 + 0.3 * fbm(s, s, 32, 32, 2))[..., None]
    return save_image("walnut_panel", col)


def tex_rug(w=1024, h=768):
    """Faded Persian-style rug: medallion, floral lattice field, layered borders, worn wool (fit)."""
    u, v = np.meshgrid(np.arange(w) / w, np.arange(h) / h)
    x, y = (u - 0.5) * 2, (v - 0.5) * 2
    edge = np.minimum((1 - np.abs(x)) * w / h, 1 - np.abs(y))
    navy, cream, rust, gold, ink = [np.array(c) for c in ([0.08, 0.1, 0.22], [0.66, 0.6, 0.47], [0.45, 0.16, 0.1], [0.58, 0.44, 0.2], [0.03, 0.03, 0.06])]
    col = np.zeros((h, w, 3)) + rust * 0.85
    # field: diamond lattice with small rosettes
    lu, lv = (x * 9) % 1 - 0.5, (y * 7) % 1 - 0.5
    lattice = np.abs(np.abs(lu) + np.abs(lv) - 0.45) < 0.05
    col[lattice] = navy
    ros = np.hypot(lu, lv) < 0.12
    petal = np.hypot(lu, lv) < 0.12 + 0.05 * np.cos(np.arctan2(lv, lu) * 6)
    col[petal] = cream * 0.85
    col[ros & (np.hypot(lu, lv) < 0.05)] = gold
    # central medallion (lobed), with a pendant above and below
    r = np.hypot(x * 1.25, y * 1.6)
    ang = np.arctan2(y * 1.6, x * 1.25)
    lobe = 0.42 + 0.06 * np.cos(ang * 12)
    col[r < lobe + 0.03] = gold
    col[r < lobe] = navy
    inner = r < 0.3 + 0.03 * np.cos(ang * 8)
    col[inner] = cream * 0.9
    col[r < 0.2] = rust
    col[r < 0.08] = navy
    for sy in (-1, 1):
        pend = (np.abs(x) * 5 + np.abs(y - sy * 0.62) * 6) < 1
        col[pend] = navy
    # corner spandrels
    corner = (np.abs(x) > 0.62) & (np.abs(y) > 0.5) & (edge > 0.2)
    col[corner] = navy * 1.1
    # borders: outer guard, main band with a running vine, inner guard
    main = (edge > 0.05) & (edge < 0.2)
    col[main] = navy
    vine = main & (np.abs(np.sin((x + y) * 22) * 0.5 + np.sin((x - y) * 22) * 0.5) > 0.75)
    col[vine] = cream * 0.8
    col[main & (np.abs(((x + y) * 11) % 1 - 0.5) < 0.08)] = rust
    col[(np.abs(edge - 0.05) < 0.012) | (np.abs(edge - 0.2) < 0.012)] = gold
    col[edge < 0.04] = cream * 0.75
    col[edge < 0.012] = ink
    # wool: fine knot noise, darker creases, worn centre
    knots = fbm(h, w, 96, 42, 2)
    wear = fbm(h, w, 4, 41)
    col *= (0.72 + 0.28 * knots)[..., None]
    col *= (0.78 + 0.35 * wear)[..., None]
    col = col * (1 - 0.25 * np.exp(-(x ** 2 + y ** 2) * 3))[..., None] + np.array([0.3, 0.26, 0.2]) * (0.12 * np.exp(-(x ** 2 + y ** 2) * 3))[..., None]
    return save_image("guest_rug", col)


def tex_quilt(s=512):
    """Blue floral quilt with stitching, tileable over 0.8 m."""
    u = np.arange(s) / s
    U, V = np.meshgrid(u, u)
    base = np.array([0.08, 0.12, 0.28])
    n = fbm(s, s, 6, 51)
    blooms = np.zeros((s, s))
    for i in range(18):
        cx, cy, r = rng.random(), rng.random(), rng.uniform(0.03, 0.07)
        for ox in (-1, 0, 1):
            for oy in (-1, 0, 1):
                d = np.hypot(U - cx - ox, V - cy - oy)
                ang = np.arctan2(V - cy - oy, U - cx - ox)
                blooms += (d < r * (0.75 + 0.25 * np.cos(ang * 5)))
    col = base + (np.array([0.55, 0.6, 0.72]) - base) * np.clip(blooms, 0, 1)[..., None] * 0.8
    col *= (0.85 + 0.25 * n)[..., None]
    stitch = (np.abs(((U + V) * 8) % 1 - 0.5) < 0.012) | (np.abs(((U - V) * 8) % 1 - 0.5) < 0.012)
    col[stitch] *= 0.6
    return save_image("blue_quilt", col)


def tex_tiles(s=512):
    """Black-and-white marble checker for the bathroom floor (0.6 m tile)."""
    u = np.arange(s) / s
    U, V = np.meshgrid(u, u)
    checker = ((np.floor(U * 2) + np.floor(V * 2)) % 2).astype(bool)
    vein = np.abs(np.sin((U * 3 + V * 2 + fbm(s, s, 6, 61) * 3) * math.pi * 2)) ** 18
    white = np.array([0.78, 0.76, 0.72]) * (0.92 + 0.08 * fbm(s, s, 16, 62))[..., None] - vein[..., None] * 0.25
    black = np.array([0.04, 0.04, 0.05]) + vein[..., None] * 0.18
    col = np.where(checker[..., None], white, black)
    grout = (np.abs((U * 2) % 1) < 0.01) | (np.abs((V * 2) % 1) < 0.01)
    col[grout] = [0.25, 0.24, 0.22]
    return save_image("bath_checker", col)


def tex_subway(s=512):
    """Glazed cream subway tiles (0.6 m repeat)."""
    u = np.arange(s) / s
    U, V = np.meshgrid(u, u)
    rows = 8
    r = np.floor(V * rows)
    off = (r % 2) * 0.125
    grout = (np.abs(((U + off) * 4) % 1) < 0.02) | (np.abs((V * rows) % 1) < 0.04)
    col = np.zeros((s, s, 3)) + np.array([0.72, 0.68, 0.58])
    col *= (0.9 + 0.12 * fbm(s, s, 8, 71))[..., None]
    col[grout] = [0.32, 0.3, 0.26]
    return save_image("subway_tile", col)


def tex_painting(name, seed, kind="landscape", w=512, h=384):
    """A moody oil painting (placeholder art generated in code)."""
    u, v = np.meshgrid(np.arange(w) / w, np.arange(h) / h)
    n = fbm(h, w, 5, seed)
    if kind == "landscape":
        sky = np.array([0.08, 0.1, 0.16]) + (np.array([0.3, 0.3, 0.28]) - np.array([0.08, 0.1, 0.16])) * (1 - v)[..., None] * 0.5
        col = sky * (0.85 + 0.3 * n)[..., None]
        moon = np.hypot(u - 0.72, v - 0.22) < 0.05
        col[moon] = [0.85, 0.82, 0.7]
        hills = v > 0.55 + 0.08 * np.sin(u * 7 + seed) + 0.06 * n
        col[hills] = np.array([0.05, 0.06, 0.05]) * (0.7 + 0.6 * n[hills])[..., None]
        trees = (v > 0.35 + 0.25 * fbm(h, w, 24, seed + 3)) & (u < 0.35)
        col[trees] = [0.03, 0.035, 0.03]
        lake = (v > 0.78) & (u > 0.4)
        col[lake] = col[lake] * 0.5 + np.array([0.2, 0.22, 0.25]) * 0.5
    else:  # portrait
        bg = np.array([0.12, 0.08, 0.05]) * (0.8 + 0.4 * n)[..., None]
        col = bg.copy()
        face = ((u - 0.5) / 0.14) ** 2 + ((v - 0.38) / 0.19) ** 2 < 1
        col[face] = np.array([0.62, 0.48, 0.38]) * (0.9 + 0.2 * n[face])[..., None]
        hair = ((u - 0.5) / 0.17) ** 2 + ((v - 0.3) / 0.16) ** 2 < 1
        col[hair & ~face] = [0.08, 0.05, 0.03]
        body = ((u - 0.5) / 0.35) ** 2 + ((v - 1.0) / 0.4) ** 2 < 1
        col[body] = [0.06, 0.08, 0.16]
    col *= (1 - 0.5 * np.hypot(u - 0.5, v - 0.5))[..., None]   # varnish vignette
    return save_image(name, col)


def tex_window(s=256):
    """Moonlit sky seen through leaded glass (emissive)."""
    u, v = np.meshgrid(np.arange(s) / s, np.arange(s) / s)
    col = np.array([0.05, 0.08, 0.16]) + (np.array([0.14, 0.2, 0.32]) - np.array([0.05, 0.08, 0.16])) * (1 - v)[..., None]
    col *= (0.8 + 0.4 * fbm(s, s, 4, 81))[..., None]
    col[np.hypot(u - 0.7, v - 0.25) < 0.07] = [0.8, 0.85, 0.95]
    trees = v > 0.62 + 0.12 * fbm(s, s, 12, 82)
    col[trees] = [0.02, 0.03, 0.04]
    lead = (np.abs((u * 4) % 1) < 0.03) | (np.abs((v * 6) % 1) < 0.03)
    col[lead] = [0.02, 0.02, 0.02]
    return save_image("moon_window", col)


print("painting textures...")
IMG = {
    "planks": tex_planks(), "damask": tex_damask(), "walnut": tex_wood_panel(), "rug": tex_rug(),
    "quilt": tex_quilt(), "checker": tex_tiles(), "subway": tex_subway(), "window": tex_window(),
    "landscape": tex_painting("painting_moonlake", 91), "portrait": tex_painting("painting_sitter", 92, "portrait", 384, 512),
}


# ---------------------------------------------------------------- materials
MATS = {}


def material(name, color=(0.5, 0.5, 0.5), rough=0.6, metal=0.0, img=None, emit=None, emit_strength=0.0, alpha=None, tile=1.0, two_sided=False):
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
    if emit is not None:
        if img is None:
            bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    if alpha is not None:
        bsdf.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED" if hasattr(m, "surface_render_method") else m.blend_method
    m.use_backface_culling = not two_sided
    m["tile"] = tile
    MATS[name] = m
    return m


def committed_image(out, non_color):
    """Fallback when assets-src/polyhaven is absent: reuse the already tinted/resized committed map."""
    src = os.path.join(TEX_COMMITTED, out + ".jpg")
    if not os.path.exists(src):
        return None
    path = os.path.join(TEX_DIR, out + ".jpg")
    if os.path.abspath(src) != os.path.abspath(path):
        shutil.copyfile(src, path)
    img = bpy.data.images.load(path)
    img.filepath = "//textures/" + out + ".jpg"
    img.name = out
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def ph_image(tex, map_name, tint=None, size=1024, non_color=False, name=None):
    """Load a Poly Haven map, optionally tinted (multiplied) and resized, saved beside the .blend."""
    out = name or f"{tex}_{map_name}"
    if not os.path.isdir(os.path.join(PH, tex)):
        return committed_image(out, non_color)
    src = next((os.path.join(PH, tex, f) for f in os.listdir(os.path.join(PH, tex)) if f.startswith(map_name + ".")), None)
    if src is None:
        return None
    img = bpy.data.images.load(src)
    if img.size[0] > size:
        img.scale(size, size)
    if tint is not None:
        px = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
        px[:, :3] *= np.array(tint, dtype=np.float32)
        img.pixels.foreach_set(px.ravel())
    path = os.path.join(TEX_DIR, out + ".jpg")
    img.filepath_raw = path
    img.file_format = "JPEG"
    img.save()
    img.filepath = "//textures/" + out + ".jpg"
    img.name = out
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def pbr(name, tex, tint=None, tile=1.0, rough_mul=1.0, normal=0.8, size=1024, two_sided=False, rough=None):
    """Principled material from a CC0 Poly Haven texture set (base colour, normal, roughness)."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    d = ph_image(tex, "diff", tint, size, name=f"{name}_diff")
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = d
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    n = ph_image(tex, "nor", None, min(size, 1024), True, name=f"{name}_nor")
    if n is not None and normal > 0:
        tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = n
        nm = nt.nodes.new("ShaderNodeNormalMap"); nm.inputs["Strength"].default_value = normal
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    r = ph_image(tex, "rough", None, min(size, 512), True, name=f"{name}_rough") if rough is None else None
    if r is not None:
        tr = nt.nodes.new("ShaderNodeTexImage"); tr.image = r
        nt.links.new(tr.outputs["Color"], bsdf.inputs["Roughness"])
    else:
        bsdf.inputs["Roughness"].default_value = rough if rough is not None else 0.6
    m.use_backface_culling = not two_sided
    m["tile"] = tile
    MATS[name] = m
    return m


M = {
    "floor": pbr("OldOakFloor", "old_wooden_floor_02", tint=(0.95, 0.85, 0.8), tile=2.4),
    "damask": pbr("BlueJacquardPaper", "floral_jacquard", tint=(0.42, 0.52, 0.78), tile=0.9, normal=0.35, rough=0.85),
    "walnut": pbr("DarkPanelling", "dark_paneled_wood", tint=(0.9, 0.8, 0.72), tile=2.2, normal=0.9),
    "trim": material("WalnutTrim", color=(0.09, 0.05, 0.028), rough=0.35),
    "rug": material("GuestRug", img=IMG["rug"], rough=0.95),
    "quilt": pbr("BlueQuatrefoilQuilt", "quatrefoil_jacquard_fabric", tint=(0.28, 0.36, 0.62), tile=0.7, normal=0.6, rough=0.9),
    "linen": material("Linen", color=(0.78, 0.75, 0.68), rough=0.85),
    "iron": material("BlackIron", color=(0.035, 0.035, 0.04), rough=0.35, metal=0.9),
    "brass": material("AgedBrass", color=(0.62, 0.45, 0.2), rough=0.32, metal=1.0),
    "wardrobe": pbr("WornWalnut", "wood_table_worn", tint=(0.55, 0.42, 0.36), tile=1.2, normal=0.6),
    "wardrobe_in": material("WardrobeInside", color=(0.06, 0.035, 0.02), rough=0.7),
    "velvet": pbr("BlueVelvet", "velour_velvet", tint=(0.2, 0.26, 0.5), tile=0.8, normal=0.5, two_sided=True, rough=0.95),
    "cushion": pbr("BlueVelvetCushion", "velour_velvet", tint=(0.24, 0.3, 0.52), tile=0.6, normal=0.5, rough=0.95),
    "shade": material("LampShade", color=(0.85, 0.72, 0.5), rough=0.8, emit=(1.0, 0.72, 0.4), emit_strength=2.2, two_sided=True),
    "bulb": material("CandleGlow", color=(1, 0.85, 0.6), emit=(1.0, 0.8, 0.5), emit_strength=6.0),
    "window": material("MoonWindow", img=IMG["window"], rough=0.1, emit=(1, 1, 1), emit_strength=1.6),
    "canvas_land": material("PaintingMoonLake", img=IMG["landscape"], rough=0.6),
    "canvas_face": material("PaintingSitter", img=IMG["portrait"], rough=0.6),
    "gilt": material("GiltFrame", color=(0.55, 0.4, 0.15), rough=0.3, metal=1.0),
    "checker": pbr("BathFloorTiles", "interior_tiles", tile=1.6, normal=0.8),
    "subway": pbr("WhiteWallTiles", "long_white_tiles", tile=1.0, normal=0.7),
    "porcelain": material("Porcelain", color=(0.86, 0.85, 0.8), rough=0.12),
    "shower": material("ShowerCurtain", color=(0.7, 0.68, 0.62), rough=0.85, two_sided=True),
    "mirror": material("Mirror", color=(0.8, 0.82, 0.85), rough=0.02, metal=1.0),
    "clothes_a": material("CoatCharcoal", color=(0.07, 0.07, 0.08), rough=0.9),
    "clothes_b": material("DressBurgundy", color=(0.25, 0.05, 0.07), rough=0.85),
    "clothes_c": material("ShirtCream", color=(0.6, 0.55, 0.45), rough=0.9),
    "towel": material("Towel", color=(0.55, 0.5, 0.42), rough=0.95),
    "wall_struct": material("StructuralWall", color=(0.06, 0.055, 0.055), rough=0.9),
    "wall_top": material("WallTopStone", color=(0.18, 0.17, 0.16), rough=0.85),
    "hall": material("HallFloor", img=IMG["planks"], rough=0.5, tile=1.6),
    "runner": material("HallRunner", color=(0.25, 0.05, 0.06), rough=0.95),
    "book": material("BookSpines", color=(0.25, 0.08, 0.06), rough=0.7),
    "diary": material("Diary", color=(0.3, 0.15, 0.08), rough=0.6),
}


# ---------------------------------------------------------------- geometry helpers
def world_uv(bm, mat_tile, fit=None):
    """Triplanar world-space UVs (metres / tile) so textures keep their size on any object."""
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            co = l.vert.co
            if fit is not None and ax == 2:
                (x0, y0, sx, sy) = fit
                l[uv].uv = ((co.x - x0) / sx, (co.y - y0) / sy)
            elif ax == 2:
                l[uv].uv = (co.x / mat_tile, co.y / mat_tile)
            elif ax == 0:
                l[uv].uv = (co.y / mat_tile, co.z / mat_tile)
            else:
                l[uv].uv = (co.x / mat_tile, co.z / mat_tile)


def finish(bm, name, mat, coll=EXPORT, fit=None, smooth=False):
    world_uv(bm, mat.get("tile", 1.0), fit)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    coll.objects.link(ob)
    return ob


def box(name, c, s, mat, coll=EXPORT, bevel=0.0, fit=None, rot=0.0):
    """Box centred at game-local c=(x, y, z) with size s=(sx, height, sz); rot = yaw in degrees."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((s[0], s[2], s[1])), verts=bm.verts)
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=2, affect="EDGES", profile=0.5)
    if rot:
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=__import__("mathutils").Matrix.Rotation(math.radians(rot), 3, "Z"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*c), verts=bm.verts)
    return finish(bm, name, mat, coll, fit)


def cyl(name, c, r, h, mat, coll=EXPORT, seg=16, r2=None, axis="y", smooth=True):
    """Cylinder (or cone with r2) centred at game-local c, along game axis y (up), x or z."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    from mathutils import Matrix
    if axis == "x":
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Matrix.Rotation(math.radians(90), 3, "Y"), verts=bm.verts)
    elif axis == "z":
        bmesh.ops.rotate(bm, cent=Vector((0, 0, 0)), matrix=Matrix.Rotation(math.radians(90), 3, "X"), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*c), verts=bm.verts)
    return finish(bm, name, mat, coll, smooth=smooth)


def sphere(name, c, r, mat, coll=EXPORT, seg=12, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(6, seg // 2), radius=r)
    bmesh.ops.scale(bm, vec=Vector((scale[0], scale[2], scale[1])), verts=bm.verts)
    bmesh.ops.translate(bm, vec=P(*c), verts=bm.verts)
    return finish(bm, name, mat, coll, smooth=True)


def drape(name, x0, x1, z, y0, y1, mat, folds=7, depth=0.06, axis="x", coll=EXPORT, gather=0.0):
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
            pos = P(a, y, z + off) if axis == "x" else P(z + off, y, a)
            row.append(bm.verts.new(pos))
        verts.append(row)
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    bm.normal_update()
    return finish(bm, name, mat, coll, smooth=True)


def empty(name, c, coll=EXPORT):
    ob = bpy.data.objects.new(name, None)
    ob.location = P(*c)
    ob.empty_display_size = 0.15
    coll.objects.link(ob)
    return ob


_COMMITTED_OBJECTS = None


def committed_model(root_name):
    """Fallback when assets-src/polyhaven is absent: append the already placed model (root empty and
    its children, packed textures, decimation as saved) from the committed guest_suite.blend."""
    global _COMMITTED_OBJECTS
    if _COMMITTED_OBJECTS is None:
        with bpy.data.libraries.load(BLEND_COMMITTED, link=False) as (src, dst):
            names = list(src.objects)
            dst.objects = list(names)   # filled in place with the appended objects
        _COMMITTED_OBJECTS = dict(zip(names, dst.objects))
        # park the appended copies under other names, so objects built later in this script keep
        # their own names (fit_uv() and other lookups by name must find the new ones, not these)
        for n, o in _COMMITTED_OBJECTS.items():
            o.name = "_committed_" + n
    root = _COMMITTED_OBJECTS[root_name]
    for o in [root, *root.children_recursive]:
        o.name = o.name.removeprefix("_committed_")
        EXPORT.objects.link(o)
    return root


def place_model(model_id, c, yaw=0.0, height=None, width=None, depth=None, decimate=None, name=None):
    """Import a CC0 Poly Haven glTF, fit it to a height / width (x) / depth (z) in metres, stand it on
    the floor at game-local c = (x, y, z) facing +z rotated by yaw (degrees), optionally decimated."""
    path = os.path.join(PH, model_id, f"{model_id}.gltf")
    if not os.path.exists(path):
        return committed_model(name or model_id)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        for col in list(o.users_collection):
            col.objects.unlink(o)
        EXPORT.objects.link(o)
    bpy.context.view_layer.update()
    # bounds in world space (Blender axes: x, y=-z_game, z=up)
    pts = [o.matrix_world @ Vector(v) for o in meshes for v in o.bound_box]
    mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    size = mx - mn
    s = height / size.z if height else width / size.x if width else depth / size.y
    root = bpy.data.objects.new(name or model_id, None)
    EXPORT.objects.link(root)
    centre = Vector(((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, mn.z))
    for o in new:
        if o.parent is None:
            o.parent = root
            o.matrix_parent_inverse = root.matrix_world.inverted()
            o.location -= centre
    root.scale = (s, s, s)
    root.rotation_euler = (0, 0, math.radians(yaw))
    root.location = P(*c)
    bpy.context.view_layer.update()
    if decimate:
        for o in meshes:
            mod = o.modifiers.new("Decimate", "DECIMATE")
            mod.ratio = decimate
    return root


# ---------------------------------------------------------------- the rooms
BED = dict(x0=-4.5, x1=4.5, z0=-4.5, z1=4.5)   # bedroom, local z (game 66..75)
BATH = dict(x0=0.5, x1=4.5, z0=5.5, z1=10)     # bathroom, local z (game 76..80.5)


def floor(name, r, mat):
    box(name, ((r["x0"] + r["x1"]) / 2, -0.03, (r["z0"] + r["z1"]) / 2), (r["x1"] - r["x0"], 0.06, r["z1"] - r["z0"]), mat)


def wall_finish(prefix, r, gaps, lower_mat, upper_mat, dado=1.0, door_h=2.35):
    """Interior wall surfaces (wainscot + paper, or tiles) inset from each edge, leaving doorway gaps.
    gaps: {side: [(a0, a1), ...]} in the wall's own axis."""
    t = 0.02
    sides = {
        "S": ("x", r["x0"] + IN, r["x1"] - IN, r["z0"] + IN + t / 2),
        "N": ("x", r["x0"] + IN, r["x1"] - IN, r["z1"] - IN - t / 2),
        "W": ("z", r["z0"] + IN, r["z1"] - IN, r["x0"] + IN + t / 2),
        "E": ("z", r["z0"] + IN, r["z1"] - IN, r["x1"] - IN - t / 2),
    }
    for side, (axis, a0, a1, at) in sides.items():
        spans, cur = [], a0
        for g0, g1 in sorted(gaps.get(side, [])):
            if g0 > cur:
                spans.append((cur, g0))
            cur = max(cur, g1)
        if cur < a1:
            spans.append((cur, a1))
        # full-height panels between gaps, plus a panel above each gap (over the door)
        segs = [(s0, s1, 0.0, WALL_H) for s0, s1 in spans] + [(g0, g1, door_h, WALL_H) for g0, g1 in gaps.get(side, [])]
        for k, (s0, s1, y0, y1) in enumerate(segs):
            mid, ln = (s0 + s1) / 2, s1 - s0
            for mat, ya, yb in ((lower_mat, y0, min(y1, dado)), (upper_mat, max(y0, dado), y1)):
                if yb <= ya:
                    continue
                c = (mid, (ya + yb) / 2, at) if axis == "x" else (at, (ya + yb) / 2, mid)
                s = (ln, yb - ya, t) if axis == "x" else (t, yb - ya, ln)
                box(f"{prefix}_{side}{k}_{mat.name}", c, s, mat)
            # dado rail, picture rail and a crown moulding
            for ry, rh in ((dado, 0.06), (2.55, 0.035), (WALL_H - 0.08, 0.12)):
                if y0 <= ry <= y1:
                    c = (mid, ry, at + (0.02 if side in "SW" else -0.02)) if axis == "x" else (at + (0.02 if side in "SW" else -0.02), ry, mid)
                    s = (ln, rh, 0.05) if axis == "x" else (0.05, rh, ln)
                    box(f"{prefix}_{side}{k}_rail{ry}", c, s, M["trim"])
            # skirting
            if y0 == 0:
                c = (mid, 0.09, at + (0.02 if side in "SW" else -0.02)) if axis == "x" else (at + (0.02 if side in "SW" else -0.02), 0.09, mid)
                s = (ln, 0.18, 0.04) if axis == "x" else (0.04, 0.18, ln)
                box(f"{prefix}_{side}{k}_skirt", c, s, M["trim"])


def door_casing(name, cx, cz, axis, width=2.0, height=2.35):
    """Architrave around a doorway (both faces) on a wall along `axis` at (cx, cz)."""
    for side in (-1, 1):
        for s in (-1, 1):
            if axis == "x":
                box(f"{name}_jamb{side}{s}", (cx + s * (width / 2 + 0.06), height / 2, cz + side * 0.17), (0.12, height, 0.05), M["trim"], bevel=0.01)
            else:
                box(f"{name}_jamb{side}{s}", (cx + side * 0.17, height / 2, cz + s * (width / 2 + 0.06)), (0.05, height, 0.12), M["trim"], bevel=0.01)
        if axis == "x":
            box(f"{name}_head{side}", (cx, height + 0.08, cz + side * 0.17), (width + 0.36, 0.16, 0.06), M["trim"], bevel=0.01)
        else:
            box(f"{name}_head{side}", (cx + side * 0.17, height + 0.08, cz), (0.06, 0.16, width + 0.36), M["trim"], bevel=0.01)


print("building bedroom...")
floor("BedroomFloor", BED, M["floor"])
wall_finish("Bed", BED, {"S": [(-1, 1)], "N": [(2, 4)]}, M["walnut"], M["damask"])
door_casing("HallDoor", 0, BED["z0"], "x")
door_casing("BathDoor", 3.0, BED["z1"], "x")
door_casing("BathDoorInner", 3.0, BATH["z0"], "x")


# --- Iron bed with a real crawl space underneath (clearance 0.58 m), head against the north wall.
BX, BZ, BW, BL = -1.6, 3.2, 1.8, 2.2    # centre x, centre z, width (x), length (z)
hz, fz = BZ + BL / 2, BZ - BL / 2       # head / foot z
for sx in (-1, 1):
    x = BX + sx * BW / 2
    cyl(f"BedPostHead{sx}", (x, 0.73, hz), 0.035, 1.46, M["iron"])
    cyl(f"BedPostFoot{sx}", (x, 0.53, fz), 0.035, 1.06, M["iron"])
    sphere(f"BedFinialHead{sx}", (x, 1.5, hz), 0.055, M["brass"])
    sphere(f"BedFinialFoot{sx}", (x, 1.1, fz), 0.05, M["brass"])
    box(f"BedSideRail{sx}", (x, 0.61, BZ), (0.05, 0.06, BL), M["iron"])
for zz, top, name in ((hz, 1.35, "Head"), (fz, 0.95, "Foot")):
    for y in (0.64, top):
        cyl(f"Bed{name}Bar{y}", (BX, y, zz), 0.022, BW, M["iron"], axis="x", seg=10)
    for i in range(1, 10):
        x = BX - BW / 2 + i * BW / 10
        cyl(f"Bed{name}Spindle{i}", (x, (0.64 + top) / 2, zz), 0.011, top - 0.64, M["brass" if i % 3 == 0 else "iron"], seg=8)
    sphere(f"Bed{name}Medallion", (BX, (0.64 + top) / 2 + 0.1, zz), 0.07, M["brass"], scale=(1, 1, 0.4))
for i in range(8):   # slats (visible from underneath)
    box(f"BedSlat{i}", (BX, 0.6, fz + 0.2 + i * (BL - 0.4) / 7), (BW - 0.1, 0.03, 0.08), M["walnut"])
# solid base under the slats (the underside you see when hiding under the bed)
box("BedBase", (BX, 0.635, BZ), (BW - 0.1, 0.03, BL - 0.14), M["wardrobe_in"])
box("Mattress", (BX, 0.76, BZ), (BW - 0.08, 0.24, BL - 0.1), M["linen"], bevel=0.05)
box("Quilt", (BX, 0.87, BZ - 0.25), (BW + 0.06, 0.05, BL - 0.55), M["quilt"], bevel=0.02)
for sx in (-1, 1):   # the quilt falls over the sides, stopping short of the crawl space
    box(f"QuiltDrop{sx}", (BX + sx * (BW / 2 + 0.02), 0.77, BZ - 0.25), (0.03, 0.2, BL - 0.55), M["quilt"])
box("QuiltFoot", (BX, 0.77, fz + 0.01), (BW + 0.06, 0.2, 0.03), M["quilt"])
box("FoldedThrow", (BX, 0.915, fz + 0.45), (BW + 0.02, 0.05, 0.4), M["velvet"], bevel=0.02)
for sx in (-1, 1):
    box(f"Pillow{sx}", (BX + sx * 0.42, 0.93, hz - 0.35), (0.72, 0.16, 0.42), M["linen"], bevel=0.07)
box("Cushion", (BX, 0.97, hz - 0.55), (0.45, 0.14, 0.14), M["cushion"], bevel=0.05)

# nightstands with lamps
LAMPS = []
for i, nx in enumerate((BX - BW / 2 - 0.4, BX + BW / 2 + 0.4)):
    place_model("ClassicNightstand_01", (nx, 0, hz - 0.3), yaw=180, height=0.64, name=f"Nightstand{i}")
    cyl(f"LampBase{i}", (nx, 0.78, hz - 0.3), 0.05, 0.28, M["brass"])
    cyl(f"LampShade{i}", (nx, 1.03, hz - 0.3), 0.17, 0.22, M["shade"], r2=0.1)
    LAMPS.append((nx, 1.0, hz - 0.3))
box("Diary", (-3.95, 0.6, 1.0), (0.2, 0.04, 0.28), M["diary"], rot=15)

# --- Wardrobe (east wall), hollow: a person fits between the coats; doors stand ajar.
WX, WZ, WD, WWd, WH = BED["x1"] - IN - 0.36, -0.8, 0.7, 1.4, 2.3
wood, inner = M["wardrobe"], M["wardrobe_in"]
box("WardrobeBack", (BED["x1"] - IN - 0.02, WH / 2 + 0.1, WZ), (0.03, WH, WWd), inner)
for sz in (-1, 1):
    box(f"WardrobeSide{sz}", (WX, WH / 2 + 0.1, WZ + sz * (WWd / 2 - 0.02)), (WD, WH, 0.04), wood, bevel=0.01)
box("WardrobeTop", (WX, WH + 0.13, WZ), (WD + 0.08, 0.06, WWd + 0.1), wood, bevel=0.012)
box("WardrobeCornice", (WX - 0.02, WH + 0.2, WZ), (WD + 0.14, 0.08, WWd + 0.18), M["trim"], bevel=0.02)
box("WardrobeBase", (WX, 0.06, WZ), (WD + 0.04, 0.12, WWd + 0.04), wood, bevel=0.01)
box("WardrobeFloor", (WX, 0.13, WZ), (WD - 0.04, 0.02, WWd - 0.08), inner)
cyl("WardrobeRail", (WX + 0.05, 2.0, WZ), 0.012, WWd - 0.1, M["brass"], axis="z", seg=8)
for i, (dz, m) in enumerate(((-0.55, "clothes_a"), (-0.45, "clothes_b"), (-0.37, "clothes_c"), (0.42, "clothes_a"), (0.52, "clothes_c"))):
    box(f"Coat{i}", (WX + 0.05, 1.45, WZ + dz), (0.46, 1.05, 0.06), M[m], bevel=0.02, rot=(i * 7 % 11) - 5)
    cyl(f"Hanger{i}", (WX + 0.05, 1.98, WZ + dz), 0.006, 0.4, M["brass"], axis="x", seg=6)
# doors: hinged at the front corners, one open wide, one ajar (about 20 degrees)
front = WX - WD / 2
for sz, ang, nm in ((-1, 105, "Wide"), (1, 20, "Ajar")):
    hinge_z = WZ + sz * WWd / 2
    a = math.radians(ang)
    dw = WWd / 2
    cz = hinge_z - sz * math.cos(a) * dw / 2
    cx = front - math.sin(a) * dw / 2
    box(f"WardrobeDoor{nm}", (cx, WH / 2 + 0.12, cz), (0.035, WH - 0.1, dw), wood, bevel=0.01, rot=-sz * ang)
    kx = front - math.sin(a) * (dw - 0.08)
    kz = hinge_z - sz * math.cos(a) * (dw - 0.08)
    sphere(f"WardrobeKnob{nm}", (kx - 0.03, 1.25, kz), 0.02, M["brass"])
box("WardrobeMirrorPanel", (WX + 0.3, 1.3, WZ - 0.66), (0.02, 1.0, 0.02), M["gilt"])

# --- Window seat on the west wall with a curtain that can be drawn across (the curtain hide).
WSZ = 0.0
box("WindowGlass", (BED["x0"] + IN + 0.03, 1.75, WSZ), (0.02, 1.9, 1.6), M["window"])
for dz in (-0.82, 0.82):
    box(f"WindowJamb{dz}", (BED["x0"] + IN + 0.06, 1.75, WSZ + dz), (0.08, 2.0, 0.07), M["trim"])
for y in (0.78, 2.72):
    box(f"WindowSill{y}", (BED["x0"] + IN + 0.08, y, WSZ), (0.14, 0.06, 1.8), M["trim"])
for i, dz in enumerate(np.linspace(-0.55, 0.55, 3)):
    box(f"WindowMullion{i}", (BED["x0"] + IN + 0.05, 1.75, WSZ + dz), (0.02, 1.9, 0.025), M["iron"])
box("WindowSeatBox", (BED["x0"] + IN + 0.3, 0.24, WSZ), (0.58, 0.48, 2.2), M["walnut"], bevel=0.015)
box("WindowSeatCushion", (BED["x0"] + IN + 0.3, 0.53, WSZ), (0.56, 0.1, 2.14), M["cushion"], bevel=0.04)
for i, dz in enumerate((-0.7, 0.55)):
    box(f"WindowPillow{i}", (BED["x0"] + IN + 0.14, 0.72, WSZ + dz), (0.14, 0.34, 0.4), M["quilt"], bevel=0.06, rot=10)
rod_x = BED["x0"] + IN + 0.95
cyl("CurtainRod", (rod_x, 2.78, WSZ), 0.018, 2.6, M["brass"], axis="z", seg=8)
for sz in (-1, 1):
    sphere(f"CurtainRodFinial{sz}", (rod_x, 2.78, WSZ + sz * 1.32), 0.035, M["brass"])
drape("CurtainDrawn", WSZ - 1.25, WSZ + 0.05, rod_x, 0.04, 2.75, M["velvet"], folds=9, depth=0.05, axis="z")
drape("CurtainTiedBack", WSZ + 0.75, WSZ + 1.25, rod_x, 0.04, 2.75, M["velvet"], folds=3, depth=0.07, axis="z", gather=0.6)

# --- Dresser + mirror, rug, armchair, paintings, sconces, trunk.
SZ = BED["z0"] + IN   # south wall inner face
place_model("GothicCommode_01", (-2.6, 0, SZ + 0.27), yaw=0, width=1.45, name="Commode")
place_model("ornate_mirror_01", (-2.6, 1.05, SZ + 0.04), yaw=0, height=1.05, decimate=0.35, name="OrnateMirror")
LAMPS.append((-3.15, 1.05, SZ + 0.3))
cyl("DresserLampBase", (-3.15, 1.0, SZ + 0.3), 0.04, 0.24, M["brass"])
cyl("DresserLampShade", (-3.15, 1.2, SZ + 0.3), 0.13, 0.16, M["shade"], r2=0.08)
box("Rug", (BX + 0.9, 0.005, BZ - 1.3), (3.4, 0.012, 2.6), M["rug"], fit=(BX + 0.9 - 1.7, -(BZ - 1.3) - 1.3, 3.4, 2.6))
box("Trunk", (BX, 0.24, fz - 0.42), (1.15, 0.46, 0.52), M["wardrobe"], bevel=0.03)
box("TrunkLid", (BX, 0.48, fz - 0.42), (1.19, 0.05, 0.56), M["wardrobe"], bevel=0.02)
for sx in (-1, 1):
    box(f"TrunkStrap{sx}", (BX + sx * 0.33, 0.25, fz - 0.42), (0.05, 0.5, 0.58), M["brass"])
AC = (-3.5, 0, -2.0)   # armchair by the window, turned toward the room
place_model("ArmChair_01", AC, yaw=90, width=0.85, name="Armchair")
place_model("Rockingchair_01", (3.35, 0, -3.3), yaw=315, height=1.05, decimate=0.4, name="RockingChair")
place_model("vintage_grandfather_clock_01", (2.55, 0, SZ + 0.28), yaw=0, height=2.05, decimate=0.5, name="GrandfatherClock")
place_model("potted_plant_04", (-3.95, 0, -3.95), yaw=20, height=0.85, decimate=0.5, name="Plant")
# paintings
box("PaintingOverBed", (BX, 2.05, BED["z1"] - IN - 0.03), (1.3, 0.95, 0.02), M["canvas_land"], fit=None)
box("PaintingOverBedFrame", (BX, 2.05, BED["z1"] - IN - 0.02), (1.46, 1.11, 0.03), M["gilt"], bevel=0.015)
box("PaintingSitter", (BED["x1"] - IN - 0.03, 1.9, 2.4), (0.02, 1.0, 0.75), M["canvas_face"])
box("PaintingSitterFrame", (BED["x1"] - IN - 0.02, 1.9, 2.4), (0.03, 1.14, 0.89), M["gilt"], bevel=0.015)
SCONCES = []
for i, (sx, sz) in enumerate(((BED["x0"] + IN + 0.08, -2.6), (BED["x0"] + IN + 0.08, 2.4), (BED["x1"] - IN - 0.08, 1.0), (-1.2, BED["z0"] + IN + 0.08), (2.3, BED["z0"] + IN + 0.08))):
    box(f"SconcePlate{i}", (sx, 2.1, sz), (0.1 if abs(sx) > 5 else 0.12, 0.2, 0.12 if abs(sx) > 5 else 0.1), M["brass"])
    sphere(f"SconceFlame{i}", (sx + (0.1 if sx < 0 and abs(sx) > 5 else -0.1 if abs(sx) > 5 else 0), 2.28, sz + (0.1 if abs(sx) <= 5 else 0)), 0.05, M["bulb"], scale=(1, 1.5, 1))
    SCONCES.append((sx, 2.3, sz))

# texture UVs for the paintings (fit the canvas): re-project their front faces
def fit_uv(ob, axis):
    me = ob.data
    uv = me.uv_layers.active.data
    xs = [v.co.x for v in me.vertices]; ys = [v.co.y for v in me.vertices]; zs = [v.co.z for v in me.vertices]
    for poly in me.polygons:
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if axis == "x":
                u = (co.x - min(xs)) / (max(xs) - min(xs))
            else:
                u = (co.y - min(ys)) / (max(ys) - min(ys))
            v = (co.z - min(zs)) / (max(zs) - min(zs))
            uv[li].uv = (u, v)


fit_uv(bpy.data.objects["PaintingOverBed"], "x")
fit_uv(bpy.data.objects["PaintingSitter"], "z")
fit_uv(bpy.data.objects["WindowGlass"], "z")

# ---------------------------------------------------------------- bathroom
print("building bathroom...")
floor("BathFloor", BATH, M["checker"])
wall_finish("Bath", BATH, {"S": [(2, 4)]}, M["subway"], M["damask"], dado=1.3)
# clawfoot tub along the north wall, with a ring rail and a drawn shower curtain (the hide)
TX, TZ = 1.75, BATH["z1"] - IN - 0.5
box("TubBody", (TX, 0.42, TZ), (1.75, 0.5, 0.78), M["porcelain"], bevel=0.14)
box("TubRim", (TX, 0.68, TZ), (1.8, 0.05, 0.82), M["porcelain"], bevel=0.02)
box("TubWater", (TX, 0.6, TZ), (1.5, 0.02, 0.56), M["mirror"])
for sx in (-1, 1):
    for sz in (-1, 1):
        sphere(f"TubFoot{sx}{sz}", (TX + sx * 0.72, 0.1, TZ + sz * 0.28), 0.07, M["brass"], scale=(1, 1.3, 1))
cyl("TubTap", (TX + 0.8, 0.85, TZ), 0.025, 0.3, M["brass"])
rail_y = 2.2
for sx in (-1, 1):
    cyl(f"ShowerRailSide{sx}", (TX + sx * 0.95, rail_y, TZ - 0.05), 0.012, 0.95, M["brass"], axis="z", seg=8)
cyl("ShowerRailFront", (TX, rail_y, TZ - 0.52), 0.012, 1.9, M["brass"], axis="x", seg=8)
cyl("ShowerRiser", (TX, (rail_y + WALL_H) / 2, TZ + 0.1), 0.012, WALL_H - rail_y, M["brass"], seg=8)
drape("ShowerCurtainFront", TX - 0.95, TX + 0.95, TZ - 0.52, 0.35, rail_y - 0.02, M["shower"], folds=12, depth=0.035)
drape("ShowerCurtainSide", TZ - 0.5, TZ + 0.35, TX - 0.95, 0.35, rail_y - 0.02, M["shower"], folds=5, depth=0.035, axis="z")
# washstand + mirror on the east wall, towel rail, small window, lamp
box("Washstand", (BATH["x1"] - IN - 0.3, 0.42, 7.3), (0.55, 0.84, 1.0), M["wardrobe"], bevel=0.015)
box("Basin", (BATH["x1"] - IN - 0.32, 0.9, 7.3), (0.42, 0.12, 0.55), M["porcelain"], bevel=0.05)
box("BathMirror", (BATH["x1"] - IN - 0.02, 1.6, 7.3), (0.02, 0.8, 0.6), M["mirror"])
box("BathMirrorFrame", (BATH["x1"] - IN - 0.015, 1.6, 7.3), (0.03, 0.92, 0.72), M["gilt"], bevel=0.01)
cyl("TowelRail", (1.35, 1.2, BATH["z0"] + IN + 0.1), 0.015, 0.8, M["brass"], axis="x", seg=8)
box("Towel", (1.35, 0.95, BATH["z0"] + IN + 0.12), (0.55, 0.5, 0.04), M["towel"], bevel=0.01)
# Linen cupboard on the west wall: hollow, shelves above head height, doors ajar (a hide).
LX, LZ, LD, LW, LH = BATH["x0"] + IN + 0.3, 6.8, 0.6, 1.0, 2.2
box("LinenBack", (BATH["x0"] + IN + 0.02, LH / 2 + 0.1, LZ), (0.03, LH, LW), M["wardrobe_in"])
for sz in (-1, 1):
    box(f"LinenSide{sz}", (LX, LH / 2 + 0.1, LZ + sz * (LW / 2 - 0.02)), (LD, LH, 0.04), M["wardrobe"], bevel=0.01)
box("LinenTop", (LX, LH + 0.13, LZ), (LD + 0.06, 0.06, LW + 0.08), M["wardrobe"], bevel=0.012)
box("LinenBase", (LX, 0.06, LZ), (LD + 0.03, 0.12, LW + 0.03), M["wardrobe"], bevel=0.01)
for i, y in enumerate((1.95, 2.18)):
    box(f"LinenShelf{i}", (LX, y, LZ), (LD - 0.06, 0.03, LW - 0.08), M["wardrobe_in"])
    for k in range(3):
        box(f"LinenStack{i}{k}", (LX - 0.05, y + 0.08, LZ - 0.28 + k * 0.28), (0.36, 0.12, 0.24), M["towel"], bevel=0.02)
lfront = LX + LD / 2
for sz, ang, nm in ((-1, 70, "Open"), (1, 15, "Ajar")):
    hinge_z = LZ + sz * LW / 2
    a = math.radians(ang); dw = LW / 2
    box(f"LinenDoor{nm}", (lfront + math.sin(a) * dw / 2, LH / 2 + 0.12, hinge_z - sz * math.cos(a) * dw / 2), (0.03, LH - 0.1, dw), M["wardrobe"], bevel=0.01, rot=sz * ang)
box("BathWindow", (BATH["x0"] + IN + 0.03, 1.9, 8.9), (0.02, 1.0, 0.7), M["window"])
fit_uv(bpy.data.objects["BathWindow"], "z")
LAMPS.append((BATH["x1"] - IN - 0.12, 2.1, 6.6))
box("BathSconce", (BATH["x1"] - IN - 0.06, 2.1, 6.6), (0.1, 0.2, 0.12), M["brass"])
sphere("BathSconceGlow", (BATH["x1"] - IN - 0.15, 2.25, 6.6), 0.06, M["bulb"], scale=(1, 1.4, 1))

# light markers for the game (it adds its own practical lights at these points)
for i, p in enumerate(LAMPS):
    empty(f"LIGHT_lamp_{i}", p)
for i, p in enumerate(SCONCES):
    empty(f"LIGHT_sconce_{i}", p)

# ---------------------------------------------------------------- render-only context
print("render-only context...")


def struct_walls(r, gaps):
    """Thick structural walls (the game builds its own) so the renders read like the cutaway."""
    for side in "SNWE":
        axis = "x" if side in "SN" else "z"
        a0, a1 = (r["x0"] - 0.15, r["x1"] + 0.15) if axis == "x" else (r["z0"] - 0.15, r["z1"] + 0.15)
        at = {"S": r["z0"], "N": r["z1"], "W": r["x0"], "E": r["x1"]}[side]
        spans, cur = [], a0
        for g0, g1 in sorted(gaps.get(side, [])):
            spans.append((cur, g0)); cur = g1
        spans.append((cur, a1))
        for k, (s0, s1) in enumerate(spans):
            mid, ln = (s0 + s1) / 2, s1 - s0
            c = (mid, WALL_H / 2, at) if axis == "x" else (at, WALL_H / 2, mid)
            s = (ln, WALL_H, 0.28) if axis == "x" else (0.28, WALL_H, ln)
            box(f"Struct{side}{k}_{r['x0']}", c, s, M["wall_struct"], RENDER_ONLY)
            c2 = (mid, WALL_H + 0.04, at) if axis == "x" else (at, WALL_H + 0.04, mid)
            s2 = (ln, 0.08, 0.34) if axis == "x" else (0.34, 0.08, ln)
            box(f"StructTop{side}{k}_{r['x0']}", c2, s2, M["wall_top"], RENDER_ONLY)


struct_walls(BED, {"S": [(-1, 1)], "N": [(2, 4)]})
struct_walls(BATH, {"S": [(2, 4)]})
for sx in (-1, 1):   # the short passage between bedroom and bathroom
    box(f"PassageWall{sx}", (3.0 + sx * 1.0, WALL_H / 2, 5.0), (0.28, WALL_H, 1.0), M["wall_struct"], RENDER_ONLY)
box("PassageFloor", (3.0, -0.03, 5.0), (2.0, 0.06, 1.0), M["floor"], RENDER_ONLY)
box("HallFloor", (0, -0.03, -10.5), (12, 0.06, 4), M["hall"], RENDER_ONLY)
box("HallRunner", (0, 0.004, -10.5), (11, 0.01, 1.4), M["runner"], RENDER_ONLY)
box("HallPassage", (0, -0.03, -6.5), (2, 0.06, 4), M["hall"], RENDER_ONLY)
for sx in (-1, 1):
    box(f"HallPassageWall{sx}", (sx * 1.0, WALL_H / 2, -6.5), (0.28, WALL_H, 4), M["wall_struct"], RENDER_ONLY)
box("OuterGround", (0, -0.1, 3), (40, 0.1, 40), M["wall_struct"], RENDER_ONLY)
# door leaves (the game has its own swinging doors)
box("HallDoorLeaf", (-0.97, 1.15, BED["z0"] + 0.47), (0.05, 2.3, 0.95), M["wardrobe"], RENDER_ONLY)
box("BathDoorLeaf", (2.03, 1.15, BED["z1"] - 0.47), (0.05, 2.3, 0.95), M["wardrobe"], RENDER_ONLY)

# ---------------------------------------------------------------- lights for the renders
def add_light(name, kind, c, energy, color, size=0.1, rot=None):
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
    RENDER_ONLY.objects.link(ob)
    return ob


for i, p in enumerate(LAMPS):
    add_light(f"LampLight{i}", "POINT", (p[0], p[1] + 0.05, p[2]), 110, (1.0, 0.66, 0.36), 0.12)
for i, p in enumerate(SCONCES):
    add_light(f"SconceLight{i}", "POINT", p, 45, (1.0, 0.6, 0.28), 0.05)
add_light("Moon", "SUN", (0, 10, 0), 0.55, (0.5, 0.62, 1.0), rot=(38, 0, 118))
add_light("RoomBounce", "AREA", (-0.5, 3.6, 0.5), 140, (1.0, 0.72, 0.45), 7.0, rot=(0, 0, 0))
add_light("BathBounce", "AREA", (2.5, 3.4, 7.8), 40, (1.0, 0.8, 0.6), 3.5, rot=(0, 0, 0))
add_light("WindowSpill", "AREA", (BED["x0"] + IN + 0.6, 1.8, WSZ), 60, (0.5, 0.62, 1.0), 1.6, rot=(0, -90, 0))
add_light("HallGlow", "POINT", (0, 2.3, -9.5), 90, (1.0, 0.6, 0.3), 0.2)
add_light("WardrobeFill", "POINT", (WX - 0.6, 1.4, WZ), 3, (1.0, 0.7, 0.45), 0.2)

world = bpy.data.worlds.new("Night")
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.012, 0.016, 0.035, 1)
bg.inputs["Strength"].default_value = 1.0
scene.world = world

# ---------------------------------------------------------------- save + export
for c in (EXPORT, RENDER_ONLY):
    for ob in c.objects:
        pass
if _COMMITTED_OBJECTS is not None:   # drop the committed-file objects that were appended but not used
    for o in _COMMITTED_OBJECTS.values():
        if not o.users_collection:
            bpy.data.objects.remove(o)
    bpy.data.orphans_purge(do_local_ids=True, do_linked_ids=True, do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=BLEND, relative_remap=True)
print("saved", BLEND)

def export_game():
    """Merge the Export collection into ONE mesh and write the game GLB with phone-sized textures."""
    BIG = ("OldOakFloor_diff", "BlueJacquardPaper_diff", "DarkPanelling_diff")
    for img in bpy.data.images:
        if img.size[0] == 0:
            continue
        n = img.name
        limit = 1024 if n in BIG else 256 if ("_nor" in n or "_arm" in n or "_rough" in n) else 512
        if img.size[0] > limit:
            img.scale(limit, max(1, int(img.size[1] * limit / img.size[0])))
    # export: the Export collection, merged into ONE mesh (one draw call per material in the game).
    MERGED = bpy.data.collections.new("ExportMerged")
    scene.collection.children.link(MERGED)
    dg = bpy.context.evaluated_depsgraph_get()
    parts = []
    for ob in EXPORT.all_objects:
        if ob.type == "MESH":
            me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
            me.transform(ob.matrix_world)
            # one UV layer called UVMap: bmesh-built parts name theirs 'Float2' in Blender 5 while
            # imported furniture uses 'UVMap', and join() would otherwise keep two UV sets, leaving the
            # furniture's real UVs in TEXCOORD_1 (which the optimiser prunes: untextured furniture)
            while len(me.uv_layers) > 1:
                me.uv_layers.remove(me.uv_layers[-1])
            if me.uv_layers:
                me.uv_layers[0].name = "UVMap"
            cp = bpy.data.objects.new(ob.name + "_m", me)
            MERGED.objects.link(cp)
            parts.append(cp)
        elif ob.name.startswith("LIGHT_"):
            e = bpy.data.objects.new(ob.name, None)
            e.location = ob.matrix_world.translation
            MERGED.objects.link(e)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    room = bpy.context.view_layer.objects.active
    room.name = "GuestSuite"
    EXPORT.hide_render = True
    bpy.ops.object.select_all(action="DESELECT")
    for ob in MERGED.objects:
        ob.select_set(True)
    props = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    want = dict(filepath=GLB, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                export_lights=False, export_cameras=False, export_extras=True, export_image_format="JPEG",
                export_jpeg_quality=80, export_image_quality=80, export_texcoords=True, export_normals=True,
                export_materials="EXPORT")
    bpy.ops.export_scene.gltf(**{k: v for k, v in want.items() if k in props})
    # weld, dedup, prune and quantize for phones (this step made the committed 3.4 MB file)
    opt = os.path.join(ROOT, "tools", "assets", "optimize-room.mjs")
    if shutil.which("node") and os.path.isdir(os.path.join(ROOT, "tools", "assets", "node_modules")):
        subprocess.run(["node", opt, GLB], check=True)
    else:
        print("NOTE: GLB not optimised. Run: (cd tools/assets && npm ci) && node tools/assets/optimize-room.mjs", GLB)
    room.data.calc_loop_triangles()
    print("exported", GLB, os.path.getsize(GLB), "bytes;", len(room.data.loop_triangles), "triangles;", len(room.data.materials), "materials")
    MERGED.hide_render = True
    EXPORT.hide_render = False



if "--no-render" in ARGS:
    export_game()
    sys.exit(0)

# ---------------------------------------------------------------- renders
engine = "BLENDER_EEVEE" if "BLENDER_EEVEE" in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items} else "BLENDER_EEVEE_NEXT"
scene.render.engine = engine
try:
    scene.eevee.taa_render_samples = int(arg("samples", 48))
    scene.eevee.use_raytracing = True
except Exception:
    pass
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Medium High Contrast" if "AgX - Medium High Contrast" in [i.identifier for i in scene.view_settings.bl_rna.properties["look"].enum_items] else "None"
scene.view_settings.exposure = 1.1


def camera(name, pos, target, lens=24):
    cd = bpy.data.cameras.new(name)
    cd.lens = lens
    cd.clip_start = 0.02
    ob = bpy.data.objects.new(name, cd)
    ob.location = P(*pos)
    direction = P(*target) - P(*pos)
    ob.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    RENDER_ONLY.objects.link(ob)
    return ob


SHOTS = [
    ("birdseye", (6.8, 12.5, -7.4), (0.3, 0.0, 1.8), 24, (1600, 1000)),
    ("room_level", (1.2, 1.62, -3.9), (-2.0, 0.95, 3.0), 18, (1400, 860)),
    ("inside_wardrobe", (WX + 0.12, 1.55, WZ + 0.05), (-2.5, 1.0, -0.4), 18, (1400, 860)),
    ("under_bed", (BX - 0.25, 0.26, BZ + 0.05), (3.5, 0.3, -1.6), 16, (1400, 860)),
]
only = [a.split("=")[1] for a in ARGS if a.startswith("--only=")]
for name, pos, target, lens, (w, h) in SHOTS:
    if only and name not in only[0].split(","):
        continue
    cam = camera(f"Cam_{name}", pos, target, lens)
    scene.camera = cam
    scene.render.resolution_x, scene.render.resolution_y = w, h
    scene.render.resolution_percentage = int(arg("res", 100))
    scene.render.filepath = os.path.join(RENDERS, f"guest_suite_{name}.png")
    print("rendering", name)
    bpy.ops.render.render(write_still=True)
    print("wrote", scene.render.filepath)
bpy.ops.wm.save_as_mainfile(filepath=BLEND, relative_remap=True)
export_game()
