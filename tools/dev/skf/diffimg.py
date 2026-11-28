import numpy as np, json
from PIL import Image, ImageDraw, ImageFont
G = json.load(open('/home/claude/skf/work/roof.json')); W, H = G['W'], G['H']; box = G['box']
M = np.fromfile('/home/claude/skf/work/roof.bin', dtype=np.float32).reshape(H, W)
Gm = np.fromfile('/home/claude/skf/work/game.bin', dtype=np.float32).reshape(H, W)
x0, x1, z0, z1 = -750, 950, -1300, 250
i0, i1, j0, j1 = int(x0 - box[0]), int(x1 - box[0]), int(z0 - box[1]), int(z1 - box[1])
m = M[j0:j1, i0:i1]; g = Gm[j0:j1, i0:i1]
d = m - g; unk = np.abs(m - 20) < 0.01
img = np.full(m.shape + (3,), 24, np.uint8)
both = (m > 0) | (g > 0)
agree = both & (np.abs(d) <= 8)
img[agree] = (110, 110, 110)
red = both & (d > 8) & ~unk; blue = both & (d < -8) & (g > 0); grey = both & unk & ~agree
img[grey] = (70, 70, 70)
t = np.clip(d / 60, 0, 1); img[red] = np.stack([200 + 55 * t, 60 - 40 * t, 40 - 30 * t], -1)[red].astype(np.uint8)
t = np.clip(-d / 60, 0, 1); img[blue] = np.stack([40 - 30 * t, 120 + 60 * t, 200 + 55 * t], -1)[blue].astype(np.uint8)
im = Image.fromarray(img).resize((m.shape[1] * 3 // 4, m.shape[0] * 3 // 4), Image.LANCZOS)
dr = ImageDraw.Draw(im)
try: F = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 15); Fs = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf', 13)
except: F = Fs = ImageFont.load_default()
P = lambda x, z: ((x - x0) * 0.75, (z - z0) * 0.75)
labels = [(-33, -607, 'Central Park 237 m (model: podium only)'), (238, -227, 'Chevron HQ 133 m (new)'), (-55, -120, 'EQ West 186/100 m (new)'), (160, -249, 'Nine The Esplanade (new)'),
          (190, -80, 'Ritz / The Towers (old outlines)'), (435, -435, 'David Malcolm Justice Centre 149 m (fixed)'), (500, -560, 'Equus 110 m (fixed)'), (-379, -718, '240 St Georges Tce'),
          (168, -996, 'ECU City (new)'), (-559, -590, 'Mia Yellagonga T1 (fixed)')]
for x, z, s in labels:
    px, pz = P(x, z); dr.ellipse([px - 4, pz - 4, px + 4, pz + 4], outline=(255, 255, 255), width=2); dr.text((px + 7, pz - 8), s, fill=(255, 255, 255), font=Fs, stroke_width=2, stroke_fill=(0, 0, 0))
dr.rectangle([0, 0, im.width, 58], fill=(12, 12, 14))
dr.text((10, 6), 'Perth CBD roof heights: Sketchfab GIS model vs Grand Theft Perth (1 px = 1.33 m, north up)', fill=(240, 240, 240), font=F)
for k, (c, s) in enumerate([((235, 40, 20), 'model taller (missing/low in game)'), ((20, 170, 250), 'game taller (newer, or levels x 3.6 m vs 3.0 m)'), ((110, 110, 110), 'agree within 8 m'), ((70, 70, 70), 'model default 20 m (no data)')]):
    x = 10 + k * 290; dr.rectangle([x, 34, x + 14, 48], fill=c); dr.text((x + 20, 33), s, fill=(220, 220, 220), font=Fs)
im.save('/home/claude/skf/height_compare.png'); print(im.size)
