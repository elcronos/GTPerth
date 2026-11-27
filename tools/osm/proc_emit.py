import json, math
D = json.load(open('api_all.json')); nodes, ways = D['nodes'], D['ways']
LAT0, LON0 = -31.95922, 115.85587
W = lambda ll: [round((ll[1] - LON0) * 94430, 1), round((LAT0 - ll[0]) * 110950, 1)]
I = json.load(open('osm_buildings_api.json'))
def cen(P): return (sum(p[0] for p in P) / len(P), sum(p[1] for p in P) / len(P))
def inpoly(x, z, P):
    c = False; j = len(P) - 1
    for i in range(len(P)):
        if (P[i][1] > z) != (P[j][1] > z) and x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]: c = not c
        j = i
    return c
blds = [i for i in I if i['k'] == 'bld']; parts = [i for i in I if i['k'] == 'part']
# dedupe identical rings (ways shared by tiles are unique by id anyway)
seen = set(); 
def key(i): return i['id']
out = []; used_parts = set()
SKIP = {'The Bell Tower', 'Florence Hummerston Kiosk'}
for b in blds:
    if b['id'] in seen: continue
    seen.add(b['id'])
    if b['name'] in SKIP: continue
    ps = [p for p in parts if p['id'] != b['id'] and inpoly(*cen(p['pts']), b['pts'])]
    # a part identical to the outline (same id, e.g. relation tagged both) is just the outline
    if ps:
        for p in ps: used_parts.add(p['id'])
        tall = max(ps, key=lambda p: (p['h'] or (p['lv'] or 0) * 3.3))
        for p in ps:
            out.append({**p, 'name': p['name'] or b['name'], 'b': b['b'] if p['b'] in (None, 'yes') else p['b'], 'col': p['col'] or b['col'], 'grp': b['id']})
    else:
        out.append({**b, 'grp': b['id']})
for p in parts:
    if p['id'] not in used_parts and p['id'] not in seen: out.append({**p, 'grp': p['id']})
rec = []
for o in out:
    h = o['h']; lv = o['lv']
    rec.append({'p': [[round(x, 1), round(z, 1)] for x, z in o['pts']], 'h': h, 'mh': round(o['mh'] or 0, 1), 'lv': lv, 'b': o['b'], 'n': o['name'], 'col': o['col'], 'roof': o['roof'], 'g': o['grp'], 'part': o['k'] == 'part'})
print('buildings out', len(rec), 'with h', sum(1 for r in rec if r['h']), 'with lv', sum(1 for r in rec if r['lv'] and not r['h']))
# ---------------- roads
CLS = {'trunk': ('t', 14, 4), 'trunk_link': ('t', 8, 1), 'primary': ('p', 13, 4), 'primary_link': ('p', 7, 1), 'secondary': ('s', 11, 2), 'secondary_link': ('s', 7, 1),
       'tertiary': ('s', 9.5, 2), 'tertiary_link': ('s', 6.5, 1), 'residential': ('m', 7.5, 2), 'unclassified': ('m', 7, 2), 'living_street': ('m', 6, 2)}
roads = []
for wid, (nds, tags) in ways.items():
    hw = tags.get('highway')
    if hw not in CLS: continue
    if tags.get('bridge') not in (None, 'no') or tags.get('tunnel') not in (None, 'no') or tags.get('layer', '0') not in ('0',) or tags.get('covered') == 'yes': continue
    if tags.get('area') == 'yes': continue
    pts = [W(nodes[n]) for n in nds if n in nodes]
    if len(pts) < 2: continue
    c, w, lanes = CLS[hw]
    try: ln = int(tags.get('lanes', '0'))
    except: ln = 0
    one = tags.get('oneway') in ('yes', '1', 'true') or hw.endswith('_link') and tags.get('oneway') != 'no' or tags.get('junction') == 'roundabout'
    if ln: lanes = ln; w = max(5.5, ln * 3.3 + 1.0)
    elif one: lanes = max(1, lanes // 2); w = max(5.5, w * 0.6)
    roads.append({'c': c, 'w': round(w, 1), 'l': lanes, 'o': 1 if one else 0, 'n': tags.get('name'), 'pts': pts})
print('roads', len(roads), {k: sum(1 for r in roads if r['c'] == k) for k in 'tpsm'})
s = '// Generated from the OpenStreetMap API (© OpenStreetMap contributors, ODbL): buildings / building parts with real\n'
s += '// heights and levels, and the street network (names, lanes, one-way). Frame as map.js. Do not edit by hand.\n'
s += 'export const OSM_ROADS = ' + json.dumps(roads, separators=(',', ':'), ensure_ascii=False) + ';\n'
s += 'export const OSM_BUILDINGS = ' + json.dumps(rec, separators=(',', ':'), ensure_ascii=False) + ';\n'
open('/home/claude/perth/src/osm_data.js', 'w').write(s); print('bytes', len(s))
