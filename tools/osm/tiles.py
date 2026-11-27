import math, os, sys, time, subprocess
from PIL import Image
def t(lat, lon, z):
    n = 2 ** z; x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y
z = int(sys.argv[1]); lat0, lat1, lon0, lon1 = [float(v) for v in sys.argv[2:6]] if len(sys.argv) > 5 else (-31.946, -31.977, 115.836, 115.876)
x0, y0 = t(lat0, lon0, z); x1, y1 = t(lat1, lon1, z)
X0, Y0, X1, Y1 = int(x0), int(y0), int(x1), int(y1)
os.makedirs(f'z{z}', exist_ok=True)
for ty in range(Y0, Y1 + 1):
    for tx in range(X0, X1 + 1):
        f = f'z{z}/{tx}_{ty}.png'
        if os.path.exists(f) and os.path.getsize(f) > 100: continue
        subprocess.run(['curl', '-s', '-m', '30', '-A', 'GrandTheftPerth-fanproject/1.0 (personal, one-off)', '-o', f, f'https://tile.openstreetmap.org/{z}/{tx}/{ty}.png'])
        time.sleep(0.3)
W, H = (X1 - X0 + 1) * 256, (Y1 - Y0 + 1) * 256
im = Image.new('RGB', (W, H))
for ty in range(Y0, Y1 + 1):
    for tx in range(X0, X1 + 1):
        try: im.paste(Image.open(f'z{z}/{tx}_{ty}.png').convert('RGB'), ((tx - X0) * 256, (ty - Y0) * 256))
        except Exception as e: print('bad', tx, ty, e)
tag = sys.argv[6] if len(sys.argv) > 6 else str(z)
im.save(f'mosaic{tag}.png'); print(W, H, X0, Y0, X1, Y1)
open(f'mosaic{tag}.json','w').write(f'{{"z":{z},"X0":{X0},"Y0":{Y0},"W":{W},"H":{H}}}')
