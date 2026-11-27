import json, numpy as np, cv2
g = json.load(open('world_grid.json')); X0W, Z0W, GW, GH = g['X0W'], g['Z0W'], g['GW'], g['GH']
RGB = np.load('world_rgb.npy').astype(np.int16); LEVEL = np.load('world_level.npy')
def near(c, tol=3): return (np.abs(RGB[:, :, 0] - c[0]) <= tol) & (np.abs(RGB[:, :, 1] - c[1]) <= tol) & (np.abs(RGB[:, :, 2] - c[2]) <= tol)
fill = (near((217, 208, 201)) | near((213, 203, 196))) & (LEVEL >= 17)
m = fill.astype(np.uint8) * 255
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))   # icons / text inside buildings
m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((2, 2), np.uint8))
nl, lab, st, cen = cv2.connectedComponentsWithStats(m, connectivity=4)
out = []
for i in range(1, nl):
    a = st[i, 4]
    if a < 45: continue
    x0, y0, w, h = st[i, :4]
    sub = (lab[y0:y0 + h, x0:x0 + w] == i).astype(np.uint8) * 255
    sub = cv2.copyMakeBorder(sub, 2, 2, 2, 2, cv2.BORDER_CONSTANT, 0)
    cs, _ = cv2.findContours(sub, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cs, key=cv2.contourArea)
    # outlines are drawn ~1 m inside: grow the footprint back by 1 m
    eps = 1.0 if a < 400 else 1.5
    ap = cv2.approxPolyDP(c, eps, True)[:, 0, :].astype(float)
    if len(ap) < 3: continue
    cx, cy = ap[:, 0].mean(), ap[:, 1].mean()
    v = ap - [cx, cy]; L = np.linalg.norm(v, axis=1, keepdims=True) + 1e-6; ap = ap + v / L * 0.9
    pts = [[round(X0W + x - 2 + x0 + 0.5, 1), round(Z0W + y - 2 + y0 + 0.5, 1)] for x, y in ap]
    out.append({'a': int(a), 'c': [round(X0W + cen[i][0] + 0.5, 1), round(Z0W + cen[i][1] + 0.5, 1)], 'pts': pts})
print('buildings', len(out), 'total area', sum(o['a'] for o in out))
json.dump(out, open('buildings.json', 'w'))
pv = cv2.imread('world_small.jpg')
for o in out:
    P = np.array([[(x - X0W) / 4, (z - Z0W) / 4] for x, z in o['pts']], np.int32); cv2.polylines(pv, [P], True, (0, 0, 255), 1)
cv2.imwrite('buildings_preview.jpg', pv)
