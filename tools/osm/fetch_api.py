import subprocess, os, time
lat0, lat1, lon0, lon1 = -31.976, -31.946, 115.838, 115.874
NY, NX = 6, 7
for j in range(NY):
    for i in range(NX):
        a = lat0 + (lat1 - lat0) * j / NY; b = lat0 + (lat1 - lat0) * (j + 1) / NY
        c = lon0 + (lon1 - lon0) * i / NX; d = lon0 + (lon1 - lon0) * (i + 1) / NX
        f = f'api/t_{j}_{i}.osm'
        if os.path.exists(f) and os.path.getsize(f) > 1000: continue
        url = f'https://api.openstreetmap.org/api/0.6/map?bbox={c:.6f},{a:.6f},{d:.6f},{b:.6f}'
        r = subprocess.run(['curl', '-sS', '-m', '120', '-A', 'GrandTheftPerth-fanproject/1.0 (one-off import)', '-o', f, '-w', '%{http_code}', url], capture_output=True, text=True)
        print(j, i, r.stdout, os.path.getsize(f) if os.path.exists(f) else 0, r.stderr[:100], flush=True)
        time.sleep(1.0)
