/* SubGrid — Rechner + Wissen pages */
import SG from '../core/engine.js';
import { TEMPLATES, KNOW, templateDefaults } from '../core/templates.js';
import { $, clamp, fmt, sfmt, fHz, TK, fitCanvas, FONT_M } from './util.js';
import { S, c0, band, env } from './state.js';
import { drawPolar, axisLog } from './analysis.js';

const out = (label, v, unit, hl) => `<div class="out ${hl ? 'hl' : ''}"><div class="l">${label}</div><div class="v">${v}<small> ${unit || ''}</small></div></div>`;
const val = id => { const v = parseFloat(String($(id).value).replace(',', '.')); return isFinite(v) ? v : 0; };
export function renderCalc() {
  const RH = S.settings.RH;
  const f = Math.max(1, val('#c1-f') || 80), c1 = SG.speedOfSound(val('#c1-t'), RH), lam = c1 / f;
  $('#c1-out').innerHTML = out('c', fmt(c1, 1), 'm/s') + out('λ', fmt(lam, 2), 'm', true) + out('λ/2', fmt(lam / 2, 2), 'm') + out('λ/4', fmt(lam / 4, 2), 'm', true) + out('Periode', fmt(1000 / f, 2), 'ms') + out('λ/4 als Delay', fmt(250 / f, 2), 'ms');
  const c = c0(), d = val('#c2-d'), tms = val('#c2-ms'), dd = val('#c2-top') - val('#c2-sub'), dt = Math.abs(dd) / c * 1000;
  $('#c2-out').innerHTML = out(fmt(d, 2) + ' m', fmt(d / c * 1000, 2), 'ms', true) + out(fmt(tms, 2) + ' ms', fmt(tms * c / 1000, 2), 'm') + out(dd > 0 ? 'Sub verzögern' : dd < 0 ? 'Top verzögern' : 'kein Delay', fmt(dt, 2), 'ms', true) + out('Wegdifferenz', fmt(Math.abs(dd), 2), 'm');
  const spl = val('#c3-spl'), n = Math.max(1, Math.round(val('#c3-n') || 1)), dist = Math.max(1, val('#c3-d') || 1);
  const coh = spl + 20 * Math.log10(n), inc = spl + 10 * Math.log10(n), loss = 20 * Math.log10(dist);
  $('#c3-out').innerHTML = out('gekoppelt @1 m', fmt(coh, 1), 'dB', true) + out('Gewinn', '+' + fmt(20 * Math.log10(n), 1), 'dB') + out('@ ' + fmt(dist, 0) + ' m', fmt(coh - loss, 1), 'dB', true) + out('unkorreliert', fmt(inc - loss, 1), 'dB');
  splCurve(spl, n, dist);
  const D = Math.max(0.1, val('#c4-D') || 1), ca = SG.speedOfSound(val('#c4-t1'), RH), cb = SG.speedOfSound(val('#c4-t2'), RH), set = D / ca * 1000, need = D / cb * 1000;
  const [lo, hi] = band(), fc = Math.sqrt(lo * hi);
  const rej = (cc, fq) => { const src = [SG.makeSource({ x: 0, y: 0 }), SG.makeSource({ x: 0, y: -D, delay_ms: set, polarity: -1 })]; const L = SG.polarDb(src, [fq], cc, [0, 180], 100); return L[1] - L[0]; };
  $('#c4-out').innerHTML = out('Delay eingestellt', fmt(set, 2), 'ms') + out('nötig bei T₂', fmt(need, 2), 'ms') + out('Fehler', fmt(Math.abs(set - need) * 1000, 0), 'µs', true) + out('Hinten @ ' + Math.round(fc) + ' Hz', sfmt(Math.max(-60, rej(cb, fc)), 1), 'dB', true);
  drift(D, set, ca, cb);
}
function frame(cv) { const { ctx, W, H } = fitCanvas(cv); ctx.fillStyle = TK.bg; ctx.fillRect(0, 0, W, H); return { ctx, W, H }; }
function splCurve(spl, n, dist) {
  const { ctx, W, H } = frame($('#c3-cv')), padL = 36, padR = 10, padT = 10, padB = 22, gw = W - padL - padR, gh = H - padT - padB;
  const dMax = Math.max(100, dist * 2), X = d => padL + Math.log10(d) / Math.log10(dMax) * gw, top = Math.ceil((spl + 20 * Math.log10(n) + 3) / 10) * 10, bot = top - 70, Y = v => padT + (top - v) / (top - bot) * gh;
  ctx.strokeStyle = TK.line; ctx.lineWidth = 1; ctx.font = '10px ' + FONT_M; ctx.fillStyle = TK.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = bot; v <= top; v += 10) { ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(padL + gw, Y(v)); ctx.stroke(); ctx.fillText(v, padL - 4, Y(v)); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const d of [1, 2, 5, 10, 20, 50, 100, 200, 500]) if (d <= dMax) { ctx.beginPath(); ctx.moveTo(X(d), padT); ctx.lineTo(X(d), padT + gh); ctx.stroke(); ctx.fillText(d + ' m', X(d), padT + gh + 5); }
  const curve = (L0, col, w, dash) => { ctx.beginPath(); for (let i = 0; i <= 120; i++) { const d = Math.pow(dMax, i / 120); const x = X(d), y = Y(L0 - 20 * Math.log10(d)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.strokeStyle = col; ctx.lineWidth = w; ctx.setLineDash(dash || []); ctx.stroke(); ctx.setLineDash([]); };
  curve(spl, '#9aa5b1', 1.2, [4, 4]); curve(spl + 10 * Math.log10(n), TK.blue, 1.4); curve(spl + 20 * Math.log10(n), TK.accent, 2.2);
  ctx.setLineDash([3, 3]); ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.beginPath(); ctx.moveTo(X(dist), padT); ctx.lineTo(X(dist), padT + gh); ctx.stroke(); ctx.setLineDash([]);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = TK.accent; ctx.fillText(n + '× gekoppelt (+20·log n)', padL + 6, padT + 4);
  ctx.fillStyle = TK.blue; ctx.fillText(n + '× unkorreliert (+10·log n)', padL + 6, padT + 17);
  ctx.fillStyle = '#9aa5b1'; ctx.fillText('1 Box', padL + 6, padT + 30);
}
function drift(D, set, ca, cb) {
  const { ctx, W, H } = frame($('#c4-cv')), padL = 36, padR = 10, padT = 10, padB = 22, gw = W - padL - padR, gh = H - padT - padB;
  const freqs = SG.logspace(20, 200, 90), X = f => padL + axisLog(0, gw, f), top = 6, bot = -42, Y = v => padT + (top - clamp(v, bot, top)) / (top - bot) * gh;
  const [lo, hi] = band(); ctx.fillStyle = 'rgba(232,119,34,.07)'; ctx.fillRect(X(lo), padT, X(hi) - X(lo), gh);
  ctx.strokeStyle = TK.line; ctx.lineWidth = 1; ctx.font = '10px ' + FONT_M; ctx.fillStyle = TK.muted; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (let v = bot; v <= top; v += 6) { ctx.beginPath(); ctx.moveTo(padL, Y(v)); ctx.lineTo(padL + gw, Y(v)); ctx.stroke(); ctx.fillText(v, padL - 4, Y(v)); }
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  for (const f of [20, 31.5, 50, 80, 125, 200]) { ctx.beginPath(); ctx.moveTo(X(f), padT); ctx.lineTo(X(f), padT + gh); ctx.stroke(); ctx.fillText(fHz(f), X(f), padT + gh + 5); }
  const src = [SG.makeSource({ x: 0, y: 0 }), SG.makeSource({ x: 0, y: -D, delay_ms: set, polarity: -1 })];
  const curve = (cc, col, w) => { const L = SG.polarDb(src, freqs, cc, [0, 180], 100); ctx.beginPath(); freqs.forEach((f, i) => { const x = X(f), y = Y(L[2 * i + 1] - L[2 * i]); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.stroke(); };
  curve(ca, TK.good, 1.6); curve(cb, TK.bad, 2);
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  ctx.fillStyle = TK.good; ctx.fillText('hinten re vorne bei T₁ (eingemessen)', padL + 6, padT + 4);
  ctx.fillStyle = TK.bad; ctx.fillText('bei T₂ (Show)', padL + 6, padT + 17);
}

export function renderKnow() {
  const c = c0(), [lo, hi] = band(), fc = Math.sqrt(lo * hi);
  $('#basics').innerHTML = [
    ['Schallgeschwindigkeit', 'c = 331,3 · √(1 + T/273,15)', `Bei ${fmt(S.settings.temp, 0)} °C: ${fmt(c, 1)} m/s. Wärmer = schneller – pro 10 °C etwa +6 m/s. Deshalb verschieben sich Delays mit der Temperatur.`],
    ['Wellenlänge', 'λ = c / f', `${lo} Hz: ${fmt(c / lo, 2)} m · ${Math.round(fc)} Hz: ${fmt(c / fc, 2)} m · ${hi} Hz: ${fmt(c / hi, 2)} m. Alle Abstandsregeln im Bass hängen an λ.`],
    ['Summierung', '+6 dB pro Verdopplung', 'Nah beieinander und phasengleich addieren sich Subs kohärent: 2 Boxen +6 dB, 4 Boxen +12 dB (20·log n). Nur unkorrelierte Signale addieren mit +3 dB (10·log n).'],
    ['Abstandsgesetz', '−6 dB pro Entfernungs-Verdopplung', 'Punktquelle im Freifeld: ΔL = −20·log(d₂/d₁). Große Linien verhalten sich in der Nähe anders (Nahfeld).'],
    ['Power Alley & Kammfilter', 'Wegdifferenz λ/2 = Auslöschung', 'Zwei getrennte Quellen: Wo die Wege gleich sind, +6 dB. Wo sie sich um λ/2 unterscheiden, löschen sie sich aus. Bei Split L/R wandert das über die ganze Fläche.'],
    ['Temperatur & Cardioid', 'Δt = D/c₁ − D/c₂', 'Die Auslöschung hinten hängt am exakten Delay. 20 °C Unterschied verschieben das um einige µs – das kostet bei hohen Frequenzen Rückwärtsdämpfung. Siehe Rechner.'],
  ].map(([h, f, p]) => `<div class="basic"><h3>${h}</h3><div class="f">${f}</div><p>${p}</p></div>`).join('');
  const e = env();
  $('#know-cards').innerHTML = KNOW.map((k, i) => `<article class="card k-card">
    <div class="k-top"><div class="k-txt"><h2>${k.title}<small>${k.chans}</small></h2><p>${k.idea}</p></div><canvas data-kp="${i}" width="216" height="216"></canvas></div>
    <div class="rule">${k.rule}</div>
    <div class="pm"><div><b class="g">Stärken</b><ul>${k.plus.map(x => `<li>${x}</li>`).join('')}</ul></div><div><b class="b">Schwächen</b><ul>${k.minus.map(x => `<li>${x}</li>`).join('')}</ul></div></div>
    <button class="btn small" data-open-tpl="${k.tpl}">In der Simulation öffnen</button></article>`).join('');
  KNOW.forEach((k, i) => {
    const cv = document.querySelector(`[data-kp="${i}"]`), ctx = cv.getContext('2d'); ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = TK.bg; ctx.fillRect(0, 0, 108, 108);
    const r = TEMPLATES[k.tpl].build(templateDefaults(k.tpl, e), e);
    drawPolar(ctx, 108, 108, r.srcs, [lo, fc, hi], { colors: [TK.blue, TK.good, TK.accent] });
  });
}
