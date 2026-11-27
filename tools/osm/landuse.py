import json, numpy as np, cv2, base64
g = json.load(open('world_grid.json')); X0W, Z0W, GW, GH = g['X0W'], g['Z0W'], g['GW'], g['GH']
RGB = np.load('world_rgb.npy').astype(np.int16)
def near(c, tol=5): return (np.abs(RGB[:, :, 0] - c[0]) <= tol) & (np.abs(RGB[:, :, 1] - c[1]) <= tol) & (np.abs(RGB[:, :, 2] - c[2]) <= tol)
lawn = near((200, 250, 204)) | near((205, 235, 176)) | near((170, 224, 203)) | near((223, 252, 226)) | near((222, 246, 192)) | near((236, 237, 207))
bush = near((173, 209, 158)) | near((200, 215, 171)) | near((214, 217, 159))
sand = near((255, 241, 186)) | near((240, 229, 199))
land = cv2.imread('land_mask.png', 0) > 0
pond = near((170, 211, 223)) & land
lawn |= pond
resid = near((224, 223, 223), 3)
lawn |= resid   # residential landuse: gardens between the houses
def clean(m, k):
    m = m.astype(np.uint8) * 255
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((k, k), np.uint8))   # fill label text / icons
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    return m
L, B, S = clean(lawn, 9), clean(bush, 9), clean(sand, 5)
mask = np.dstack([L, B, S])  # RGB = lawn, bush, sand
small = cv2.resize(mask, (2048, 2048), interpolation=cv2.INTER_AREA)
ok, png = cv2.imencode('.png', small[:, :, ::-1], [cv2.IMWRITE_PNG_COMPRESSION, 9])
print('png', len(png))
cv2.imwrite('ground_mask_preview.jpg', cv2.resize(small, (1024, 1024))[:, :, ::-1])
b64 = base64.b64encode(png.tobytes()).decode()
open('/home/claude/perth/src/assets/osm_mask.js', 'w').write(
  '// Ground cover mask from OpenStreetMap landuse (© OpenStreetMap contributors, ODbL): R lawn/park, G bush/wood, B sand.\n'
  f'export const OSM_MASK = {{ x0: {X0W}, z0: {Z0W}, size: {GW}, px: 2048, png: "data:image/png;base64,{b64}" }};\n')
