# Restore building outlines that proc_emit.py replaced by their parts when the parts cover only a sliver of the outline
# and the outline is much taller (e.g. David Malcolm Justice Centre: 149 m outline, one 7 m part). Found by comparing
# against the Sketchfab "Perth, WA, Australia" GIS model (Jack M Simmons, CC BY 4.0). Run after dedupe_overlaps.py.
import json, re
I = json.load(open('osm_buildings_api.json'))
def cen(P): return (sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P))
def inpoly(x, z, P):
    c = False; j = len(P) - 1
    for i in range(len(P)):
        if (P[i][1] > z) != (P[j][1] > z) and x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]: c = not c
        j = i
    return c
H = lambda o: o['h'] or (o['lv'] or 0) * 3.3
blds = [i for i in I if i['k'] == 'bld']; parts = [i for i in I if i['k'] == 'part']
p = 'src/osm_data.js'; s = open(p).read()
m = re.search(r'(OSM_BUILDINGS = )(\[.*?\])(;?\n)', s, re.S); B = json.loads(m.group(2))
have = {b['g'] for b in B if not b['part']}
seen=set(); add=[]
for b in blds:
    if b['id'] in seen or b['id'] in have: continue
    seen.add(b['id'])
    ps = [q for q in parts if q['id'] != b['id'] and inpoly(*cen(q['pts']), b['pts'])]
    if not ps: continue
    ho, hp = H(b), max(H(q) for q in ps)
    xs=[q[0] for q in b['pts']]; zs=[q[1] for q in b['pts']]; tot=cov=0
    z=min(zs)+0.5
    while z<max(zs):
        x=min(xs)+0.5
        while x<max(xs):
            if inpoly(x,z,b['pts']):
                tot+=1
                if any(inpoly(x,z,q['pts']) for q in ps): cov+=1
            x+=1
        z+=1
    if tot == 0 or ho < 9 or tot > 8000 or b['b'] in ('roof', 'transportation', 'train_station', 'parking') or re.search(r'station|car ?park|underground', b['name'] or '', re.I): continue   # real podiums only, not plazas/underground
    if not ((ho >= hp + 8 and cov / tot < 0.75) or (cov / tot < 0.6 and ho > 0)): continue   # tall outline over a sliver of parts, or parts leaving a hole
    add.append({'p': [[round(x,1),round(z,1)] for x,z in b['pts']], 'h': b['h'], 'mh': round(b['mh'] or 0,1), 'lv': b['lv'], 'b': b['b'], 'n': b['name'], 'col': b['col'], 'roof': b['roof'], 'g': b['id'], 'part': False, 'keep': True, 'ins': 0.12})
    print(f"restore {b['id']} {b['name']} outline h{ho:.0f} parts max h{hp:.0f} covered {100*cov/tot:.0f}% area {tot}")
if '--write' in __import__('sys').argv:
    out = B + add
    open(p,'w').write(s[:m.start(2)] + json.dumps(out, separators=(',', ':')) + s[m.end(2):]); print('wrote', len(add))
