#!/usr/bin/env python3
"""Tile images into a labelled contact sheet for vision critics or casting picks, and build the G1 look
board / G2 gallery page. Needs Pillow for sheets (stdlib only for --html).

  python3 contact_sheet.py --out sheet.jpg [--cols 4] [--tile 480] [--index shots.jsonl --filter view=opening]
                           [--ref docs/reference.png] [img1.png img2.png ...]
  python3 contact_sheet.py --html docs/gallery.html --index shots/shots.jsonl --ref docs/reference.png
                           [--bible look-bible.json] [--reviews docs/reviews] [--title "Look board"] [--embed]

With --index, images come from a shot-matrix shots.jsonl (label = shot id); --filter key=value keeps
matching rows (repeatable). Without it, positional images are used (label = file name). Keep sheets at
<= 16 tiles so a vision model can still read detail; make several sheets rather than one huge one.

--ref pins the reference image as tile 0 of every sheet (critics need it side by side). When there are more
items than --max allows, several sheets are written (sheet.jpg, sheet-2.jpg, ...), each starting with the ref.

--html writes a static page (look-board.html at G1, gallery.html at G2) with: reference vs hero frame,
time-of-day strip, phone frames, character close-ups, and the overall-score trend read from
<reviews>/look-r*.json. The hero frame is the bible composition.view at light.heroHour (or --hero-view /
--hero-hour). Image paths are relative to the page unless --embed inlines them as base64.
"""
import argparse
import base64
import glob
import html
import json
import mimetypes
import os
import re


def load_index(path, filters):
    flt = [f.split("=", 1) for f in filters]
    rows = []
    for line in open(path):
        if not line.strip():
            continue
        s = json.loads(line)
        if not s.get("file"):
            continue  # e.g. lampAudit rows
        if all(str(s.get(k)) == v for k, v in flt):
            rows.append(s)
    return rows


def write_sheets(items, ref, a):
    from PIL import Image, ImageDraw, ImageFont

    per = a.max - (1 if ref else 0)
    if per < 1:
        raise SystemExit("--max too small for --ref")
    chunks = [items[i:i + per] for i in range(0, len(items), per)] or [[]]
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial.ttf", 14)
    except OSError:
        try:
            font = ImageFont.truetype("DejaVuSans.ttf", 14)
        except OSError:
            font = ImageFont.load_default()
    base, ext = os.path.splitext(a.out)
    outs = []
    for n, chunk in enumerate(chunks):
        tiles = ([(ref, "REFERENCE " + os.path.basename(ref))] if ref else []) + chunk
        first = Image.open(tiles[0][0])
        th = int(a.tile * first.height / first.width)
        label_h = 22
        cols = min(a.cols, len(tiles))
        rows = (len(tiles) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * a.tile, rows * (th + label_h)), (18, 18, 22))
        draw = ImageDraw.Draw(sheet)
        for i, (path, label) in enumerate(tiles):
            im = Image.open(path).convert("RGB")
            im.thumbnail((a.tile, th))
            x, y = (i % cols) * a.tile, (i // cols) * (th + label_h)
            sheet.paste(im, (x, y + label_h))
            colour = (255, 214, 120) if ref and i == 0 else (230, 230, 230)
            draw.text((x + 6, y + 3), label[:70], fill=colour, font=font)
        out = a.out if n == 0 else f"{base}-{n + 1}{ext}"
        sheet.save(out, quality=88)
        outs.append(out)
        print(f"{out}: {len(tiles)} tiles, {sheet.width}x{sheet.height}")
    return outs


# ---------------------------------------------------------------- html

def src_for(path, page_dir, embed):
    if embed:
        mime = mimetypes.guess_type(path)[0] or "image/png"
        return f"data:{mime};base64," + base64.b64encode(open(path, "rb").read()).decode()
    return os.path.relpath(os.path.realpath(path), page_dir)


def figure(path, label, page_dir, embed, cls=""):
    if not path or not os.path.exists(path):
        return (f'<figure class="missing {cls}"><div class="ph">missing</div>'
                f'<figcaption>{html.escape(label)}</figcaption></figure>')
    return (f'<figure class="{cls}"><a href="{html.escape(src_for(path, page_dir, False))}">'
            f'<img loading="lazy" src="{html.escape(src_for(path, page_dir, embed))}" alt="{html.escape(label)}"></a>'
            f'<figcaption>{html.escape(label)}</figcaption></figure>')


def score_trend(reviews_dir):
    rounds = {}
    for f in glob.glob(os.path.join(reviews_dir, "look-r*.json")):
        m = re.search(r"look-r(\d+)", os.path.basename(f))
        if not m:
            continue
        try:
            d = json.load(open(f))
        except (OSError, ValueError):
            continue
        for doc in (d if isinstance(d, list) else [d]):
            if isinstance(doc, dict) and isinstance(doc.get("overall"), (int, float)):
                rounds.setdefault(int(m.group(1)), []).append(
                    (doc.get("critic", os.path.basename(f)), float(doc["overall"])))
    return [(r, rounds[r]) for r in sorted(rounds)]


def trend_svg(trend, target=None):
    if not trend:
        return '<p class="note">No look-r*.json reviews yet.</p>'
    W, H, pad = 640, 180, 28
    xs = [r for r, _ in trend]
    means = [sum(v for _, v in c) / len(c) for _, c in trend]
    x0, x1 = min(xs), max(xs)

    def px(r):
        return pad + (0 if x1 == x0 else (r - x0) / (x1 - x0)) * (W - 2 * pad)

    def py(v):
        return H - pad - (v - 1) / 9 * (H - 2 * pad)

    parts = [f'<svg viewBox="0 0 {W} {H}" role="img" aria-label="overall score per look-dev round">']
    for v in (2, 4, 6, 8, 10):
        parts.append(f'<line class="grid" x1="{pad}" x2="{W - pad}" y1="{py(v):.1f}" y2="{py(v):.1f}"/>'
                     f'<text class="ax" x="4" y="{py(v) + 4:.1f}">{v}</text>')
    if target is not None:
        parts.append(f'<line class="target" x1="{pad}" x2="{W - pad}" y1="{py(target):.1f}" y2="{py(target):.1f}"/>'
                     f'<text class="ax" x="{W - pad - 60}" y="{py(target) - 4:.1f}">target {target}</text>')
    for r, crit in trend:
        for _, v in crit:
            parts.append(f'<circle class="dot" cx="{px(r):.1f}" cy="{py(v):.1f}" r="3"/>')
    pts = " ".join(f"{px(r):.1f},{py(m):.1f}" for (r, _), m in zip(trend, means))
    parts.append(f'<polyline class="mean" points="{pts}"/>')
    for (r, _), m in zip(trend, means):
        parts.append(f'<text class="ax" x="{px(r) - 8:.1f}" y="{H - 8}">r{r}</text>'
                     f'<text class="val" x="{px(r) + 5:.1f}" y="{py(m) - 6:.1f}">{m:.1f}</text>')
    parts.append("</svg>")
    rows = "".join(f"<tr><td>r{r}</td><td>{sum(v for _, v in c) / len(c):.2f}</td><td>"
                   + ", ".join(f"{html.escape(str(k))} {v:.1f}" for k, v in c) + "</td></tr>" for r, c in trend)
    return "".join(parts) + f"<table><tr><th>round</th><th>mean overall</th><th>critics</th></tr>{rows}</table>"


CSS = """
:root{--bg:#f6f5f2;--fg:#1d1d22;--muted:#6b6b75;--card:#ffffff;--line:#dedbd4;--accent:#c07a2a}
@media (prefers-color-scheme: dark){:root{--bg:#141418;--fg:#ececf0;--muted:#9a9aa6;--card:#1f1f25;--line:#33333c;--accent:#f0b060}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:1400px;margin:0 auto;padding:24px 16px 64px}h1{font-size:26px;margin:0 0 4px}h2{font-size:18px;margin:36px 0 12px}
.note{color:var(--muted)}.grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));gap:12px}
.strip{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(220px,1fr);gap:10px;overflow-x:auto;padding-bottom:6px}
.phones{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.closeups{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(260px,100%),1fr));gap:10px}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;overflow:hidden}
figure img{display:block;width:100%;height:auto}figcaption{font-size:12px;color:var(--muted);padding:6px 8px;word-break:break-all}
figure.ref{border-color:var(--accent);border-width:2px}.ph{aspect-ratio:16/9;display:grid;place-items:center;color:var(--muted)}
svg{width:100%;max-width:640px;background:var(--card);border:1px solid var(--line);border-radius:8px}
svg .grid{stroke:var(--line)}svg .target{stroke:var(--accent);stroke-dasharray:4 4}svg .mean{fill:none;stroke:var(--fg);stroke-width:2}
svg .dot{fill:var(--muted)}svg text{fill:var(--muted);font-size:11px}svg .val{fill:var(--fg)}
table{border-collapse:collapse;margin-top:10px;font-size:13px}td,th{border-bottom:1px solid var(--line);padding:4px 10px;text-align:left}
"""

TIER_RANK = {"high": 0, "medium": 1, "low": 2}


def is_phone(profile):
    return "phone" in str(profile or "").lower()


def best(cands):
    """Prefer desktop, then highest tier, so the hero / strip frames are the most representative."""
    return sorted(cands, key=lambda s: (is_phone(s.get("profile")), TIER_RANK.get(s.get("tier"), 3), str(s.get("state"))))


def section(title, cls, figs, empty):
    return f"<h2>{title}</h2>" + (f'<div class="{cls}">' + "".join(figs) + "</div>" if figs else f'<p class="note">{empty}</p>')


def write_html(rows, a):
    page_dir = os.path.dirname(os.path.realpath(a.html))
    os.makedirs(page_dir, exist_ok=True)
    bible = json.load(open(a.bible)) if a.bible and os.path.exists(a.bible) else {}
    hero_view = a.hero_view or bible.get("composition", {}).get("view", "opening")
    hero_hour = a.hero_hour if a.hero_hour is not None else bible.get("light", {}).get("heroHour")
    fig = lambda s, label=None, cls="": figure(s["file"], label or s["id"], page_dir, a.embed, cls)

    in_view = [s for s in rows if s.get("view") == hero_view]
    at_hour = [s for s in in_view if hero_hour is not None and s.get("time") == hero_hour]
    hero_c = best(at_hour or in_view or rows)
    hero = hero_c[0] if hero_c else None

    sec = []
    pair = []
    if a.ref:
        pair.append(figure(a.ref, "reference " + os.path.basename(a.ref), page_dir, a.embed, "ref"))
    if hero:
        pair.append(fig(hero, "hero " + hero["id"]))
    sec.append(section("Reference vs hero frame", "grid2", pair, "No shots."))

    tod = []
    if hero:
        same = [s for s in rows if s.get("time") is not None and all(
            s.get(k) == hero.get(k) for k in ("view", "profile", "tier", "state"))]
        by_hour = {}
        for s in same:
            by_hour.setdefault(s["time"], s)
        tod = [by_hour[h] for h in sorted(by_hour, key=lambda t: (t - a.day_start) % 24)]
    sec.append(section("Time of day", "strip", [fig(s, f"{int(s['time']):02d}h  {s['id']}") for s in tod] if len(tod) > 1 else [],
                       "Static time of day, or a single hour in this index."))

    phones = sorted([s for s in rows if is_phone(s.get("profile"))], key=lambda s: (str(s.get("view")), str(s.get("time"))))
    sec.append(section("Phone", "phones", [fig(s) for s in phones[: a.max_section]], "No phone profile shots."))

    close_re = re.compile(a.closeup_views, re.I)
    close = best([s for s in rows if close_re.search(str(s.get("view", "")))])
    sec.append(section("Character close-ups", "closeups", [fig(s) for s in close[: a.max_section]], "No close-up views matched."))

    target = None
    rub = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "templates", "style-rubric.json")
    try:
        target = json.load(open(rub)).get("pass", {}).get("overallMin")
    except (OSError, ValueError, AttributeError):
        pass
    sec.append("<h2>Score trend</h2>" + trend_svg(score_trend(a.reviews), target))

    title = a.title or ("Gallery" if "gallery" in os.path.basename(a.html).lower() else "Look board")
    meta = f"{len(rows)} shots from {html.escape(a.index or 'positional images')}; hero view {html.escape(str(hero_view))}"
    if hero_hour is not None:
        meta += f"; hero hour {hero_hour}"
    doc = (f'<!doctype html><html lang="en"><head><meta charset="utf-8">'
           f'<meta name="viewport" content="width=device-width,initial-scale=1">'
           f"<title>{html.escape(title)}</title><style>{CSS}</style></head><body><main>"
           f'<h1>{html.escape(title)}</h1><p class="note">{meta}</p>' + "".join(sec) + "</main></body></html>")
    with open(a.html, "w") as fh:
        fh.write(doc)
    print(f"{a.html}: {len(rows)} shots, hero {hero['id'] if hero else None}, {len(tod)} hours, "
          f"{len(phones)} phone, {len(close)} close-ups")


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("images", nargs="*")
    p.add_argument("--out", help="sheet image path (jpg/png)")
    p.add_argument("--cols", type=int, default=4)
    p.add_argument("--tile", type=int, default=480, help="tile width in px")
    p.add_argument("--index")
    p.add_argument("--filter", action="append", default=[])
    p.add_argument("--max", type=int, default=16, help="tiles per sheet, reference included")
    p.add_argument("--ref", help="reference image: tile 0 of every sheet, and beside the hero frame in --html")
    p.add_argument("--html", help="write a look-board / gallery page to this path")
    p.add_argument("--title")
    p.add_argument("--bible", help="look-bible.json for composition.view and light.heroHour")
    p.add_argument("--hero-view")
    p.add_argument("--hero-hour", type=float)
    p.add_argument("--day-start", type=int, default=6, help="first hour of the time-of-day strip")
    p.add_argument("--reviews", default="docs/reviews", help="directory holding look-r*.json critic outputs")
    p.add_argument("--closeup-views", default=r"char|close|portrait|dialogue|turntable", help="regex on view name")
    p.add_argument("--max-section", type=int, default=12)
    p.add_argument("--embed", action="store_true", help="inline images as base64 (self-contained page)")
    a = p.parse_args()
    if not a.out and not a.html:
        p.error("give --out and/or --html")
    if a.ref and not os.path.exists(a.ref):
        raise SystemExit(f"reference not found: {a.ref}")

    rows = load_index(a.index, a.filter) if a.index else []
    rows += [{"file": f, "id": os.path.basename(f)} for f in a.images]
    if not rows and not a.ref:
        raise SystemExit("no images")
    if a.out:
        write_sheets([(s["file"], s["id"]) for s in rows], a.ref, a)
    if a.html:
        write_html(rows, a)


if __name__ == "__main__":
    main()
