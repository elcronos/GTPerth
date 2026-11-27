#!/usr/bin/env python3
"""Per-round frame metrics: frame luma, player-box luma, saturation, palette distance to the bible hour keyframe."""
import json, sys, subprocess, os
import numpy as np
from PIL import Image
d = sys.argv[1]
rows = json.load(open(os.path.join(d, 'shots.json')))
bible = 'docs/look/look-bible.json'
hours = [t['hour'] for t in json.load(open(bible))['palette']['timeOfDay']]
out = []
for r in rows:
    im = np.asarray(Image.open(r['file']).convert('RGB')).astype(np.float32)
    H, W = im.shape[:2]
    luma = 0.2126 * im[..., 0] + 0.7152 * im[..., 1] + 0.0722 * im[..., 2]
    mx, mn = im.max(-1), im.min(-1); sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)
    m = {'id': r['id'], 'luma': round(float(luma.mean()), 1), 'luma_p5': round(float(np.percentile(luma, 5)), 1),
         'luma_p95': round(float(np.percentile(luma, 95)), 1), 'sat': round(float(sat.mean()), 3), 'tris': r['stats'].get('tris'), 'calls': r['stats'].get('calls')}
    p = r.get('player')
    if p and 0 < p['x'] < 1 and 0 < p['yt'] < 1:
        x0, x1 = int((p['x'] - 0.02) * W), int((p['x'] + 0.02) * W); y0, y1 = int(p['yt'] * H), int(p['yb'] * H)
        if y1 > y0 and x1 > x0: m['player_luma'] = round(float(luma[y0:y1, x0:x1].mean()), 1); m['player_x'] = round(p['x'], 3); m['player_h_pct'] = round(100 * (p['yb'] - p['yt']), 1)
    hr = min(hours, key=lambda h: abs(h - r['hour']))
    try:
        res = subprocess.run(['python3', 'tools/qa/frame_metrics.py', 'palette-distance', r['file'], '--bible', bible, '--hour', str(hr)], capture_output=True, text=True)
        m['paletteDE'] = json.loads(res.stdout).get('meanDeltaE76') if res.stdout.strip().startswith('{') else res.stdout.strip()[:80]
    except Exception as e: m['paletteDE'] = str(e)[:60]
    out.append(m)
json.dump(out, open(os.path.join(d, 'metrics.json'), 'w'), indent=1)
for m in out: print(m)
