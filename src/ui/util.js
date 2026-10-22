/* SubGrid — small UI helpers */
export const $ = (s, r) => (r || document).querySelector(s);
export const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
export const D2R = Math.PI / 180;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const fmt = (v, d) => {
  d = d == null ? 1 : d;
  if (v == null || !isFinite(v)) return '–';
  const p = Math.pow(10, d);
  return (Math.round(v * p) / p).toFixed(d).replace('.', ',');
};
export const sfmt = (v, d) => (v == null || !isFinite(v)) ? '–' : (v > 0.0001 ? '+' : v < -0.0001 ? '−' : '±') + fmt(Math.abs(v), d);
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fHz = f => f < 100 ? (Math.round(f * 10) / 10 === Math.round(f) ? String(Math.round(f)) : fmt(f, 1)) : String(Math.round(f));
export const num = (v, def) => { const x = parseFloat(String(v).replace(',', '.')); return isFinite(x) ? x : def; };

/* colours used in canvas drawings (CSS tokens mirror these) */
export const TK = {
  bg: '#0b0c0e', panel: '#141619', line: '#262a30', line2: '#343940', grid: 'rgba(255,255,255,.045)', grid2: 'rgba(255,255,255,.10)',
  text: '#d9dbde', muted: '#9097a0', faint: '#5f656d', white: '#f3f4f5',
  accent: '#e87722', blue: '#4a9edd', bad: '#e0584c', good: '#5fb76b', warn: '#d9aa3a',
  aud: '#4a9edd', quiet: '#e0584c', stage: '#b48be6', place: '#e87722', nogo: '#9aa5b1', wall: '#d5d9de',
};
export const KIND = {
  audience: { label: 'Publikum', short: 'Publikum', col: TK.aud, fill: 'rgba(74,158,221,.10)', key: '1', tip: 'Hier soll es gleichmäßig und laut sein.' },
  stage: { label: 'Bühne', short: 'Bühne', col: TK.stage, fill: 'rgba(180,139,230,.11)', key: '2', tip: 'Musiker: weniger Sub-Pegel, eigenes Ziel (Standard −10 dB).' },
  quiet: { label: 'Ruhezone', short: 'Ruhe', col: TK.quiet, fill: 'rgba(224,88,76,.11)', key: '3', tip: 'Anwohner, Backstage, FOH-Rückseite: so leise wie möglich.' },
  place: { label: 'Aufstellfläche', short: 'Aufstellung', col: TK.place, fill: 'rgba(232,119,34,.10)', key: '4', tip: 'Nur hier dürfen Subs stehen.' },
  nogo: { label: 'Sperrfläche', short: 'Sperre', col: TK.nogo, fill: 'rgba(154,165,177,.13)', key: '5', tip: 'Fluchtweg, Säule, Kabelbrücke: hier nie eine Box.' },
};
export const KIND_ORDER = ['place', 'nogo', 'audience', 'stage', 'quiet'];   // drawing order (bottom → top)
/* wall materials: reflection loss per bounce (dB) */
export const WALL_MAT = [
  { loss: 0.5, label: 'Beton / Mauer', col: '#d5d9de' },
  { loss: 2, label: 'Holz / Gipskarton', col: '#c9a77a' },
  { loss: 5, label: 'Vorhang / Molton', col: '#a08fd0' },
  { loss: 10, label: 'Absorber / offen', col: '#6f8f7a' },
];
export const wallMat = loss => WALL_MAT.reduce((b, m) => Math.abs(m.loss - loss) < Math.abs(b.loss - loss) ? m : b, WALL_MAT[0]);
export const CH_COL = ['#e87722', '#4a9edd', '#5fb76b', '#d9aa3a', '#b07cd8', '#45c4c0', '#e0607e', '#c98b4a', '#7f9be8', '#a3c95a', '#d17fb8', '#5fa9a0'];
export const chColor = ch => ch > 0 ? CH_COL[(ch - 1) % CH_COL.length] : '#9aa5b1';
export const POLAR_F = [31.5, 40, 50, 63, 80, 100, 125, 160];
export const POLAR_COL = { 31.5: '#7f9be8', 40: '#4a9edd', 50: '#45c4c0', 63: '#5fb76b', 80: '#d9aa3a', 100: '#e87722', 125: '#e0584c', 160: '#e0607e' };
export const FONT_M = '"Share Tech Mono", ui-monospace, Consolas, monospace';
export const FONT_U = '"Exo 2", system-ui, "Segoe UI", sans-serif';

/* turbo colormap, 256-entry LUT */
export const LUT = (() => {
  const a = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const r = 0.13572138 + t * (4.61539260 + t * (-42.66032258 + t * (132.13108234 + t * (-152.94239396 + t * 59.28637943))));
    const g = 0.09140261 + t * (2.19418839 + t * (4.84296658 + t * (-14.18503333 + t * (4.27729857 + t * 2.82956604))));
    const b = 0.10667330 + t * (12.64194608 + t * (-60.58204836 + t * (110.36276771 + t * (-89.90310912 + t * 27.34824973))));
    a[3 * i] = r * 255; a[3 * i + 1] = g * 255; a[3 * i + 2] = b * 255;
  }
  return a;
})();
export function colorAt(t) { const i = clamp(Math.round(t * 255), 0, 255); return [LUT[3 * i], LUT[3 * i + 1], LUT[3 * i + 2]]; }
export const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

export function fitCanvas(cv) {
  const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: r.width, H: r.height, dpr };
}

export function toast(msg, kind) {
  const t = document.createElement('div'); t.className = 'toast ' + (kind || ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), 4000);
}
export function openModal(title, html) { $('#modal-t').textContent = title; $('#modal-b').innerHTML = html; $('#modal').hidden = false; }
export function closeModal() { $('#modal').hidden = true; }
export function showText(title, txt, intro) {
  openModal(title, `<p class="note" style="margin:0">${esc(intro || '')}</p><textarea readonly id="modal-ta">${esc(txt)}</textarea>`);
  const ta = $('#modal-ta'); ta.focus(); ta.select();
}
export function gauge(v, good, ok, lowerBetter) {
  if (v == null || !isFinite(v)) return '';
  return lowerBetter ? (v <= good ? 'g' : v <= ok ? 'w' : 'b') : (v >= good ? 'g' : v >= ok ? 'w' : 'b');
}
