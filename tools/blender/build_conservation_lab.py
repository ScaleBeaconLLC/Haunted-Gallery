"""
Conservation Lab (references/mansion-package/previews/13_Conservation_Lab.jpg) for Haunted Gallery,
built in Blender: the first of the older rooms rebuilt as a real, lit 3D room.

    tools/blender/blender-py tools/blender/build_conservation_lab.py -- [--out=DIR] [--no-bake] [--no-render]
    blender --background --factory-startup --python tools/blender/build_conservation_lab.py -- [...]

Options: see tools/blender/hg_room.py. Writes conservation_lab.{blend,glb,json}, the baked lightmap
and docs/renders/conservation_lab_*.png. The furniture footprints printed as OBSTACLES must match
ROOMS.conservation.obstacles in server/src/game/data.ts (tools/blender/check_room_data.mjs checks).

Layout (world metres; the room is x 16..32, z 22..38, local origin (24, 30)):
    doors   south (18, 22) to the Archive, west (16, 30) to the Sealed Exhibition Room,
            north (20, 38) to the Hall of Mirrors; two lancet windows in the east wall
    hides   under the restoration table (24.6, 32.0) - behind the draped canvas rack (17.2, 35.2) -
            behind the solvent cabinet (31.0, 24.2)
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy                      # noqa: E402
import numpy as np              # noqa: E402

import hg_room as R             # noqa: E402
from hg_room import P, box, cyl, sphere, lathe, plane, cloth, empty, add_light, fbm, WALL_H, IN   # noqa: E402

NAME = "conservation_lab"
ORIGIN = (24.0, 30.0)
S, PATHS = R.init(NAME)
TEX = PATHS.tex_dir
rng = np.random.default_rng(1913)


def L(x, y, z):
    """World (x, y, z) -> room-local game coordinates."""
    return (x - ORIGIN[0], y, z - ORIGIN[1])


RECT = dict(x0=-8.0, x1=8.0, z0=-8.0, z1=8.0)
OBSTACLES = []   # world [x0, x1, z0, z1] footprints people cannot walk through


def obstacle(x0, x1, z0, z1, label):
    OBSTACLES.append(([round(x0, 2), round(x1, 2), round(z0, 2), round(z1, 2)], label))


# ================================================================ textures
print("painting textures...")


def tex_limestone(s=1024):
    """Warm limestone ashlar, 1.8 m tile: courses of 0.3 m, staggered 0.6 m blocks."""
    u = np.arange(s) / s
    U, V = np.meshgrid(u, u)
    rows = 6
    r = np.floor(V * rows)
    off = (r % 2) * 0.5 / 3
    bu = (U + off) * 3
    col_id = np.floor(bu)
    fu, fv = bu - col_id, V * rows - r
    mortar = np.minimum(np.minimum(fu, 1 - fu) * 3 * 0.6, np.minimum(fv, 1 - fv) * 1.0)
    edge = np.clip(mortar / 0.035, 0, 1)
    tone = np.random.default_rng(3).uniform(0.82, 1.1, (rows + 1, 5))[r.astype(int), (col_id.astype(int) % 5)]
    grain = fbm(s, s, 12, 5) * 0.5 + fbm(s, s, 48, 7, 3) * 0.5
    base = np.array([0.46, 0.41, 0.34])
    col = base * (tone * (0.8 + 0.35 * grain))[..., None]
    pits = (fbm(s, s, 96, 9, 2) > 0.72) * 0.25
    col *= (1 - pits)[..., None]
    col = col * edge[..., None] + np.array([0.2, 0.18, 0.15]) * (1 - edge)[..., None]
    grime = np.clip(fbm(s, s, 3, 11) - 0.45, 0, 1) * 0.9
    col *= (1 - grime * (1 - V) * 0.6)[..., None]
    hgt = edge * 0.8 + grain * 0.2 - pits
    return (R.save_image(TEX, "lab_limestone", col, fmt="JPEG"),
            R.save_image(TEX, "lab_limestone_nor", R.normal_from_height(hgt, 3.0), fmt="JPEG", non_color=True))


def tex_linen(name, base=(0.78, 0.74, 0.66), s=512, stains=0.5):
    u = np.arange(s) / s
    U, V = np.meshgrid(u, u)
    weave = 0.5 + 0.25 * np.sin(U * 2 * math.pi * 160) * np.sin(V * 2 * math.pi * 160)
    slub = fbm(s, s, 64, 21, 2)
    col = np.array(base) * (0.86 + 0.1 * weave + 0.12 * slub)[..., None]
    st = np.clip(fbm(s, s, 4, 23) - 0.55, 0, 1) * stains * 2.2
    col = col * (1 - st[..., None] * 0.35) + np.array([0.45, 0.36, 0.22]) * st[..., None] * 0.25
    hgt = weave * 0.6 + slub * 0.4
    return (R.save_image(TEX, name, col, fmt="JPEG"),
            R.save_image(TEX, name + "_nor", R.normal_from_height(hgt, 1.2), fmt="JPEG", non_color=True))


def craquelure(h, w, seed):
    n = fbm(h, w, 24, seed, 3)
    return np.clip(1 - np.abs(n - 0.5) / 0.012, 0, 1)


def varnish(col, u, v, seed, age=0.6):
    h, w, _ = col.shape
    strokes = fbm(h, w, 8, seed + 50, 3)
    streak = np.sin((u * 60 + strokes * 9) * math.pi)   # directional brush marks
    col = col * (0.93 + 0.07 * streak)[..., None]
    col = col * np.array([1.0, 0.93, 0.74]) ** age          # yellowed varnish
    col *= (1 - 0.55 * craquelure(h, w, seed + 60) * 0.35)[..., None]
    col *= (1 - 0.6 * np.hypot(u - 0.5, v - 0.5) ** 2)[..., None]
    return col


def tex_painting(name, seed, kind, w=512, h=640, cleaned=False):
    """Placeholder oil paintings generated in code (landscape, portrait, still life)."""
    u, v = np.meshgrid(np.arange(w) / w, np.arange(h) / h)
    n = fbm(h, w, 5, seed)
    if kind == "landscape":
        sky = np.array([0.1, 0.12, 0.18]) + np.array([0.38, 0.34, 0.26]) * (1 - v)[..., None] ** 2 * 0.6
        col = sky * (0.8 + 0.35 * fbm(h, w, 3, seed + 1))[..., None]
        moon = np.hypot((u - 0.7) * w / h, v - 0.2) < 0.045
        col[moon] = [0.9, 0.85, 0.66]
        halo = np.exp(-(np.hypot((u - 0.7) * w / h, v - 0.2) / 0.12) ** 2)
        col += halo[..., None] * np.array([0.25, 0.22, 0.15])
        for k, (hz, dark) in enumerate(((0.52, 0.16), (0.6, 0.09), (0.7, 0.05))):
            ridge = v > hz + 0.06 * np.sin(u * (5 + k * 2) + seed + k) + 0.05 * fbm(h, w, 6, seed + 3 + k)
            col[ridge] = np.array([dark, dark * 1.1, dark * 0.9]) * (0.8 + 0.5 * n[ridge])[..., None]
        lake = (v > 0.78) & (v < 0.9) & (u > 0.35)
        col[lake] = col[lake] * 0.4 + np.array([0.3, 0.3, 0.28]) * (0.5 + 0.5 * np.sin(v[lake] * 300)) [..., None] * 0.35
        trees = (v > 0.3 + 0.35 * fbm(h, w, 20, seed + 9)) & (u < 0.28)
        col[trees] = [0.03, 0.035, 0.028]
    elif kind == "portrait":
        col = np.array([0.1, 0.07, 0.045]) * (0.7 + 0.6 * n)[..., None]
        x, y = (u - 0.5) / 0.5, (v - 0.36) / 0.5
        face = (x / 0.3) ** 2 + (y / 0.4) ** 2 < 1
        shade = np.clip(0.55 - x * 0.9 - y * 0.2, 0.1, 1.0)
        col[face] = (np.array([0.78, 0.6, 0.47]) * shade[face][..., None]) * (0.92 + 0.12 * n[face])[..., None]
        hair = ((x / 0.36) ** 2 + ((y + 0.12) / 0.38) ** 2 < 1) & ~face & (y < 0.1)
        col[hair] = np.array([0.1, 0.06, 0.035]) * (0.7 + 0.5 * n[hair])[..., None]
        for ex in (-0.12, 0.12):
            eye = ((x - ex) / 0.05) ** 2 + ((y + 0.03) / 0.022) ** 2 < 1
            col[eye] = [0.06, 0.04, 0.03]
        body = ((x / 0.8) ** 2 + ((y - 1.05) / 0.62) ** 2 < 1) & ~face
        col[body] = np.array([0.05, 0.05, 0.08]) * (0.7 + 0.6 * n[body])[..., None]
        collar = body & ((x / 0.22) ** 2 + ((y - 0.5) / 0.12) ** 2 < 1)
        col[collar] = [0.62, 0.58, 0.5]
    else:   # still life
        col = np.array([0.08, 0.06, 0.04]) * (0.7 + 0.6 * n)[..., None]
        table = v > 0.68
        col[table] = np.array([0.22, 0.1, 0.05]) * (0.8 + 0.4 * n[table])[..., None]
        for cx, cy, r, c in ((0.35, 0.6, 0.11, (0.55, 0.12, 0.08)), (0.52, 0.64, 0.08, (0.62, 0.45, 0.1)), (0.64, 0.61, 0.09, (0.3, 0.35, 0.12))):
            d = np.hypot(u - cx, (v - cy) * h / w)
            m = d < r
            sh = np.clip(1.1 - (u - cx + 0.5 * r) / r * 0.5 - (v - cy) / r * 0.4, 0.2, 1.3)
            col[m] = np.array(c) * sh[m][..., None]
        vase = (np.abs(u - 0.47) < 0.07 + 0.04 * np.sin((v - 0.3) * 9)) & (v > 0.25) & (v < 0.62)
        col[vase] = np.array([0.35, 0.33, 0.3]) * (0.6 + 0.6 * (0.5 - (u[vase] - 0.47) * 4))[..., None]
    col = np.clip(col * 1.45, 0, 1)   # oil colours read brighter than the dark underpaint
    col = varnish(col, u, v, seed, age=0.25 if cleaned else 0.6)
    if cleaned:   # a cleaning test: the left half still under darkened varnish
        dirty = u < 0.46 + 0.03 * fbm(h, w, 10, seed + 70)
        col[dirty] *= np.array([0.62, 0.52, 0.34])
    return R.save_image(TEX, name, col, fmt="JPEG")


def tex_rug(name, palette, w=1024, h=768, seed=41):
    u, v = np.meshgrid(np.arange(w) / w, np.arange(h) / h)
    x, y = (u - 0.5) * 2, (v - 0.5) * 2
    edge = np.minimum((1 - np.abs(x)) * w / h, 1 - np.abs(y))
    field, dark, light, accent = [np.array(c) for c in palette]
    col = np.zeros((h, w, 3)) + field
    lu, lv = (x * 9) % 1 - 0.5, (y * 7) % 1 - 0.5
    col[np.abs(np.abs(lu) + np.abs(lv) - 0.45) < 0.05] = dark
    petal = np.hypot(lu, lv) < 0.12 + 0.05 * np.cos(np.arctan2(lv, lu) * 6)
    col[petal] = light * 0.85
    r = np.hypot(x * 1.25, y * 1.6)
    ang = np.arctan2(y * 1.6, x * 1.25)
    lobe = 0.42 + 0.06 * np.cos(ang * 12)
    col[r < lobe + 0.03] = accent
    col[r < lobe] = dark
    col[r < 0.3 + 0.03 * np.cos(ang * 8)] = light * 0.9
    col[r < 0.2] = field
    col[r < 0.08] = dark
    main = (edge > 0.05) & (edge < 0.2)
    col[main] = dark
    col[main & (np.abs(np.sin((x + y) * 22) * 0.5 + np.sin((x - y) * 22) * 0.5) > 0.75)] = light * 0.8
    col[(np.abs(edge - 0.05) < 0.012) | (np.abs(edge - 0.2) < 0.012)] = accent
    col[edge < 0.04] = light * 0.75
    knots = fbm(h, w, 96, seed + 1, 2)
    wear = fbm(h, w, 4, seed)
    col *= (0.7 + 0.3 * knots)[..., None]
    col *= (0.74 + 0.36 * wear)[..., None]
    return R.save_image(TEX, name, col, fmt="JPEG")


def tex_window(s=512):
    """Moonlit sky through leaded diamond panes (emissive), for the lancet windows."""
    u, v = np.meshgrid(np.arange(s) / s, np.arange(s) / s)
    col = np.array([0.05, 0.07, 0.13]) + np.array([0.12, 0.17, 0.28]) * (1 - v)[..., None]
    col *= (0.75 + 0.5 * fbm(s, s, 4, 81))[..., None]
    trees = v > 0.7 + 0.1 * fbm(s, s, 14, 82)
    col[trees] = [0.015, 0.02, 0.03]
    du, dv = (u * 6 + v * 4) % 1, (u * 6 - v * 4) % 1
    lead = (np.minimum(du, 1 - du) < 0.04) | (np.minimum(dv, 1 - dv) < 0.04)
    col[lead] = [0.01, 0.01, 0.012]
    return R.save_image(TEX, "lab_moon_window", col, fmt="JPEG")


def tex_paper(s=256):
    u, v = np.meshgrid(np.arange(s) / s, np.arange(s) / s)
    col = np.array([0.74, 0.68, 0.55]) * (0.9 + 0.15 * fbm(s, s, 6, 91))[..., None]
    lines = (np.abs((v * 22) % 1 - 0.5) < 0.03) & (u > 0.12) & (u < 0.88) & (v > 0.15)
    col[lines] *= 0.55
    return R.save_image(TEX, "lab_notes", col, fmt="JPEG")


IMG = {
    "limestone": tex_limestone(),
    "linen": tex_linen("lab_linen"),
    "canvasback": tex_linen("lab_canvas_back", base=(0.66, 0.58, 0.44), stains=0.2),
    "rug_red": tex_rug("lab_rug_red", ([0.42, 0.12, 0.08], [0.1, 0.06, 0.1], [0.66, 0.58, 0.44], [0.62, 0.44, 0.18])),
    "rug_blue": tex_rug("lab_rug_blue", ([0.12, 0.14, 0.24], [0.05, 0.05, 0.1], [0.6, 0.54, 0.42], [0.5, 0.2, 0.12]), seed=77),
    "window": tex_window(),
    "notes": tex_paper(),
    "p_clean": tex_painting("lab_painting_cleaning", 301, "portrait", 640, 800, cleaned=True),
    "p_land1": tex_painting("lab_painting_moonlake", 302, "landscape", 800, 560),
    "p_land2": tex_painting("lab_painting_hills", 303, "landscape", 700, 520),
    "p_port1": tex_painting("lab_painting_sitter", 304, "portrait"),
    "p_port2": tex_painting("lab_painting_widow", 305, "portrait"),
    "p_still": tex_painting("lab_painting_still", 306, "still", 600, 520),
}

# committed CC0 Poly Haven maps (tinted copies)
floor_d = R.committed_map(TEX, "OldOakFloor_diff", tint=(0.72, 0.62, 0.55), out="lab_floor_diff")
floor_n = R.committed_map(TEX, "OldOakFloor_nor", out="lab_floor_nor", non_color=True)
floor_r = R.committed_map(TEX, "OldOakFloor_rough", out="lab_floor_rough", non_color=True)
panel_d = R.committed_map(TEX, "DarkPanelling_diff", tint=(0.78, 0.66, 0.58), out="lab_panel_diff")
panel_n = R.committed_map(TEX, "DarkPanelling_nor", out="lab_panel_nor", non_color=True)
walnut_d = R.committed_map(TEX, "WornWalnut_diff", tint=(0.62, 0.5, 0.42), out="lab_walnut_diff")
walnut_n = R.committed_map(TEX, "WornWalnut_nor", out="lab_walnut_nor", non_color=True)
velvet_d = R.committed_map(TEX, "BlueVelvet_diff", tint=(2.2, 0.8, 0.7), out="lab_velvet_diff")
velvet_n = R.committed_map(TEX, "BlueVelvet_nor", out="lab_velvet_nor", non_color=True)

mat = R.material
M = {
    "floor": mat("LabFloor", img=floor_d, nor=floor_n, rough_img=floor_r, normal=0.7, tile=2.4),
    "panel": mat("LabPanelling", img=panel_d, nor=panel_n, normal=0.9, rough=0.55, tile=2.2),
    "stone": mat("LabLimestone", img=IMG["limestone"][0], nor=IMG["limestone"][1], normal=0.8, rough=0.85, tile=1.8),
    "walnut": mat("LabWalnut", img=walnut_d, nor=walnut_n, normal=0.6, rough=0.5, tile=1.2),
    "trim": mat("LabTrim", color=(0.075, 0.042, 0.024), rough=0.38),
    "oak": mat("LabOakFrame", color=(0.22, 0.13, 0.07), rough=0.6),
    "linen": mat("LabDropCloth", img=IMG["linen"][0], nor=IMG["linen"][1], normal=0.6, rough=0.95, tile=0.9, two_sided=True),
    "canvasback": mat("LabCanvasBack", img=IMG["canvasback"][0], nor=IMG["canvasback"][1], normal=0.5, rough=0.95, tile=0.8),
    "brass": mat("LabBrass", color=(0.6, 0.43, 0.2), rough=0.3, metal=1.0),
    "iron": mat("LabIron", color=(0.04, 0.04, 0.045), rough=0.4, metal=0.9),
    "steel": mat("LabSteel", color=(0.55, 0.56, 0.58), rough=0.35, metal=1.0),
    "glass": mat("LabGlass", color=(0.1, 0.12, 0.12), rough=0.05, alpha=0.22),
    "amber": mat("LabAmberGlass", color=(0.42, 0.2, 0.05), rough=0.08, alpha=0.7),
    "porcelain": mat("LabPorcelain", color=(0.85, 0.83, 0.78), rough=0.25),
    "marble": mat("LabMarble", color=(0.8, 0.78, 0.74), rough=0.3),
    "paper": mat("LabNotes", img=IMG["notes"], rough=0.9),
    "rug_red": mat("LabRugRed", img=IMG["rug_red"], rough=0.95),
    "rug_blue": mat("LabRugBlue", img=IMG["rug_blue"], rough=0.95),
    "velvet": mat("LabVelvet", img=velvet_d, nor=velvet_n, normal=0.5, rough=0.95, tile=0.7, two_sided=True),
    "window": mat("LabMoonWindow", img=IMG["window"], rough=0.1, emit=(1, 1, 1), emit_strength=1.4),
    "bulb": mat("LabBulb", color=(1, 0.85, 0.6), emit=(1.0, 0.78, 0.48), emit_strength=8.0),
    "flame": mat("LabFlame", color=(1, 0.7, 0.3), emit=(1.0, 0.62, 0.25), emit_strength=12.0),
    "wax": mat("LabWax", color=(0.86, 0.8, 0.66), rough=0.5),
    "leather": mat("LabLeather", color=(0.2, 0.08, 0.04), rough=0.55),
    "books": mat("LabBooks", color=(0.28, 0.1, 0.06), rough=0.7),
    "cork": mat("LabCork", color=(0.45, 0.3, 0.16), rough=0.9),
    "wall_struct": mat("LabStructWall", color=(0.06, 0.055, 0.05), rough=0.9),
    "ceiling": mat("LabCeiling", color=(0.09, 0.06, 0.04), rough=0.8),
    "corridor": mat("LabCorridorFloor", img=floor_d, rough=0.6, tile=2.4),
}
PAINT = {k: mat(f"Lab_{k}", img=IMG[k], rough=0.45) for k in ("p_clean", "p_land1", "p_land2", "p_port1", "p_port2", "p_still")}


# ================================================================ helpers in world coordinates
def wbox(name, x, y, z, sx, sy, sz, m, **kw):
    return box(name, L(x, y, z), (sx, sy, sz), m, **kw)


def rotp(cx, cz, yaw, u, w):
    """Point at local (u across, w forward) of a frame at (cx, cz) facing yaw (deg; 0 = +z, 90 = +x)."""
    a = math.radians(yaw)
    return cx + u * math.cos(a) + w * math.sin(a), cz - u * math.sin(a) + w * math.cos(a)


def turned_leg(name, x, z, h, m, r=0.045):
    prof = [(r * 0.8, 0), (r, 0.04), (r * 0.7, 0.1), (r * 1.1, 0.16), (r * 0.65, 0.3), (r * 0.7, h * 0.55),
            (r * 1.15, h * 0.62), (r * 0.8, h * 0.7), (r * 0.9, h - 0.12), (r * 1.2, h - 0.1), (r * 1.2, h)]
    return lathe(name, L(x, 0, z), prof, m, seg=12)


def jar(name, x, y, z, r, h, m, lid=None):
    lathe(name, L(x, y, z), [(r * 0.85, 0), (r, 0.02), (r, h * 0.8), (r * 0.7, h * 0.9), (r * 0.55, h)], m, seg=12)
    if lid:
        cyl(name + "Lid", L(x, y + h + 0.01, z), r * 0.6, 0.02, lid, seg=12)


def bottle(name, x, y, z, r, h, m):
    lathe(name, L(x, y, z), [(r * 0.9, 0), (r, 0.01), (r, h * 0.62), (r * 0.35, h * 0.78), (r * 0.3, h), (r * 0.36, h)], m, seg=10)
    cyl(name + "Cork", L(x, y + h + 0.012, z), r * 0.3, 0.025, M["cork"], seg=8)


def framed(name, x, y, z, w, h, facing, pm, frame=0.07, depth=0.04, fm=None):
    """A framed painting centred at (x, y, z) facing 'x+','x-','z+','z-' (or 'up', lying flat)."""
    fm = fm or M["brass"]
    if facing == "up":
        plane(name, L(x, y + depth / 2 + 0.002, z), w, h, pm, "up")
        for s in (-1, 1):
            wbox(f"{name}_fa{s}", x, y + depth / 2, z + s * (h / 2 + frame / 2), w + 2 * frame, depth, frame, fm, bevel=0.008)
            wbox(f"{name}_fb{s}", x + s * (w / 2 + frame / 2), y + depth / 2, z, frame, depth, h, fm, bevel=0.008)
        return
    along_x = facing in ("z+", "z-")
    off = 0.012 if facing in ("z+", "x+") else -0.012
    if along_x:
        plane(name, L(x, y, z + off), w, h, pm, facing)
        wbox(f"{name}_back", x, y, z, w, h, 0.02, M["canvasback"])
        for s in (-1, 1):
            wbox(f"{name}_ft{s}", x, y + s * (h / 2 + frame / 2), z + off / 2, w + 2 * frame, frame, depth, fm, bevel=0.008)
            wbox(f"{name}_fs{s}", x + s * (w / 2 + frame / 2), y, z + off / 2, frame, h, depth, fm, bevel=0.008)
    else:
        plane(name, L(x + off, y, z), w, h, pm, facing)
        wbox(f"{name}_back", x, y, z, 0.02, h, w, M["canvasback"])
        for s in (-1, 1):
            wbox(f"{name}_ft{s}", x + off / 2, y + s * (h / 2 + frame / 2), z, depth, frame, w + 2 * frame, fm, bevel=0.008)
            wbox(f"{name}_fs{s}", x + off / 2, y, z + s * (w / 2 + frame / 2), depth, h, frame, fm, bevel=0.008)


LAMPS, SCONCES, CANDLES = [], [], []


def candle(name, x, y, z, h=0.16):
    """A church candle in a brass stick; adds a small baked light (and a game practical)."""
    lathe(f"{name}Stick", L(x, y, z), [(0.05, 0), (0.05, 0.015), (0.015, 0.03), (0.012, 0.12), (0.035, 0.14), (0.03, 0.155)], M["brass"], seg=12)
    cyl(f"{name}Wax", L(x, y + 0.155 + h / 2, z), 0.018, h, M["wax"], seg=8)
    sphere(f"{name}Flame", L(x, y + 0.165 + h, z), 0.012, M["flame"], seg=6, scale=(1, 2.2, 1))
    CANDLES.append(L(x, y + 0.2 + h, z))


# ================================================================ architecture
print("building the room...")
x0, x1, z0, z1 = 16.0, 32.0, 22.0, 38.0
wbox("LabFloorBoards", 24, -0.03, 30, 16, 0.06, 16, M["floor"])

DOORS = {"S": [(17.0, 19.0)], "W": [(29.0, 31.0)], "N": [(19.0, 21.0)]}
WINDOWS_E = [29.2, 33.4]
DADO, DOOR_H = 1.15, 2.66


def wall_segments(side):
    a0, a1 = (x0 + IN, x1 - IN) if side in "SN" else (z0 + IN, z1 - IN)
    spans, cur = [], a0
    for g0, g1 in sorted(DOORS.get(side, [])):
        spans.append((cur, g0))
        cur = g1
    spans.append((cur, a1))
    return spans


for side in "SNWE":
    axis = "x" if side in "SN" else "z"
    at = {"S": z0 + IN + 0.01, "N": z1 - IN - 0.01, "W": x0 + IN + 0.01, "E": x1 - IN - 0.01}[side]
    inward = {"S": 1, "N": -1, "W": 1, "E": -1}[side]
    segs = [(s0, s1, 0.0, WALL_H) for s0, s1 in wall_segments(side)] + [(g0, g1, DOOR_H, WALL_H) for g0, g1 in DOORS.get(side, [])]
    for k, (s0, s1, y0, y1) in enumerate(segs):
        mid, ln = (s0 + s1) / 2, s1 - s0
        for m, ya, yb in ((M["panel"], y0, min(y1, DADO)), (M["stone"], max(y0, DADO), y1)):
            if yb <= ya:
                continue
            if axis == "x":
                wbox(f"Wall{side}{k}_{m.name}", mid, (ya + yb) / 2, at, ln, yb - ya, 0.02, m)
            else:
                wbox(f"Wall{side}{k}_{m.name}", at, (ya + yb) / 2, mid, 0.02, yb - ya, ln, m)
        for ry, rh, rd in ((DADO, 0.07, 0.06), (WALL_H - 0.1, 0.16, 0.1), (0.1, 0.2, 0.045)):
            if y0 <= ry <= y1:
                if axis == "x":
                    wbox(f"Wall{side}{k}_rail{ry}", mid, ry, at + inward * rd / 2, ln, rh, rd, M["trim"])
                else:
                    wbox(f"Wall{side}{k}_rail{ry}", at + inward * rd / 2, ry, mid, rd, rh, ln, M["trim"])
        # raised wainscot panels
        if y0 == 0:
            n = max(1, int(ln / 0.9))
            for i in range(n):
                c = s0 + (i + 0.5) * ln / n
                pw = ln / n - 0.16
                if axis == "x":
                    wbox(f"Wainscot{side}{k}_{i}", c, 0.62, at + inward * 0.012, pw, 0.7, 0.02, M["panel"], bevel=0.008)
                else:
                    wbox(f"Wainscot{side}{k}_{i}", at + inward * 0.012, 0.62, c, 0.02, 0.7, pw, M["panel"], bevel=0.008)

# stone pilasters at the corners and between windows
for px, pz in ((x0 + IN + 0.14, z0 + IN + 0.14), (x1 - IN - 0.14, z0 + IN + 0.14), (x0 + IN + 0.14, z1 - IN - 0.14), (x1 - IN - 0.14, z1 - IN - 0.14),
               (x1 - IN - 0.12, 27.0), (x1 - IN - 0.12, 31.3), (x1 - IN - 0.12, 35.6), (24.0, z0 + IN + 0.12), (24.0, z1 - IN - 0.12), (x0 + IN + 0.12, 25.5), (x0 + IN + 0.12, 34.5)):
    wbox(f"Pilaster{px}_{pz}", px, WALL_H / 2, pz, 0.28, WALL_H, 0.28, M["stone"], bevel=0.02)
    wbox(f"PilasterBase{px}_{pz}", px, 0.12, pz, 0.36, 0.24, 0.36, M["stone"], bevel=0.02)
    wbox(f"PilasterCap{px}_{pz}", px, WALL_H - 0.14, pz, 0.36, 0.14, 0.36, M["stone"], bevel=0.02)


def lancet(name, cz, width=1.2, sill=0.95, top=2.9):
    """Pointed-arch window in the east wall: emissive leaded glass in a stone surround."""
    import bmesh
    xw = x1 - IN - 0.03
    spring = top - width * 0.62
    pts = []
    for i in range(9):
        a = i / 8
        pts.append((-width / 2 + width / 2 * (1 - math.cos(a * math.pi / 2)) , spring + width * 0.62 * math.sin(a * math.pi / 2)))
    pts = [(-width / 2, sill)] + pts[:-1] + [(0, top)] + [(-px, py) for px, py in reversed(pts[:-1])] + [(width / 2, sill)]
    bm = bmesh.new()
    vs = [bm.verts.new(P(*L(xw, py, cz + px))) for px, py in pts]
    f = bm.faces.new(vs)
    uv = bm.loops.layers.uv.verify()
    for lp in f.loops:
        co = lp.vert.co
        lp[uv].uv = ((-co.y - (cz - ORIGIN[1] - width / 2)) / width, (co.z - sill) / (top - sill))
    bm.normal_update()
    if f.normal.x > 0:
        f.normal_flip()
    R.finish(bm, name, M["window"], keep_uv=True)
    # a continuous stone surround: the window outline and one 0.14 m further out, joined into a
    # ring 0.12 m deep (front face, reveal and outer edge), following the pointed arch smoothly
    def outline(wd, sl, tp, n=14):
        sp = tp - wd * 0.62
        arc = [(-wd / 2 + wd / 2 * (1 - math.cos(i / n * math.pi / 2)), sp + wd * 0.62 * math.sin(i / n * math.pi / 2)) for i in range(n + 1)]
        return [(-wd / 2, sl)] + arc[:-1] + [(0, tp)] + [(-u, v) for u, v in reversed(arc[:-1])] + [(wd / 2, sl)]
    inner, outer = outline(width, sill, top), outline(width + 0.28, sill - 0.02, top + 0.17)
    sb = bmesh.new()
    def ring(pts2, depth):
        return [sb.verts.new(P(*L(xw - depth, v, cz + u))) for u, v in pts2]
    fi, fo, bo = ring(inner, 0.12), ring(outer, 0.12), ring(outer, 0.0)
    bi = ring(inner, 0.0)
    for i in range(len(inner) - 1):
        sb.faces.new((fi[i], fi[i + 1], fo[i + 1], fo[i]))      # front
        sb.faces.new((bi[i], bi[i + 1], fi[i + 1], fi[i]))      # reveal
        sb.faces.new((fo[i], fo[i + 1], bo[i + 1], bo[i]))      # outer edge
    bmesh.ops.recalc_face_normals(sb, faces=sb.faces)
    sb.faces.ensure_lookup_table()
    if sb.faces[0].normal.x > 0:          # the front must face into the room (-x), not the wall
        bmesh.ops.reverse_faces(sb, faces=list(sb.faces))
    R.finish(sb, f"{name}_surround", M["stone"], smooth=False)
    wbox(f"{name}_sill", xw - 0.1, sill - 0.05, cz, 0.3, 0.1, width + 0.3, M["stone"], bevel=0.015)
    wbox(f"{name}_mullion", xw - 0.02, (sill + spring) / 2 + 0.2, cz, 0.06, spring - sill + 0.4, 0.05, M["stone"])
    wbox(f"{name}_transom", xw - 0.02, spring - 0.25, cz, 0.06, 0.05, width, M["stone"])


for i, wz in enumerate(WINDOWS_E):
    lancet(f"Lancet{i}", wz)


def door_casing(name, cx, cz, axis, width=2.0, height=DOOR_H):
    """Stone architrave around a doorway (both faces), with a pointed hood moulding above."""
    for side in (-1, 1):
        for s in (-1, 1):
            if axis == "x":
                wbox(f"{name}_jamb{side}{s}", cx + s * (width / 2 + 0.09), height / 2, cz + side * 0.17, 0.18, height, 0.07, M["stone"], bevel=0.01)
            else:
                wbox(f"{name}_jamb{side}{s}", cx + side * 0.17, height / 2, cz + s * (width / 2 + 0.09), 0.07, height, 0.18, M["stone"], bevel=0.01)
        for k, sgn in enumerate((-1, 1)):   # two halves of the pointed hood
            ang = sgn * 28
            if axis == "x":
                box(f"{name}_hood{side}{k}", L(cx + sgn * 0.45, height + 0.27, cz + side * 0.19), (1.1, 0.1, 0.08), M["stone"], rot=0, tilt=-ang, tilt_axis="Y")
            else:
                box(f"{name}_hood{side}{k}", L(cx + side * 0.19, height + 0.27, cz + sgn * 0.45), (0.08, 0.1, 1.1), M["stone"], tilt=ang, tilt_axis="X")
        if axis == "x":
            wbox(f"{name}_lintel{side}", cx, height + 0.08, cz + side * 0.17, width + 0.4, 0.16, 0.08, M["stone"], bevel=0.01)
        else:
            wbox(f"{name}_lintel{side}", cx + side * 0.17, height + 0.08, cz, 0.08, 0.16, width + 0.4, M["stone"], bevel=0.01)


door_casing("DoorS", 18.0, z0, "x")
door_casing("DoorN", 20.0, z1, "x")
door_casing("DoorW", x0, 30.0, "z")


# ================================================================ furniture
print("furnishing...")


def work_table(name, cx, cz, w, d, h=0.92, drawers_side=-1):
    top = wbox(f"{name}Top", cx, h - 0.03, cz, w, 0.06, d, M["walnut"], bevel=0.012)
    wbox(f"{name}Apron", cx, h - 0.13, cz, w - 0.12, 0.14, d - 0.12, M["walnut"], bevel=0.006)
    for sx in (-1, 1):
        for sz in (-1, 1):
            turned_leg(f"{name}Leg{sx}{sz}", cx + sx * (w / 2 - 0.1), cz + sz * (d / 2 - 0.1), h - 0.06, M["walnut"])
    for sz in (-1, 1):
        wbox(f"{name}Stretcher{sz}", cx, 0.14, cz + sz * (d / 2 - 0.1), w - 0.25, 0.05, 0.04, M["walnut"])
    nd = max(2, int(w / 0.8))
    for i in range(nd):
        dx = cx - w / 2 + 0.2 + (i + 0.5) * (w - 0.4) / nd
        fz = cz + drawers_side * (d / 2 - 0.055)
        wbox(f"{name}Drawer{i}", dx, h - 0.13, fz, (w - 0.4) / nd - 0.06, 0.1, 0.02, M["walnut"], bevel=0.004)
        sphere(f"{name}Knob{i}", L(dx, h - 0.13, fz + drawers_side * 0.02), 0.018, M["brass"], seg=8)
    return top


# ---- the main restoration table (hide: under it) ------------------------------------------
TX, TZ, TW, TD = 24.6, 32.0, 3.2, 1.5
main_top = work_table("RestTable", TX, TZ, TW, TD, drawers_side=-1)
obstacle(TX - TW / 2, TX + TW / 2, TZ - TD / 2, TZ + TD / 2, "restoration table (hide under it)")
framed("RestTablePainting", TX - 0.1, 0.92, TZ + 0.05, 1.05, 0.8, "up", PAINT["p_clean"], frame=0.08)
for i, (bx, bz, r, hh, mm) in enumerate(((TX + 1.15, TZ - 0.45, 0.05, 0.14, M["glass"]), (TX + 1.3, TZ - 0.2, 0.04, 0.2, M["amber"]),
                                          (TX + 1.05, TZ + 0.05, 0.035, 0.18, M["amber"]), (TX - 1.3, TZ - 0.5, 0.06, 0.1, M["porcelain"]),
                                          (TX - 1.2, TZ + 0.45, 0.045, 0.16, M["glass"]))):
    jar(f"TableJar{i}", bx, 0.92, bz, r, hh, mm, lid=M["brass"] if i % 2 else None)
cyl("BrushPot", L(TX - 1.35, 1.0, TZ - 0.1), 0.055, 0.16, M["porcelain"], seg=12)
for k in range(7):
    a = k * 0.9
    cyl(f"Brush{k}", L(TX - 1.35 + 0.025 * math.cos(a), 1.12, TZ - 0.1 + 0.025 * math.sin(a)), 0.006, 0.28, M["trim"], seg=6)
wbox("TableSwabs", TX + 0.75, 0.93, TZ + 0.52, 0.28, 0.02, 0.18, M["porcelain"])
wbox("TableNotes", TX + 0.9, 0.925, TZ - 0.1, 0.3, 0.006, 0.4, M["paper"], rot=12)
# magnifier lamp clamped to the north edge, its head over the painting
cyl("MagLampPost", L(TX + 0.55, 1.2, TZ + 0.66), 0.018, 0.56, M["steel"], seg=8)
box("MagLampArm", L(TX + 0.4, 1.46, TZ + 0.4), (0.03, 0.03, 0.6), M["steel"], tilt=-40, tilt_axis="X")
lathe("MagLampHead", L(TX + 0.3, 1.28, TZ + 0.17), [(0.0, 0.0), (0.14, 0.0), (0.15, 0.03), (0.11, 0.08), (0.03, 0.1)], M["steel"], seg=16)
sphere("MagLampBulb", L(TX + 0.3, 1.3, TZ + 0.17), 0.035, M["bulb"], seg=8)
LAMPS.append(L(TX + 0.3, 1.26, TZ + 0.17))
# the drop cloth thrown over the north half, falling to the floor: the hiding side is dark
cloth_colliders = [main_top, bpy.data.objects["RestTableApron"]]
floor_proxy = box("ClothFloorProxy", L(TX, -0.05, TZ), (6, 0.1, 5), M["floor"])
cloth("RestTableDropCloth", L(TX - 0.25, 0.975, TZ + 0.95), 2.7, 1.6, M["linen"], cloth_colliders + [floor_proxy], res=34, frames=45,
      pins=[(TX - 0.25 + dx, TZ + 0.2) for dx in (-1.3, -0.65, 0.0, 0.65, 1.3)])
bpy.data.objects.remove(floor_proxy)
# stools
for i, (sx, sz) in enumerate(((TX - 0.9, TZ - 1.25), (TX + 1.1, TZ - 1.3))):
    cyl(f"Stool{i}Seat", L(sx, 0.62, sz), 0.19, 0.05, M["walnut"], seg=16)
    for k in range(3):
        a = k * 2.094 + 0.3
        box(f"Stool{i}Leg{k}", L(sx + 0.13 * math.cos(a), 0.3, sz + 0.13 * math.sin(a)), (0.03, 0.62, 0.03), M["walnut"], tilt=8, tilt_axis="X", rot=math.degrees(a))
    cyl(f"Stool{i}Ring", L(sx, 0.22, sz), 0.15, 0.02, M["walnut"], seg=12)

# ---- second work table with a table easel -----------------------------------------------
T2X, T2Z, T2W, T2D = 26.4, 26.4, 2.2, 1.1
work_table("SideTable", T2X, T2Z, T2W, T2D, drawers_side=-1)
obstacle(T2X - T2W / 2, T2X + T2W / 2, T2Z - T2D / 2, T2Z + T2D / 2, "second work table")
box("TableEaselBack", L(T2X - 0.2, 1.3, T2Z + 0.2), (0.06, 0.8, 0.05), M["oak"], tilt=15, tilt_axis="X")
framed("SideTablePainting", T2X - 0.2, 1.3, T2Z + 0.12, 0.62, 0.78, "z-", PAINT["p_port2"], frame=0.06)
for i in range(4):
    bottle(f"SideBottle{i}", T2X + 0.4 + 0.14 * i, 0.92, T2Z - 0.25 + 0.1 * (i % 2), 0.035, 0.2 + 0.03 * (i % 3), M["amber"] if i % 2 else M["glass"])
wbox("SidePalette", T2X - 0.75, 0.93, T2Z - 0.2, 0.35, 0.012, 0.25, M["walnut"], rot=-20)
cyl("SideStoolSeat", L(T2X - 0.3, 0.62, T2Z - 0.95), 0.19, 0.05, M["walnut"], seg=16)
cyl("SideStoolPost", L(T2X - 0.3, 0.31, T2Z - 0.95), 0.03, 0.6, M["iron"], seg=8)
cyl("SideStoolFoot", L(T2X - 0.3, 0.02, T2Z - 0.95), 0.2, 0.03, M["iron"], seg=12)

# ---- tall studio lamps by both tables ----------------------------------------------------
for i, (lx, lz, hx, hz) in enumerate(((26.9, 33.3, 25.6, 32.3), (28.0, 27.4, 26.9, 26.6))):
    cyl(f"StudioLamp{i}Foot", L(lx, 0.02, lz), 0.22, 0.04, M["iron"], seg=16)
    cyl(f"StudioLamp{i}Post", L(lx, 1.1, lz), 0.02, 2.2, M["iron"], seg=8)
    ang = math.degrees(math.atan2(hz - lz, hx - lx))
    ln = math.hypot(hx - lx, hz - lz)
    box(f"StudioLamp{i}Arm", L((lx + hx) / 2, 2.2, (lz + hz) / 2), (ln, 0.025, 0.025), M["iron"], rot=-ang)
    lathe(f"StudioLamp{i}Shade", L(hx, 1.95, hz), [(0.24, 0.0), (0.2, 0.05), (0.08, 0.2), (0.03, 0.26)], M["brass"], seg=18)
    sphere(f"StudioLamp{i}Bulb", L(hx, 2.02, hz), 0.05, M["bulb"], seg=8)
    LAMPS.append(L(hx, 1.95, hz))

# ---- canvas drying rack + drop cloth (hide: behind it, against the west wall) ------------
RX0, RX1, RZ0, RZ1, RH = 17.9, 18.9, 33.4, 36.1, 2.25
rack_parts = []
for z in (RZ0, RZ1):
    for x in (RX0, RX1):
        rack_parts.append(wbox(f"RackPost{x}_{z}", x, RH / 2, z, 0.07, RH, 0.07, M["oak"]))
    rack_parts.append(wbox(f"RackEnd{z}", (RX0 + RX1) / 2, RH - 0.03, z, RX1 - RX0, 0.06, 0.07, M["oak"]))
    wbox(f"RackFoot{z}", (RX0 + RX1) / 2, 0.04, z, RX1 - RX0 + 0.2, 0.08, 0.1, M["oak"])
for x in (RX0, RX1):
    rack_parts.append(wbox(f"RackRail{x}", x, RH - 0.03, (RZ0 + RZ1) / 2, 0.06, 0.06, RZ1 - RZ0, M["oak"]))
    wbox(f"RackBaseRail{x}", x, 0.12, (RZ0 + RZ1) / 2, 0.06, 0.06, RZ1 - RZ0, M["oak"])
nslots = 8
for i in range(nslots):
    z = RZ0 + 0.18 + i * (RZ1 - RZ0 - 0.36) / (nslots - 1)
    wbox(f"RackDivider{i}", (RX0 + RX1) / 2, 0.16, z, RX1 - RX0, 0.04, 0.03, M["oak"])
    cw = 0.7 + 0.25 * rng.random()
    ch = 0.8 + 0.9 * rng.random()
    cxp = (RX0 + RX1) / 2 + (rng.random() - 0.5) * 0.1
    wbox(f"RackCanvas{i}", cxp, 0.2 + ch / 2, z + 0.06, cw, ch, 0.03, M["canvasback"], bevel=0.004)
    wbox(f"RackStretcher{i}", cxp, 0.2 + ch / 2, z + 0.085, cw - 0.06, 0.04, 0.02, M["oak"])
framed("RackPaintingEnd", (RX0 + RX1) / 2, 1.05, RZ0 - 0.05, 0.8, 1.1, "z-", PAINT["p_land2"], frame=0.07)
cloth("RackDropCloth", L(18.75, 2.55, (RZ0 + RZ1) / 2), 1.9, 3.0, M["linen"], rack_parts, res=36, frames=55)
obstacle(RX0 - 0.1, RX1 + 0.1, RZ0 - 0.1, RZ1 + 0.1, "canvas rack with drop cloth (hide behind it)")
# the bay behind: frames leaning on the west wall close its north end; the notes lie on a crate
wbox("BayCrate", 17.0, 0.32, 36.95, 1.2, 0.64, 0.8, M["oak"], bevel=0.01)
for i, (fz, fh, fw) in enumerate(((37.55, 1.6, 1.3), (37.45, 1.35, 1.0))):
    box(f"LeaningFrame{i}", L(16.55 + 0.15 * i, fh / 2, fz), (fw, fh, 0.05), M["canvasback"], tilt=-12, tilt_axis="Y", rot=90)
obstacle(16.15, 17.7, 36.5, 37.85, "crate and leaning frames")
wbox("NotesDesk", 17.35, 0.36, 34.3, 0.55, 0.72, 0.5, M["walnut"], bevel=0.01)
wbox("RestorationNotes", 17.35, 0.73, 34.3, 0.3, 0.01, 0.4, M["paper"], rot=8)
cyl("NotesCandle", L(17.5, 0.8, 34.12), 0.02, 0.14, M["wax"], seg=8)
sphere("NotesFlame", L(17.5, 0.9, 34.12), 0.012, M["flame"], seg=6, scale=(1, 2, 1))
obstacle(17.05, 17.65, 34.05, 34.55, "notes desk")

# ---- solvent cabinet + plan chest + folding screen (hide: in the bay behind the cabinet) --
CX0, CX1, CZ0, CZ1, CH = 29.3, 29.9, 24.2, 26.6, 2.25
wbox("SolventCabinet", (CX0 + CX1) / 2, CH / 2, (CZ0 + CZ1) / 2, CX1 - CX0, CH, CZ1 - CZ0, M["walnut"], bevel=0.015)
wbox("SolventCabinetCornice", (CX0 + CX1) / 2, CH + 0.05, (CZ0 + CZ1) / 2, CX1 - CX0 + 0.08, 0.1, CZ1 - CZ0 + 0.08, M["trim"], bevel=0.01)
for i, zc in enumerate(((CZ0 + CZ1) / 2 - 0.6, (CZ0 + CZ1) / 2 + 0.6)):
    wbox(f"CabinetGlass{i}", CX0 - 0.012, 1.35, zc, 0.01, 1.4, 1.0, M["glass"])
    for yy in (0.95, 1.4, 1.85):
        for k in range(4):
            jar(f"CabJar{i}_{yy}_{k}", CX0 + 0.2, yy - 0.2, zc - 0.36 + k * 0.24, 0.05 + 0.01 * (k % 2), 0.14 + 0.04 * (k % 3), M["amber"] if (k + i) % 2 else M["glass"])
    for k in range(3):
        wbox(f"CabDrawer{i}{k}", CX0 - 0.012, 0.18 + k * 0.2, zc, 0.02, 0.16, 1.0, M["walnut"], bevel=0.004)
obstacle(CX0 - 0.05, CX1, CZ0, CZ1, "solvent cabinet (hide behind it)")
PCX0, PCX1 = 29.95, x1 - IN
wbox("PlanChestSouth", (PCX0 + PCX1) / 2, 0.5, z0 + IN + 0.4, PCX1 - PCX0, 1.0, 0.78, M["walnut"], bevel=0.012)
for k in range(5):
    wbox(f"PlanChestSouthDrawer{k}", (PCX0 + PCX1) / 2, 0.12 + k * 0.18, z0 + IN + 0.8, PCX1 - PCX0 - 0.1, 0.14, 0.02, M["walnut"], bevel=0.004)
obstacle(PCX0, PCX1, z0 + IN, z0 + IN + 0.82, "plan chest")
for i in range(3):   # a three-leaf screen closing the bay's north side
    zc = 26.85 + (0.04 if i == 1 else 0)
    xc = 30.25 + i * 0.58
    box(f"BayScreen{i}", L(xc, 0.95, zc), (0.56, 1.8, 0.035), M["velvet"], rot=(12 if i == 1 else -12))
    for s in (-1, 1):
        box(f"BayScreenFrame{i}{s}", L(xc + s * 0.28, 0.95, zc), (0.04, 1.85, 0.05), M["oak"])
obstacle(29.95, x1 - IN, 26.65, 27.05, "folding screen")

# ---- easels by the windows ---------------------------------------------------------------
def easel(name, cx, cz, yaw, pm, cw=0.8, chh=1.0, covered=False):
    parts = []
    for s in (-1, 1):
        fx, fz = rotp(cx, cz, yaw, s * 0.28, 0.0)
        parts.append(box(f"{name}Leg{s}", L(fx, 0.95, fz), (0.045, 1.95, 0.045), M["oak"], tilt=-8, tilt_axis="X", rot=yaw))
    bx, bz = rotp(cx, cz, yaw, 0, -0.45)
    box(f"{name}BackLeg", L(bx, 0.85, bz), (0.04, 1.75, 0.04), M["oak"], tilt=22, tilt_axis="X", rot=yaw)
    lx, lz = rotp(cx, cz, yaw, 0, 0.1)
    parts.append(box(f"{name}Ledge", L(lx, 0.78, lz), (0.75, 0.04, 0.09), M["oak"], rot=yaw))
    px, pz = rotp(cx, cz, yaw, 0, 0.05)
    canvas = box(f"{name}Canvas", L(px, 0.8 + chh / 2, pz), (cw, chh, 0.03), M["canvasback"], tilt=-8, tilt_axis="X", rot=yaw)
    parts.append(canvas)
    fx2, fz2 = rotp(cx, cz, yaw, 0, 0.068)
    if not covered:
        ob = plane(f"{name}Painting", (0, 0, 0), cw - 0.02, chh - 0.02, pm, "z+")
        ob.rotation_euler = (math.radians(-8), 0, math.radians(yaw))
        ob.location = P(*L(fx2, 0.8 + chh / 2, fz2))
    return parts


easel("EaselA", 30.0, 31.3, 250, PAINT["p_land1"], 0.95, 0.7)
easel("EaselB", 28.6, 34.6, 215, PAINT["p_port1"], 0.7, 0.9)
covered = easel("EaselC", 22.2, 35.8, 180, None, 0.9, 1.1, covered=True)
cloth("EaselCCloth", L(22.2, 2.2, 35.8), 1.3, 1.1, M["linen"], covered, res=26, frames=40)
for nm, (cx, cz) in (("EaselA", (30.0, 31.3)), ("EaselB", (28.6, 34.6)), ("EaselC", (22.2, 35.8))):
    obstacle(cx - 0.5, cx + 0.5, cz - 0.5, cz + 0.5, nm)

# ---- covered statue in the north-east corner ----------------------------------------------
SX, SZ = 30.75, 36.7
plinth = wbox("StatuePlinth", SX, 0.45, SZ, 0.8, 0.9, 0.8, M["marble"], bevel=0.02)
fig = lathe("StatueProxy", L(SX, 0.9, SZ), [(0.18, 0), (0.22, 0.2), (0.2, 0.7), (0.26, 1.05), (0.12, 1.15), (0.14, 1.32), (0.0, 1.45)], M["marble"], seg=12)
cloth("StatueShroud", L(SX, 2.75, SZ), 1.9, 1.9, M["linen"], [plinth, fig], res=38, frames=60)
bpy.data.objects.remove(fig)
obstacle(SX - 0.6, SX + 0.6, SZ - 0.6, SZ + 0.6, "covered statue")

# ---- plan chest on the north wall, bust, wall paintings ----------------------------------
wbox("PlanChestNorth", 25.6, 0.5, z1 - IN - 0.36, 3.6, 1.0, 0.7, M["walnut"], bevel=0.012)
for k in range(5):
    for j in range(2):
        wbox(f"PlanChestNorthDrawer{k}{j}", 24.7 + j * 1.8, 0.12 + k * 0.18, z1 - IN - 0.72, 1.7, 0.14, 0.02, M["walnut"], bevel=0.004)
        sphere(f"PlanChestNorthPull{k}{j}", L(24.7 + j * 1.8, 0.12 + k * 0.18, z1 - IN - 0.74), 0.015, M["brass"], seg=6)
obstacle(23.8, 27.4, z1 - IN - 0.72, z1 - IN, "plan chest (north)")
for i in range(5):
    cyl(f"RolledCanvas{i}", L(24.3 + i * 0.28, 1.06, z1 - IN - 0.4), 0.05, 1.1, M["canvasback"], axis="z", seg=10)
framed("NorthWallPainting", 25.6, 2.1, z1 - IN - 0.03, 1.4, 1.0, "z-", PAINT["p_still"], frame=0.09)
lathe("BustPedestal", L(22.7, 0, z1 - IN - 0.45), [(0.22, 0), (0.22, 0.08), (0.14, 0.14), (0.11, 0.9), (0.17, 0.98), (0.2, 1.05), (0.2, 1.1)], M["marble"], seg=16)
sphere("BustShoulders", L(22.7, 1.23, z1 - IN - 0.45), 0.22, M["marble"], seg=14, scale=(1.2, 0.55, 0.7))
cyl("BustNeck", L(22.7, 1.38, z1 - IN - 0.45), 0.055, 0.14, M["marble"], seg=10)
sphere("BustHead", L(22.7, 1.54, z1 - IN - 0.45), 0.11, M["marble"], seg=14, scale=(0.85, 1.15, 1.0))
obstacle(22.4, 23.0, z1 - IN - 0.75, z1 - IN - 0.15, "bust")
framed("WestWallPortrait", x0 + IN + 0.04, 2.05, 32.5, 0.8, 1.05, "x+", PAINT["p_port1"], frame=0.08)
framed("SouthWallLandscape", 26.5, 2.0, z0 + IN + 0.04, 1.3, 0.9, "z+", PAINT["p_land1"], frame=0.08)

# ---- shelves of pigments and solvents on the west wall ------------------------------------
SHX0, SHX1, SHZ0, SHZ1 = x0 + IN, x0 + IN + 0.45, 23.0, 27.6
for s, zz in enumerate((SHZ0, SHZ1)):
    wbox(f"ShelfSide{s}", (SHX0 + SHX1) / 2, 1.2, zz, 0.45, 2.4, 0.04, M["walnut"])
wbox("ShelfBack", SHX0 + 0.02, 1.2, (SHZ0 + SHZ1) / 2, 0.02, 2.4, SHZ1 - SHZ0, M["walnut"])
for k, yy in enumerate((0.1, 0.62, 1.12, 1.62, 2.12, 2.38)):
    wbox(f"ShelfBoard{k}", (SHX0 + SHX1) / 2, yy, (SHZ0 + SHZ1) / 2, 0.44, 0.03, SHZ1 - SHZ0, M["walnut"])
    if k in (0, 5):
        continue
    zz = SHZ0 + 0.15
    while zz < SHZ1 - 0.15:
        pick = rng.random()
        if pick < 0.45:
            jar(f"ShelfJar{k}_{zz:.2f}", SHX0 + 0.24, yy + 0.015, zz, 0.05 + 0.02 * rng.random(), 0.12 + 0.1 * rng.random(), M["glass"] if rng.random() < 0.5 else M["amber"], lid=M["cork"])
            zz += 0.15
        elif pick < 0.75:
            n = 3 + int(rng.random() * 5)
            for b in range(n):
                wbox(f"ShelfBook{k}_{zz:.2f}_{b}", SHX0 + 0.22, yy + 0.015 + 0.14, zz + b * 0.05, 0.24, 0.28 + 0.06 * rng.random(), 0.045, M["books"] if b % 3 else M["leather"])
            zz += n * 0.05 + 0.08
        else:
            wbox(f"ShelfBox{k}_{zz:.2f}", SHX0 + 0.24, yy + 0.1, zz + 0.12, 0.3, 0.17, 0.24, M["oak"], bevel=0.008)
            zz += 0.3
obstacle(SHX0, SHX1 + 0.05, SHZ0, SHZ1, "pigment shelves")

# ---- cart of solvents by the main table --------------------------------------------------
CAX, CAZ = 21.5, 31.1
for yy in (0.25, 0.82):
    wbox(f"CartShelf{yy}", CAX, yy, CAZ, 0.9, 0.03, 0.55, M["steel"])
for sx in (-1, 1):
    for sz in (-1, 1):
        cyl(f"CartPost{sx}{sz}", L(CAX + sx * 0.42, 0.47, CAZ + sz * 0.25), 0.012, 0.86, M["steel"], seg=6)
        cyl(f"CartWheel{sx}{sz}", L(CAX + sx * 0.42, 0.045, CAZ + sz * 0.25), 0.045, 0.03, M["iron"], axis="x", seg=10)
for i in range(5):
    bottle(f"CartBottle{i}", CAX - 0.32 + i * 0.16, 0.835, CAZ + 0.08 * (i % 2), 0.04, 0.22, M["amber"] if i % 2 else M["glass"])
    jar(f"CartJar{i}", CAX - 0.3 + i * 0.15, 0.265, CAZ, 0.05, 0.12, M["porcelain"])
obstacle(CAX - 0.47, CAX + 0.47, CAZ - 0.3, CAZ + 0.3, "cart")

# ---- south wall: trestle table of frames, crates, leaning canvases; a big studio easel -----
TRX0, TRX1 = 19.9, 23.0
wbox("TrestleTop", (TRX0 + TRX1) / 2, 0.8, z0 + IN + 0.42, TRX1 - TRX0, 0.05, 0.7, M["oak"], bevel=0.008)
for sx in (TRX0 + 0.25, TRX1 - 0.25):
    for k, tl in enumerate((-14, 14)):
        box(f"Trestle{sx}_{k}", L(sx + (0.12 if k else -0.12), 0.39, z0 + IN + 0.42), (0.05, 0.8, 0.6), M["oak"], tilt=tl, tilt_axis="Y")
for i in range(5):   # a pile of old frames on the trestle
    fw, fd = 0.9 - 0.1 * i, 0.6 - 0.06 * i
    box(f"TrestleFrame{i}", L(20.9 + 0.05 * i, 0.84 + 0.035 * i, z0 + IN + 0.42), (fw, 0.03, fd), M["trim"] if i % 2 else M["walnut"], rot=4 * i - 8)
wbox("Toolbox", 22.4, 0.92, z0 + IN + 0.42, 0.45, 0.2, 0.25, M["iron"], bevel=0.01)
cyl("TrestleRoll", L(21.9, 0.86, z0 + IN + 0.22), 0.05, 1.0, M["canvasback"], axis="x", seg=10)
candle("TrestleCandle", 22.75, 0.825, z0 + IN + 0.62)
obstacle(TRX0, TRX1, z0 + IN, z0 + IN + 0.8, "trestle table")
for i, (cxx, cyy, cs) in enumerate(((25.1, 0.35, 0.7), (25.95, 0.3, 0.6), (25.4, 0.95, 0.55))):
    wbox(f"Crate{i}", cxx, cyy, z0 + IN + 0.45, cs, cs if i < 2 else 0.5, cs, M["oak"], bevel=0.01, rot=(6 if i == 2 else 0))
    for k in (-1, 1):
        wbox(f"CrateSlat{i}{k}", cxx, cyy + k * cs * 0.3, z0 + IN + 0.45 + cs / 2 + 0.006, cs + 0.02, 0.06, 0.012, M["trim"])
obstacle(24.7, 26.35, z0 + IN, z0 + IN + 0.85, "crates")
for i, (fx, fw, fh, tl) in enumerate(((27.2, 0.9, 1.2, 14), (27.35, 1.1, 0.9, 12), (27.9, 0.7, 1.5, 16), (28.4, 0.8, 1.0, 12))):
    box(f"SouthLeaning{i}", L(fx, fh / 2, z0 + IN + 0.1 + 0.05 * i), (fw, fh, 0.04), M["canvasback"] if i % 2 else M["trim"], tilt=tl, tilt_axis="X")
framed("SouthLeaningPainting", 27.9, 0.78, z0 + IN + 0.36, 0.62, 0.8, "z+", PAINT["p_port2"], frame=0.06)
obstacle(26.7, 28.9, z0 + IN, z0 + IN + 0.55, "leaning canvases")
# a tall studio easel (H-frame) holding a large portrait under restoration, facing the room
SEX, SEZ = 24.4, 24.7
for s2 in (-1, 1):
    wbox(f"StudioEaselPost{s2}", SEX + s2 * 0.55, 1.2, SEZ, 0.07, 2.4, 0.07, M["oak"])
wbox("StudioEaselBase", SEX, 0.06, SEZ, 1.4, 0.08, 0.6, M["oak"], bevel=0.01)
wbox("StudioEaselShelf", SEX, 0.7, SEZ + 0.06, 1.3, 0.05, 0.14, M["oak"])
wbox("StudioEaselClamp", SEX, 2.25, SEZ + 0.02, 1.2, 0.06, 0.08, M["oak"])
framed("StudioEaselPortrait", SEX, 1.45, SEZ + 0.07, 1.0, 1.35, "z+", PAINT["p_port1"], frame=0.1)
obstacle(SEX - 0.75, SEX + 0.75, SEZ - 0.35, SEZ + 0.35, "studio easel")
# frames leaning under the east windows, and a ladder by the north plan chest
for i, (fz, fw, fh) in enumerate(((31.0, 0.8, 1.1), (31.35, 1.0, 0.8), (31.7, 0.6, 1.3))):
    box(f"EastLeaning{i}", L(x1 - IN - 0.12 - 0.05 * i, fh / 2, fz), (0.04, fh, fw), M["canvasback"] if i != 1 else M["trim"], tilt=-13, tilt_axis="Y")
obstacle(x1 - IN - 0.5, x1 - IN, 30.5, 32.1, "canvases under the window")
for s2 in (-1, 1):
    box(f"Ladder{s2}", L(28.3 + s2 * 0.22, 1.3, z1 - IN - 0.35), (0.05, 2.7, 0.06), M["oak"], tilt=-10, tilt_axis="X")
for k in range(8):
    box(f"LadderRung{k}", L(28.3, 0.25 + k * 0.32, z1 - IN - 0.35 - 0.055 * (0.25 + k * 0.32)), (0.44, 0.035, 0.035), M["oak"])
obstacle(27.95, 28.65, z1 - IN - 0.7, z1 - IN, "ladder")
candle("PlanChestCandleA", 24.2, 1.0, z1 - IN - 0.55)
candle("PlanChestCandleB", 27.0, 1.0, z1 - IN - 0.55, h=0.11)
candle("SideTableCandle", T2X + 0.9, 0.92, T2Z + 0.3)

# ---- a large painting on trestles under a dust sheet; a small specimen cabinet --------------
DTX, DTZ = 27.2, 29.0
trestles = []
for sx in (-0.75, 0.75):
    for k, tl in enumerate((-12, 12)):
        trestles.append(box(f"DustTrestle{sx}_{k}", L(DTX + sx + (0.1 if k else -0.1), 0.36, DTZ), (0.05, 0.74, 1.1), M["oak"], tilt=tl, tilt_axis="Y"))
panel = wbox("DustPanel", DTX, 0.76, DTZ, 2.0, 0.06, 1.3, M["walnut"])
framed("DustPainting", DTX, 0.79, DTZ, 1.8, 1.1, "up", PAINT["p_land2"], frame=0.06)
cloth("DustSheet", L(DTX + 0.15, 0.86, DTZ + 0.1), 2.3, 1.7, M["linen"], [panel] + trestles, res=34, frames=45,
      pins=[(DTX - 0.7 + 0.35 * k, DTZ - 0.1) for k in range(5)])
obstacle(DTX - 1.1, DTX + 1.1, DTZ - 0.7, DTZ + 0.7, "dust-sheeted painting on trestles")
wbox("SpecimenCabinet", x0 + IN + 0.25, 0.55, 28.3, 0.5, 1.1, 1.0, M["walnut"], bevel=0.01)
wbox("SpecimenCabinetGlass", x0 + IN + 0.51, 0.75, 28.3, 0.01, 0.55, 0.85, M["glass"])
for k in range(4):
    jar(f"SpecimenJar{k}", x0 + IN + 0.3, 0.52, 27.95 + k * 0.23, 0.05, 0.14 + 0.03 * (k % 2), M["amber"] if k % 2 else M["glass"])
candle("SpecimenCandle", x0 + IN + 0.25, 1.1, 28.0, h=0.12)
obstacle(x0 + IN, x0 + IN + 0.55, 27.75, 28.85, "specimen cabinet")

# ---- rugs ----------------------------------------------------------------------------------
wbox("RugMain", TX, 0.006, TZ - 0.3, 5.0, 0.012, 3.4, M["rug_red"], fit=(L(TX, 0, TZ)[0] - 2.5, -(TZ - 0.3 - ORIGIN[1]) - 1.7, 5.0, 3.4))
wbox("RugEasels", 28.9, 0.006, 32.4, 2.6, 0.012, 3.6, M["rug_blue"], fit=(28.9 - ORIGIN[0] - 1.3, -(32.4 - ORIGIN[1]) - 1.8, 2.6, 3.6))
wbox("RugEntry", 21.2, 0.006, 26.2, 2.2, 0.012, 3.4, M["rug_red"], fit=(21.2 - ORIGIN[0] - 1.1, -(26.2 - ORIGIN[1]) - 1.7, 2.2, 3.4))

# ---- sconces with candles -----------------------------------------------------------------
for i, (sx, sz, side) in enumerate(((x0 + IN, 27.8, "W"), (x0 + IN, 33.2, "W"), (22.2, z0 + IN, "S"), (28.6, z1 - IN, "N"), (21.8, z1 - IN, "N"))):
    nx, nz = {"W": (1, 0), "S": (0, 1), "N": (0, -1)}[side]
    wbox(f"Sconce{i}Plate", sx + nx * 0.03, 1.95, sz + nz * 0.03, 0.12 if nz else 0.04, 0.3, 0.04 if nz else 0.12, M["brass"])
    for k in (-1, 1):
        cxk = sx + nx * 0.16 + (k * 0.1 if nz else 0)
        czk = sz + nz * 0.16 + (0 if nz else k * 0.1)
        cyl(f"Sconce{i}Cup{k}", L(cxk, 2.02, czk), 0.035, 0.03, M["brass"], seg=10)
        cyl(f"Sconce{i}Candle{k}", L(cxk, 2.11, czk), 0.018, 0.15, M["wax"], seg=8)
        sphere(f"Sconce{i}Flame{k}", L(cxk, 2.21, czk), 0.012, M["flame"], seg=6, scale=(1, 2.2, 1))
    SCONCES.append(L(sx + nx * 0.2, 2.2, sz + nz * 0.2))

# light markers for the game (it adds its own practical lights at these points)
for i, p in enumerate(LAMPS):
    empty(f"LIGHT_lamp_{i}", p)
for i, p in enumerate(SCONCES):
    empty(f"LIGHT_sconce_{i}", p)
for i, p in enumerate(CANDLES):
    empty(f"LIGHT_candle_{i}", p)


# ================================================================ render / bake context
print("context...")
RO = S.RENDER_ONLY


def struct_walls():
    for side in "SNWE":
        axis = "x" if side in "SN" else "z"
        a0, a1 = (x0 - 0.15, x1 + 0.15) if axis == "x" else (z0 - 0.15, z1 + 0.15)
        at = {"S": z0, "N": z1, "W": x0, "E": x1}[side]
        spans, cur = [], a0
        for g0, g1 in sorted(DOORS.get(side, [])):
            spans.append((cur, g0))
            cur = g1
        spans.append((cur, a1))
        for k, (s0, s1) in enumerate(spans):
            mid, ln = (s0 + s1) / 2, s1 - s0
            if axis == "x":
                wbox(f"Struct{side}{k}", mid, WALL_H / 2, at, ln, WALL_H, 0.28, M["wall_struct"], coll=RO)
            else:
                wbox(f"Struct{side}{k}", at, WALL_H / 2, mid, 0.28, WALL_H, ln, M["wall_struct"], coll=RO)
        for g0, g1 in DOORS.get(side, []):   # masonry above each doorway
            mid = (g0 + g1) / 2
            if axis == "x":
                wbox(f"StructHead{side}{mid}", mid, (DOOR_H + WALL_H) / 2, at, g1 - g0, WALL_H - DOOR_H, 0.28, M["wall_struct"], coll=RO)
            else:
                wbox(f"StructHead{side}{mid}", at, (DOOR_H + WALL_H) / 2, mid, 0.28, WALL_H - DOOR_H, g1 - g0, M["wall_struct"], coll=RO)


struct_walls()
# short passages beyond each door (so the bake sees corridor floor, and light spills in)
wbox("PassS", 18, -0.03, 19.3, 2, 0.06, 5.4, M["corridor"], coll=RO)
wbox("PassN", 20, -0.03, 40, 2, 0.06, 4, M["corridor"], coll=RO)
wbox("PassW", 11.5, -0.03, 30, 9, 0.06, 2, M["corridor"], coll=RO)
wbox("Ground", 24, -0.12, 30, 60, 0.1, 60, M["wall_struct"], coll=RO)
ceiling = wbox("Ceiling", 24, WALL_H + 0.05, 30, 16.6, 0.1, 16.6, M["ceiling"], coll=RO)
ceiling.visible_camera = False     # it bounces light and shades the room, but renders see in


# ================================================================ lights (bake + renders)
for i, p in enumerate(LAMPS):
    energy = 70 if i == 0 else 330
    add_light(f"LampLight{i}", "POINT", (p[0], p[1] - 0.05, p[2]), energy, (1.0, 0.7, 0.42), 0.08)
for i, p in enumerate(SCONCES):
    add_light(f"SconceLight{i}", "POINT", p, 70, (1.0, 0.58, 0.26), 0.05)
for i, wz in enumerate(WINDOWS_E):
    add_light(f"MoonWindow{i}", "AREA", L(x1 - IN - 0.25, 1.9, wz), 90, (0.52, 0.64, 1.0), 1.2, rot=(0, -90, 0))
add_light("MoonSpill", "SPOT", L(x1 + 3, 5.5, 31.3), 900, (0.55, 0.66, 1.0), 0.4, rot=(0, -60, 0))
add_light("DoorGlowS", "POINT", L(18, 1.8, 20.0), 45, (1.0, 0.62, 0.32), 0.2)
add_light("DoorGlowW", "POINT", L(13.5, 1.8, 30), 45, (1.0, 0.62, 0.32), 0.2)
add_light("DoorGlowN", "POINT", L(20, 1.8, 40), 25, (1.0, 0.62, 0.32), 0.2)
add_light("RoomFill", "AREA", L(24, WALL_H - 0.15, 30), 120, (1.0, 0.76, 0.52), 9.0)
for i, p in enumerate(CANDLES):
    add_light(f"CandleLight{i}", "POINT", p, 18, (1.0, 0.55, 0.22), 0.03)

world = bpy.data.worlds.new("Night")
world.use_nodes = True
bgn = world.node_tree.nodes["Background"]
bgn.inputs["Color"].default_value = (0.01, 0.013, 0.03, 1)
bgn.inputs["Strength"].default_value = 1.0
S.scene.world = world

# ================================================================ obstacles report
with open(os.path.join(PATHS.models if R.arg("out") else os.path.join(R.ROOT, "tools", "blender"), f"{NAME}_obstacles.json"), "w") as fh:
    json.dump([o for o, _ in OBSTACLES], fh)
print("OBSTACLES", json.dumps(OBSTACLES))

# ================================================================ save, merge, bake, export
bpy.ops.wm.save_as_mainfile(filepath=PATHS.blend, relative_remap=True)
print("saved", PATHS.blend)

if not R.flag("no-render"):
    R.setup_render(samples=int(R.arg("samples", 64)), cycles=True)
    SHOTS = [
        ("birdseye", L(33.5, 15.5, 20.5), L(24.2, 0.0, 30.8), 24, (1600, 1000)),
        ("room_level", L(19.2, 1.62, 23.4), L(27.5, 0.9, 34.0), 18, (1400, 860)),
        ("under_table", L(24.6, 0.42, 32.15), L(22.0, 0.5, 27.0), 16, (1400, 860)),
        ("behind_rack", L(17.1, 1.05, 35.5), L(21.5, 0.9, 31.5), 18, (1400, 860)),
    ]
    R.render_shots(PATHS, SHOTS)

BIG = ("lab_floor_diff", "lab_panel_diff", "lab_limestone")


def limits(n):
    if n in BIG:
        return 1024
    if "_nor" in n or "_rough" in n:
        return 256 if "floor" not in n else 512
    return 512


merged, room, markers = R.merge_export("ConservationLab", limits)
room["room"] = NAME
R.cull_hidden_faces(room, (RECT["x0"], RECT["x1"], RECT["z0"], RECT["z1"]))
if not R.flag("no-bake"):
    R.lightmap_uvs(room)
    px = R.bake_lightmap(room, int(R.arg("bake-size", 2048)), int(R.arg("bake-samples", 256)))
    R.write_lightmap(px, PATHS.lightmap, PATHS.sidecar)
R.export_glb(PATHS.glb, [room, *markers], keep_lightmap=not R.flag("no-bake"))
room.data.calc_loop_triangles()
print("room:", len(room.data.loop_triangles), "triangles;", len(room.data.materials), "materials;", len(room.data.uv_layers), "uv sets")
# (the editable .blend was saved before merging; the merged, phone-sized state is not kept)
