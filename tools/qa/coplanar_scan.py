"""Coplanar-face lint for Blender scenes or GLBs (z-fighting before it ships).

Run inside Blender (headless):
  blender -b --factory-startup --python coplanar_scan.py -- --glb path/to/asset.glb [--ground 0.0] [--eps 0.0005] [--json out.json]
  blender -b scene.blend --python coplanar_scan.py -- [--ground 0.0]

What it flags
  1. Overlapping coplanar faces between DIFFERENT objects or materials: faces are bucketed by quantised plane
     (normal, distance); within a bucket, faces whose 2D projections overlap by more than `--min-area` are
     reported. A BVH overlap test misses exactly coplanar triangles, which is why this uses plane buckets.
  2. Upward faces lying on the ground plane (`--ground`, default 0.0) within eps: these fight the terrain pad.
     Fix: lift visual meshes about 2 cm (colliders can stay).
Objects named COL_* (colliders) are ignored. Exit code 1 when anything is found (use in build scripts).
"""
import json
import math
import sys
from collections import defaultdict

import bpy
import bmesh
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def opt(name, default=None, cast=str):
    if f"--{name}" in argv:
        return cast(argv[argv.index(f"--{name}") + 1])
    return default


GLB = opt("glb")
GROUND = opt("ground", 0.0, float)
EPS = opt("eps", 0.0005, float)
MIN_AREA = opt("min-area", 1e-4, float)
OUT = opt("json")

if GLB:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=GLB)


def poly2d(verts, n):
    # project onto the dominant plane of the normal
    ax = max(range(3), key=lambda i: abs(n[i]))
    keep = [i for i in range(3) if i != ax]
    return [(v[keep[0]], v[keep[1]]) for v in verts]


def area2d(p):
    return abs(sum(p[i][0] * p[(i + 1) % len(p)][1] - p[(i + 1) % len(p)][0] * p[i][1] for i in range(len(p)))) / 2


def clip(subject, clipper):
    # Sutherland-Hodgman; clipper must be convex (triangles are)
    def inside(p, a, b):
        return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0

    def inter(p1, p2, a, b):
        x1, y1 = p1; x2, y2 = p2; x3, y3 = a; x4, y4 = b
        den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
        if abs(den) < 1e-12:
            return p2
        t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
        return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

    # orient clipper counter-clockwise
    if sum(clipper[i][0] * clipper[(i + 1) % len(clipper)][1] - clipper[(i + 1) % len(clipper)][0] * clipper[i][1] for i in range(len(clipper))) < 0:
        clipper = clipper[::-1]
    out = subject
    for i in range(len(clipper)):
        a, b = clipper[i], clipper[(i + 1) % len(clipper)]
        inp, out = out, []
        if not inp:
            break
        s = inp[-1]
        for e in inp:
            if inside(e, a, b):
                if not inside(s, a, b):
                    out.append(inter(s, e, a, b))
                out.append(e)
            elif inside(s, a, b):
                out.append(inter(s, e, a, b))
            s = e
    return out


tris = []  # (objname, material, normal, d, verts_world)
for ob in bpy.context.scene.objects:
    if ob.type != "MESH" or ob.name.startswith("COL_") or ob.hide_render:
        continue
    bm = bmesh.new()
    bm.from_object(ob, bpy.context.evaluated_depsgraph_get())
    bm.transform(ob.matrix_world)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    mats = [s.material.name if s.material else "none" for s in ob.material_slots] or ["none"]
    for f in bm.faces:
        if f.calc_area() < 1e-7:
            continue
        n = f.normal.normalized()
        vs = [v.co.copy() for v in f.verts]
        d = n.dot(vs[0])
        tris.append((ob.name, mats[min(f.material_index, len(mats) - 1)], n, d, vs))
    bm.free()

issues = []
# 2. ground-plane faces (one issue per object/material, with a face count)
ground = defaultdict(int)
for name, mat, n, d, vs in tris:
    if n.z > 0.99 and all(abs(v.z - GROUND) < EPS for v in vs):
        ground[(name, mat)] += 1
for (name, mat), cnt in ground.items():
    issues.append({"kind": "on-ground-plane", "object": name, "material": mat, "z": GROUND, "faces": cnt})

# 1. coplanar overlaps across objects/materials
q = lambda x, s: round(x / s)
buckets = defaultdict(list)
for t in tris:
    name, mat, n, d, vs = t
    sign = 1 if (n.x, n.y, n.z) > (0, 0, 0) else -1  # opposite-facing coplanar faces also fight
    key = (q(n.x * sign, 0.01), q(n.y * sign, 0.01), q(n.z * sign, 0.01), q(d * sign, EPS * 4))
    buckets[key].append(t)

seen = set()
for key, group in buckets.items():
    if len(group) < 2 or len(group) > 4000:
        continue
    for i in range(len(group)):
        ni, mi, n, _, vi = group[i]
        pi = poly2d(vi, n)
        for j in range(i + 1, len(group)):
            nj, mj, _, _, vj = group[j]
            if ni == nj and mi == mj:
                continue
            pj = poly2d(vj, n)
            # quick bbox reject
            if max(p[0] for p in pi) < min(p[0] for p in pj) or max(p[0] for p in pj) < min(p[0] for p in pi):
                continue
            if max(p[1] for p in pi) < min(p[1] for p in pj) or max(p[1] for p in pj) < min(p[1] for p in pi):
                continue
            ov = clip(pi, pj)
            a = area2d(ov) if len(ov) >= 3 else 0
            if a > MIN_AREA:
                pair = tuple(sorted([(ni, mi), (nj, mj)]))
                if pair in seen:
                    continue
                seen.add(pair)
                c = sum(vi, Vector()) / 3
                issues.append({"kind": "coplanar-overlap", "a": f"{ni}/{mi}", "b": f"{nj}/{mj}", "area": round(a, 5), "at": [round(c.x, 3), round(c.y, 3), round(c.z, 3)]})

report = {"file": GLB or bpy.data.filepath, "triangles": len(tris), "issues": issues}
text = json.dumps(report, indent=2)
if OUT:
    open(OUT, "w").write(text)
print("COPLANAR", text if issues else f"{report['file']}: 0 issues ({len(tris)} tris)")
sys.exit(1 if issues else 0)
