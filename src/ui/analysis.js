/* SubGrid — analysis: KPI tiles, polar, angle map (directivity), frequency response */
import SG from '../core/engine.js';
import { $, clamp, fmt, sfmt, fHz, esc, D2R, TK, POLAR_F, POLAR_COL, colorAt, fitCanvas, FONT_M } from './util.js';
import { S, onSrc, c0, band, getScorer } from './state.js';

let AN = null;
export function computeAnalysis() {
  const on = onSrc(), c = c0(), [lo, hi] = band();
  if (!on.length) { AN = null; return; }
  const mAll = SG.computeMetrics(on, SG.logspace(20, 200, 61), c);
  const mBand = SG.computeMetrics(on, SG.bandFreqs(lo, hi), c);
  const bs = SG.bandSummary(mBand, lo, hi);
  const sc = getScorer();
  let zone = null;
  if (sc) { try { zone = sc.assess(on); } catch (e) { zone = null; } }
  AN = { mAll, bs, zone, n: on.length };
}
export const analysis = () => AN;

function tile(label, value, unit, sub, cls, title) {
  return `<div class="kpi ${cls || ''}" title="${esc(title || '')}"><div class="kpi-l"><span>${label}</span></div><div class="kpi-v">${value}<small>${unit || ''}</small></div><div class="kpi-s">${sub || '&nbsp;'}</div></div>`;
}
export function renderKpis() {
  const el = $('#kpis'), [lo, hi] = band();
  $('#ana-band').textContent = `${lo}–${hi} Hz · ${fmt(S.settings.temp, 0)} °C`;
  if (!AN) { el.innerHTML = '<div class="note" style="grid-column:1/-1;padding:10px 2px">Noch keine Boxen. Starte den Optimierer, wähle eine Vorlage oder setze Boxen mit dem Box-Werkzeug (A).</div>'; return; }
  const b = AN.bs, z = AN.zone, ideal = 20 * Math.log10(AN.n), loss = ideal - b.on_mean, t = [];
  t.push(tile('Pegel vorne', sfmt(b.on_mean, 1), ' dB', `re 1 Box · ideal ${sfmt(ideal, 1)}`, loss <= 3 ? 'g' : loss <= 6 ? 'w' : 'b', 'Pegel auf der Mittelachse im Fernfeld, Mittel über das Band'));
  t.push(tile('Rückwärts', sfmt(b.rear_worst, 1), ' dB', '150–210°, schlechtester Wert', b.rear_worst <= -12 ? 'g' : b.rear_worst <= -6 ? 'w' : 'b', 'Lautester Punkt hinten relativ zu vorne, schlechteste Frequenz im Band'));
  t.push(tile('Öffnung −6 dB', Math.round(b.bw_mean), '°', `${Math.round(b.bw_min)}–${Math.round(b.bw_max)}° im Band`, '', 'Gesamtwinkel um 0°, bis der Pegel 6 dB unter vorne fällt'));
  const both = z && z.rej != null && z.rejS != null;
  if (!both) t.push(tile('Nebenkeulen', b.sidelobe < -90 ? 'keine' : sfmt(b.sidelobe, 1), b.sidelobe < -90 ? '' : ' dB', 'außerhalb der Hauptkeule', b.sidelobe <= -10 ? 'g' : b.sidelobe <= -6 ? 'w' : 'b'));
  if (z) {
    t.push(tile('Gleichmäßigkeit', '±' + fmt(z.spread, 1), ' dB', 'Streuung im Publikum (σ)', z.spread <= 3 ? 'g' : z.spread <= 5 ? 'w' : 'b', 'Standardabweichung des Pegels über die Publikumsfläche'));
    const zt = (label, v, target) => tile(label, sfmt(v, 1), ' dB', `re Publikum · Ziel ${sfmt(target, 0)}`, v <= target ? 'g' : v <= target + 6 ? 'w' : 'b', 'Mittlerer Pegel in der Fläche relativ zum Publikum');
    if (z.rej != null) t.push(zt('Ruhezone', z.rej, S.goal.quietTarget));
    if (z.rejS != null) t.push(zt('Bühne', z.rejS, S.goal.stageTarget));
    if (z.rej == null && z.rejS == null) t.push(tile('Ruhe / Bühne', '–', '', 'keine gezeichnet', ''));
    t.push(tile('Effizienz', sfmt(z.eff, 1), ' dB', 'vs. perfekte Summe', z.eff >= -3 ? 'g' : z.eff >= -6 ? 'w' : 'b', 'Pegel im Publikum relativ zur Summe, wenn alle Boxen überall perfekt addieren würden'));
    t.push(tile('SPL Publikum', z.spl10 != null ? fmt(z.spl10, 0) : '–', ' dB', '90 % der Fläche liegen darüber', ''));
  } else t.push('<div class="kpi" style="grid-column:1/-1"><div class="kpi-s" style="white-space:normal">Gleichmäßigkeit, Bühne und Effizienz erscheinen, sobald eine Publikumsfläche gezeichnet ist.</div></div>');
  el.innerHTML = t.join('');
}

export function renderAna() {
  const { ctx, W, H } = fitCanvas($('#ana'));
  ctx.fillStyle = TK.bg; ctx.fillRect(0, 0, W, H);
  const chips = $('#fchips'), note = $('#ana-note');
  if (!AN) { chips.innerHTML = ''; note.textContent = ''; return; }
  if (S.anaTab === 'polar') {
    chips.innerHTML = POLAR_F.map(f => `<button class="fchip" data-f="${f}" aria-pressed="${S.settings.polarFreqs.includes(f)}"><i style="background:${POLAR_COL[f]}"></i>${fHz(f)}</button>`).join('');
    drawPolar(ctx, W, H, onSrc(), S.settings.polarFreqs.slice().sort((a, b) => a - b), { labels: true });
    note.textContent = 'Fernfeld (100 m), je Frequenz auf das Maximum normiert. 0° = vorne, Ringe alle 6 dB.';
  } else if (S.anaTab === 'dmap') {
    chips.innerHTML = ''; drawDmap(ctx, W, H);
    note.textContent = 'Pegel relativ zu vorne je Frequenz, 3-dB-Stufen. Weiße Linie = −6 dB. Inseln außerhalb der Mitte sind Nebenkeulen.';
  } else {
    chips.innerHTML = `<span class="fchip" aria-pressed="true"><i style="background:${TK.accent}"></i>0° vorne</span><span class="fchip" aria-pressed="true"><i style="background:${TK.blue}"></i>90° Seite</span><span class="fchip" aria-pressed="true"><i style="background:${TK.bad}"></i>180° hinten</span><span class="fchip" aria-pressed="true"><i style="background:#9aa5b1"></i>ideale Summe</span>`;
    drawFreq(ctx, W, H);
    note.textContent = 'Oben: Pegel re 1 Box im Fernfeld. Unten: −6-dB-Öffnungswinkel. Hinterlegt = Band.';
  }
}
export function drawPolar(ctx, W, H, srcs, freqs, o) {
  o = o || {};
  const pad = o.labels ? 26 : 3, R = Math.max(10, Math.min(W, H) / 2 - pad), cx = W / 2, cy = H / 2, range = 30;
  ctx.lineWidth = 1;
  for (let k = 0; k <= range; k += 6) { ctx.beginPath(); ctx.arc(cx, cy, R * (1 - k / range), 0, 2 * Math.PI); ctx.strokeStyle = k === 6 ? 'rgba(232,119,34,.4)' : k === 0 ? TK.line2 : TK.line; ctx.stroke(); }
  for (let a = 0; a < 360; a += 30) { const r = a * D2R; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + R * Math.sin(r), cy - R * Math.cos(r)); ctx.strokeStyle = a % 90 ? TK.line : TK.line2; ctx.stroke(); }
  if (o.labels) {
    ctx.font = '10px ' + FONT_M; ctx.fillStyle = TK.faint; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let a = 0; a < 360; a += 30) { const r = a * D2R; ctx.fillText((a > 180 ? a - 360 : a) + '°', cx + (R + 14) * Math.sin(r), cy - (R + 14) * Math.cos(r)); }
    ctx.textAlign = 'left'; for (let k = 6; k < range; k += 6) ctx.fillText('−' + k, cx + 3, cy - R * (1 - k / range) + 7);
  }
  if (!srcs.length || !freqs.length) return;
  const ang = []; for (let a = 0; a < 360; a += o.labels ? 1 : 3) ang.push(a);
  const L = SG.polarDb(srcs, freqs, c0(), ang, 100);
  freqs.forEach((f, i) => {
    let mx = -1e9; for (let a = 0; a < ang.length; a++) mx = Math.max(mx, L[i * ang.length + a]);
    ctx.beginPath();
    for (let a = 0; a <= ang.length; a++) {
      const aa = a % ang.length, v = clamp(L[i * ang.length + aa] - mx, -range, 0), r = R * (1 + v / range), t = ang[aa] * D2R;
      const x = cx + r * Math.sin(t), y = cy - r * Math.cos(t); a ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = o.colors ? o.colors[i] : (POLAR_COL[f] || TK.accent); ctx.lineWidth = o.labels ? 1.8 : 1.4; ctx.stroke();
  });
}
export const axisLog = (x0, x1, f) => x0 + (Math.log(f / 20) / Math.log(10)) * (x1 - x0);
function drawDmap(ctx, W, H) {
  const padL = 38, padR = 8, padT = 8, padB = 24, fN = 64, freqs = SG.logspace(20, 200, fN), ang = [];
  for (let a = -180; a <= 180; a += 2) ang.push(a);
  const M = SG.directivityMap(onSrc(), freqs, c0(), ang), A = ang.length, gw = W - padL - padR, gh = H - padT - padB;
  const off = document.createElement('canvas'); off.width = A; off.height = fN;
  const o = off.getContext('2d'), im = o.createImageData(A, fN), lo = -30, hi = 3;
  for (let i = 0; i < fN; i++) for (let a = 0; a < A; a++) {
    const v = M[i * A + a]; let t = (v - lo) / (hi - lo); t = (Math.floor(t * 11) + 0.5) / 11;
    const col = colorAt(clamp(t, 0, 1)), k = 4 * ((fN - 1 - i) * A + a);
    im.data[k] = col[0]; im.data[k + 1] = col[1]; im.data[k + 2] = col[2]; im.data[k + 3] = 255;
  }
  o.putImageData(im, 0, 0); ctx.imageSmoothingEnabled = true; ctx.drawImage(off, padL, padT, gw, gh);
  ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.6; ctx.beginPath();
  const X = a => padL + a / (A - 1) * gw, Y = i => padT + (1 - i / (fN - 1)) * gh;
  for (let i = 0; i < fN - 1; i++) for (let a = 0; a < A - 1; a++) {
    const v00 = M[i * A + a] + 6, v10 = M[i * A + a + 1] + 6, v01 = M[(i + 1) * A + a] + 6;
    if ((v00 > 0) !== (v10 > 0)) { const t = v00 / (v00 - v10), x = X(a + t); ctx.moveTo(x, Y(i - 0.5)); ctx.lineTo(x, Y(i + 0.5)); }
    if ((v00 > 0) !== (v01 > 0)) { const t = v00 / (v00 - v01), y = Y(i + t); ctx.moveTo(X(a - 0.5), y); ctx.lineTo(X(a + 0.5), y); }
  }
  ctx.stroke();
  const [lo2, hi2] = band(); ctx.setLineDash([4, 4]); ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.lineWidth = 1;
  for (const f of [lo2, hi2]) { const y = padT + gh - axisLog(0, gh, f); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke(); }
  ctx.setLineDash([]); ctx.font = '10px ' + FONT_M; ctx.fillStyle = TK.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (const f of [20, 31.5, 40, 50, 63, 80, 100, 125, 160, 200]) ctx.fillText(fHz(f), padL - 5, padT + gh - axisLog(0, gh, f));
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const a of [-180, -90, 0, 90, 180]) ctx.fillText(a + '°', clamp(padL + (a + 180) / 360 * gw, padL + 12, padL + gw - 12), padT + gh + 6);
  ctx.strokeStyle = TK.line2; ctx.strokeRect(padL + 0.5, padT + 0.5, gw - 1, gh - 1);
}
function drawFreq(ctx, W, H) {
  const m = AN.mAll, padL = 38, padR = 10, padT = 8, gap = 22, padB = 22;
  const gw = W - padL - padR, h1 = (H - padT - padB - gap) * 0.62, h2 = (H - padT - padB - gap) - h1;
  const X = f => padL + axisLog(0, gw, f), ideal = 20 * Math.log10(AN.n);
  const top = Math.ceil((Math.max(...m.on_axis, ideal) + 2) / 6) * 6, bot = top - 42;
  const Y1 = v => padT + (top - clamp(v, bot, top)) / (top - bot) * h1, y2top = padT + h1 + gap, Y2 = v => y2top + (1 - v / 360) * h2;
  const [lo, hi] = band();
  ctx.fillStyle = 'rgba(232,119,34,.07)'; ctx.fillRect(X(lo), padT, X(hi) - X(lo), h1); ctx.fillRect(X(lo), y2top, X(hi) - X(lo), h2);
  ctx.strokeStyle = TK.line; ctx.lineWidth = 1; ctx.font = '10px ' + FONT_M; ctx.fillStyle = TK.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = bot; v <= top; v += 6) { const y = Y1(v); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke(); ctx.fillText((v > 0 ? '+' : '') + v, padL - 5, y); }
  for (const v of [0, 90, 180, 270, 360]) { const y = Y2(v); ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + gw, y); ctx.stroke(); ctx.fillText(v + '°', padL - 5, y); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const f of [20, 31.5, 40, 50, 63, 80, 100, 125, 160, 200]) { const x = X(f); ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, padT + h1); ctx.moveTo(x, y2top); ctx.lineTo(x, y2top + h2); ctx.stroke(); ctx.fillText(fHz(f), x, y2top + h2 + 6); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillStyle = TK.faint; ctx.fillText('dB re 1 Box', padL + 4, padT + 3); ctx.fillText('−6-dB-Öffnung', padL + 4, y2top + 3);
  const line = (arr, col, Y, w, dash) => { ctx.beginPath(); m.freqs.forEach((f, i) => { const x = X(f), y = Y(arr[i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
  ctx.save(); ctx.beginPath(); ctx.rect(padL, padT, gw, h1); ctx.clip();
  line(m.freqs.map(() => ideal), '#9aa5b1', Y1, 1.2, [5, 4]);
  line(m.on_axis.map((v, i) => v + m.side90[i]), TK.blue, Y1, 1.6);
  line(m.on_axis.map((v, i) => v + m.rear[i]), TK.bad, Y1, 1.6);
  line(m.on_axis, TK.accent, Y1, 2.2);
  ctx.restore();
  line(m.beamwidth, TK.accent, Y2, 1.8);
  ctx.strokeStyle = TK.line2; ctx.strokeRect(padL + 0.5, padT + 0.5, gw - 1, h1 - 1); ctx.strokeRect(padL + 0.5, y2top + 0.5, gw - 1, h2 - 1);
}
/** small polar for result cards / knowledge cards (canvas sized 2x) */
export function miniPolar(cv, srcs, size) {
  const ctx = cv.getContext('2d'); ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.fillStyle = TK.bg; ctx.fillRect(0, 0, size, size);
  const [lo, hi] = band();
  drawPolar(ctx, size, size, srcs, [lo, Math.sqrt(lo * hi), hi], { colors: [TK.blue, TK.good, TK.accent] });
}
