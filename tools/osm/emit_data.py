import json, math
R = json.load(open('roads.json')); B = json.load(open('buildings.json'))
def ext(pts, d=3.0):
    if len(pts) < 2: return pts
    a, b = pts[0], pts[1]; L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    p0 = [round(a[0] - (b[0] - a[0]) / L * d, 1), round(a[1] - (b[1] - a[1]) / L * d, 1)]
    a, b = pts[-1], pts[-2]; L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
    p1 = [round(a[0] - (b[0] - a[0]) / L * d, 1), round(a[1] - (b[1] - a[1]) / L * d, 1)]
    return [p0] + pts[1:-1] + [p1] if len(pts) > 2 else [p0, p1]
roads = [{'c': r['cls'][0], 'pts': ext(r['pts'])} for r in R]
blds = [[o['c'], [[round(x, 1), round(z, 1)] for x, z in o['pts']]] for o in B]
s = '// Generated from OpenStreetMap standard-style tiles (© OpenStreetMap contributors, ODbL): road centrelines\n'
s += '// (t trunk, p primary, s secondary, m minor) and building footprints [centroid, ring]. Frame as map.js.\n'
s += 'export const OSM_ROADS = ' + json.dumps(roads, separators=(',', ':')) + ';\n'
s += 'export const OSM_BUILDINGS = ' + json.dumps(blds, separators=(',', ':')) + ';\n'
open('/home/claude/perth/src/osm_data.js', 'w').write(s); print(len(s))
