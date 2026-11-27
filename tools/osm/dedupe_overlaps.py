#!/usr/bin/env python3
"""Post-process src/osm_data.js OSM_BUILDINGS: a footprint >90% inside a bigger one either hides inside it (dropped) or
is a taller tower on that podium (flag ins=0.25 → towers.js pulls its walls 0.25 m in). Stops coplanar-wall z-fighting.
Run after regenerating osm_data.js. Needs shapely."""
import re, json
from shapely.geometry import Polygon
from shapely.strtree import STRtree
p = 'src/osm_data.js'; s = open(p).read()
m = re.search(r'(OSM_BUILDINGS = )(\[.*?\])(;?\n)', s, re.S); B = json.loads(m.group(2))
G = [Polygon(b['p']).buffer(0) for b in B]; tree = STRtree(G)
H = lambda b: b.get('h') or (b.get('lv') or 2) * 3.3
drop, ins = set(), set()
for i, g in enumerate(G):
    for j in tree.query(g):
        j = int(j)
        if j == i or g.area <= 0 or g.area > G[j].area or g.intersection(G[j]).area / g.area <= 0.9: continue
        bi, bj = B[i], B[j]
        if min(H(bi), H(bj)) <= max(bi.get('mh') or 0, bj.get('mh') or 0): continue
        (drop if H(bi) <= H(bj) + 0.3 and (bi.get('mh') or 0) >= (bj.get('mh') or 0) - 0.3 else ins).add(i)
out = [dict(b, ins=0.25) if i in ins else b for i, b in enumerate(B) if i not in drop]
open(p, 'w').write(s[:m.start(2)] + json.dumps(out, separators=(',', ':')) + s[m.end(2):])
print('dropped', len(drop), 'inset', len(ins))
# second pass (also applied): any remaining partial overlap > 0.3 m² → the smaller footprint gets ins=0.18
