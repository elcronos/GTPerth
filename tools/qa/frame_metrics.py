#!/usr/bin/env python3
"""Frame metrics for 3D look-dev QA (generic). Needs Pillow and numpy.

Subcommands
  palette  <img> [--k 10]                          k-means palette with area shares (hex, share)
  luma     <img> [--box name=x,y,w,h ...]          Rec.709 mean luma (0-255) for the frame and boxes (CSS px * dpr)
  contrast <img> --text x,y,w,h [--bg x,y,w,h]     WCAG-style contrast of the text box vs its surround
  flicker  <a.png> <b.png> [--thresh 40]           fraction of pixels that changed strongly between a 1 cm camera pair
  diff     <golden.png> <new.png>                  structural similarity (block SSIM) + mean luma delta
  palette-distance <img> --bible look-bible.json [--hour 14]   mean CIE76 dE from frame palette to bible palette
  composition <img> --focal x,y,w,h [--player x,y,w,h]  focal height %, player x fraction, sky fraction (heuristic)
  check    <shots.jsonl> --bible look-bible.json [--golden DIR] [--json out.json]
           runs luma floors, composition, palette distance, flicker and golden diffs for every shot in a
           shot-matrix index and exits 1 on any failure. Boxes come from shots.jsonl `boxes` (projected by the
           game hook), thresholds from the bible `qa` block (defaults below).

Defaults (override in look-bible.json -> qa): player luma >= 40, path luma >= 45, interior-night luma >= 35,
flicker fraction <= 0.002, golden SSIM >= 0.92, golden luma delta <= 8, palette dE <= 18, text contrast
>= 4.5, phone text height >= 12 css px, emissive lamp to nearest light source <= 1.5 m.
"""
import argparse
import json
import math
import os
import sys

import numpy as np
from PIL import Image

DEFAULT_QA = {
    "luma_floor": {"player": 40, "path": 45, "interior": 35},
    "flicker_max_fraction": 0.002,
    "flicker_pixel_thresh": 40,
    "golden_ssim_min": 0.92,
    "golden_luma_delta_max": 8,
    "palette_de_max": 18,
    "contrast_min": 4.5,
    "text_min_css_px": 12,
    "phone_profiles": ["phone"],
    "dusk_vs_midnight_margin": 2,
    "player_luma_neighbour_drop": 0.30,
    "lamp_max_source_dist_m": 1.5,
}


def load(path, size=None):
    im = Image.open(path).convert("RGB")
    if size:
        im = im.resize(size, getattr(Image, 'Resampling', Image).BILINEAR)
    return np.asarray(im).astype(np.float32)


def luma(arr):
    return 0.2126 * arr[..., 0] + 0.7152 * arr[..., 1] + 0.0722 * arr[..., 2]


def crop(arr, box, scale=1.0):
    x, y, w, h = [int(round(v * scale)) for v in box]
    H, W = arr.shape[:2]
    x0, y0 = max(0, x), max(0, y)
    x1, y1 = min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return None
    return arr[y0:y1, x0:x1]


def parse_box(s):
    return [float(v) for v in s.split(",")]


def kmeans_palette(arr, k=10, iters=12, seed=0):
    px = arr.reshape(-1, 3)
    rng = np.random.default_rng(seed)
    if len(px) > 40000:
        px = px[rng.choice(len(px), 40000, replace=False)]
    cent = px[rng.choice(len(px), k, replace=False)]
    for _ in range(iters):
        d = ((px[:, None, :] - cent[None, :, :]) ** 2).sum(-1)
        lab = d.argmin(1)
        for i in range(k):
            m = px[lab == i]
            if len(m):
                cent[i] = m.mean(0)
    shares = np.bincount(lab, minlength=k) / len(lab)
    order = np.argsort(-shares)
    return [("#%02x%02x%02x" % tuple(int(c) for c in cent[i]), float(shares[i])) for i in order]


def srgb_to_lab(rgb):
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)


def hex_to_rgb(h):
    h = h.lstrip("#")
    return [int(h[i:i + 2], 16) for i in (0, 2, 4)]


def bible_palette(bible, hour=None):
    """Day palette when hour is None; the keyframe palette for that hour, or None when no keyframe at
    that hour has colors (falling back to the day palette would fail every dusk and night shot)."""
    pal = bible.get("palette", {})
    if hour is None:
        return [c["hex"] for c in pal.get("colors", [])]
    for kf in pal.get("timeOfDay", []):
        if kf.get("hour") == hour and kf.get("colors"):
            return [c["hex"] if isinstance(c, dict) else c for c in kf["colors"]]
    return None


def palette_distance(arr, bible_hexes, k=8):
    if not bible_hexes:
        return None
    frame = kmeans_palette(arr, k)
    fl = srgb_to_lab([hex_to_rgb(h) for h, _ in frame])
    bl = srgb_to_lab([hex_to_rgb(h) for h in bible_hexes])
    d = np.sqrt(((fl[:, None, :] - bl[None, :, :]) ** 2).sum(-1)).min(1)
    w = np.array([s for _, s in frame])
    return float((d * w).sum() / w.sum())


def rel_lum(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.03928, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return 0.2126 * c[..., 0] + 0.7152 * c[..., 1] + 0.0722 * c[..., 2]


def contrast(arr, text_box, bg_box=None, scale=1.0):
    t = crop(arr, text_box, scale)
    if t is None:
        return None
    if bg_box:
        b = crop(arr, bg_box, scale).reshape(-1, 3)
    else:
        # ring of `pad` px around the text box (excludes the box itself)
        pad = 12
        x, y, w, h = [int(round(v * scale)) for v in text_box]
        H, W = arr.shape[:2]
        x0, y0, x1, y1 = max(0, x - pad), max(0, y - pad), min(W, x + w + pad), min(H, y + h + pad)
        region = arr[y0:y1, x0:x1]
        mask = np.ones(region.shape[:2], bool)
        mask[max(0, y - y0):max(0, y - y0) + h, max(0, x - x0):max(0, x - x0) + w] = False
        b = region[mask]
        if b.size == 0:
            return None
    lt = rel_lum(t.reshape(-1, 3))
    # text = darkest or brightest decile depending on the background
    lb = float(np.median(rel_lum(b)))
    lt_val = float(np.percentile(lt, 10 if lb > 0.5 else 90))
    hi, lo = max(lt_val, lb), min(lt_val, lb)
    return (hi + 0.05) / (lo + 0.05)


def flicker(a, b, thresh=40):
    if a.shape != b.shape:
        return None
    d = np.abs(luma(a) - luma(b))
    return float((d > thresh).mean())


def ssim_blocks(a, b, block=8):
    ga, gb = luma(a), luma(b)
    H, W = ga.shape
    H, W = H - H % block, W - W % block
    ga, gb = ga[:H, :W], gb[:H, :W]
    sh = (H // block, block, W // block, block)
    A, B = ga.reshape(sh), gb.reshape(sh)
    ma, mb = A.mean((1, 3)), B.mean((1, 3))
    va, vb = A.var((1, 3)), B.var((1, 3))
    cov = ((A - ma[:, None, :, None]) * (B - mb[:, None, :, None])).mean((1, 3))
    c1, c2 = (0.01 * 255) ** 2, (0.03 * 255) ** 2
    s = ((2 * ma * mb + c1) * (2 * cov + c2)) / ((ma ** 2 + mb ** 2 + c1) * (va + vb + c2))
    return float(s.mean()), float(abs(ga.mean() - gb.mean()))


def sky_fraction(arr):
    g = luma(arr)
    gy = np.abs(np.diff(g, axis=0, prepend=g[:1]))
    gx = np.abs(np.diff(g, axis=1, prepend=g[:, :1]))
    smooth = (gx + gy) < 3.0
    top = np.zeros_like(smooth)
    top[: g.shape[0] // 2] = True
    bright = g > np.median(g)
    return float((smooth & top & bright).mean())


def composition(arr, focal=None, player=None, scale=1.0):
    H, W = arr.shape[:2]
    out = {"skyFraction": round(sky_fraction(arr), 3)}
    if focal:
        out["focalHeightPct"] = round(100 * focal[3] * scale / H, 1)
    if player:
        out["playerX"] = round((player[0] + player[2] / 2) * scale / W, 3)
    return out


def box_list(b):
    return [b["x"], b["y"], b["w"], b["h"]] if b else None


def brightest_is_focal(arr, focal, scale=1.0):
    """Focal box mean luma vs the 95th-percentile luma of the rest of the frame."""
    g = luma(arr)
    x, y, w, h = [int(round(v * scale)) for v in focal]
    H, W = g.shape
    x0, y0, x1, y1 = max(0, x), max(0, y), min(W, x + w), min(H, y + h)
    if x1 <= x0 or y1 <= y0:
        return None, None, None
    mask = np.ones(g.shape, bool)
    mask[y0:y1, x0:x1] = False
    focal_mean = float(g[y0:y1, x0:x1].mean())
    rest_p95 = float(np.percentile(g[mask], 95)) if mask.any() else 0.0
    return focal_mean >= rest_p95, round(focal_mean, 1), round(rest_p95, 1)


def lamp_orphans(entry, max_dist):
    """Accepts a lampAudit list of {name, worldPos, nearestSourceDist} or a dict with `orphans` / `lamps`."""
    if isinstance(entry, dict):
        if "orphans" in entry:
            return list(entry["orphans"] or [])
        entry = entry.get("lamps", [])
    out = []
    for lamp in entry or []:
        d = lamp.get("nearestSourceDist")
        if lamp.get("orphan") or d is None or d > max_dist:
            out.append(lamp)
    return out


def is_phone(s, qa):
    prof = str(s.get("profile", ""))
    return prof in qa["phone_profiles"] or "phone" in prof.lower()


def time_order_checks(report, qa, fails):
    """Dusk/night must not be darker than midnight; luma_player must not dip > N % below its neighbours."""
    groups = {}
    for r in report:
        if r.get("time") is None:
            continue
        key = (r.get("view"), r.get("profile"), r.get("tier"), r.get("state"))
        groups.setdefault(key, {})[r["time"]] = r
    margin = qa["dusk_vs_midnight_margin"]
    drop = qa["player_luma_neighbour_drop"]
    for key, by_h in groups.items():
        tag = "/".join(str(k) for k in key)
        mid = by_h.get(0)
        if mid is not None:
            for h in (18, 21):
                if h in by_h and by_h[h]["lumaFrame"] < mid["lumaFrame"] - margin:
                    fails.append(f"{tag}: hour {h} lumaFrame {by_h[h]['lumaFrame']} darker than midnight {mid['lumaFrame']} (margin {margin})")
        hours = sorted(h for h in by_h if "luma_player" in by_h[h])
        if len(hours) < 3:
            continue
        for i, h in enumerate(hours):
            nb = [hours[(i - 1) % len(hours)], hours[(i + 1) % len(hours)]]
            ref = min(by_h[n]["luma_player"] for n in nb)  # a dip below both neighbours (hours wrap around)
            v = by_h[h]["luma_player"]
            if ref > 0 and v < ref * (1 - drop):
                fails.append(f"{tag}: hour {h} luma_player {v} is > {int(drop * 100)}% below both neighbours {nb} (lower {ref:.1f})")


def cmd_check(args):
    bible = json.load(open(args.bible))
    qa = {**DEFAULT_QA, **bible.get("qa", {})}
    floors = {**DEFAULT_QA["luma_floor"], **qa.get("luma_floor", {})}
    comp = bible.get("composition", {})
    report, fails, lamp_rows = [], [], []
    for line in open(args.index):
        if not line.strip():
            continue
        s = json.loads(line)
        if s.get("lampAudit") is not None:
            lamp_rows.append(s)
        if not s.get("file"):
            continue
        arr = load(s["file"])
        scale = s.get("dpr", 1)
        r = {"id": s["id"], "view": s.get("view"), "profile": s.get("profile"), "tier": s.get("tier"),
             "state": s.get("state"), "time": s.get("time"), "lumaFrame": round(float(luma(arr).mean()), 1)}
        for name, box in (s.get("boxes") or {}).items():
            if not box:
                continue
            c = crop(arr, box_list(box), scale)
            if c is None:
                continue
            v = float(luma(c).mean())
            r[f"luma_{name}"] = round(v, 1)
            key = "interior" if name.startswith("interior") else name
            if key in floors and v < floors[key]:
                fails.append(f"{s['id']}: {name} luma {v:.1f} < {floors[key]}")
        hexes = bible_palette(bible, s.get("time"))
        if hexes is None:
            r["paletteDE"], r["paletteReason"] = None, "no keyframe"
        else:
            pd = palette_distance(arr, hexes)
            if pd is not None:
                r["paletteDE"] = round(pd, 1)
                if pd > qa["palette_de_max"]:
                    fails.append(f"{s['id']}: palette dE {pd:.1f} > {qa['palette_de_max']}")
        if s.get("view") == comp.get("view", "opening") and s.get("boxes"):
            b = s["boxes"]
            f = box_list(b.get(comp.get("focalBox", "npc")))
            c = composition(arr, f, box_list(b.get("player")), scale)
            tgt = comp.get("targets", {})
            if tgt.get("brightestIsFocal") and f:
                ok, fm, p95 = brightest_is_focal(arr, f, scale)
                c["focalLuma"], c["restP95Luma"] = fm, p95
                if ok is False:
                    fails.append(f"{s['id']}: focal mean luma {fm} < 95th-percentile luma of the rest {p95} (brightestIsFocal)")
            r["composition"] = c
            if "maxEmptySkyPct" in tgt and c["skyFraction"] * 100 > tgt["maxEmptySkyPct"]:
                fails.append(f"{s['id']}: sky {c['skyFraction']*100:.0f}% > {tgt['maxEmptySkyPct']}%")
            if "focalHeightPct" in tgt and "focalHeightPct" in c and abs(c["focalHeightPct"] - tgt["focalHeightPct"]) > tgt.get("focalTolerancePct", 8):
                fails.append(f"{s['id']}: focal height {c['focalHeightPct']}% vs target {tgt['focalHeightPct']}%")
            if "playerX" in tgt and "playerX" in c and abs(c["playerX"] - tgt["playerX"]) > tgt.get("playerXTolerance", 0.08):
                fails.append(f"{s['id']}: playerX {c['playerX']} vs target {tgt['playerX']} (tolerance {tgt.get('playerXTolerance', 0.08)})")
        text_boxes = s.get("textBoxes") or (s.get("meta") or {}).get("textBoxes") or []
        if text_boxes:
            tr = []
            for i, tb in enumerate(text_boxes):
                label = tb.get("sel") or tb.get("selector") or tb.get("name") or f"text{i}"
                cr = contrast(arr, box_list(tb), None, scale)
                tr.append({"box": label, "contrast": None if cr is None else round(cr, 2), "heightCss": tb.get("h")})
                if cr is not None and cr < qa["contrast_min"]:
                    fails.append(f"{s['id']}: text {label} contrast {cr:.2f} < {qa['contrast_min']}")
                if is_phone(s, qa) and tb.get("h", 99) < qa["text_min_css_px"]:
                    fails.append(f"{s['id']}: text {label} {tb.get('h')} css px high < {qa['text_min_css_px']} on phone")
            r["text"] = tr
        if s.get("fileB") and os.path.exists(s["fileB"]):
            fl = flicker(arr, load(s["fileB"]), qa["flicker_pixel_thresh"])
            r["flicker"] = fl
            if fl is not None and fl > qa["flicker_max_fraction"]:
                fails.append(f"{s['id']}: flicker fraction {fl:.4f} > {qa['flicker_max_fraction']}")
        if args.golden:
            g = os.path.join(args.golden, os.path.basename(s["file"]))
            if os.path.exists(g):
                ga = load(g)
                if ga.shape == arr.shape:
                    ss, dl = ssim_blocks(ga, arr)
                    r["goldenSSIM"], r["goldenLumaDelta"] = round(ss, 3), round(dl, 1)
                    if ss < qa["golden_ssim_min"] or dl > qa["golden_luma_delta_max"]:
                        fails.append(f"{s['id']}: golden ssim {ss:.3f} / luma delta {dl:.1f}")
        if s.get("errors"):
            fails.append(f"{s['id']}: console errors {len(s['errors'])}")
        report.append(r)
    time_order_checks(report, qa, fails)
    lamps = []
    lamp_errors = []
    for row in lamp_rows:
        where = row.get("id") or "/".join(str(row.get(k)) for k in ("profile", "tier", "state"))
        la = row["lampAudit"]
        if isinstance(la, dict) and la.get("ok") is None and la.get("error"):
            lamp_errors.append({"where": where, "error": la["error"]})  # audit did not run: reported, not a pass
        for o in lamp_orphans(row["lampAudit"], qa["lamp_max_source_dist_m"]):
            lamps.append({"where": where, **o})
            fails.append(f"{where}: emissive lamp {o.get('name', '?')} has no light source within "
                         f"{qa['lamp_max_source_dist_m']} m (nearest {o.get('nearestSourceDist')})")
    out = {"shots": len(report), "failures": fails, "results": report, "lampOrphans": lamps, "lampAuditErrors": lamp_errors}
    text = json.dumps(out, indent=2)
    if args.json:
        open(args.json, "w").write(text)
    print(text if not args.quiet else f"{len(report)} shots, {len(fails)} failures")
    return 1 if fails else 0


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("palette"); a.add_argument("img"); a.add_argument("--k", type=int, default=10)
    a = sub.add_parser("luma"); a.add_argument("img"); a.add_argument("--box", action="append", default=[])
    a = sub.add_parser("contrast"); a.add_argument("img"); a.add_argument("--text", required=True); a.add_argument("--bg")
    a = sub.add_parser("flicker"); a.add_argument("a"); a.add_argument("b"); a.add_argument("--thresh", type=float, default=40)
    a = sub.add_parser("diff"); a.add_argument("golden"); a.add_argument("new")
    a = sub.add_parser("palette-distance"); a.add_argument("img"); a.add_argument("--bible", required=True); a.add_argument("--hour", type=int)
    a = sub.add_parser("composition"); a.add_argument("img"); a.add_argument("--focal"); a.add_argument("--player")
    a = sub.add_parser("check"); a.add_argument("index"); a.add_argument("--bible", required=True); a.add_argument("--golden"); a.add_argument("--json"); a.add_argument("--quiet", action="store_true")
    args = p.parse_args()

    if args.cmd == "check":
        sys.exit(cmd_check(args))
    if args.cmd == "flicker":
        print(json.dumps({"flickerFraction": flicker(load(args.a), load(args.b), args.thresh)}))
        return
    if args.cmd == "diff":
        a, b = load(args.golden), load(args.new)
        if a.shape != b.shape:
            b = load(args.new, (a.shape[1], a.shape[0]))
        s, d = ssim_blocks(a, b)
        print(json.dumps({"ssim": round(s, 4), "lumaDelta": round(d, 2)}))
        return
    arr = load(args.img)
    if args.cmd == "palette":
        small = load(args.img, (256, max(1, int(256 * arr.shape[0] / arr.shape[1]))))
        print(json.dumps([{"hex": h, "share": round(s, 3)} for h, s in kmeans_palette(small, args.k)], indent=1))
    elif args.cmd == "luma":
        out = {"frame": round(float(luma(arr).mean()), 1)}
        for spec in args.box:
            name, box = spec.split("=")
            c = crop(arr, parse_box(box))
            out[name] = None if c is None else round(float(luma(c).mean()), 1)
        print(json.dumps(out))
    elif args.cmd == "contrast":
        r = contrast(arr, parse_box(args.text), parse_box(args.bg) if args.bg else None)
        print(json.dumps({"contrast": None if r is None else round(r, 2), "pass": r is not None and r >= DEFAULT_QA["contrast_min"]}))
    elif args.cmd == "palette-distance":
        small = load(args.img, (256, max(1, int(256 * arr.shape[0] / arr.shape[1]))))
        hexes = bible_palette(json.load(open(args.bible)), args.hour)
        print(json.dumps({"meanDeltaE76": None if hexes is None else palette_distance(small, hexes),
                          **({"reason": "no keyframe"} if hexes is None else {})}))
    elif args.cmd == "composition":
        print(json.dumps(composition(arr, parse_box(args.focal) if args.focal else None, parse_box(args.player) if args.player else None)))


if __name__ == "__main__":
    main()
