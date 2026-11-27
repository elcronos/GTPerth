import json
g = json.load(open('world_grid.json')); X0W, Z0W, GW, GH = g['X0W'], g['Z0W'], g['GW'], g['GH']
X1W, Z1W = X0W + GW, Z0W + GH
P = json.load(open('land_polys.json'))
def border(p, tol=3): return abs(p[0] - X0W) < tol or abs(p[0] - X1W) < tol or abs(p[1] - Z0W) < tol or abs(p[1] - Z1W) < tol
def run(pts):
    n = len(pts); onb = [border(p) for p in pts]; best = (0, 0); start = None
    for k in range(2 * n):
        i = k % n
        if not onb[i]:
            if start is None: start = k
            if k - start + 1 > best[1] and k - start + 1 <= n: best = (start, k - start + 1)
        else: start = None
    s0, L = best
    return [pts[(s0 - 1) % n]] + [pts[(s0 + j) % n] for j in range(L)] + [pts[(s0 + L) % n]]
north = P[0]['pts']; south = P[1]['pts']; heir = P[2]['pts']; isl = P[3]['pts']
N = run(north); S = run(south)
if N[0][0] > N[-1][0]: N = N[::-1]
if not (S[0][1] > S[-1][1]): S = S[::-1]      # start at the south border, end at the east border
r = lambda L: [[round(x, 1), round(z, 1)] for x, z in L]
print('N', len(N), N[0], N[-1], ' S', len(S), S[0], S[-1])
out = '// Generated from OpenStreetMap (© OpenStreetMap contributors, ODbL) by tools/osm: shorelines traced from the river.\n'
out += '// Frame: metres, +x east, +z south, origin = Elizabeth Quay Bridge midpoint. Do not edit by hand.\n'
out += f'export const OSM_BOUNDS = {json.dumps([X0W, Z0W, X1W, Z1W])};\n'
out += f'export const SHORE_N = {json.dumps(r(N))};   // west → east\n'
out += f'export const SHORE_S = {json.dumps(r(S))};   // south edge → around Mill Point → east\n'
out += f'export const HEIRISSON = {json.dumps(r(heir))};\n'
out += f'export const EQ_ISLAND = {json.dumps(r(isl))};\n'
open('/home/claude/perth/src/osm_land.js', 'w').write(out); print(len(out))
