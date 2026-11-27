# Build georeferenced world data for Grand Theft Perth from OpenStreetMap standard tiles (© OpenStreetMap
# contributors, ODbL). Frame: x east, z south (metres), origin EQ Bridge midpoint.
import json, math, numpy as np, cv2
LAT0, LON0 = -31.95922, 115.85587
X0W, Z0W, X1W, Z1W, RES = -2000, -1800, 2100, 2300, 1.0          # world grid (1 m)
GW, GH = int((X1W - X0W) / RES), int((Z1W - Z0W) / RES)
xs = X0W + (np.arange(GW) + 0.5) * RES; zs = Z0W + (np.arange(GH) + 0.5) * RES
LON = LON0 + xs / 94430; LAT = LAT0 - zs / 110950
def src(tag):
    m = json.load(open(f'mosaic{tag}.json')); n = 2 ** m['z'] * 256
    im = cv2.imread(f'mosaic{tag}.png')[:, :, ::-1]
    px = ((LON + 180) / 360 * n - m['X0'] * 256)
    lr = np.radians(LAT); py = ((1 - np.log(np.tan(lr) + 1 / np.cos(lr)) / math.pi) / 2 * n - m['Y0'] * 256)
    return im, px, py
def sample(tag):   # → world-grid RGB image + validity
    im, px, py = src(tag)
    PX, PY = np.meshgrid(px, py)
    valid = (PX >= 0) & (PY >= 0) & (PX < im.shape[1] - 1) & (PY < im.shape[0] - 1)
    mapx = PX.astype(np.float32); mapy = PY.astype(np.float32)
    out = cv2.remap(im, mapx, mapy, cv2.INTER_NEAREST, borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0))
    return out, valid
RGB = np.zeros((GH, GW, 3), np.uint8); HAVE = np.zeros((GH, GW), bool); LEVEL = np.zeros((GH, GW), np.uint8)
for tag, lv in [('16', 16), ('cbd17', 17), ('sp17', 17), ('eq18', 18)]:
    im, v = sample(tag)
    RGB[v] = im[v]; HAVE |= v; LEVEL[v] = lv
    print('sampled', tag, v.sum())
np.save('world_rgb.npy', RGB); np.save('world_level.npy', LEVEL)
cv2.imwrite('world_rgb.png', RGB[:, :, ::-1])
small = cv2.resize(RGB[:, :, ::-1], (GW // 4, GH // 4), interpolation=cv2.INTER_AREA); cv2.imwrite('world_small.jpg', small)
json.dump({'X0W': X0W, 'Z0W': Z0W, 'RES': RES, 'GW': GW, 'GH': GH}, open('world_grid.json', 'w'))
