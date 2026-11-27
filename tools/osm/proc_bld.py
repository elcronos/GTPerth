import json, math, re
D = json.load(open('api_all.json')); nodes, ways, rels = D['nodes'], D['ways'], D['rels']
LAT0, LON0 = -31.95922, 115.85587
W = lambda ll: [round((ll[1] - LON0) * 94430, 2), round((LAT0 - ll[0]) * 110950, 2)]
def num(v):
    if v is None: return None
    m = re.match(r'\s*([0-9]+(?:\.[0-9]+)?)', v.replace(',', '.'));
    if not m: return None
    x = float(m.group(1))
    if "'" in v or 'ft' in v: x *= 0.3048
    return x
def ring(ids):
    pts = [W(nodes[i]) for i in ids if i in nodes]
    if len(pts) >= 2 and pts[0] == pts[-1]: pts = pts[:-1]
    return pts if len(pts) >= 3 and len(pts) == len([i for i in ids if i in nodes]) - (1 if ids[0] == ids[-1] else 0) else None
def join(member_ways):
    segs = [list(ways[w][0]) for w in member_ways if w in ways]
    out = []
    while segs:
        cur = segs.pop(0)
        changed = True
        while changed and cur[0] != cur[-1]:
            changed = False
            for k, s in enumerate(segs):
                if s[0] == cur[-1]: cur += s[1:]; segs.pop(k); changed = True; break
                if s[-1] == cur[-1]: cur += s[::-1][1:]; segs.pop(k); changed = True; break
                if s[-1] == cur[0]: cur = s + cur[1:]; segs.pop(k); changed = True; break
                if s[0] == cur[0]: cur = s[::-1] + cur[1:]; segs.pop(k); changed = True; break
        if cur[0] == cur[-1]: out.append(cur)
    return out
def area(P):
    a = 0
    for i in range(len(P)): j = (i + 1) % len(P); a += P[i][0] * P[j][1] - P[j][0] * P[i][1]
    return a / 2
items = []
def add(kind, rng, tags, oid):
    if rng is None or len(rng) < 3: return
    a = abs(area(rng))
    if a < 8: return
    h = num(tags.get('height')); mh = num(tags.get('min_height')) or 0
    lv = num(tags.get('building:levels')); mlv = num(tags.get('building:min_level'))
    if mh == 0 and mlv: mh = mlv * 3.2
    items.append({'k': kind, 'id': oid, 'pts': rng, 'a': round(a, 1), 'h': h, 'mh': mh, 'lv': lv,
                  'name': tags.get('name'), 'b': tags.get('building') or tags.get('building:part'), 'roof': tags.get('roof:shape'),
                  'col': tags.get('building:colour'), 'mat': tags.get('building:material'), 'rcol': tags.get('roof:colour')})
for wid, (nds, tags) in ways.items():
    if ('building' in tags and tags.get('building') != 'no') or 'building:part' in tags:
        if nds[0] != nds[-1]: continue
        add('part' if 'building:part' in tags else 'bld', ring(nds), tags, 'w' + wid)
for rid, (mem, tags) in rels.items():
    if tags.get('type') not in ('multipolygon', 'building'): continue
    if not (('building' in tags and tags.get('building') != 'no') or 'building:part' in tags): continue
    outers = [m[1] for m in mem if m[0] == 'way' and m[2] in ('outer', '')]
    for o in join(outers):
        add('part' if 'building:part' in tags else 'bld', ring(o), tags, 'r' + rid)
print('items', len(items), 'parts', sum(1 for i in items if i['k'] == 'part'), 'with height', sum(1 for i in items if i['h']), 'with levels', sum(1 for i in items if i['lv']))
json.dump(items, open('osm_buildings_api.json', 'w'))
named = sorted([i for i in items if i['name'] and (i['h'] or i['lv'])], key=lambda i: -(i['h'] or i['lv'] * 3.2))
for i in named[:45]: print(i['k'], i['name'], i['h'], i['lv'], i['mh'], round(sum(p[0] for p in i['pts']) / len(i['pts'])), round(sum(p[1] for p in i['pts']) / len(i['pts'])))
