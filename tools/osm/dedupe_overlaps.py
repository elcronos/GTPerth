#!/usr/bin/env python3
"""Post-process src/osm_data.js OSM_BUILDINGS to stop coplanar-wall z-fighting (needs shapely). Run after regenerating.
  A footprint >90% inside a bigger one B:
   - same height as B and B is >2x bigger  → B is an outline carrying its tallest part's height: drop B, keep the part
   - not taller than B (and not starting higher) → hidden inside B: drop it
   - taller (tower on a podium)            → keep, ins=0.25 (towers.js pulls its walls 0.25 m in)
  Any remaining partial overlap > 0.3 m² → the smaller footprint gets ins=0.18."""
import re, json
from shapely.geometry import Polygon
from shapely.strtree import STRtree
p = 'src/osm_data.js'; s = open(p).read()
m = re.search(r'(OSM_BUILDINGS = )(\[.*?\])(;?\n)', s, re.S); B = json.loads(m.group(2))
G = [Polygon(b['p']).buffer(0) for b in B]; tree = STRtree(G)
H = lambda b: b.get('h') or (b.get('lv') or 2) * 3.3
MH = lambda b: b.get('mh') or 0
drop, ins = set(), {}
for i, g in enumerate(G):
    if i in drop: continue
    for j in tree.query(g):
        j = int(j)
        if j == i or j in drop or g.area <= 0 or g.area > G[j].area or g.intersection(G[j]).area / g.area <= 0.9: continue
        bi, bj = B[i], B[j]
        if min(H(bi), H(bj)) <= max(MH(bi), MH(bj)): continue
        if abs(H(bi) - H(bj)) < 0.6 and G[j].area > 2 * g.area and MH(bi) <= MH(bj) + 0.3: drop.add(j)
        elif H(bi) <= H(bj) + 0.3 and MH(bi) >= MH(bj) - 0.3: drop.add(i); break
        else: ins[i] = 0.25
for i, g in enumerate(G):
    if i in drop: continue
    for j in tree.query(g):
        j = int(j)
        if j <= i or j in drop or g.intersection(G[j]).area < 0.3: continue
        if min(H(B[i]), H(B[j])) <= max(MH(B[i]), MH(B[j])): continue
        k = i if g.area < G[j].area else j
        ins.setdefault(k, 0.18)
out = [dict(b, ins=ins[i]) if i in ins else b for i, b in enumerate(B) if i not in drop]
open(p, 'w').write(s[:m.start(2)] + json.dumps(out, separators=(',', ':')) + s[m.end(2):])
print('dropped', len(drop), 'inset', len(ins), 'kept', len(out))
# Manual fix applied after this script: Brookfield Place / BHP Tower — OSM only carries crown slivers as parts (mh 0,
# h 204-234) and the body outline was lost; the parts were removed and the w47027178 body (h 204) re-added.
