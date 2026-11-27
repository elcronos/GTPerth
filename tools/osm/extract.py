import json, math, numpy as np, cv2
g = json.load(open('world_grid.json')); X0W, Z0W, RES, GW, GH = g['X0W'], g['Z0W'], g['RES'], g['GW'], g['GH']
RGB = np.load('world_rgb.npy').astype(np.int16); LEVEL = np.load('world_level.npy')
def near(c, tol=6): return (np.abs(RGB[:, :, 0] - c[0]) <= tol) & (np.abs(RGB[:, :, 1] - c[1]) <= tol) & (np.abs(RGB[:, :, 2] - c[2]) <= tol)
W2 = lambda px, py: [round(X0W + (px + 0.5) * RES, 1), round(Z0W + (py + 0.5) * RES, 1)]
# ---------------- water / land
water = near((170, 211, 223), 8).astype(np.uint8) * 255
water = cv2.morphologyEx(water, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
nl, lab, st, _ = cv2.connectedComponentsWithStats(water)
keep = [i for i in range(1, nl) if st[i, 4] > 150000]
water = np.where(np.isin(lab, keep), 255, 0).astype(np.uint8)
land = 255 - water
# cut the Narrows Bridge deck (drawn over the river) so the banks separate
cut = np.zeros_like(land)
def gp(x, z): return (int((x - X0W) / RES), int((z - Z0W) / RES))
cv2.line(cut, gp(-905, 262), gp(-806, 640), 255, 70)
wd = cv2.dilate(water, np.ones((121, 121), np.uint8))
land[(cut > 0) & (wd > 0)] = 0
land = cv2.morphologyEx(land, cv2.MORPH_OPEN, np.ones((7, 7), np.uint8))   # drop thin lines drawn on the water (boundaries, routes)
# Barrack Street jetties are timber piers on piles (modelled separately): strip them from the land
zx0, zz0 = gp(90, 48); zx1, zz1 = gp(300, 160)
sub = land[zz0:zz1, zx0:zx1]
land[zz0:zz1, zx0:zx1] = cv2.morphologyEx(sub, cv2.MORPH_OPEN, np.ones((21, 21), np.uint8))
cv2.imwrite('land_mask.png', land)
nl, lab, st, _ = cv2.connectedComponentsWithStats(land)
polys = []
for i in range(1, nl):
    if st[i, 4] < 800: continue
    m = np.where(lab == i, 255, 0).astype(np.uint8)
    cs, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); c = max(cs, key=cv2.contourArea)
    c = cv2.approxPolyDP(c, 1.3, True)[:, 0, :]
    x0, y0, w, h = st[i, :4]
    polys.append({'area': int(st[i, 4]), 'pts': [W2(float(x), float(y)) for x, y in c], 'touch': [bool(x0 == 0), bool(y0 == 0), bool(x0 + w >= GW), bool(y0 + h >= GH)], 'bbox': [W2(x0, y0), W2(x0 + w, y0 + h)]})
polys.sort(key=lambda p: -p['area'])
for p in polys: print('land', p['area'], p['touch'], p['bbox'], len(p['pts']))
json.dump(polys, open('land_polys.json', 'w'))
