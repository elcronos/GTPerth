// Canvas-2D signage, stencils, labels, hazard stripes and numbers — with wear — packed into an atlas and
// shown on decal planes. Believable text + wear is the cheapest realism cue there is.
//
//   import { DecalAtlas, signCanvas, stencilCanvas, hazardCanvas, labelCanvas, decalMesh } from './decals/canvas-text.js';
//   const atlas = new DecalAtlas(2048);
//   atlas.add('gate', signCanvas({ lines: [{ text: 'GATE 4' }, { text: 'NO UNAUTHORISED ENTRY', size: 0.18 }] }));
//   atlas.add('bay', stencilCanvas({ text: 'B4-0271' }));
//   const tex = atlas.finish(G.renderer);                      // CanvasTexture sRGB + mips + anisotropy
//   const m = decalMesh(atlas, 'gate', 1.6);                    // width 1.6 m, height from aspect
//   m.position.set(x, y, z + 0.004); scene.add(m);              // sit 2-5 mm off the surface
//
// Distress is destination-out (removes paint, so the surface below shows through) and is seeded by an FNV hash
// of the text: the same sign always wears the same way, different signs never share a pattern.
// All canvases are drawn at `ppm` pixels per metre of the intended print size (default 256 px/m).
import { CanvasTexture, SRGBColorSpace, LinearMipmapLinearFilter, LinearFilter, PlaneGeometry, Mesh, MeshStandardMaterial, ClampToEdgeWrapping } from 'three';
import { rngFrom, fnv, fbm2, clamp, sstep } from '../geo/noise.js';
import { patch, after } from '../engine/patch.js';

// Font stacks (no web-font dependency: single-file games must render offline). Condensed bold reads as
// industrial signage on every OS; stencil bridges are drawn procedurally so no stencil font is needed.
export const FONTS = {
  sign: '"DIN Condensed", "Bahnschrift SemiBold Condensed", "Arial Narrow", "Roboto Condensed", Impact, "Helvetica Neue", Arial, sans-serif',
  stencil: '"DIN Condensed", "Bahnschrift Condensed", Impact, "Arial Narrow", "Arial Black", sans-serif',
  mono: '"SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
};
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

// ------------------------------------------------------------------ wear
// Remove paint from a layer: fbm-thresholded wear patches (stronger toward edges), chips, scratches, specks.
// amount 0..1. Operates in place on `cv` (a layer canvas whose transparent pixels are "bare surface").
export function distress(cv, { amount = 0.5, seed = 1, edge = 0.6, chips = 1, scratches = 1, specks = 1, scale = 1 } = {}) {
  if (amount <= 0) return cv;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, rnd = rngFrom(seed);
  // 1) per-pixel wear mask: low-frequency fbm patches + edge proximity, smooth threshold (no aliasing)
  const img = g.getImageData(0, 0, W, H), d = img.data, f = (6 / Math.max(W, H)) * scale, ox = rnd() * 100, oy = rnd() * 100;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (x + y * W) * 4; if (d[i + 3] === 0) continue;
    const ed = Math.min(x, y, W - 1 - x, H - 1 - y) / (0.12 * Math.min(W, H)); // 0 at the border
    const n = fbm2(x * f + ox, y * f + oy, 4, seed) + 0.25 * fbm2(x * f * 6 + oy, y * f * 6, 2, seed + 3);
    const wear = n - (1.05 - amount * 0.55) + edge * 0.35 * (1 - clamp(ed, 0, 1));
    d[i + 3] = d[i + 3] * (1 - sstep(-0.02, 0.07, wear));
  }
  g.putImageData(img, 0, 0);
  g.save(); g.globalCompositeOperation = 'destination-out';
  const S = Math.min(W, H) / 256;
  // 2) chips: irregular polygons, biased to the edges
  const nc = Math.round(60 * amount * chips * (W * H) / 65536);
  for (let i = 0; i < nc; i++) {
    let x = rnd() * W, y = rnd() * H;
    if (rnd() < 0.6) { if (rnd() < 0.5) x = rnd() < 0.5 ? rnd() * W * 0.08 : W - rnd() * W * 0.08; else y = rnd() < 0.5 ? rnd() * H * 0.08 : H - rnd() * H * 0.08; }
    const r = S * (1 + rnd() * rnd() * 7), n = 5 + Math.floor(rnd() * 4);
    g.globalAlpha = 0.6 + 0.4 * rnd(); g.beginPath();
    for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2, rr = r * (0.5 + 0.7 * rnd()); k ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
    g.fill();
  }
  // 3) scratches: thin short strokes, mostly in one dominant direction (handling/wiping marks)
  const ns = Math.round(40 * amount * scratches * (W * H) / 65536), dir = rnd() * Math.PI;
  g.lineCap = 'round';
  for (let i = 0; i < ns; i++) {
    const x = rnd() * W, y = rnd() * H, a = dir + (rnd() - 0.5) * 0.6, L = S * (6 + rnd() * 40);
    g.globalAlpha = 0.25 + 0.5 * rnd(); g.lineWidth = Math.max(1, S * (0.4 + rnd() * 0.9));
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * L * 0.5 + (rnd() - 0.5) * L * 0.2, y + Math.sin(a) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L); g.stroke();
  }
  // 4) specks: pinholes / spray voids
  const np = Math.round(400 * amount * specks * (W * H) / 65536);
  for (let i = 0; i < np; i++) { g.globalAlpha = 0.3 + 0.7 * rnd(); g.beginPath(); g.arc(rnd() * W, rnd() * H, S * (0.3 + rnd() * 1.1), 0, Math.PI * 2); g.fill(); }
  g.restore();
  return cv;
}

// Grime overlay (source-atop: only darkens existing paint): bottom-up dirt gradient + drip streaks.
export function grime(cv, { amount = 0.4, seed = 1, color = '40,32,24' } = {}) {
  if (amount <= 0) return cv;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, rnd = rngFrom(seed + 77);
  g.save(); g.globalCompositeOperation = 'source-atop';
  const gr = g.createLinearGradient(0, H, 0, H * 0.4); gr.addColorStop(0, `rgba(${color},${0.55 * amount})`); gr.addColorStop(1, `rgba(${color},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  const n = Math.round(14 * amount * W / 256);
  for (let i = 0; i < n; i++) { // drips from the top edge / fixings
    const x = rnd() * W, w = (1 + rnd() * 4) * W / 512, L = H * (0.15 + rnd() * 0.6);
    const s = g.createLinearGradient(0, 0, 0, L); s.addColorStop(0, `rgba(${color},${0.35 * amount})`); s.addColorStop(1, `rgba(${color},0)`);
    g.fillStyle = s; g.fillRect(x, 0, w, L);
  }
  g.restore();
  return cv;
}

// ------------------------------------------------------------------ text
// Stencil-style text into ctx at (x, baseline y): glyph by glyph, with vertical bridges cut through closed
// counters (O, B, D, 0, 8 …) on an offscreen layer so the cut never touches what's underneath.
const BRIDGE = new Set('ABDOPQR04689&@'.split(''));
export function stencilText(g, text, x, y, size, { font = FONTS.stencil, color = '#111', spacing = 0.06, bridge = 0.085, align = 'left' } = {}) {
  g.save(); g.font = `bold ${size}px ${font}`;
  const adv = [...text].map((ch) => g.measureText(ch).width + size * spacing);
  const total = adv.reduce((a, b) => a + b, 0) - size * spacing;
  let cx = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
  const L = mk(Math.ceil(total + size), Math.ceil(size * 1.4)), lg = L.getContext('2d');
  lg.font = g.font; lg.fillStyle = color; lg.textBaseline = 'alphabetic';
  let px = size * 0.5;
  for (let i = 0; i < adv.length; i++) {
    const ch = text[i]; lg.fillText(ch, px, size * 1.1);
    if (BRIDGE.has(ch.toUpperCase())) { // cut a bridge through the glyph centre
      const w = g.measureText(ch).width; lg.save(); lg.globalCompositeOperation = 'destination-out';
      lg.fillRect(px + w / 2 - (size * bridge) / 2, 0, size * bridge, size * 1.4); lg.restore();
    }
    px += adv[i];
  }
  g.drawImage(L, cx - size * 0.5, y - size * 1.1);
  g.restore();
  return total;
}
// Fit text into maxW by shrinking the size; returns the size used.
export function fitText(g, text, size, maxW, font) { g.font = `bold ${size}px ${font}`; const w = g.measureText(text).width; return w > maxW ? size * (maxW / w) : size; }

// Diagonal hazard stripes in a rect (pitch in px, 45°), clipped.
export function hazardStripes(g, x, y, w, h, { pitch = 48, a = '#e8b41c', b = '#141414' } = {}) {
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = a; g.fillRect(x, y, w, h); g.fillStyle = b;
  for (let s = -h; s < w + h; s += pitch) { g.beginPath(); g.moveTo(x + s, y + h); g.lineTo(x + s + pitch / 2, y + h); g.lineTo(x + s + pitch / 2 + h, y); g.lineTo(x + s + h, y); g.closePath(); g.fill(); }
  g.restore();
}

// ------------------------------------------------------------------ ready-made canvases
// Sign plate: background, border, optional hazard band, centred lines, rivets, wear + grime.
//  w/h in metres (ppm px per metre); lines: [{text, size (fraction of plate height), color, font, stencil}]
export function signCanvas({ w = 1.6, h = 0.8, ppm = 320, bg = '#e9e4d6', fg = '#16181a', border = '#16181a', borderW = 0.018, stripes = false,
  lines = [{ text: 'SIGN' }], rivets = true, wear = 0.45, dirt = 0.35, seed = null, radius = 0.02 } = {}) {
  const W = w * ppm, H = h * ppm, cv = mk(W, H), g = cv.getContext('2d');
  const sd = seed ?? fnv(lines.map((l) => l.text).join('|'));
  const r = radius * ppm;
  g.fillStyle = bg; g.beginPath(); g.roundRect(0, 0, W, H, r); g.fill();
  if (border) { g.strokeStyle = border; g.lineWidth = borderW * ppm; g.beginPath(); g.roundRect(borderW * ppm * 1.2, borderW * ppm * 1.2, W - borderW * ppm * 2.4, H - borderW * ppm * 2.4, r * 0.6); g.stroke(); }
  let top = borderW * ppm * 3;
  if (stripes) { const sh = H * 0.16; hazardStripes(g, borderW * ppm * 2.2, H - sh - borderW * ppm * 2.2, W - borderW * ppm * 4.4, sh, { pitch: sh * 0.9 }); }
  const avail = H - top * 2 - (stripes ? H * 0.18 : 0);
  const tot = lines.reduce((a, l) => a + (l.size ?? 0.36), 0);
  let y = top + (avail - tot * H * 0.92) / 2;
  for (const l of lines) {
    const font = l.font || (l.stencil ? FONTS.stencil : FONTS.sign);
    const size = fitText(g, l.text, (l.size ?? 0.36) * H, W * 0.86, font);
    y += size * 0.92;
    if (l.stencil) stencilText(g, l.text, W / 2, y, size, { color: l.color || fg, align: 'center', font });
    else { g.font = `bold ${size}px ${font}`; g.fillStyle = l.color || fg; g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillText(l.text, W / 2, y); }
    y += (l.size ?? 0.36) * H * 0.92 - size * 0.92 + H * 0.02;
  }
  if (rivets) for (const [rx, ry] of [[0.04, 0.08], [0.96, 0.08], [0.04, 0.92], [0.96, 0.92]]) {
    const cx = rx * W, cy = ry * H, rr = 0.011 * ppm, gr = g.createRadialGradient(cx - rr * 0.3, cy - rr * 0.3, rr * 0.1, cx, cy, rr);
    gr.addColorStop(0, '#d8d8d0'); gr.addColorStop(1, '#55534e'); g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, rr, 0, Math.PI * 2); g.fill();
  }
  grime(cv, { amount: dirt, seed: sd });
  distress(cv, { amount: wear, seed: sd });
  return cv;
}

// Spray-stencilled text on a transparent background (container IDs, bay numbers, "NO STEP").
// Soft overspray halo + bridges + heavy distress. h = letter height in metres.
export function stencilCanvas({ text = 'B4-0271', h = 0.25, ppm = 400, color = 'rgba(236,232,220,1)', wear = 0.4, overspray = 0.35, seed = null } = {}) {
  const size = h * ppm, probe = mk(4, 4).getContext('2d'); probe.font = `bold ${size}px ${FONTS.stencil}`;
  const W = [...text].reduce((a, ch) => a + probe.measureText(ch).width + size * 0.06, 0) + size * 0.6, H = size * 1.5;
  const cv = mk(W, H), g = cv.getContext('2d'), sd = seed ?? fnv(text);
  if (overspray > 0) { // blurred low-alpha pass under the crisp one
    const o = mk(W, H), og = o.getContext('2d'); stencilText(og, text, size * 0.3, size * 1.15, size, { color });
    g.save(); g.filter = `blur(${Math.max(1, size * 0.035)}px)`; g.globalAlpha = overspray; g.drawImage(o, 0, 0); g.restore();
  }
  stencilText(g, text, size * 0.3, size * 1.15, size, { color });
  distress(cv, { amount: wear, seed: sd, edge: 0.2 });
  return cv;
}

// Data label / nameplate: rows of "KEY  value" in a bordered plate (MAX GROSS 30480 KG ...).
export function labelCanvas({ rows = [['MAX GROSS', '30480 KG'], ['TARE', '2200 KG'], ['NET', '28280 KG']], w = 0.7, ppm = 400, color = 'rgba(236,232,220,1)', wear = 0.4, seed = null, plate = null } = {}) {
  const rh = 0.065 * ppm, W = w * ppm, H = rows.length * rh * 1.25 + rh * 0.6, cv = mk(W, H), g = cv.getContext('2d');
  if (plate) { g.fillStyle = plate; g.fillRect(0, 0, W, H); }
  g.font = `bold ${rh}px ${FONTS.sign}`; g.fillStyle = color; g.textBaseline = 'alphabetic';
  rows.forEach(([k, v], i) => { const y = rh * 0.3 + (i + 1) * rh * 1.25 - rh * 0.25; g.textAlign = 'left'; g.fillText(k, rh * 0.3, y); g.textAlign = 'right'; g.fillText(v, W - rh * 0.3, y); });
  distress(cv, { amount: wear, seed: seed ?? fnv(rows.flat().join()), edge: 0.1 });
  return cv;
}

// Big painted number/letter in a box (bay markers, column IDs). Transparent background.
export function numberCanvas({ text = '07', h = 0.6, ppm = 300, color = '#e8b41c', box = true, wear = 0.5, seed = null } = {}) {
  const size = h * ppm, W = size * (0.7 * text.length + 0.6), H = size * 1.35, cv = mk(W, H), g = cv.getContext('2d');
  if (box) { g.strokeStyle = color; g.lineWidth = size * 0.07; g.strokeRect(size * 0.08, size * 0.08, W - size * 0.16, H - size * 0.16); }
  g.font = `bold ${size}px ${FONTS.sign}`; g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, W / 2, H / 2 + size * 0.05);
  distress(cv, { amount: wear, seed: seed ?? fnv('n' + text), edge: 0.3 });
  return cv;
}

// Hazard band (kerbs, barrier rails, door edges): stripes + wear. w,h metres.
export function hazardCanvas({ w = 1.2, h = 0.2, ppm = 256, wear = 0.55, seed = 9 } = {}) {
  const cv = mk(w * ppm, h * ppm), g = cv.getContext('2d');
  hazardStripes(g, 0, 0, cv.width, cv.height, { pitch: Math.min(cv.height, 0.15 * ppm) * 1.4 });
  grime(cv, { amount: 0.4, seed }); distress(cv, { amount: wear, seed });
  return cv;
}

// ------------------------------------------------------------------ texture + atlas
// CanvasTexture configured for decals: sRGB, trilinear mips, max anisotropy, premultiplied alpha (filtering
// transparent edges against black rgb would otherwise make dark halos on every letter).
export function canvasTexture(cv, renderer = null) {
  const t = new CanvasTexture(cv);
  t.colorSpace = SRGBColorSpace; t.generateMipmaps = true; t.minFilter = LinearMipmapLinearFilter; t.magFilter = LinearFilter;
  t.wrapS = t.wrapT = ClampToEdgeWrapping; t.premultiplyAlpha = true;
  t.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
  t.needsUpdate = true;
  return t;
}

// Shelf-packing atlas. add(name, canvas) → rect; finish(renderer) → texture. Each entry is padded and its
// border pixels are smeared into the padding so mip levels never bleed neighbours into it.
export class DecalAtlas {
  constructor(size = 2048, pad = 8) { this.size = size; this.pad = pad; this.items = []; this.rects = {}; this.cv = mk(size, size); this.texture = null; }
  add(name, cv) { this.items.push({ name, cv }); return this; }
  finish(renderer = null) {
    const S = this.size, P = this.pad, g = this.cv.getContext('2d');
    let items = this.items.slice().sort((a, b) => b.cv.height - a.cv.height);
    // downscale everything uniformly if it does not fit (area heuristic, then retry)
    let scale = 1;
    for (let tries = 0; tries < 8; tries++) {
      let x = 0, y = 0, rowH = 0, ok = true; const rects = {};
      for (const it of items) {
        const w = Math.ceil(it.cv.width * scale) + 2 * P, h = Math.ceil(it.cv.height * scale) + 2 * P;
        if (x + w > S) { x = 0; y += rowH; rowH = 0; }
        if (w > S || y + h > S) { ok = false; break; }
        rects[it.name] = { x: x + P, y: y + P, w: w - 2 * P, h: h - 2 * P, aspect: it.cv.width / it.cv.height };
        x += w; rowH = Math.max(rowH, h);
      }
      if (ok) { this.rects = rects; break; }
      scale *= 0.85;
    }
    g.clearRect(0, 0, S, S);
    for (const it of items) {
      const r = this.rects[it.name]; if (!r) continue;
      g.drawImage(it.cv, r.x - P, r.y - P, r.w + 2 * P, r.h + 2 * P); // smeared border (approximate edge extend)
      g.clearRect(r.x - 1, r.y - 1, r.w + 2, r.h + 2);
      g.drawImage(it.cv, r.x, r.y, r.w, r.h);
    }
    this.texture = canvasTexture(this.cv, renderer);
    return this.texture;
  }
  // UV rect (three flips canvas Y: v = 1 - y/S)
  uv(name) { const r = this.rects[name], S = this.size; return { u0: r.x / S, v0: 1 - (r.y + r.h) / S, u1: (r.x + r.w) / S, v1: 1 - r.y / S, aspect: r.aspect }; }
}

// Plane geometry (XY, facing +Z) mapped to an atlas rect. h defaults from the entry's aspect.
export function decalGeo(atlas, name, w, h = null) {
  const r = atlas.uv(name); h = h ?? w / r.aspect;
  const g = new PlaneGeometry(w, h), uv = g.attributes.uv.array;
  for (let i = 0; i < uv.length; i += 2) { uv[i] = r.u0 + uv[i] * (r.u1 - r.u0); uv[i + 1] = r.v0 + uv[i + 1] * (r.v1 - r.v0); }
  return g;
}

// Decal material: alpha-blended, no depth write, polygonOffset -2 so it never z-fights the wall 2-5 mm behind.
// The texture is uploaded premultiplied (correct filtering at letter edges); the 'unpremul' patch divides the
// colour back by alpha so lighting, fog (atmosApply) and standard straight-alpha blending all stay correct.
const _matCache = new Map();
export function unpremultiply(m) {
  return patch(m, 'unpremul', (s) => {
    s.fragmentShader = after(s.fragmentShader, '#include <map_fragment>', '#ifdef USE_MAP\n  diffuseColor.rgb /= max( sampledDiffuseColor.a, 1e-3 );\n#endif');
  });
}
export function decalMaterial(tex, { roughness = 0.62, metalness = 0, key = 'default' } = {}) {
  const k = tex.uuid + key;
  if (!_matCache.has(k)) {
    const m = new MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness, metalness, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    m.alphaTest = 0.002; unpremultiply(m); _matCache.set(k, m);
  }
  return _matCache.get(k);
}
export function decalMesh(atlas, name, w, h = null, matOpts = {}) {
  const m = new Mesh(decalGeo(atlas, name, w, h), matOpts.material || decalMaterial(atlas.texture, matOpts));
  m.receiveShadow = true; m.renderOrder = 2; m.name = 'decal:' + name;
  return m;
}
