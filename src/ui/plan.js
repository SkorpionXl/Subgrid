/* SubGrid — floor plan: SPL map, zones (drawn + painted), boxes, tools, context menu */
import SG from '../core/engine.js';
import { $, clamp, fmt, fHz, esc, D2R, TK, KIND, KIND_ORDER, WALL_MAT, wallMat, chColor, colorAt, rgb, fitCanvas, FONT_M, FONT_U, toast, openModal, closeModal, num } from './util.js';
import { S, CELL, allZones, paintGrids, pushUndo, changed, emit, on, onSrc, c0, band, newZoneId, rasterizeShape, activeRoom, roomKey, persist } from './state.js';
import { can, needStudio } from './edition.js';

const Z = SG.zones;
let PW = 800, PH = 600;
export let lowRes = false;
export function setLowRes(v) { lowRes = v; }
const w2s = (x, y) => [PW / 2 + (x - S.view.x) * S.view.s, PH / 2 - (y - S.view.y) * S.view.s];
const s2w = (px, py) => [S.view.x + (px - PW / 2) / S.view.s, S.view.y - (py - PH / 2) / S.view.s];
const cv = () => $('#plan');

export const TOOLS = [
  { id: 'select', key: 'S', label: 'Auswahl', hint: 'Boxen und Zonen wählen, ziehen, verformen. Ziehen auf freier Fläche verschiebt die Ansicht.' },
  { id: 'box', key: 'A', label: 'Box setzen', hint: 'Klick setzt eine Box.' },
  { id: 'rect', key: 'R', label: 'Rechteck', hint: 'Ziehen zeichnet ein Rechteck in der gewählten Flächenart.' },
  { id: 'poly', key: 'G', label: 'Polygon', hint: 'Ecken anklicken. Doppelklick, Rechtsklick oder Enter schließt, Esc bricht ab.' },
  { id: 'circle', key: 'C', label: 'Kreis', hint: 'Vom Mittelpunkt aus ziehen.' },
  { id: 'fan', key: 'F', label: 'Fächer', hint: 'Von der Spitze aus in Richtung Publikum ziehen. Öffnung danach an den Griffen ändern.' },
  { id: 'brush', key: 'B', label: 'Pinsel', hint: 'Malen in der gewählten Flächenart, rechte Maustaste radiert.' },
  { id: 'eraser', key: 'X', label: 'Radierer', hint: 'Radiert gemalte und gezeichnete Flächen.' },
  { id: 'delete', key: 'K', label: 'Zone löschen', hint: 'Klick auf eine Fläche löscht sie ganz.' },
  { id: 'wall', key: 'W', label: 'Wand', studio: 'walls', hint: 'Ecken anklicken. Doppelklick, Rechtsklick oder Enter beendet, Klick auf den Startpunkt schließt den Raum. ⇧ = 15°-Schritte, Alt = ohne Raster.' },
  { id: 'measure', key: 'M', label: 'Messen', hint: 'Ziehen misst Abstand, Winkel und Laufzeit (bei aktueller Temperatur).' },
  { id: 'calib', key: '', label: 'Plan kalibrieren', hidden: true, hint: 'Zwei Punkte mit bekanntem Abstand auf dem Hallenplan anklicken (z. B. Wandlänge).' },
  { id: 'bgmove', key: '', label: 'Plan verschieben', hidden: true, hint: 'Hallenplan ziehen, bis er zu Zonen und Nullpunkt passt. Esc beendet.' },
];
const DRAW_TOOLS = ['rect', 'poly', 'circle', 'fan', 'brush', 'eraser', 'delete'];
export function setTool(t) {
  const T = TOOLS.find(q => q.id === t);
  if (T && T.studio && needStudio(T.studio)) return;
  if (S.tool === 'poly' && t !== 'poly') polyPts = null;
  if (S.tool === 'wall' && t !== 'wall') wallPts = null;
  if (t !== 'calib') calib = null;
  S.tool = t; emit('tool', t);
  if (DRAW_TOOLS.includes(t) && !S.settings.showZones) { S.settings.showZones = true; emit('settings'); }
  draft = null; requestRender();
}
let requestRender = () => {};
export function setRenderRequest(fn) { requestRender = fn; }

/* =====================================================================
   SPL map
   ===================================================================== */
function mapFreqs() {
  if (S.settings.mapBand) { const [lo, hi] = band(); const f = SG.bandFreqs(lo, hi, 3); return f.length ? f : [Math.sqrt(lo * hi)]; }
  return [S.settings.mapFreq];
}
const MAP = { key: '', rect: null, nx: 0, ny: 0, vals: null, img: null, lo: 0, hi: 0, segs: null, cell: 0 };
export const invalidateMap = () => { MAP.key = ''; };
function mapKey() { return JSON.stringify([onSrc().map(s => [s.x, s.y, s.delay_ms, s.gain_db, s.polarity, s.ap_f, s.ap_q, s.lp_f]), mapFreqs(), c0(), S.settings.mapMode, S.settings.box_spl, roomKey()]); }
function ensureMap() {
  const key = mapKey(), cellPx = lowRes ? 9 : 3.2, room = activeRoom();
  const cap = room ? (lowRes ? 90 : room.order > 1 ? 170 : 240) : (lowRes ? 150 : 380);
  const [vx0, vy1] = s2w(0, 0), [vx1, vy0] = s2w(PW, PH), r = MAP.rect;
  // cell size we would compute now (screen resolution, limited by the grid cap)
  const cellW = Math.max(cellPx / S.view.s, 1.4 * Math.max(vx1 - vx0, vy1 - vy0) / cap);
  const inside = r && vx0 >= r[0] && vx1 <= r[1] && vy0 >= r[2] && vy1 <= r[3];
  const resOk = MAP.cell && MAP.cell <= cellW * 1.6 && MAP.cell >= cellW * 0.5;
  if (MAP.key === key && inside && (resOk || (lowRes && MAP.cell <= cellW * 2))) return;
  const mx = (vx1 - vx0) * 0.2, my = (vy1 - vy0) * 0.2;
  const x0 = vx0 - mx, x1 = vx1 + mx, y0 = vy0 - my, y1 = vy1 + my;
  const nx = Math.max(8, Math.round((x1 - x0) / cellW)), ny = Math.max(8, Math.round((y1 - y0) / cellW));
  const freqs = mapFreqs(), c = c0(), on = onSrc();
  const vals = SG.fieldMap(on, freqs, c, x0, x1, y0, y1, nx, ny, room);
  let lo, hi;
  if (S.settings.mapMode === 'norm') {
    let cx = 0, cy = 0; on.forEach(s => { cx += s.x; cy += s.y; }); if (on.length) { cx /= on.length; cy /= on.length; }
    const pol = on.length ? SG.polarDb(on, freqs, c, [0], 100) : [0];
    let e = 0; for (let i = 0; i < freqs.length; i++) e += Math.pow(10, pol[i] / 10);
    const ref = 10 * Math.log10(e / freqs.length + 1e-24), dx = (x1 - x0) / (nx - 1), dy = (y1 - y0) / (ny - 1);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) vals[j * nx + i] += 20 * Math.log10(Math.max(1, Math.hypot(x0 + i * dx - cx, y1 - j * dy - cy))) - ref;
    hi = 6; lo = -30;
  } else {
    for (let i = 0; i < vals.length; i++) vals[i] += S.settings.box_spl;
    const sample = [], stp = Math.max(1, Math.floor(vals.length / 4000));
    for (let i = 0; i < vals.length; i += stp) sample.push(vals[i]);
    sample.sort((a, b) => a - b);
    hi = Math.ceil((sample[Math.floor(sample.length * 0.985)] || S.settings.box_spl) / 3) * 3; lo = hi - 36;
  }
  const off = MAP.img || document.createElement('canvas'); off.width = nx; off.height = ny;
  const octx = off.getContext('2d'), im = octx.createImageData(nx, ny);
  for (let i = 0; i < vals.length; i++) {
    const v = vals[i]; let t = (v - lo) / (hi - lo); t = (Math.floor(t * (hi - lo) / 3) + 0.5) * 3 / (hi - lo);
    const a = v < lo ? Math.max(0, 1 - (lo - v) / 9) : 1, col = colorAt(clamp(t, 0, 1));
    im.data[4 * i] = col[0] * 0.92; im.data[4 * i + 1] = col[1] * 0.92; im.data[4 * i + 2] = col[2] * 0.92; im.data[4 * i + 3] = 235 * a;
  }
  octx.putImageData(im, 0, 0);
  Object.assign(MAP, { key, rect: [x0, x1, y0, y1], nx, ny, vals, img: off, lo, hi, cell: (x1 - x0) / nx, segs: null });
  drawLegend();
}
function mapContours() {
  if (MAP.segs) return MAP.segs;
  const { nx, ny, vals, rect, lo, hi } = MAP, [x0, x1, , y1] = rect, dx = (x1 - x0) / (nx - 1), dy = (y1 - rect[2]) / (ny - 1), out = [];
  for (let L = lo + 3; L < hi; L += 3) {
    const segs = [];
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = vals[j * nx + i], b = vals[j * nx + i + 1], c = vals[(j + 1) * nx + i + 1], d = vals[(j + 1) * nx + i];
      const idx = (a > L ? 8 : 0) | (b > L ? 4 : 0) | (c > L ? 2 : 0) | (d > L ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const X = g => x0 + g * dx, Y = g => y1 - g * dy;
      const top = [X(i + (L - a) / (b - a)), Y(j)], right = [X(i + 1), Y(j + (L - b) / (c - b))], bot = [X(i + (L - d) / (c - d)), Y(j + 1)], left = [X(i), Y(j + (L - a) / (d - a))];
      const add = (p, q) => segs.push(p[0], p[1], q[0], q[1]);
      switch (idx) {
        case 1: case 14: add(left, bot); break; case 2: case 13: add(bot, right); break; case 3: case 12: add(left, right); break;
        case 4: case 11: add(top, right); break; case 5: add(left, top); add(bot, right); break; case 6: case 9: add(top, bot); break;
        case 7: case 8: add(left, top); break; case 10: add(top, right); add(left, bot); break;
      }
    }
    out.push({ L, segs });
  }
  return (MAP.segs = out);
}
function drawLegend() {
  const { ctx, W, H } = fitCanvas($('#legend'));
  ctx.clearRect(0, 0, W, H);
  const bw = 10, x = W - bw - 2, top = 6, bot = H - 6, n = Math.round((MAP.hi - MAP.lo) / 3);
  for (let k = 0; k < n; k++) { const y0 = bot - (k + 1) * (bot - top) / n; ctx.fillStyle = rgb(colorAt((k + 0.5) / n)); ctx.fillRect(x, y0, bw, (bot - top) / n + 0.5); }
  ctx.strokeStyle = TK.line2; ctx.strokeRect(x - 0.5, top - 0.5, bw + 1, bot - top + 1);
  ctx.font = '10px ' + FONT_M; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let k = 0; k <= n; k += 2) {
    const y = bot - k * (bot - top) / n;
    ctx.fillStyle = 'rgba(11,12,14,.85)'; ctx.fillRect(x - 30, y - 7, 26, 14);
    ctx.fillStyle = TK.text; ctx.fillText((S.settings.mapMode === 'norm' && MAP.lo + 3 * k > 0 ? '+' : '') + Math.round(MAP.lo + 3 * k), x - 5, y);
  }
}

/* =====================================================================
   rendering
   ===================================================================== */
let hover = null, polyPts = null, wallPts = null, draft = null, menu = null, calib = null;
export function renderPlan() {
  const r = fitCanvas(cv()), ctx = r.ctx; PW = r.W; PH = r.H;
  ctx.fillStyle = TK.bg; ctx.fillRect(0, 0, PW, PH);
  if (onSrc().length) {
    ensureMap();
    const [x0, x1, y0, y1] = MAP.rect, [sx0, sy0] = w2s(x0, y1), [sx1, sy1] = w2s(x1, y0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(MAP.img, sx0, sy0, sx1 - sx0, sy1 - sy0);
  }
  drawPlanImage(ctx);
  drawGrid(ctx);
  if (onSrc().length && S.settings.showContours && !lowRes) {
    for (const { L, segs } of mapContours()) {
      const beam = S.settings.mapMode === 'norm' && L === -6;
      ctx.strokeStyle = beam ? 'rgba(255,255,255,.95)' : 'rgba(8,8,10,.40)'; ctx.lineWidth = beam ? 2 : 0.8; ctx.beginPath();
      for (let k = 0; k < segs.length; k += 4) { const a = w2s(segs[k], segs[k + 1]), b = w2s(segs[k + 2], segs[k + 3]); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
      ctx.stroke();
    }
  }
  if (S.settings.showZones) drawZones(ctx);
  drawWalls(ctx);
  drawOrigin(ctx);
  drawBoxes(ctx);
  drawDraft(ctx);
  drawMeasure(ctx);
  drawScaleBar(ctx);
  if (hover && (S.tool === 'brush' || S.tool === 'eraser')) {
    const [sx, sy] = w2s(hover.x, hover.y);
    ctx.strokeStyle = S.tool === 'eraser' ? TK.white : KIND[S.kind].col; ctx.lineWidth = 1.2; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(sx, sy, S.brush * S.view.s, 0, 2 * Math.PI); ctx.stroke(); ctx.setLineDash([]);
  }
  const on = onSrc(), st = SG.stacks(on, S.settings.box_d);
  $('#plan-stat').textContent = `${on.length} Boxen · ${st.length} Stacks · ${new Set(on.map(s => s.channel)).size} Kanäle · ${S.settings.mapBand ? 'Band ' + band()[0] + '–' + band()[1] + ' Hz' : fHz(S.settings.mapFreq) + ' Hz'}`;
  renderSelBar();
}
const STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
function niceStep(pxPerM) { for (const s of STEPS) if (s * pxPerM >= 28) return s; return STEPS[STEPS.length - 1]; }
export const fmtLen = (v, d) => Math.abs(v) >= 1000 ? fmt(v / 1000, Math.abs(v) % 1000 ? 1 : 0) + ' km' : fmt(v, d != null ? d : (v % 1 ? 1 : 0)) + ' m';
export const MIN_ZOOM = 0.02, MAX_ZOOM = 400;
function drawGrid(ctx) {
  const st = niceStep(S.view.s), big = st * 5, [x0, y1] = s2w(0, 0), [x1, y0] = s2w(PW, PH);
  ctx.lineWidth = 1;
  for (const [step, col] of [[st, TK.grid], [big, TK.grid2]]) {
    ctx.strokeStyle = col; ctx.beginPath();
    for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const p = Math.round(w2s(x, 0)[0]) + 0.5; ctx.moveTo(p, 0); ctx.lineTo(p, PH); }
    for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const p = Math.round(w2s(0, y)[1]) + 0.5; ctx.moveTo(0, p); ctx.lineTo(PW, p); }
    ctx.stroke();
  }
  ctx.font = '10px ' + FONT_M; ctx.fillStyle = TK.muted; ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  for (let x = Math.ceil(x0 / big) * big; x <= x1; x += big) { const p = w2s(x, 0)[0]; if (p > 90 && p < PW - 60) ctx.fillText(fmtLen(x), p, 50); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  for (let y = Math.ceil(y0 / big) * big; y <= y1; y += big) { const p = w2s(0, y)[1]; if (p > 70 && p < PH - 56) ctx.fillText(fmtLen(y), 54, p); }
}
function drawScaleBar(ctx) {
  const target = 110 / S.view.s; let L = STEPS[0];
  for (const s of STEPS) if (s <= target) L = s;
  const px = L * S.view.s, x = PW - 62 - px, y = PH - 54;
  ctx.fillStyle = 'rgba(11,12,14,.78)'; ctx.fillRect(x - 8, y - 15, px + 16, 22);
  ctx.strokeStyle = TK.text; ctx.lineWidth = 1.5; ctx.beginPath();
  ctx.moveTo(x, y - 4); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 4); ctx.stroke();
  ctx.font = '10px ' + FONT_M; ctx.fillStyle = TK.text; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  ctx.fillText(fmtLen(L), x + px / 2, y - 3);
}
/* ---------- hall plan (background image) ---------- */
const IMG = { url: '', el: null };
function bgImage() {
  const bg = S.bg; if (!bg || !bg.url) return null;
  if (IMG.url !== bg.url) { IMG.url = bg.url; IMG.el = new Image(); IMG.el.onload = () => requestRender(); IMG.el.src = bg.url; }
  return IMG.el.complete && IMG.el.naturalWidth ? IMG.el : null;
}
function drawPlanImage(ctx) {
  const bg = S.bg; if (!bg || bg.hidden || !can('plan')) return;
  const im = bgImage(); if (!im) return;
  const [sx, sy] = w2s(bg.x, bg.y), w = bg.w * bg.mpp * S.view.s, h = bg.h * bg.mpp * S.view.s;
  ctx.save();
  ctx.globalAlpha = clamp(bg.opacity != null ? bg.opacity : 0.6, 0.05, 1);
  if (bg.invert !== false) { ctx.filter = 'invert(1) grayscale(1)'; ctx.globalCompositeOperation = 'screen'; }
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(im, sx, sy, w, h);
  ctx.restore();
  if (S.tool === 'bgmove' || S.tool === 'calib') { ctx.strokeStyle = TK.accent; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.2; ctx.strokeRect(sx, sy, w, h); ctx.setLineDash([]); }
}
/* ---------- walls ---------- */
function drawWalls(ctx) {
  const active = !!activeRoom();
  for (const w of S.walls) {
    const sel = S.selWall === w.id, m = wallMat(w.loss), p = w.p;
    ctx.beginPath();
    for (let i = 0; i < p.length; i += 2) { const [x, y] = w2s(p[i], p[i + 1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }
    ctx.lineCap = 'square'; ctx.lineJoin = 'miter';
    ctx.strokeStyle = 'rgba(11,12,14,.85)'; ctx.lineWidth = sel ? 7 : 6; ctx.stroke();
    ctx.strokeStyle = sel ? TK.accent : m.col; ctx.lineWidth = sel ? 3.5 : 3; ctx.globalAlpha = active || sel ? 1 : 0.45;
    ctx.setLineDash(w.loss >= 8 ? [6, 4] : []); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.lineCap = 'butt';
    if (sel) {
      ctx.font = '10px ' + FONT_M; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let i = 0; i + 3 < p.length; i += 2) {
        const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); if (L * S.view.s < 40) continue;
        const [mx, my] = w2s((p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2), t = fmtLen(L, 2), tw = ctx.measureText(t).width + 8;
        ctx.fillStyle = 'rgba(11,12,14,.85)'; ctx.fillRect(mx - tw / 2, my - 7, tw, 14); ctx.fillStyle = TK.white; ctx.fillText(t, mx, my);
      }
      for (let i = 0; i < p.length; i += 2) { const [x, y] = w2s(p[i], p[i + 1]); ctx.fillStyle = TK.bg; ctx.fillRect(x - 4.5, y - 4.5, 9, 9); ctx.strokeStyle = TK.white; ctx.lineWidth = 1.5; ctx.strokeRect(x - 4.5, y - 4.5, 9, 9); }
    }
  }
}
function drawMeasure(ctx) {
  const m = S.measure; if (!m) return;
  const a = w2s(m.x0, m.y0), b = w2s(m.x1, m.y1), L = Math.hypot(m.x1 - m.x0, m.y1 - m.y0);
  ctx.strokeStyle = TK.white; ctx.lineWidth = 1.5; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]);
  [a, b].forEach(q => { ctx.fillStyle = TK.accent; ctx.fillRect(q[0] - 3.5, q[1] - 3.5, 7, 7); });
  if (L < 1e-3) return;
  const ang = Math.atan2(m.x1 - m.x0, m.y1 - m.y0) / D2R, ms = L / c0() * 1000;
  const l1 = `${fmtLen(L, 2)} · ${fmt(ms, 2)} ms`, l2 = `Δx ${fmt(m.x1 - m.x0, 2)} · Δy ${fmt(m.y1 - m.y0, 2)} · ${Math.round(ang)}°`;
  ctx.font = '11px ' + FONT_M; const tw = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 12;
  let lx = (a[0] + b[0]) / 2 + 12, ly = (a[1] + b[1]) / 2 - 34;
  lx = clamp(lx, 4, PW - tw - 4); ly = clamp(ly, 4, PH - 40);
  ctx.fillStyle = 'rgba(11,12,14,.9)'; ctx.fillRect(lx, ly, tw, 34); ctx.strokeStyle = TK.line2; ctx.lineWidth = 1; ctx.strokeRect(lx + 0.5, ly + 0.5, tw - 1, 33);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = TK.white; ctx.fillText(l1, lx + 6, ly + 4); ctx.fillStyle = TK.muted; ctx.fillText(l2, lx + 6, ly + 18);
}
function drawOrigin(ctx) {
  const [ox, oy] = w2s(0, 0);
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(ox - 7, oy); ctx.lineTo(ox + 7, oy); ctx.moveTo(ox, oy - 7); ctx.lineTo(ox, oy + 7); ctx.stroke();
}
function zoneLabelPoint(z) {
  const p = z.p;
  if (z.shape === 'sector') { const r = p[3] * 0.82 + p[2] * 0.18, a = (p[4] + Z.angSpan(p[4], p[5]) / 2) * D2R; return [p[0] + r * Math.sin(a), p[1] + r * Math.cos(a)]; }
  if (z.shape === 'circle' || z.shape === 'ring') return [p[0], p[1] + (z.shape === 'ring' ? (p[2] + p[3]) / 2 : p[2] * 0.6)];
  const b = Z.bbox(z);
  if (z.shape === 'rect') return [b[0], b[1]];
  return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
}
function pathZone(ctx, z) {
  ctx.beginPath();
  Z.outline(z, 160).forEach(pl => pl.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }));
}
function paintEdges() {
  // boundary segments between painted cells of different kinds / empty (cached per paint version)
  if (paintEdges.ver === S.paintVer) return paintEdges.segs;
  const segs = {};
  S.paint.forEach((k, key) => {
    const [i, j] = key.split(',').map(Number), L = segs[k] || (segs[k] = []);
    const nb = (a, b) => S.paint.get(a + ',' + b) === k;
    if (!nb(i - 1, j)) L.push(i, j, i, j + 1);
    if (!nb(i + 1, j)) L.push(i + 1, j, i + 1, j + 1);
    if (!nb(i, j - 1)) L.push(i, j, i + 1, j);
    if (!nb(i, j + 1)) L.push(i, j + 1, i + 1, j + 1);
  });
  paintEdges.ver = S.paintVer; paintEdges.segs = segs;
  return segs;
}
function drawZones(ctx) {
  const order = KIND_ORDER;
  // painted cells
  for (const g of paintGrids().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    const K = KIND[g.kind]; ctx.fillStyle = K.fill.replace(/[\d.]+\)$/, '.16)');
    for (const [j, a, b] of g.runs) {
      const [x0, y0] = w2s(a * CELL, (j + 1) * CELL), [x1, y1] = w2s((b + 1) * CELL, j * CELL);
      ctx.fillRect(Math.floor(x0), Math.floor(y0), Math.ceil(x1 - x0), Math.ceil(y1 - y0));
    }
  }
  const edges = paintEdges();
  for (const k of Object.keys(edges)) {
    const L = edges[k]; ctx.strokeStyle = KIND[k].col; ctx.lineWidth = 1.2; ctx.beginPath();
    for (let n = 0; n < L.length; n += 4) { const a = w2s(L[n] * CELL, L[n + 1] * CELL), b = w2s(L[n + 2] * CELL, L[n + 3] * CELL); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); }
    ctx.stroke();
  }
  if (S.selZone && S.selZone.type === 'paint') {
    ctx.fillStyle = 'rgba(255,255,255,.10)';
    S.selZone.cells.forEach(key => { const [i, j] = key.split(',').map(Number); const [x0, y0] = w2s(i * CELL, (j + 1) * CELL), [x1, y1] = w2s((i + 1) * CELL, j * CELL); ctx.fillRect(x0, y0, x1 - x0, y1 - y0); });
  }
  // drawn shapes
  for (const z of S.shapes.slice().sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    const K = KIND[z.kind], sel = S.selZone && S.selZone.id === z.id;
    pathZone(ctx, z); ctx.fillStyle = K.fill; ctx.fill('evenodd');
    ctx.strokeStyle = K.col; ctx.lineWidth = sel ? 2 : 1.3; ctx.setLineDash(z.kind === 'place' ? [7, 4] : z.kind === 'nogo' ? [2, 3] : []);
    ctx.globalAlpha = sel ? 1 : 0.85; ctx.stroke(); ctx.globalAlpha = 1; ctx.setLineDash([]);
    if (z.kind === 'nogo') {
      const b = Z.bbox(z), [a0, a1] = w2s(b[0], b[3]), [b0, b1] = w2s(b[2], b[1]);
      ctx.save(); pathZone(ctx, z); ctx.clip(); ctx.strokeStyle = 'rgba(154,165,177,.35)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = a0 - (b1 - a1); x < b0; x += 8) { ctx.moveTo(x, b1); ctx.lineTo(x + (b1 - a1), a1); } ctx.stroke(); ctx.restore();
    }
    let lp = w2s(...zoneLabelPoint(z));
    ctx.font = '700 10px ' + FONT_U; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const t = K.short.toUpperCase(), tw = ctx.measureText(t).width + 10;
    if (z.shape === 'rect') lp = [lp[0] + tw / 2, lp[1] + 9];          // just below the lower-left corner
    ctx.fillStyle = 'rgba(11,12,14,.8)'; ctx.fillRect(lp[0] - tw / 2, lp[1] - 8, tw, 16);
    ctx.fillStyle = K.col; ctx.fillText(t, lp[0], lp[1] + 0.5);
    if (sel) handles(z).forEach(h => { const [x, y] = w2s(h.x, h.y); ctx.fillStyle = TK.bg; ctx.fillRect(x - 4.5, y - 4.5, 9, 9); ctx.strokeStyle = TK.white; ctx.lineWidth = 1.5; ctx.strokeRect(x - 4.5, y - 4.5, 9, 9); });
  }
}
function stackGroups() {
  return SG.stacks(S.sources, S.settings.box_d).map(g => { const s0 = S.sources[g.idx[0]]; return Object.assign(g, { corners: SG.boxCorners(s0.x, s0.y, s0.rot_deg, S.settings.box_w, S.settings.box_d) }); });
}
function drawBoxes(ctx) {
  const bad = SG.collisions(S.sources, S.settings.box_w, S.settings.box_d), selSet = new Set(S.sel), big = S.view.s >= 26;
  for (const g of stackGroups()) {
    const srcs = g.idx.map(i => S.sources[i]), enabled = srcs.some(s => s.enabled), pts = g.corners.map(c => w2s(c[0], c[1]));
    const isSel = g.idx.some(i => selSet.has(i)), chs = [...new Set(srcs.map(s => s.channel))];
    ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.closePath();
    ctx.fillStyle = enabled ? 'rgba(17,19,22,.92)' : 'rgba(17,19,22,.4)'; ctx.fill();
    if (isSel) { ctx.strokeStyle = TK.accent; ctx.lineWidth = 2.6; ctx.stroke(); }
    else { ctx.strokeStyle = g.idx.some(i => bad.has(i)) ? TK.bad : chColor(chs[0]); ctx.lineWidth = 1.6; ctx.setLineDash(enabled ? [] : [3, 3]); ctx.stroke(); ctx.setLineDash([]); }
    for (const s of srcs) {
      const c = SG.boxCorners(s.x, s.y, s.rot_deg, S.settings.box_w, S.settings.box_d), a = w2s(c[2][0], c[2][1]), b = w2s(c[3][0], c[3][1]);
      ctx.strokeStyle = 'rgba(243,244,245,.9)'; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    const seen = new Set();
    for (const s of srcs) {
      const k = s.x.toFixed(3) + ',' + s.y.toFixed(3); if (seen.has(k)) continue; seen.add(k);
      const [sx, sy] = w2s(s.x, s.y), r = big ? 3.5 : 2.6;
      ctx.fillStyle = s.polarity < 0 ? TK.bad : chColor(s.channel); ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
      ctx.strokeStyle = TK.bg; ctx.lineWidth = 1; ctx.strokeRect(sx - r, sy - r, 2 * r, 2 * r);
    }
    const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4, boxPx = S.settings.box_w * S.view.s;
    if (srcs.some(s => s.pinned)) {
      const p = pts[3]; ctx.fillStyle = TK.white; ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6); ctx.strokeStyle = TK.bg; ctx.strokeRect(p[0] - 3, p[1] - 3, 6, 6);
    }
    if (boxPx > 14) {
      ctx.font = `${boxPx > 26 ? 11 : 9.5}px ${FONT_M}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = TK.white;
      const dirs = new Set(srcs.map(s => Math.round(((s.rot_deg % 360) + 360) % 360))), n = srcs.length;
      const lbl = (n > 1 ? n + '×' : '') + (dirs.size > 1 ? '↕' : '');
      if (lbl) ctx.fillText(lbl, cx, cy - (big ? 6 : 0));
      if (big) { ctx.fillStyle = TK.muted; ctx.font = `9.5px ${FONT_M}`; ctx.fillText(chs.map(c => c ? 'K' + c : '–').join('/'), cx, cy + (lbl ? 6 : 0)); }
    }
    if (big && S.view.s >= 34) {
      const dl = [...new Set(srcs.map(s => fmt(s.delay_ms, 2)))], by = Math.max(...pts.map(p => p[1])) + 11;
      const txt = dl.join('/') + ' ms' + (srcs.some(s => s.polarity < 0) ? ' · INV' : '');
      ctx.font = `10px ${FONT_M}`; const tw = ctx.measureText(txt).width + 8;
      ctx.fillStyle = 'rgba(11,12,14,.85)'; ctx.fillRect(cx - tw / 2, by - 7, tw, 14);
      ctx.fillStyle = srcs.some(s => s.polarity < 0) ? '#ef8c83' : TK.text; ctx.fillText(txt, cx, by);
    }
  }
}
function drawDraft(ctx) {
  const K = KIND[S.kind];
  if (draft) {
    const z = draftZone(); if (!z) return;
    pathZone(ctx, z); ctx.fillStyle = K.fill; ctx.fill('evenodd'); ctx.strokeStyle = K.col; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.font = '11px ' + FONT_M; ctx.fillStyle = TK.white; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    const [sx, sy] = w2s(draft.x1, draft.y1); ctx.fillText(draftLabel(), sx + 10, sy - 6);
  }
  if (wallPts && wallPts.length) {
    const pts = wallPts.concat(hover ? [wallSnap(hover.x, hover.y, hover.shift, hover.alt)] : []);
    ctx.strokeStyle = TK.wall; ctx.lineWidth = 3; ctx.lineCap = 'square'; ctx.beginPath();
    pts.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); ctx.lineCap = 'butt';
    wallPts.forEach(p => { const [x, y] = w2s(p[0], p[1]); ctx.fillStyle = TK.accent; ctx.fillRect(x - 3, y - 3, 6, 6); });
    if (hover) {
      const a = wallPts[wallPts.length - 1], b = pts[pts.length - 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const [sx, sy] = w2s(b[0], b[1]); ctx.font = '11px ' + FONT_M; ctx.fillStyle = TK.white; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
      ctx.fillText(`${fmtLen(L, 2)} · ${Math.round(Math.atan2(b[0] - a[0], b[1] - a[1]) / D2R)}°`, sx + 10, sy - 6);
    }
  }
  if (calib && calib.a) {
    const a = w2s(calib.a[0], calib.a[1]); ctx.fillStyle = TK.accent; ctx.fillRect(a[0] - 4, a[1] - 4, 8, 8);
    if (hover) { const b = w2s(hover.x, hover.y); ctx.strokeStyle = TK.accent; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]); }
  }
  if (polyPts && polyPts.length) {
    ctx.strokeStyle = K.col; ctx.lineWidth = 1.6; ctx.beginPath();
    polyPts.forEach((p, i) => { const [x, y] = w2s(p[0], p[1]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    if (hover) { const [x, y] = w2s(hover.sx, hover.sy); ctx.lineTo(x, y); }
    ctx.stroke();
    polyPts.forEach(p => { const [x, y] = w2s(p[0], p[1]); ctx.fillStyle = K.col; ctx.fillRect(x - 3, y - 3, 6, 6); });
  }
}
function draftZone() {
  const d = draft;
  if (d.tool === 'rect') return { kind: S.kind, shape: 'rect', p: [Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)] };
  const r = Math.hypot(d.x1 - d.x0, d.y1 - d.y0); if (r < 0.05) return null;
  if (d.tool === 'circle') return { kind: S.kind, shape: 'circle', p: [d.x0, d.y0, r] };
  const a = Math.atan2(d.x1 - d.x0, d.y1 - d.y0) / D2R, half = 45;
  return { kind: S.kind, shape: 'sector', p: [d.x0, d.y0, 0, r, a - half, a + half] };
}
function draftLabel() {
  const d = draft;
  if (d.tool === 'rect') return `${fmt(Math.abs(d.x1 - d.x0), 1)} × ${fmt(Math.abs(d.y1 - d.y0), 1)} m`;
  return `r ${fmt(Math.hypot(d.x1 - d.x0, d.y1 - d.y0), 1)} m`;
}

/* ---------- zone handles ---------- */
function handles(z) {
  const p = z.p, H = [];
  if (z.shape === 'rect') { H.push({ x: p[0], y: p[1], h: 'r00' }, { x: p[2], y: p[1], h: 'r10' }, { x: p[2], y: p[3], h: 'r11' }, { x: p[0], y: p[3], h: 'r01' }); }
  else if (z.shape === 'poly') { for (let i = 0; i < p.length; i += 2) H.push({ x: p[i], y: p[i + 1], h: 'v' + i / 2 }); }
  else if (z.shape === 'circle') H.push({ x: p[0] + p[2], y: p[1], h: 'r2' });
  else if (z.shape === 'ring') H.push({ x: p[0] + p[3], y: p[1], h: 'r2' }, { x: p[0] + p[2], y: p[1], h: 'r1' });
  else if (z.shape === 'sector') {
    const span = Z.angSpan(p[4], p[5]), am = (p[4] + span / 2) * D2R, a0 = p[4] * D2R, a1 = (p[4] + span) * D2R;
    H.push({ x: p[0] + p[3] * Math.sin(am), y: p[1] + p[3] * Math.cos(am), h: 'r2' }, { x: p[0] + p[2] * Math.sin(am), y: p[1] + p[2] * Math.cos(am), h: 'r1' },
      { x: p[0] + p[3] * Math.sin(a0), y: p[1] + p[3] * Math.cos(a0), h: 'a0' }, { x: p[0] + p[3] * Math.sin(a1), y: p[1] + p[3] * Math.cos(a1), h: 'a1' });
  }
  return H;
}
function applyHandle(z, h, x, y) {
  const p = z.p;
  if (z.shape === 'rect') { if (h[1] === '0') p[0] = x; else p[2] = x; if (h[2] === '0') p[1] = y; else p[3] = y; }
  else if (z.shape === 'poly') { const i = +h.slice(1) * 2; p[i] = x; p[i + 1] = y; }
  else {
    const r = Math.hypot(x - p[0], y - p[1]);
    if (h === 'r2') { if (z.shape === 'circle') p[2] = Math.max(0.1, r); else p[3] = Math.max(p[2] + 0.1, r); }
    else if (h === 'r1') p[2] = clamp(r, 0, p[3] - 0.1);
    else {
      const a = Math.atan2(x - p[0], y - p[1]) / D2R;
      if (h === 'a0') { const end = p[4] + Z.angSpan(p[4], p[5]); p[4] = a; p[5] = a + (((end - a) % 360) + 360) % 360 || 360; }
      else { p[5] = p[4] + ((((a - p[4]) % 360) + 360) % 360 || 360); }
    }
  }
}
function normZone(z) { if (z.shape === 'rect') { const [a, b, c, d] = z.p; z.p = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]; } }

/* ---------- hit tests ---------- */
function hitStack(px, py) {
  const groups = stackGroups();
  for (let k = groups.length - 1; k >= 0; k--) {
    const g = groups[k], pts = g.corners.map(c => w2s(c[0], c[1]));
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside; }
    const cx = pts.reduce((a, p) => a + p[0], 0) / 4, cy = pts.reduce((a, p) => a + p[1], 0) / 4;
    if (inside || Math.hypot(px - cx, py - cy) < 9) return g;
  }
  return null;
}
function hitHandle(px, py) {
  if (!S.selZone || S.selZone.type !== 'shape') return null;
  const z = S.shapes.find(s => s.id === S.selZone.id); if (!z) return null;
  for (const h of handles(z)) { const [x, y] = w2s(h.x, h.y); if (Math.abs(px - x) <= 7 && Math.abs(py - y) <= 7) return { z, h: h.h }; }
  return null;
}
function hitShape(x, y) {
  const c = S.shapes.filter(z => Z.contains(z, x, y)).sort((a, b) => Z.area(a) - Z.area(b));
  return c[0] || null;
}
function paintComponent(i, j) {
  const k = S.paint.get(i + ',' + j); if (!k) return null;
  const cells = new Set([i + ',' + j]), q = [[i, j]];
  while (q.length && cells.size < 200000) {
    const [a, b] = q.pop();
    for (const [u, v] of [[a + 1, b], [a - 1, b], [a, b + 1], [a, b - 1]]) { const key = u + ',' + v; if (!cells.has(key) && S.paint.get(key) === k) { cells.add(key); q.push([u, v]); } }
  }
  return { kind: k, cells };
}
function hitZone(x, y) {
  const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
  const sh = hitShape(x, y);
  if (S.paint.has(i + ',' + j) && (!sh || Z.area(sh) > 4)) { const c = paintComponent(i, j); return { type: 'paint', kind: c.kind, cells: c.cells }; }
  if (sh) return { type: 'shape', id: sh.id };
  return null;
}
export function zoneAt(x, y) { return hitZone(x, y); }

/* ---------- wall hit tests / snapping ---------- */
function segDistPx(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
function hitWall(px, py) {
  for (let k = S.walls.length - 1; k >= 0; k--) {
    const w = S.walls[k], p = w.p;
    for (let i = 0; i + 3 < p.length; i += 2) if (segDistPx(px, py, w2s(p[i], p[i + 1]), w2s(p[i + 2], p[i + 3])) <= 6) return w;
  }
  return null;
}
function hitWallHandle(px, py) {
  const w = S.selWall && S.walls.find(q => q.id === S.selWall); if (!w) return null;
  for (let i = 0; i < w.p.length; i += 2) { const [x, y] = w2s(w.p[i], w.p[i + 1]); if (Math.abs(px - x) <= 7 && Math.abs(py - y) <= 7) return { w, i }; }
  return null;
}
/** snap a wall point: existing wall corners (10 px), 15° steps from the last point (Shift), 10-cm grid */
function wallSnap(x, y, shift, alt) {
  const [px, py] = w2s(x, y);
  const cand = []; S.walls.forEach(w => { for (let i = 0; i < w.p.length; i += 2) cand.push([w.p[i], w.p[i + 1]]); });
  if (wallPts && wallPts.length > 2) cand.push(wallPts[0]);
  for (const c of cand) { const [cx, cy] = w2s(c[0], c[1]); if (Math.hypot(px - cx, py - cy) <= 10) return [c[0], c[1]]; }
  const last = wallPts && wallPts[wallPts.length - 1];
  if (shift && last) {
    const L = alt ? Math.hypot(x - last[0], y - last[1]) : Math.round(Math.hypot(x - last[0], y - last[1]) / 0.1) * 0.1;
    const a = Math.round(Math.atan2(x - last[0], y - last[1]) / D2R / 15) * 15 * D2R;
    return [+(last[0] + L * Math.sin(a)).toFixed(3), +(last[1] + L * Math.cos(a)).toFixed(3)];
  }
  return [snapZ(x, alt), snapZ(y, alt)];
}
function finishWall() {
  if (wallPts && wallPts.length >= 2) {
    pushUndo();
    const w = { id: newZoneId(), p: wallPts.flat().map(v => +(+v).toFixed(3)), loss: S.wallLoss != null ? S.wallLoss : 0.5 };
    S.walls.push(w); S.selWall = w.id; S.sel = []; S.selZone = null; emit('selection'); changed('zones');
    toast(`Wand: ${wallPts.length - 1} Segment${wallPts.length > 2 ? 'e' : ''} · ${wallMat(w.loss).label}` + (activeRoom() ? '' : ' · Reflexionen sind aus'), 'ok');
  }
  wallPts = null; requestRender();
}
export function deleteSelWall() {
  if (!S.selWall) return false;
  pushUndo(); S.walls = S.walls.filter(w => w.id !== S.selWall); S.selWall = null; emit('selection'); changed('zones'); return true;
}
export function setSelWallLoss(loss) {
  const w = S.walls.find(q => q.id === S.selWall); if (!w) return;
  pushUndo(); w.loss = loss; S.wallLoss = loss; changed('zones');
}
/* ---------- hall plan calibration ---------- */
function calibClick(x, y) {
  if (!S.bg) { setTool('select'); return; }
  if (!calib || !calib.a) { calib = { a: [x, y] }; requestRender(); return; }
  const a = calib.a, b = [x, y], d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d < 1e-3) return;
  openModal('Hallenplan kalibrieren', `<p class="note" style="margin-top:0">Auf dem Plan gemessen: <b class="mono">${fmtLen(d, 2)}</b>. Wie lang ist die Strecke in echt?</p>
    <label class="lbl">Echte Länge (m)<input type="number" id="cal-len" step="0.01" min="0.1" value="${(+d.toFixed(2))}"></label>
    <div style="display:flex;gap:8px;margin-top:12px"><button class="btn primary" id="cal-ok">Übernehmen</button><button class="btn" id="cal-cancel">Abbrechen</button></div>`);
  const inp = $('#cal-len'); setTimeout(() => { inp.focus(); inp.select(); }, 30);
  const done = ok => {
    if (ok) {
      const real = num(inp.value, NaN);
      if (isFinite(real) && real > 0) {
        const f = real / d, bg = S.bg;
        bg.mpp *= f; bg.x = a[0] + (bg.x - a[0]) * f; bg.y = a[1] + (bg.y - a[1]) * f;
        toast(`Plan skaliert: 1 px = ${fmt(bg.mpp * 100, 2)} cm`, 'ok'); changed('view'); persist(); emit('planchanged');
      }
    }
    closeModal(); calib = null; setTool('select');
  };
  $('#cal-ok').onclick = () => done(true); $('#cal-cancel').onclick = () => done(false);
  inp.onkeydown = e => { if (e.key === 'Enter') done(true); };
}

/* ---------- painting ---------- */
function paintDisc(x, y, r, kind) {
  // erase also converts drawn shapes under the brush into cells first
  if (!kind) {
    const probe = [[x, y]]; for (let k = 0; k < 8; k++) probe.push([x + r * Math.cos(k * Math.PI / 4), y + r * Math.sin(k * Math.PI / 4)]);
    S.shapes.filter(z => probe.some(([u, v]) => Z.contains(z, u, v))).forEach(z => rasterizeShape(z));
  }
  const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL), j0 = Math.floor((y - r) / CELL), j1 = Math.floor((y + r) / CELL);
  let ch = false;
  for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
    if (Math.hypot((i + 0.5) * CELL - x, (j + 0.5) * CELL - y) > Math.max(r, CELL * 0.6)) continue;
    const key = i + ',' + j;
    if (kind) { if (S.paint.get(key) !== kind) { S.paint.set(key, kind); ch = true; } }
    else if (S.paint.delete(key)) ch = true;
  }
  if (ch) S.paintVer++;
}
function paintSeg(a, b, kind) {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(d / (CELL / 2)));
  for (let k = 1; k <= n; k++) paintDisc(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, S.brush, kind);
}

/* =====================================================================
   interaction
   ===================================================================== */
const P = { mode: null, sx: 0, sy: 0, view0: null, idx: [], pos0: [], moved: false, pts: new Map(), pinch: null, btn: 0, last: null, hz: null, z0: null, undo: false };
const snapB = (v, free) => free ? v : Math.round(v / 0.05) * 0.05;
const snapZ = (v, free) => free ? v : Math.round(v / 0.1) * 0.1;
export function selectedIdx() { return S.sel.filter(i => S.sources[i]); }
let onUserEdit = () => {};
export function setUserEditHook(fn) { onUserEdit = fn; }

export function initPlan() {
  const c = cv();
  c.addEventListener('pointerdown', e => {
    closeMenu();
    c.setPointerCapture(e.pointerId); P.pts.set(e.pointerId, [e.offsetX, e.offsetY]);
    if (P.pts.size === 2) {
      const [a, b] = [...P.pts.values()];
      P.mode = 'pinch'; P.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), view: Object.assign({}, S.view), mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }; return;
    }
    P.sx = e.offsetX; P.sy = e.offsetY; P.moved = false; P.btn = e.button; P.undo = false;
    const [wx, wy] = s2w(e.offsetX, e.offsetY);
    if (e.button === 1) { P.mode = 'pan'; P.view0 = Object.assign({}, S.view); return; }
    const t = S.tool;
    if (e.button === 2 && t !== 'brush' && t !== 'eraser') { P.mode = null; return; }
    if (t === 'select') {
      const hh = hitHandle(e.offsetX, e.offsetY);
      if (hh) { P.mode = 'handle'; P.hz = hh; return; }
      const wh = hitWallHandle(e.offsetX, e.offsetY);
      if (wh) { P.mode = 'whandle'; P.wh = wh; return; }
      const g = hitStack(e.offsetX, e.offsetY);
      if (g) { S.sel = g.idx.slice(); S.selZone = null; S.selWall = null; P.mode = 'drag'; P.idx = g.idx.slice(); P.pos0 = g.idx.map(i => [S.sources[i].x, S.sources[i].y]); c.classList.add('grab'); emit('selection'); requestRender(); return; }
      const hw = hitWall(e.offsetX, e.offsetY);
      if (hw) { S.selWall = hw.id; S.sel = []; S.selZone = null; emit('selection'); P.mode = 'wmove'; P.z0 = [wx, wy]; P.worig = hw.p.slice(); requestRender(); return; }
      const z = S.settings.showZones ? hitZone(wx, wy) : null;
      if (z) {
        S.selZone = z; S.sel = []; S.selWall = null; emit('selection');
        P.mode = 'zmove'; P.z0 = [wx, wy];
        if (z.type === 'shape') P.zorig = JSON.parse(JSON.stringify(S.shapes.find(s => s.id === z.id)));
        else P.zorig = { cells: [...z.cells], kind: z.kind };
        requestRender(); return;
      }
      P.mode = 'pan'; P.view0 = Object.assign({}, S.view); return;
    }
    if (t === 'box' || t === 'poly' || t === 'delete' || t === 'wall' || t === 'calib') { P.mode = 'click'; P.view0 = Object.assign({}, S.view); return; }
    if (t === 'measure') { const x = snapZ(wx, e.altKey), y = snapZ(wy, e.altKey); S.measure = { x0: x, y0: y, x1: x, y1: y }; P.mode = 'measure'; return; }
    if (t === 'bgmove' && S.bg) { P.mode = 'bgmove'; P.z0 = [wx, wy]; P.bg0 = [S.bg.x, S.bg.y]; return; }
    if (t === 'rect' || t === 'circle' || t === 'fan') { const x = snapZ(wx, e.altKey), y = snapZ(wy, e.altKey); draft = { tool: t, x0: x, y0: y, x1: x, y1: y }; P.mode = 'draw'; return; }
    if (t === 'brush' || t === 'eraser') {
      pushUndo(); P.mode = 'paint'; P.last = [wx, wy];
      paintDisc(wx, wy, S.brush, t === 'brush' && e.button !== 2 ? S.kind : null); changed('zones'); return;
    }
  });
  c.addEventListener('pointermove', e => {
    if (P.pts.has(e.pointerId)) P.pts.set(e.pointerId, [e.offsetX, e.offsetY]);
    const [wx, wy] = s2w(e.offsetX, e.offsetY);
    if (P.mode === 'pinch' && P.pts.size === 2) {
      const [a, b] = [...P.pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), p = P.pinch;
      S.view.s = clamp(p.view.s * d / p.d, MIN_ZOOM, MAX_ZOOM);
      const wx0 = p.view.x + (p.mid[0] - PW / 2) / p.view.s, wy0 = p.view.y - (p.mid[1] - PH / 2) / p.view.s;
      S.view.x = wx0 - (p.mid[0] - PW / 2) / S.view.s; S.view.y = wy0 + (p.mid[1] - PH / 2) / S.view.s;
      lowRes = true; changed('view'); return;
    }
    hover = { x: wx, y: wy, px: e.offsetX, py: e.offsetY, sx: snapZ(wx, e.altKey), sy: snapZ(wy, e.altKey), shift: e.shiftKey, alt: e.altKey };
    if (!P.mode) {
      c.classList.toggle('over', S.tool === 'select' && (!!hitStack(e.offsetX, e.offsetY) || !!hitHandle(e.offsetX, e.offsetY) || !!hitWallHandle(e.offsetX, e.offsetY) || !!hitWall(e.offsetX, e.offsetY)));
      showTip(); if (S.tool !== 'select') requestRender(); return;
    }
    const dx = e.offsetX - P.sx, dy = e.offsetY - P.sy;
    if (!P.moved && Math.hypot(dx, dy) < 3 && P.mode !== 'paint' && P.mode !== 'draw' && P.mode !== 'measure') return;
    P.moved = true; $('#tip').hidden = true;
    if (P.mode === 'pan' || P.mode === 'click') {
      if (!P.view0) P.view0 = Object.assign({}, S.view);
      S.view.x = P.view0.x - dx / S.view.s; S.view.y = P.view0.y + dy / S.view.s; lowRes = true; changed('view');
    } else if (P.mode === 'drag') {
      if (!P.undo) { pushUndo(); P.undo = true; onUserEdit(); }
      const ref = P.pos0[0], nx = snapB(ref[0] + dx / S.view.s, e.altKey), ny = snapB(ref[1] - dy / S.view.s, e.altKey);
      P.idx.forEach((i, k) => { S.sources[i].x = +(P.pos0[k][0] + nx - ref[0]).toFixed(3); S.sources[i].y = +(P.pos0[k][1] + ny - ref[1]).toFixed(3); });
      lowRes = true; changed('src');
    } else if (P.mode === 'handle') {
      if (!P.undo) { pushUndo(); P.undo = true; }
      applyHandle(P.hz.z, P.hz.h, snapZ(wx, e.altKey), snapZ(wy, e.altKey)); changed('zones');
    } else if (P.mode === 'zmove') {
      if (!P.undo) { pushUndo(); P.undo = true; }
      let ddx = wx - P.z0[0], ddy = wy - P.z0[1];
      if (S.selZone.type === 'shape') {
        ddx = snapZ(ddx, e.altKey); ddy = snapZ(ddy, e.altKey);
        const i = S.shapes.findIndex(s => s.id === S.selZone.id);
        if (i >= 0) { const moved = Z.translate(P.zorig, ddx, ddy); S.shapes[i] = Object.assign(moved, { id: P.zorig.id }); }
      } else {
        const di = Math.round(ddx / CELL), dj = Math.round(ddy / CELL);
        P.zorig.cells.forEach(k => { if (S.paint.get(k) === P.zorig.kind) S.paint.delete(k); });
        const nc = new Set();
        P.zorig.cells.forEach(k => { const [a, b] = k.split(',').map(Number); const key = (a + di) + ',' + (b + dj); S.paint.set(key, P.zorig.kind); nc.add(key); });
        P.zorig.cells = [...nc]; P.z0 = [P.z0[0] + di * CELL, P.z0[1] + dj * CELL]; S.selZone = { type: 'paint', kind: P.zorig.kind, cells: nc }; S.paintVer++;
      }
      changed('zones');
    } else if (P.mode === 'draw') {
      draft.x1 = snapZ(wx, e.altKey); draft.y1 = snapZ(wy, e.altKey); requestRender();
    } else if (P.mode === 'measure') {
      S.measure.x1 = snapZ(wx, e.altKey); S.measure.y1 = snapZ(wy, e.altKey); requestRender();
    } else if (P.mode === 'wmove') {
      if (!P.undo) { pushUndo(); P.undo = true; }
      const w = S.walls.find(q => q.id === S.selWall);
      if (w) { const ddx = snapZ(wx - P.z0[0], e.altKey), ddy = snapZ(wy - P.z0[1], e.altKey); w.p = P.worig.map((v, i) => +(v + (i % 2 ? ddy : ddx)).toFixed(3)); }
      changed('zones');
    } else if (P.mode === 'whandle') {
      if (!P.undo) { pushUndo(); P.undo = true; }
      const sv = wallPts; wallPts = null;
      const [x, y] = wallSnapExcept(wx, wy, e.altKey, P.wh); wallPts = sv;
      P.wh.w.p[P.wh.i] = x; P.wh.w.p[P.wh.i + 1] = y; changed('zones');
    } else if (P.mode === 'bgmove') {
      S.bg.x = P.bg0[0] + (wx - P.z0[0]); S.bg.y = P.bg0[1] + (wy - P.z0[1]); requestRender();
    } else if (P.mode === 'paint') {
      paintSeg(P.last, [wx, wy], S.tool === 'brush' && P.btn !== 2 ? S.kind : null); P.last = [wx, wy]; changed('zones');
    }
  });
  const end = e => {
    P.pts.delete(e.pointerId);
    if (P.mode === 'pinch') { if (P.pts.size < 2) { P.mode = null; lowRes = false; requestRender(); } return; }
    const [wx, wy] = s2w(e.offsetX, e.offsetY), m = P.mode; P.mode = null; c.classList.remove('grab'); lowRes = false;
    if (m === 'pan' && !P.moved && P.btn === 0) { S.sel = []; S.selZone = null; S.selWall = null; emit('selection'); }
    if (m === 'click' && !P.moved && P.btn === 0) {
      if (S.tool === 'box') addBox(snapB(wx, e.altKey), snapB(wy, e.altKey));
      else if (S.tool === 'poly') {
        const pt = [snapZ(wx, e.altKey), snapZ(wy, e.altKey)];
        if (!polyPts) polyPts = [];
        const last = polyPts[polyPts.length - 1];
        if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 0.05) polyPts.push(pt);
      } else if (S.tool === 'delete') deleteZoneAt(wx, wy);
      else if (S.tool === 'wall') {
        const pt = wallSnap(wx, wy, e.shiftKey, e.altKey);
        if (!wallPts) wallPts = [];
        const last = wallPts[wallPts.length - 1], first = wallPts[0];
        if (wallPts.length > 2 && first && Math.hypot(first[0] - pt[0], first[1] - pt[1]) < 1e-6) { wallPts.push(pt); finishWall(); }
        else if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 0.05) wallPts.push(pt);
      } else if (S.tool === 'calib') calibClick(wx, wy);
    }
    if (m === 'measure') { const ms = S.measure; if (ms && Math.hypot(ms.x1 - ms.x0, ms.y1 - ms.y0) < 0.05) S.measure = null; }
    if (m === 'bgmove') { changed('view'); persist(); }
    if (m === 'draw') {
      const z = draftZone(); draft = null;
      const okSize = z && (z.shape === 'rect' ? Math.abs(z.p[2] - z.p[0]) > 0.2 && Math.abs(z.p[3] - z.p[1]) > 0.2 : (z.p[3] || z.p[2]) > 0.2);
      if (okSize) { pushUndo(); z.id = newZoneId(); S.shapes.push(z); S.selZone = { type: 'shape', id: z.id }; emit('selection'); changed('zones'); }
    }
    if (m === 'handle' && P.hz) { normZone(P.hz.z); changed('zones'); }
    if (m === 'zmove' || m === 'paint' || m === 'wmove' || m === 'whandle') changed('zones');
    if (m === 'drag' && P.moved) changed('src');
    requestRender();
  };
  c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  c.addEventListener('pointerleave', () => { if (!P.mode) { hover = null; $('#tip').hidden = true; requestRender(); } });
  c.addEventListener('wheel', e => {
    e.preventDefault();
    const f = Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.0015)), [wx, wy] = s2w(e.offsetX, e.offsetY);
    S.view.s = clamp(S.view.s * f, MIN_ZOOM, MAX_ZOOM); S.view.x = wx - (e.offsetX - PW / 2) / S.view.s; S.view.y = wy + (e.offsetY - PH / 2) / S.view.s;
    lowRes = true; changed('view');
  }, { passive: false });
  c.addEventListener('dblclick', e => {
    if (S.tool === 'poly') { closePoly(); return; }
    if (S.tool === 'wall') { finishWall(); return; }
    if (S.tool === 'select' && !hitStack(e.offsetX, e.offsetY) && !hitZone(...s2w(e.offsetX, e.offsetY))) { const [x, y] = s2w(e.offsetX, e.offsetY); addBox(snapB(x), snapB(y)); }
  });
  c.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (S.tool === 'poly') { closePoly(); return; }
    if (S.tool === 'wall') { finishWall(); return; }
    if (S.tool === 'select' || S.tool === 'box') openMenu(e.offsetX, e.offsetY);
  });
  document.addEventListener('pointerdown', e => { if (menu && !e.target.closest('.ctx')) closeMenu(); });
}
function wallSnapExcept(x, y, alt, wh) {
  const [px, py] = w2s(x, y);
  for (const w of S.walls) for (let i = 0; i < w.p.length; i += 2) {
    if (w === wh.w && i === wh.i) continue;
    const [cx, cy] = w2s(w.p[i], w.p[i + 1]); if (Math.hypot(px - cx, py - cy) <= 10) return [w.p[i], w.p[i + 1]];
  }
  return [snapZ(x, alt), snapZ(y, alt)];
}
export function zoomBy(f) {
  S.view.s = clamp(S.view.s * f, MIN_ZOOM, MAX_ZOOM); changed('view');
}
export function closePoly() {
  if (wallPts) { finishWall(); return; }
  if (polyPts && polyPts.length >= 3) {
    pushUndo();
    const z = { id: newZoneId(), kind: S.kind, shape: 'poly', p: polyPts.flat() };
    S.shapes.push(z); S.selZone = { type: 'shape', id: z.id }; emit('selection'); changed('zones');
  }
  polyPts = null; requestRender();
}
export function cancelDraw() { polyPts = null; wallPts = null; draft = null; calib = null; if (S.tool === 'calib' || S.tool === 'bgmove') setTool('select'); requestRender(); }
export const drawing = () => !!((polyPts && polyPts.length) || (wallPts && wallPts.length) || (calib && calib.a) || S.tool === 'calib' || S.tool === 'bgmove');
function deleteZoneAt(x, y) {
  const z = hitZone(x, y); if (!z) { toast('Hier ist keine Zone.'); return; }
  pushUndo();
  if (z.type === 'shape') S.shapes = S.shapes.filter(s => s.id !== z.id);
  else { z.cells.forEach(k => S.paint.delete(k)); S.paintVer++; }
  S.selZone = null; emit('selection'); changed('zones');
}
export function deleteSelZone() {
  const z = S.selZone; if (!z) return false;
  pushUndo();
  if (z.type === 'shape') S.shapes = S.shapes.filter(s => s.id !== z.id);
  else { z.cells.forEach(k => S.paint.delete(k)); S.paintVer++; }
  S.selZone = null; emit('selection'); changed('zones'); return true;
}
export function setSelZoneKind(kind) {
  const z = S.selZone; if (!z) return;
  pushUndo();
  if (z.type === 'shape') { const s = S.shapes.find(q => q.id === z.id); if (s) s.kind = kind; }
  else { z.cells.forEach(k => S.paint.set(k, kind)); z.kind = kind; S.paintVer++; }
  changed('zones');
}

function showTip() {
  const tip = $('#tip');
  if (!hover || !onSrc().length || S.tool !== 'select') { tip.hidden = true; return; }
  const freqs = mapFreqs(), p = SG.pressure(onSrc(), Float64Array.from([hover.x, hover.y]), freqs, c0(), 0.2, activeRoom());
  let e = 0; for (let i = 0; i < freqs.length; i++) e += p.re[i] * p.re[i] + p.im[i] * p.im[i];
  const L = 10 * Math.log10(e / freqs.length + 1e-24), r = Math.hypot(hover.x, hover.y), a = Math.atan2(hover.x, hover.y) / D2R;
  const z = S.settings.showZones ? allZones().filter(q => Z.contains(q, hover.x, hover.y)).map(q => KIND[q.kind].short) : [];
  tip.innerHTML = `${fmt(S.settings.box_spl + L, 1)} dB <span>SPL</span><br><span>x</span> ${fmt(hover.x, 1)} <span>y</span> ${fmt(hover.y, 1)} m<br><span>${Math.round(a)}° · ${fmt(r, 1)} m${z.length ? ' · ' + [...new Set(z)].join(', ') : ''}</span>`;
  tip.style.left = hover.px + 'px'; tip.style.top = hover.py + 'px';
  tip.style.transform = hover.px > PW - 170 ? 'translate(calc(-100% - 12px),12px)' : 'translate(12px,12px)';
  tip.hidden = false;
}
export function fitView() {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const add = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  S.sources.forEach(s => SG.boxCorners(s.x, s.y, s.rot_deg, S.settings.box_w, S.settings.box_d).forEach(c => add(c[0], c[1])));
  if (S.settings.showZones) allZones().forEach(z => { if (Z.area(z) > 0) { const b = Z.bbox(z); add(b[0], b[1]); add(b[2], b[3]); } });
  S.walls.forEach(w => { for (let i = 0; i < w.p.length; i += 2) add(w.p[i], w.p[i + 1]); });
  if (S.bg && !S.bg.hidden && can('plan')) { add(S.bg.x, S.bg.y); add(S.bg.x + S.bg.w * S.bg.mpp, S.bg.y - S.bg.h * S.bg.mpp); }
  if (!isFinite(x0)) { x0 = -10; x1 = 10; y0 = -5; y1 = 20; }
  const w = Math.max(4, x1 - x0), h = Math.max(4, y1 - y0), r = $('#plan-wrap').getBoundingClientRect();
  PW = r.width; PH = r.height;
  S.view.s = clamp(Math.min((PW - 130) / w, (PH - 120) / h), MIN_ZOOM, MAX_ZOOM);
  S.view.x = (x0 + x1) / 2 - 12 / S.view.s; S.view.y = (y0 + y1) / 2 - 6 / S.view.s;
  changed('view');
}
export function centerOf() { return [S.view.x, S.view.y]; }

/* ---------- box edits ---------- */
export function addBox(x, y) {
  pushUndo(); onUserEdit();
  S.sources.push(Object.assign(SG.makeSource({ x: +x.toFixed(3), y: +y.toFixed(3), channel: 0 }), { pinned: false }));
  S.sel = [S.sources.length - 1]; S.selZone = null; emit('selection'); changed('src');
}
export function rotSel(deg) {
  const sel = selectedIdx(); if (!sel.length) return;
  pushUndo(); onUserEdit();
  sel.forEach(i => {
    const s = S.sources[i], c = SG.boxCentre(s.x, s.y, s.rot_deg, S.settings.box_d);
    s.rot_deg = (((s.rot_deg + deg) % 360) + 360) % 360;
    const f = SG.boxFront(s.rot_deg); s.x = +(c[0] + f[0] * S.settings.box_d / 2).toFixed(3); s.y = +(c[1] + f[1] * S.settings.box_d / 2).toFixed(3);
  });
  changed('src');
}
export function polSel() { const sel = selectedIdx(); if (!sel.length) return; pushUndo(); onUserEdit(); sel.forEach(i => { S.sources[i].polarity *= -1; }); changed('src'); }
export function pinSel() { const sel = selectedIdx(); if (!sel.length) return; pushUndo(); const p = !sel.every(i => S.sources[i].pinned); sel.forEach(i => { S.sources[i].pinned = p; }); toast(p ? 'Fixiert – der Optimierer lässt diese Boxen stehen' : 'Fixierung gelöst'); changed('src'); }
export function dupSel() {
  const sel = selectedIdx(); if (!sel.length) return;
  pushUndo(); onUserEdit();
  const dx = S.settings.box_w + 0.1, n0 = S.sources.length;
  sel.forEach(i => { const s = Object.assign(SG.makeSource(S.sources[i]), { pinned: false }); s.x = +(s.x + dx).toFixed(3); S.sources.push(s); });
  S.sel = S.sources.slice(n0).map((_, k) => n0 + k); emit('selection'); changed('src');
}
export function delSel() {
  const sel = new Set(selectedIdx());
  if (!sel.size && S.selWall) return deleteSelWall();
  if (!sel.size) return deleteSelZone();
  pushUndo(); onUserEdit();
  S.sources = S.sources.filter((_, i) => !sel.has(i)); S.sel = []; emit('selection'); changed('src'); return true;
}
let nudgeT = 0;
export function nudge(dx, dy) {
  const sel = selectedIdx(); if (!sel.length) return;
  if (!nudgeT) pushUndo(); clearTimeout(nudgeT); nudgeT = setTimeout(() => { nudgeT = 0; }, 600);
  onUserEdit(); sel.forEach(i => { S.sources[i].x = +(S.sources[i].x + dx).toFixed(3); S.sources[i].y = +(S.sources[i].y + dy).toFixed(3); }); changed('src');
}

/* ---------- selection bar + context menu ---------- */
function renderSelBar() {
  const bar = $('#selbar');
  $('#sel-wall').hidden = true;
  const sw = S.selWall && S.walls.find(w => w.id === S.selWall);
  if (sw && !S.sel.length) {
    let L = 0; for (let i = 0; i + 3 < sw.p.length; i += 2) L += Math.hypot(sw.p[i + 2] - sw.p[i], sw.p[i + 3] - sw.p[i + 1]);
    $('#sel-info').innerHTML = `<b style="color:${TK.wall}">Wand</b> · ${sw.p.length / 2 - 1} Seg. · ${fmtLen(L, 1)}`;
    const m = wallMat(sw.loss);
    $('#sel-wall-mat').innerHTML = WALL_MAT.map(q => `<option value="${q.loss}" ${q === m ? 'selected' : ''}>${q.label} (−${fmt(q.loss, 1)} dB)</option>`).join('');
    $('#sel-box').hidden = true; $('#sel-zone').hidden = true; $('#sel-wall').hidden = false; bar.hidden = false; return;
  }
  if (S.sel.length) {
    const srcs = S.sel.map(i => S.sources[i]).filter(Boolean), chs = [...new Set(srcs.map(s => s.channel))].map(c => c ? 'K' + c : 'ohne Kanal');
    $('#sel-info').innerHTML = `<b>${srcs.length > 1 ? 'Stack · ' + srcs.length + ' Boxen' : 'Box #' + (S.sel[0] + 1)}</b> · ${chs.join(', ')}${srcs.some(s => s.pinned) ? ' · fixiert' : ''}`;
    $('#sel-box').hidden = false; $('#sel-zone').hidden = true; bar.hidden = false;
  } else if (S.selZone) {
    const kind = S.selZone.type === 'shape' ? (S.shapes.find(z => z.id === S.selZone.id) || {}).kind : S.selZone.kind;
    if (!kind) { bar.hidden = true; return; }
    $('#sel-info').innerHTML = `<b style="color:${KIND[kind].col}">${KIND[kind].label}</b> · ${S.selZone.type === 'shape' ? 'gezeichnet' : 'gemalt'}`;
    $('#sel-box').hidden = true; $('#sel-zone').hidden = false; bar.hidden = false;
    $$k('#sel-zone [data-selkind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.selkind === kind)));
  } else bar.hidden = true;
}
const $$k = s => Array.from(document.querySelectorAll(s));
function openMenu(px, py) {
  const [wx, wy] = s2w(px, py), g = hitStack(px, py), hw = !g ? hitWall(px, py) : null, z = !g && !hw && S.settings.showZones ? hitZone(wx, wy) : null, items = [];
  if (hw) {
    S.selWall = hw.id; S.sel = []; S.selZone = null; emit('selection');
    WALL_MAT.forEach(m => items.push(['wloss:' + m.loss, (wallMat(hw.loss) === m ? '● ' : '') + m.label + ' (−' + fmt(m.loss, 1) + ' dB)', '']));
    items.push(['-'], ['wdel', 'Wand löschen', 'Entf']);
  } else if (g) {
    S.sel = g.idx.slice(); S.selZone = null; S.selWall = null; emit('selection');
    const pinned = g.idx.every(i => S.sources[i].pinned);
    items.push(['rot180', 'Um 180° drehen', 'T'], ['rot90', 'Um 90° drehen', '⇧T'], ['pol', 'Polarität umkehren', 'I'], ['pin', pinned ? 'Fixierung lösen' : 'Fixieren (Optimierer lässt sie stehen)', 'L'], ['dup', 'Duplizieren', 'Strg+D'], ['-'], ['del', 'Löschen', 'Entf']);
  } else if (z) {
    S.selZone = z; S.sel = []; S.selWall = null; emit('selection');
    Object.keys(KIND).forEach(k => items.push(['kind:' + k, 'Typ: ' + KIND[k].label, KIND[k].key]));
    items.push(['-'], ['zdel', 'Zone löschen', 'Entf']);
  } else {
    items.push(['add', 'Box hier hinzufügen', 'A'], ['fit', 'Ansicht einpassen', '0']);
  }
  requestRender();
  const el = $('#ctx');
  el.innerHTML = items.map(([a, t, k]) => a === '-' ? '<hr>' : `<button data-a="${a}"><span>${esc(t)}</span><kbd>${k || ''}</kbd></button>`).join('');
  el.hidden = false;
  const wr = $('#plan-wrap').getBoundingClientRect(), mw = 250, mh = el.offsetHeight;
  el.style.left = Math.min(px, wr.width - mw - 6) + 'px'; el.style.top = Math.min(py, wr.height - mh - 6) + 'px';
  menu = { wx, wy };
  el.onclick = ev => {
    const b = ev.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a; closeMenu();
    if (a === 'rot180') rotSel(180); else if (a === 'rot90') rotSel(90); else if (a === 'pol') polSel(); else if (a === 'pin') pinSel();
    else if (a === 'dup') dupSel(); else if (a === 'del') delSel(); else if (a === 'zdel') deleteSelZone();
    else if (a === 'add') addBox(snapB(wx), snapB(wy)); else if (a === 'fit') fitView();
    else if (a.startsWith('kind:')) setSelZoneKind(a.slice(5));
    else if (a.startsWith('wloss:')) setSelWallLoss(+a.slice(6)); else if (a === 'wdel') deleteSelWall();
  };
}
export function closeMenu() { const el = $('#ctx'); if (el) el.hidden = true; menu = null; }
export const menuOpen = () => !!menu;
export function onResize() { MAP.key = ''; }
