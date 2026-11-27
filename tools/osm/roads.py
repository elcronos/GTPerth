import json, numpy as np, cv2
from skimage.morphology import skeletonize
g = json.load(open('world_grid.json')); X0W, Z0W, GW, GH = g['X0W'], g['Z0W'], g['GW'], g['GH']
RGB = np.load('world_rgb.npy').astype(np.int16); LEVEL = np.load('world_level.npy')
land = cv2.imread('land_mask.png', 0) > 0
def near(c, tol=4): return (np.abs(RGB[:, :, 0] - c[0]) <= tol) & (np.abs(RGB[:, :, 1] - c[1]) <= tol) & (np.abs(RGB[:, :, 2] - c[2]) <= tol)
CLASSES = [  # name, colours, width m, lanes, min px width
  ('trunk', [(249, 178, 156)], 16, 4),
  ('primary', [(252, 214, 164)], 14, 4),
  ('secondary', [(247, 250, 191)], 12, 2),
  ('minor', [(255, 255, 255)], 9, 2),
]
N8 = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
def trace(sk):
    H, W = sk.shape; ys, xs = np.nonzero(sk); S = set(zip(ys.tolist(), xs.tolist()))
    def nb(p): return [(p[0] + dy, p[1] + dx) for dy, dx in N8 if (p[0] + dy, p[1] + dx) in S]
    deg = {p: len(nb(p)) for p in S}
    nodes = {p for p, d in deg.items() if d != 2}
    seen = set(); paths = []
    for n0 in nodes:
        for nx in nb(n0):
            e = (n0, nx) if n0 < nx else (nx, n0)
            if (n0, nx) in seen: continue
            path = [n0, nx]; seen.add((n0, nx)); seen.add((nx, n0)); prev, cur = n0, nx
            while cur not in nodes:
                nxt = [q for q in nb(cur) if q != prev and (cur, q) not in seen]
                if not nxt: break
                q = nxt[0]; seen.add((cur, q)); seen.add((q, cur)); path.append(q); prev, cur = cur, q
            paths.append(path)
    return paths
out = []
for name, cols, w, lanes in CLASSES:
    m = np.zeros(RGB.shape[:2], bool)
    for c in cols: m |= near(c)
    m &= land
    m8 = m.astype(np.uint8) * 255
    k = 3 if name == 'minor' else 5
    m8 = cv2.morphologyEx(m8, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))
    m8 = cv2.morphologyEx(m8, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    # a road must be at least ~4 m wide (drops label halos, hairlines)
    dist = cv2.distanceTransform(m8, cv2.DIST_L2, 3)
    core = (dist >= (2.0 if name == 'minor' else 2.5)).astype(np.uint8) * 255
    core = cv2.dilate(core, np.ones((3, 3), np.uint8)) & m8
    sk = skeletonize(core > 0)
    paths = trace(sk)
    kept = 0
    for p in paths:
        if len(p) < 25: continue
        arr = np.array([[x, y] for y, x in p], np.float32).reshape(-1, 1, 2)
        ap = cv2.approxPolyDP(arr, 1.6, False)[:, 0, :]
        pts = [[round(X0W + float(x) + 0.5, 1), round(Z0W + float(y) + 0.5, 1)] for x, y in ap]
        L = sum(((pts[i][0] - pts[i - 1][0]) ** 2 + (pts[i][1] - pts[i - 1][1]) ** 2) ** 0.5 for i in range(1, len(pts)))
        if L < 30: continue
        out.append({'cls': name, 'w': w, 'lanes': lanes, 'pts': pts}); kept += 1
    print(name, 'paths', len(paths), 'kept', kept)
json.dump(out, open('roads.json', 'w'))
# preview
pv = cv2.imread('world_small.jpg')
colmap = {'trunk': (0, 0, 255), 'primary': (0, 140, 255), 'secondary': (0, 200, 0), 'minor': (255, 0, 0)}
for r in out:
    P = np.array([[(x - X0W) / 4, (z - Z0W) / 4] for x, z in r['pts']], np.int32)
    cv2.polylines(pv, [P], False, colmap[r['cls']], 1)
cv2.imwrite('roads_preview.jpg', pv)
