/* SubGrid — zones panel: area type, brush, scenarios, list + numeric editor */
import SG from '../core/engine.js';
import { $, $$, fmt, num, esc, toast, KIND, WALL_MAT, wallMat, TK } from './util.js';
import { S, SCENARIOS, CELL, allZones, pushUndo, changed, emit, scenarioZones, newZoneId, activeRoom, persist } from './state.js';
import { setTool, deleteSelZone, setSelZoneKind, fmtLen } from './plan.js';
import { can, needStudio } from './edition.js';
import { openImage } from './platform.js';

const Z = SG.zones;
let fit = () => {};
export function setZoneFit(fn) { fit = fn; }
const SHAPE_NAME = { rect: 'Rechteck', poly: 'Polygon', circle: 'Kreis', ring: 'Ring', sector: 'Fächer', grid: 'gemalt' };

export function renderKindPicker() {
  const kp = $('#z-kinds');
  if (kp && !kp.children.length) kp.innerHTML = Object.keys(KIND).map(k => `<button data-setkind="${k}" style="--k:${KIND[k].col}" title="${esc(KIND[k].tip)}"><i></i>${KIND[k].label}<kbd>${KIND[k].key}</kbd></button>`).join('');
  $$('[data-setkind]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.setkind === S.kind)));
  const tip = $('#z-kind-tip'); if (tip) tip.innerHTML = `<b style="color:${KIND[S.kind].col}">${KIND[S.kind].label}:</b> ${esc(KIND[S.kind].tip)}`;
  const br = $('#z-brush'); if (br) { br.value = S.brush; $('#z-brush-v').textContent = fmt(S.brush, 1) + ' m'; }
}
export function applyScenario(i) {
  const sc = SCENARIOS[i];
  pushUndo(); scenarioZones(sc.z); Object.assign(S.goal, sc.g);
  emit('goal'); changed('zones'); fit();
}
export function renderZonePanel() {
  renderKindPicker();
  const list = $('#z-list'), zs = allZones();
  const sumKind = {};
  zs.forEach(z => { sumKind[z.kind] = (sumKind[z.kind] || 0) + Z.area(z); });
  $('#z-sum').innerHTML = Object.keys(KIND).map(k => `<span class="zs" style="--k:${KIND[k].col}"><i></i>${KIND[k].short} <b class="mono">${sumKind[k] ? fmt(sumKind[k], 0) + ' m²' : '–'}</b></span>`).join('');
  if (!zs.length) { list.innerHTML = '<div class="note">Noch keine Zonen. Wähle eine Flächenart und zeichne auf dem Plan – oder nimm ein Szenario.</div>'; }
  else {
    list.innerHTML = zs.map(z => {
      const sel = S.selZone && ((S.selZone.type === 'shape' && S.selZone.id === z.id) || (S.selZone.type === 'paint' && z.shape === 'grid' && S.selZone.kind === z.kind));
      return `<button class="zrow ${sel ? 'sel' : ''}" data-zid="${esc(z.id)}" style="--k:${KIND[z.kind].col}"><i></i><span>${KIND[z.kind].label}</span><span class="dim">${SHAPE_NAME[z.shape] || z.shape}</span><span class="mono">${fmt(Z.area(z), 0)} m²</span></button>`;
    }).join('');
  }
  renderEditor();
  renderWalls();
  renderPlanSec();
}

/* ---------- walls & room (Studio) ---------- */
function renderWalls() {
  const el = $('#z-walls'); if (!el) return;
  if (!can('walls')) {
    el.innerHTML = `<p class="note">Wände werfen Schall zurück (Spiegelquellen 1. und 2. Ordnung) – wichtig in Hallen, Aulen und Clubs. ${S.walls.length ? S.walls.length + ' Wand/Wände im Projekt werden angezeigt, aber nicht gerechnet.' : ''}</p><div class="lockbox">Nur in SubGrid Studio</div>`;
    return;
  }
  const ord = S.settings.reflOrder | 0, room = activeRoom();
  const rows = S.walls.map((w, i) => {
    let L = 0; for (let k = 0; k + 3 < w.p.length; k += 2) L += Math.hypot(w.p[k + 2] - w.p[k], w.p[k + 3] - w.p[k + 1]);
    const m = wallMat(w.loss);
    return `<div class="wrow ${S.selWall === w.id ? 'sel' : ''}" data-wid="${w.id}"><i style="background:${m.col}"></i><button class="linkbtn" data-wsel="${w.id}">Wand ${i + 1}</button><span class="mono dim">${w.p.length / 2 - 1} Seg. · ${fmtLen(L, 1)}</span>
      <select data-wloss="${w.id}" aria-label="Material">${WALL_MAT.map(q => `<option value="${q.loss}" ${q === m ? 'selected' : ''}>${q.label}</option>`).join('')}</select></div>`;
  }).join('');
  el.innerHTML = `<div class="seg full" id="z-refl" role="group" aria-label="Reflexionen"><button data-o="0" aria-pressed="${ord === 0}">Aus</button><button data-o="1" aria-pressed="${ord === 1}">1. Ordnung</button><button data-o="2" aria-pressed="${ord === 2}">bis 2. Ordnung</button></div>
    <p class="note">${S.walls.length ? (room ? `Wände wirken auf Karte, Analyse und Optimierer${ord === 2 ? ' (2. Ordnung rechnet deutlich länger)' : ''}.` : 'Reflexionen sind aus – Wände nur als Zeichnung.') : 'Noch keine Wände. Wand-Werkzeug (W) oder schnell einen Raum einfügen:'}</p>
    ${rows ? `<div class="wlist">${rows}</div>` : ''}
    <div class="mini-f three room-f"><label>Breite (m)<input type="number" id="r-w" min="2" max="200" step="0.5" value="${S.roomW || 24}"></label><label>Tiefe (m)<input type="number" id="r-d" min="2" max="300" step="0.5" value="${S.roomD || 30}"></label><label>Hinterwand y (m)<input type="number" id="r-y" min="-100" max="100" step="0.5" value="${S.roomY != null ? S.roomY : -6}"></label></div>
    <div class="btnrow"><button class="btn small" id="r-add">Rechteck-Raum einfügen</button><button class="btn small" id="w-draw">Wand zeichnen (W)</button>${S.walls.length ? '<button class="btn small" id="w-clear">Alle Wände löschen</button>' : ''}</div>`;
}
function addRoom() {
  const w = num($('#r-w').value, 24), d = num($('#r-d').value, 30), y0 = num($('#r-y').value, -6);
  S.roomW = w; S.roomD = d; S.roomY = y0;
  pushUndo();
  const x0 = -w / 2, x1 = w / 2, y1 = y0 + d;
  S.walls.push({ id: newZoneId(), p: [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0], loss: S.wallLoss != null ? S.wallLoss : 0.5 });
  if (!(S.settings.reflOrder > 0)) S.settings.reflOrder = 1;
  changed('zones'); toast(`Raum ${fmt(w, 1)} × ${fmt(d, 1)} m eingefügt – Hinterwand bei y = ${fmt(y0, 1)} m`, 'ok');
}

/* ---------- hall plan (Studio) ---------- */
function renderPlanSec() {
  const el = $('#z-plan'); if (!el) return;
  if (!can('plan')) { el.innerHTML = `<p class="note">Grundriss als Bild (PNG/JPG) unterlegen, mit zwei Punkten maßstäblich machen und Zonen/Wände direkt darauf zeichnen.</p><div class="lockbox">Nur in SubGrid Studio</div>`; return; }
  const bg = S.bg;
  if (!bg) { el.innerHTML = `<p class="note">Grundriss als Bild unterlegen (PNG/JPG, z. B. Screenshot aus dem Hallen-PDF). Danach mit zwei Punkten bekannter Länge kalibrieren.</p><button class="btn small" id="bg-load">Bild laden …</button>`; return; }
  el.innerHTML = `<div class="bgrow"><span class="mono dim">${esc(bg.name || 'Plan')}</span><span class="mono dim">${fmtLen(bg.w * bg.mpp, 1)} × ${fmtLen(bg.h * bg.mpp, 1)}</span></div>
    <label class="lbl">Deckkraft <span class="mono" id="bg-op-v">${Math.round((bg.opacity != null ? bg.opacity : 0.6) * 100)} %</span><input type="range" id="bg-op" min="0.05" max="1" step="0.05" value="${bg.opacity != null ? bg.opacity : 0.6}"></label>
    <label class="switch"><input type="checkbox" id="bg-inv" ${bg.invert !== false ? 'checked' : ''}> Linien hell (für Pläne mit weißem Hintergrund)</label>
    <label class="switch"><input type="checkbox" id="bg-hide" ${bg.hidden ? 'checked' : ''}> ausblenden</label>
    <div class="btnrow"><button class="btn small primary" id="bg-cal">Kalibrieren</button><button class="btn small" id="bg-move">Verschieben</button><button class="btn small" id="bg-load">Anderes Bild</button><button class="btn small danger" id="bg-del">Entfernen</button></div>`;
}
async function loadPlanImage() {
  if (needStudio('plan')) return;
  const f = await openImage(); if (!f) return;
  const img = new Image();
  img.onload = () => {
    // keep the project small: at most 2400 px on the long side, JPEG for photos/scans
    const k = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight));
    const cv = document.createElement('canvas'); cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
    const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
    let url = cv.toDataURL('image/jpeg', 0.85);
    if (f.url.startsWith('data:image/png') && f.size < url.length * 0.75) url = f.url;
    // first guess: 40 m wide, centred above the origin – calibrate afterwards
    const mpp = 40 / cv.width;
    S.bg = { url, name: f.name, w: cv.width, h: cv.height, mpp, x: -20, y: cv.height * mpp - 8, opacity: 0.6, invert: true };
    changed('view'); persist(); renderPlanSec(); emit('fit');
    toast('Plan geladen – jetzt mit zwei Punkten kalibrieren', 'ok');
    setTool('calib');
  };
  img.onerror = () => toast('Bild konnte nicht gelesen werden.', 'err');
  img.src = f.url;
}
function renderEditor() {
  const ed = $('#z-edit'), sz = S.selZone;
  if (!sz) { ed.innerHTML = ''; ed.hidden = true; return; }
  ed.hidden = false;
  const kindSel = k => `<div class="kinds compact">${Object.keys(KIND).map(q => `<button data-zkind="${q}" aria-pressed="${q === k}" style="--k:${KIND[q].col}"><i></i>${KIND[q].short}</button>`).join('')}</div>`;
  if (sz.type === 'paint') {
    ed.innerHTML = `<div class="ed-h">Gemalte Fläche · ${fmt(sz.cells.size * CELL * CELL, 0)} m²</div>${kindSel(sz.kind)}<div class="note">Mit Pinsel (B) ergänzen, mit Radierer (X) wegnehmen. Ziehen verschiebt sie.</div><button class="btn small danger" id="z-del">Fläche löschen</button>`;
    return;
  }
  const z = S.shapes.find(s => s.id === sz.id); if (!z) { ed.hidden = true; return; }
  const p = z.p, f = (k, label, v, step) => `<label>${label}<input type="number" data-zp="${k}" step="${step || 0.1}" value="${+(+v).toFixed(2)}"></label>`;
  let fields = '';
  if (z.shape === 'rect') fields = f(0, 'x von', p[0]) + f(2, 'x bis', p[2]) + f(1, 'y von', p[1]) + f(3, 'y bis', p[3]);
  else if (z.shape === 'circle') fields = f(0, 'Mitte x', p[0]) + f(1, 'Mitte y', p[1]) + f(2, 'Radius', p[2]);
  else if (z.shape === 'ring') fields = f(0, 'Mitte x', p[0]) + f(1, 'Mitte y', p[1]) + f(2, 'r innen', p[2]) + f(3, 'r außen', p[3]);
  else if (z.shape === 'sector') {
    const span = Z.angSpan(p[4], p[5]), mid = ((p[4] + span / 2) % 360 + 540) % 360 - 180;
    fields = f(0, 'Spitze x', p[0]) + f(1, 'Spitze y', p[1]) + f(2, 'ab m', p[2], 0.5) + f(3, 'bis m', p[3], 0.5) + f('dir', 'Richtung °', mid, 5) + f('span', 'Öffnung °', span, 5);
  } else if (z.shape === 'poly') fields = `<div class="note" style="grid-column:1/-1">${p.length / 2} Ecken – auf dem Plan an den Griffen ziehen.</div>`;
  ed.innerHTML = `<div class="ed-h">${SHAPE_NAME[z.shape]} · ${fmt(Z.area(z), 0)} m²</div>${kindSel(z.kind)}<div class="mini-f">${fields}</div><button class="btn small danger" id="z-del">Zone löschen</button>`;
}
export function initZonePanel() {
  $('#z-scen').innerHTML = SCENARIOS.map((s, i) => `<button class="chip" data-scen="${i}">${s.name}</button>`).join('');
  $('#z-scen').addEventListener('click', e => { const b = e.target.closest('[data-scen]'); if (b) applyScenario(+b.dataset.scen); });
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-setkind]'); if (!b) return;
    S.kind = b.dataset.setkind; renderKindPicker();
    if (!['rect', 'poly', 'circle', 'fan', 'brush'].includes(S.tool)) setTool('rect');
    emit('kind');
  });
  $('#z-brush').addEventListener('input', e => { S.brush = num(e.target.value, 1.5); renderKindPicker(); });
  $('#z-list').addEventListener('click', e => {
    const b = e.target.closest('[data-zid]'); if (!b) return;
    const id = b.dataset.zid;
    if (id.startsWith('grid-')) { const k = id.slice(5), cells = new Set(); S.paint.forEach((q, key) => { if (q === k) cells.add(key); }); S.selZone = { type: 'paint', kind: k, cells }; }
    else S.selZone = { type: 'shape', id };
    S.sel = []; setTool('select'); emit('selection'); changed('view');
  });
  const ed = $('#z-edit');
  ed.addEventListener('click', e => {
    if (e.target.closest('#z-del')) { deleteSelZone(); return; }
    const k = e.target.closest('[data-zkind]'); if (k) setSelZoneKind(k.dataset.zkind);
  });
  ed.addEventListener('change', e => {
    const k = e.target.dataset.zp; if (k == null || !S.selZone || S.selZone.type !== 'shape') return;
    const z = S.shapes.find(s => s.id === S.selZone.id); if (!z) return;
    const v = num(e.target.value, NaN); if (!isFinite(v)) return;
    pushUndo();
    if (k === 'dir' || k === 'span') {
      const span = Z.angSpan(z.p[4], z.p[5]), mid = z.p[4] + span / 2;
      const nm = k === 'dir' ? v : mid, ns = k === 'span' ? Math.max(5, Math.min(360, v)) : span;
      z.p[4] = nm - ns / 2; z.p[5] = nm + ns / 2;
    } else {
      z.p[+k] = v;
      if (z.shape === 'rect') { const [a, b, c, d] = z.p; z.p = [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)]; }
      if (z.shape === 'sector' || z.shape === 'ring') { z.p[2] = Math.max(0, z.p[2]); z.p[3] = Math.max(z.p[2] + 0.1, z.p[3]); }
      if (z.shape === 'circle') z.p[2] = Math.max(0.1, z.p[2]);
    }
    changed('zones');
  });
  const wl = $('#z-walls');
  wl.addEventListener('click', e => {
    const o = e.target.closest('[data-o]');
    if (o) { S.settings.reflOrder = +o.dataset.o; changed('zones'); return; }
    if (e.target.closest('#r-add')) { addRoom(); return; }
    if (e.target.closest('#w-draw')) { setTool('wall'); return; }
    if (e.target.closest('#w-clear')) { pushUndo(); S.walls = []; S.selWall = null; emit('selection'); changed('zones'); return; }
    const ws = e.target.closest('[data-wsel]');
    if (ws) { S.selWall = ws.dataset.wsel; S.sel = []; S.selZone = null; setTool('select'); emit('selection'); changed('view'); }
  });
  wl.addEventListener('change', e => {
    const id = e.target.dataset.wloss; if (!id) return;
    const w = S.walls.find(q => q.id === id); if (!w) return;
    pushUndo(); w.loss = +e.target.value; S.wallLoss = w.loss; changed('zones');
  });
  const pl = $('#z-plan');
  pl.addEventListener('click', e => {
    if (e.target.closest('#bg-load')) { loadPlanImage(); return; }
    if (!S.bg) return;
    if (e.target.closest('#bg-cal')) { setTool('calib'); toast('Ersten Punkt auf dem Plan anklicken'); return; }
    if (e.target.closest('#bg-move')) { setTool('bgmove'); return; }
    if (e.target.closest('#bg-del')) { S.bg = null; if (S.tool === 'calib' || S.tool === 'bgmove') setTool('select'); changed('view'); persist(); renderPlanSec(); }
  });
  pl.addEventListener('input', e => {
    if (!S.bg) return;
    if (e.target.id === 'bg-op') { S.bg.opacity = +e.target.value; $('#bg-op-v').textContent = Math.round(S.bg.opacity * 100) + ' %'; changed('view'); }
  });
  pl.addEventListener('change', e => {
    if (!S.bg) return;
    if (e.target.id === 'bg-inv') S.bg.invert = e.target.checked;
    if (e.target.id === 'bg-hide') S.bg.hidden = e.target.checked;
    if (e.target.id === 'bg-op') S.bg.opacity = +e.target.value;
    changed('view'); persist();
  });
  $('#z-clear').addEventListener('click', () => {
    if (!allZones().length) return;
    pushUndo(); S.shapes = []; S.paint = new Map(); S.paintVer++; S.selZone = null; emit('selection'); changed('zones');
  });
}
