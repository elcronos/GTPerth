import json, numpy as np, cv2, base64, math
g = json.load(open('world_grid.json')); X0W, Z0W, GW, GH = g['X0W'], g['Z0W'], g['GW'], g['GH']
mask = cv2.imread('ground_mask_full.png') if False else None
RGB = np.load('world_rgb.npy').astype(np.int16)
def near(c, tol=5): return (np.abs(RGB[:, :, 0] - c[0]) <= tol) & (np.abs(RGB[:, :, 1] - c[1]) <= tol) & (np.abs(RGB[:, :, 2] - c[2]) <= tol)
land = cv2.imread('land_mask.png', 0) > 0
green = near((173, 209, 158)) | near((200, 250, 204)) | near((205, 235, 176)) | near((200, 215, 171)) | near((170, 224, 203))
S = 4  # work at 4 m
gs = cv2.resize(green.astype(np.uint8) * 255, (GW // S, GH // S), interpolation=cv2.INTER_AREA)
ls = cv2.resize(land.astype(np.uint8) * 255, (GW // S, GH // S), interpolation=cv2.INTER_AREA) > 127
gs = cv2.morphologyEx(gs, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8)) > 100
xs = X0W + (np.arange(GW // S) + 0.5) * S; zs = Z0W + (np.arange(GH // S) + 0.5) * S
XX, ZZ = np.meshgrid(xs, zs)
region = gs & ls & (XX < -640) & (ZZ < 700)
nl, lab = cv2.connectedComponents(region.astype(np.uint8))
cnt = np.bincount(lab.ravel()); cnt[0] = 0; seed = int(np.argmax(cnt)); print('kp seed', seed, cnt[seed] * S * S, 'm2')
kp = (lab == seed)
# Mount Eliza is a plateau: fill holes (buildings, car parks inside the park), then the escarpment falls to Mounts Bay Rd
kp8 = kp.astype(np.uint8) * 255
cs, _ = cv2.findContours(kp8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE); kpf = np.zeros_like(kp8); cv2.drawContours(kpf, cs, -1, 255, -1)
# the plateau also continues under West Perth to the north (the land keeps its height away from the river):
d = cv2.distanceTransform(kpf, cv2.DIST_L2, 5) * S
# distance to the river (water) for the escarpment side
dw = cv2.distanceTransform(ls.astype(np.uint8) * 255, cv2.DIST_L2, 5) * S
def sst(a, b, x): t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
n = np.sin(XX * 0.021) * np.cos(ZZ * 0.017) * 3 + np.sin(XX * 0.07 + ZZ * 0.05) * 1.2
H = (55 + n) * sst(0, 120, d) * sst(25, 140, dw)
# West Perth / Kings Park Road side: high ground persists north of the park (smooth blend towards the CBD rise)
kpH = cv2.GaussianBlur(H.astype(np.float32), (0, 0), 6)
H = np.maximum(H, kpH * 0.9)
hm = np.clip(H / 0.3, 0, 255).astype(np.uint8)
out = cv2.resize(hm, (512, 512), interpolation=cv2.INTER_AREA)
ok, png = cv2.imencode('.png', out); print('kp height png', len(png), 'max', H.max())
cv2.imwrite('kp_height_preview.png', out)
b64 = base64.b64encode(out.tobytes()).decode()
open('/home/claude/perth/src/assets/osm_height.js', 'w').write(
  '// Mount Eliza (Kings Park) terrain: plateau = the park as mapped in OpenStreetMap (© OpenStreetMap contributors),\n'
  '// escarpment falling to Mounts Bay Road. 512x512 uint8, 0.3 m per step, over OSM_BOUNDS.\n'
  f'export const KP_HEIGHT = {{ x0: {X0W}, z0: {Z0W}, size: {GW}, n: 512, step: 0.3, data: "{b64}" }};\n')
