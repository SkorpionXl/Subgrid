/* SubGrid — live optimizer panel (talks to the Web Worker) */
import SG from '../core/engine.js';
import { FAM } from '../core/families.js';
import { createRunner } from '../core/runner.js';
import workerSrc from '../../build/worker.txt';
import { $, $$, fmt, sfmt, esc, num, toast, gauge, TK, fitCanvas, FONT_M, KIND } from './util.js';
import { S, pushUndo, changed, emit, on, zonesClean, fullGoal, zoneSummary } from './state.js';
import { miniPolar } from './analysis.js';
import { can, needStudio } from './edition.js';
const famShort = k => k === 'free' ? 'Freiform' : (FAM[k] ? FAM[k].label.replace(/ \(.*\)/, '') : k);

let fit = () => {}, gotoZones = () => {};
export function setLiveHooks(o) { fit = o.fit || fit; gotoZones = o.gotoZones || gotoZones; }

const LIVE = { w: null, inline: false, running: false, snap: null, applying: false, sig: '', open: new Set(['__top']), restartT: 0, lastPreviewId: null, mode: 'design', startedAt: 0 };

function makeWorker() {
  try {
    const url = URL.createObjectURL(new Blob([workerSrc], { type: 'text/javascript' }));
    const w = new Worker(url);
    w.onmessage = e => onMsg(e.data);
    w.onerror = e => { e.preventDefault && e.preventDefault(); fallbackInline(); };
    return w;
  } catch (e) { return null; }
}
function fallbackInline() {
  if (LIVE.inline) return;
  LIVE.inline = true;
  const run = createRunner(m => setTimeout(() => onMsg(m), 0));
  LIVE.w = { postMessage: m => run(Object.assign({ inline: true }, m)), terminate() {} };
  if (LIVE.running) start();
}
function ensureWorker() { if (!LIVE.w) { LIVE.w = makeWorker(); if (!LIVE.w) fallbackInline(); } }

const GOAL_NUM = ['boxes', 'channels', 'maxStack', 'quietTarget', 'stageTarget', 'seed'];
export function goalToForm() {
  const g = S.goal;
  GOAL_NUM.forEach(k => { const el = $('#g-' + k); if (el) el.value = g[k]; });
  $$('#g-effort button').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.v === (g.effort || 'normal'))); b.classList.toggle('locked', b.dataset.v === 'thorough' && !can('thorough')); });
  const fams = Object.keys(FAM), on = g.families ? new Set(g.families) : null;
  $('#g-fams').innerHTML = fams.map(k => `<button class="chip ${can('families') ? '' : 'locked'}" data-fam="${k}" aria-pressed="${!on || on.has(k)}">${esc(famShort(k))}</button>`).join('')
    + (can('families') ? '' : '<div class="note" style="width:100%">Gezielt an-/abwählen gibt\'s in Studio – Lite probiert immer alle.</div>');
  $('#g-fams-n').textContent = on ? `${on.size} von ${fams.length}` : 'alle';
  $('#g-dsp').value = g.dsp; $('#g-robust').checked = g.robust; $('#g-preview').checked = g.preview; $('#g-move').checked = g.move;
  $$('#g-priority button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === g.priority)));
  $$('#g-mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === g.mode)));
  $('#g-design-only').hidden = g.mode !== 'design'; $('#g-setup-only').hidden = g.mode !== 'setup';
  renderZoneStatus();
}
export function renderZoneStatus() {
  const s = zoneSummary(), el = $('#lv-zones'); if (!el) return;
  const miss = [];
  if (!s.audience) miss.push('Publikum');
  if (S.goal.mode === 'design' && !s.place) miss.push('Aufstellfläche');
  el.innerHTML = `<div class="zs-row">${Object.keys(KIND).map(k => `<span class="zs" style="--k:${KIND[k].col}"><i></i>${KIND[k].short} <b class="mono">${s[k] ? fmt(s[k], 0) + ' m²' : '–'}</b></span>`).join('')}</div>`
    + (miss.length ? `<div class="warnbox">Es fehlt: ${miss.join(', ')}. <button class="linkbtn" id="lv-goto-zones">Jetzt zeichnen →</button></div>` : '');
}

function start() {
  ensureWorker();
  const goal = fullGoal(), zones = zonesClean();
  $('#lv-msg').innerHTML = '';
  if (!LIVE.running && S.goal.preview) pushUndo();
  LIVE.running = true; LIVE.mode = S.goal.mode; LIVE.sig = ''; LIVE.lastPreviewId = null; LIVE.startedAt = performance.now();
  LIVE.w.postMessage({ type: 'start', mode: S.goal.mode, zones, goal, sources: S.sources.map(s => Object.assign({}, s)), opts: { move: S.goal.move, maxMove: 1.5 } });
  renderRunState();
}
export function stop(silent) {
  if (!LIVE.running) return;
  LIVE.running = false;
  if (LIVE.w) LIVE.w.postMessage({ type: 'stop' });
  renderRunState();
  if (!silent) toast('Optimierer gestoppt');
}
export const isRunning = () => LIVE.running;
function restartSoon() {
  if (!LIVE.running) return;
  clearTimeout(LIVE.restartT);
  LIVE.restartT = setTimeout(() => { if (LIVE.running) start(); }, 700);
}
function renderRunState() {
  const b = $('#lv-run');
  b.innerHTML = LIVE.running ? '<svg><use href="#i-stop"/></svg><span>Stopp</span>' : '<svg><use href="#i-play"/></svg><span>Optimierer starten</span>';
  b.classList.toggle('running', LIVE.running);
  $('#lv-led').className = 'led ' + (LIVE.running ? 'on' : '');
}

function onMsg(m) {
  if (m.type === 'error') {
    LIVE.running = false; renderRunState();
    $('#lv-msg').innerHTML = `<div class="errbox">${esc(m.msg)}</div>`; return;
  }
  if (m.type !== 'status') return;
  if (!LIVE.running && m.running) return;           // stale message after stop
  LIVE.snap = m;
  if (!m.running) { LIVE.running = false; renderRunState(); if (m.converged) toast('Optimierer fertig – seit einer Minute keine Verbesserung mehr', 'ok'); }
  renderStatus(m);
  if (m.mode === 'design') { renderResults(m); preview(m.results && m.results[0] ? m.results[0] : m.preview ? { id: 'seed', srcs: m.preview.srcs } : null); }
  else { renderSetupResult(m); if (m.result) preview(m.result); }
}
function preview(r) {
  if (!r || !S.goal.preview || !LIVE.running && LIVE.lastPreviewId === r.id) return;
  if (LIVE.lastPreviewId === r.id && r.id !== 'seed') return;
  LIVE.lastPreviewId = r.id;
  LIVE.applying = true;
  const pins = LIVE.mode === 'setup' ? S.sources.filter(s => s.enabled).map(s => s.pinned) : null;
  const disabled = LIVE.mode === 'setup' ? S.sources.filter(s => !s.enabled) : [];
  S.sources = r.srcs.map((s, i) => Object.assign(SG.makeSource(s), { pinned: pins ? !!pins[i] : false })).concat(disabled);
  S.sel = []; emit('selection'); changed('src');
  LIVE.applying = false;
}

function renderStatus(m) {
  const t = Math.round(m.elapsed), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
  const c = m.counts || {};
  const phase = m.mode === 'setup' ? 'Feinabstimmung'
    : m.stage === 'screen' ? `Sichtung: ${m.seedDone} / ${m.seedTotal} Lehrbuch-Varianten`
    : m.stage === 'race' ? `Runde ${m.round + 1} von ${m.rounds}: ${c.race} Ansätze im Rennen, ${c.out} ausgeschieden`
    : m.stage === 'final' ? `Finale: ${c.final} Ansätze werden verfeinert (inkl. Freiform)` : 'fertig';
  $('#lv-stat').innerHTML = `<span>${LIVE.running ? 'läuft' : m.converged ? 'fertig' : 'gestoppt'}</span><span class="mono">${m.evals.toLocaleString('de-DE')} Varianten</span><span class="mono">${mm}:${ss}</span>`;
  $('#lv-phase').textContent = phase + (m.aim ? ` · Publikum Richtung ${Math.round(m.aim)}°` : '');
  const best = m.mode === 'setup' ? m.bestCost : m.bestCost;
  $('#lv-best').innerHTML = best != null ? `Bewertung <b class="mono">${fmt(best, 2)}</b> <span class="dim">(kleiner = besser)</span>` : '';
  drawSpark(m.hist || []);
  renderProtocol(m);
}
const ST_LABEL = { final: 'Finale', race: 'Rennen', screen: 'Sichtung', out: 'raus' };
function renderProtocol(m) {
  const wrap = $('#lv-proto-wrap'); if (!wrap) return;
  const pr = m.mode === 'design' ? m.protocol || [] : [];
  wrap.hidden = !pr.length; if (!pr.length) return;
  const c = m.counts || {};
  $('#lv-proto-n').textContent = `${pr.length} Ansätze · ${c.out || 0} raus`;
  if (!wrap.open) return;
  $('#lv-proto').innerHTML = `<table class="proto-t"><thead><tr><th></th><th>Ansatz</th><th class="r">Bew.</th><th class="r">Tests</th></tr></thead><tbody>${pr.map(p =>
    `<tr class="st-${p.status}${p.leader ? ' lead' : ''}" title="${esc(p.why || '')}"><td><span class="pill">${ST_LABEL[p.status] || p.status}</span></td><td><b>${esc(famShort(p.fam))}</b><span class="dim"> · ${esc(p.label)}</span>${p.why ? `<div class="why">${esc(p.why)}</div>` : ''}</td><td class="r mono">${p.cost != null ? fmt(p.cost, 2) + (p.rough ? '*' : '') : '–'}</td><td class="r mono">${p.spent || ''}</td></tr>`).join('')}</tbody></table>
    <div class="note">* grobe Sichtung bei einer Temperatur. Runden haben für jeden Ansatz das gleiche Budget – so gewinnt die Anordnung, nicht der Zufall.</div>`;
}
function drawSpark(h) {
  const cv = $('#lv-spark'); if (!cv) return;
  const { ctx, W, H } = fitCanvas(cv);
  ctx.fillStyle = TK.bg; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = TK.line; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  if (h.length < 2) return;
  const t1 = Math.max(h[h.length - 1][0], 1), vs = h.map(p => p[1]), lo = Math.min(...vs), hi = Math.max(...vs.slice(Math.min(2, vs.length - 1)));
  const top = hi > lo ? hi : lo + 1, X = t => 4 + t / t1 * (W - 8), Y = v => 4 + (1 - (Math.min(v, top) - lo) / (top - lo)) * (H - 12);
  ctx.beginPath(); h.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); if (i) { ctx.lineTo(x, Y(h[i - 1][1])); ctx.lineTo(x, y); } else ctx.moveTo(x, y); });
  ctx.strokeStyle = TK.accent; ctx.lineWidth = 1.6; ctx.stroke();
  ctx.font = '9.5px ' + FONT_M; ctx.fillStyle = TK.faint; ctx.textAlign = 'right'; ctx.textBaseline = 'bottom';
  ctx.fillText('Bewertung über Zeit', W - 5, H - 2);
}
function resultCard(r, i, g) {
  const z = r.summary, open = LIVE.open.has(r.fam) || (i === 0 && LIVE.open.has('__top'));
  return `<article class="res ${i === 0 ? 'top' : ''}" data-fam="${r.fam}">
    <div class="res-hd"><span class="res-rank">${i + 1}</span><div class="res-tt"><div class="res-title">${esc(r.label)}${r.status === 'out' ? ' <span class="pill out">raus</span>' : ''}</div><div class="res-sub">${r.variant && r.fam !== 'free' ? esc(r.variant) + ' · ' : ''}${r.nBoxes} Boxen · ${r.channels} ${r.channels === 1 ? 'Kanal' : 'Kanäle'} · ${fmt(r.size[0], 1)} × ${fmt(r.size[1], 1)} m · <span class="mono">${fmt(r.cost, 2)}</span></div></div></div>
    <div class="res-body"><canvas data-mini="${i}" width="152" height="152"></canvas><dl class="kv">
      <dt>Gleichmäßig</dt><dd class="${gauge(z.spread, 3, 5, true)}">±${fmt(z.spread, 1)} dB</dd>
      ${z.rej != null ? `<dt>Ruhezone</dt><dd class="${gauge(z.rej, g.quietTarget, g.quietTarget + 6, true)}">${sfmt(z.rej, 1)} dB</dd>` : ''}
      ${z.rejS != null ? `<dt>Bühne</dt><dd class="${gauge(z.rejS, g.stageTarget, g.stageTarget + 6, true)}">${sfmt(z.rejS, 1)} dB</dd>` : ''}
      <dt>Effizienz</dt><dd class="${gauge(z.eff, -3, -6, false)}">${sfmt(z.eff, 1)} dB</dd>
      <dt>Rückwärts</dt><dd class="${gauge(r.band.rear_worst, -12, -6, true)}">${sfmt(r.band.rear_worst, 0)} dB</dd>
      <dt>Öffnung</dt><dd>${Math.round(r.band.bw_mean)}°</dd></dl></div>
    <details ${open ? 'open' : ''}><summary>Warum so?</summary><ul>${r.explain.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>
    <button class="btn small ${i === 0 ? '' : 'primary'}" data-apply="${i}">${i === 0 && S.goal.preview ? 'Behalten' : 'Übernehmen'}</button>
  </article>`;
}
function renderResults(m) {
  const el = $('#lv-results'), res = m.results || [];
  const sig = res.map(r => r.id + r.status).join(',') + '|' + (m.skipped || []).length + '|' + S.goal.preview;
  if (sig === LIVE.sig) return;
  LIVE.sig = sig;
  const g = S.goal, live = res.filter(r => r.status !== 'out'), out = res.filter(r => r.status === 'out');
  const shown = live.length ? live : res;
  el.innerHTML = (shown.length ? shown.map((r, i) => resultCard(r, i, g)).join('') : '<div class="note">Prüft gerade die Lehrbuch-Anordnungen …</div>')
    + (live.length && out.length ? `<div class="skips"><b>Ausgeschieden (bestes Ergebnis):</b>${out.map(r => `<span>${esc(r.label.replace(/ \(.*\)/, ''))} · <span class="mono">${fmt(r.cost, 2)}</span> <button class="linkbtn" data-apply-fam="${esc(r.fam)}">ansehen</button></span>`).join('')}</div>` : '')
    + ((m.skipped || []).length ? `<div class="skips"><b>Nicht im Rennen:</b>${m.skipped.map(s => `<span>${esc(famShort(s.fam))} – ${esc(s.why)}</span>`).join('')}</div>` : '')
    + (res.length ? `<div class="note">Mini-Polar: <span style="color:${TK.blue}">${g && fullGoal().band[0]} Hz</span> · <span style="color:${TK.good}">Bandmitte</span> · <span style="color:${TK.accent}">${fullGoal().band[1]} Hz</span></div>` : '');
  shown.forEach((r, i) => { const cv = el.querySelector(`[data-mini="${i}"]`); if (cv) miniPolar(cv, r.srcs, 76); });
}
function shownResults() {
  const res = (LIVE.snap && LIVE.snap.results) || [], live = res.filter(r => r.status !== 'out');
  return live.length ? live : res;
}
function renderSetupResult(m) {
  const el = $('#lv-results'), r = m.result;
  if (!r) { el.innerHTML = ''; return; }
  const sig = 'setup' + r.id; if (sig === LIVE.sig) return; LIVE.sig = sig;
  const z = r.summary, g = S.goal, gain = m.cost0 > 0 ? (1 - m.bestCost / m.cost0) * 100 : 0;
  const chs = new Map(); r.srcs.forEach(s => { if (!chs.has(s.channel)) chs.set(s.channel, s); });
  el.innerHTML = `<article class="res top"><div class="res-hd"><span class="res-rank">✓</span><div class="res-tt"><div class="res-title">Dein Setup – verbessert</div><div class="res-sub">Bewertung ${fmt(m.cost0, 2)} → ${fmt(m.bestCost, 2)} (${gain >= 0 ? '−' : '+'}${fmt(Math.abs(gain), 0)} %)${m.movable ? ' · ' + m.movable + ' Stacks beweglich' : ''}</div></div></div>
    <dl class="kv" style="grid-template-columns:auto auto auto auto"><dt>Gleichmäßig</dt><dd class="${gauge(z.spread, 3, 5, true)}">±${fmt(z.spread, 1)} dB</dd>${z.rej != null ? `<dt>Ruhezone</dt><dd class="${gauge(z.rej, g.quietTarget, g.quietTarget + 6, true)}">${sfmt(z.rej, 1)} dB</dd>` : ''}${z.rejS != null ? `<dt>Bühne</dt><dd class="${gauge(z.rejS, g.stageTarget, g.stageTarget + 6, true)}">${sfmt(z.rejS, 1)} dB</dd>` : ''}<dt>Effizienz</dt><dd class="${gauge(z.eff, -3, -6, false)}">${sfmt(z.eff, 1)} dB</dd></dl>
    <ul>${[...chs.entries()].sort((a, b) => a[0] - b[0]).map(([k, s]) => `<li>K${k}: ${fmt(s.delay_ms, 2)} ms · ${sfmt(s.gain_db, 1)} dB${s.polarity < 0 ? ' · invertiert' : ''}</li>`).join('')}</ul>
    <button class="btn small" data-apply="setup">${S.goal.preview ? 'Behalten' : 'Übernehmen'}</button></article>`;
}

export function initLive() {
  const left = $('#left-live');
  left.addEventListener('change', e => {
    const id = e.target.id; if (!id || !id.startsWith('g-')) return;
    const k = id.slice(2);
    if (GOAL_NUM.includes(k)) { const v = num(e.target.value, NaN); if (isFinite(v)) S.goal[k] = k === 'quietTarget' || k === 'stageTarget' ? Math.min(0, v) : Math.max(1, Math.round(v)); }
    else if (k === 'dsp') S.goal.dsp = e.target.value;
    else if (k === 'robust' || k === 'preview' || k === 'move') S.goal[k] = e.target.checked;
    goalToForm(); changed('settings'); if (k !== 'preview') restartSoon();
  });
  $('#g-priority').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; S.goal.priority = b.dataset.v; goalToForm(); changed('settings'); restartSoon(); });
  $('#g-mode').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; if (LIVE.running) stop(true); S.goal.mode = b.dataset.v; LIVE.sig = ''; $('#lv-results').innerHTML = ''; goalToForm(); changed('settings'); });
  $('#lv-run').addEventListener('click', () => { if (LIVE.running) stop(); else start(); });
  $('#g-effort').addEventListener('click', e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    if (b.dataset.v === 'thorough' && needStudio('thorough')) return;
    S.goal.effort = b.dataset.v; goalToForm(); changed('settings'); restartSoon();
  });
  $('#g-reseed').addEventListener('click', () => { S.goal.seed = 1 + Math.floor(Math.random() * 99998); goalToForm(); changed('settings'); restartSoon(); toast('Neuer Startwert ' + S.goal.seed + ' – andere Varianten werden probiert'); });
  $('#g-fams').addEventListener('click', e => {
    const b = e.target.closest('[data-fam]'); if (!b || needStudio('families')) return;
    const all = Object.keys(FAM), cur = new Set(S.goal.families || all), k = b.dataset.fam;
    if (cur.has(k)) { if (cur.size === 1) { toast('Mindestens eine Topologie muss mitmachen'); return; } cur.delete(k); } else cur.add(k);
    S.goal.families = cur.size === all.length ? null : all.filter(q => cur.has(q));
    goalToForm(); changed('settings'); restartSoon();
  });
  $('#lv-proto-wrap').addEventListener('toggle', () => { if (LIVE.snap) renderProtocol(LIVE.snap); });
  left.addEventListener('click', e => {
    if (e.target.closest('#lv-goto-zones')) { gotoZones(); return; }
    const bf = e.target.closest('[data-apply-fam]');
    const b = bf || e.target.closest('[data-apply]'); if (!b || !LIVE.snap) return;
    const r = bf ? LIVE.snap.results.find(q => q.fam === bf.dataset.applyFam) : b.dataset.apply === 'setup' ? LIVE.snap.result : shownResults()[+b.dataset.apply];
    if (!r) return;
    if (LIVE.running) stop(true);
    if (!(S.goal.preview && LIVE.lastPreviewId === r.id)) pushUndo();
    LIVE.lastPreviewId = r.id;
    S.sources = r.srcs.map(s => Object.assign(SG.makeSource(s), { pinned: false }));
    S.sel = []; emit('selection'); emit('useredit-applied'); changed('src'); fit();
    toast('Übernommen: ' + r.label, 'ok');
  });
  left.addEventListener('toggle', e => {
    const art = e.target.closest && e.target.closest('.res'); if (!art) return;
    const f = art.dataset.fam; if (e.target.open) LIVE.open.add(f); else LIVE.open.delete(f);
    LIVE.open.delete('__top');
  }, true);
  on('useredit', () => { if (LIVE.running && !LIVE.applying) { stop(true); toast('Optimierer angehalten – du bearbeitest selbst'); } });
  on('changed', what => { if (what === 'zones') { renderZoneStatus(); restartSoon(); } if (what === 'settings') restartSoon(); });
  renderRunState();
}
