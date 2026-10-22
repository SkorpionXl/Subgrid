/* SubGrid — template panel (SubGrid 1 array types with formulas) */
import SG from '../core/engine.js';
import { TEMPLATES, templateDefaults } from '../core/templates.js';
import { $, $$, clamp, fmt } from './util.js';
import { S, env, pushUndo, changed, emit } from './state.js';

let fit = () => {};
export function setFit(fn) { fit = fn; }

function tplIcon(id) {
  const e = env(), t = TEMPLATES[id];
  let r; try { r = t.build(templateDefaults(id, e), e); } catch (err) { return ''; }
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const rects = r.srcs.map(s => SG.boxCorners(s.x, s.y, s.rot_deg, e.w, e.d));
  rects.forEach(c => c.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
  const W = 100, H = 30, k = Math.min((W - 8) / (x1 - x0 || 1), (H - 6) / (y1 - y0 || 1)), ox = (W - (x1 - x0) * k) / 2, oy = (H - (y1 - y0) * k) / 2;
  const P = ([x, y]) => [(ox + (x - x0) * k).toFixed(1), (oy + (y1 - y) * k).toFixed(1)];
  let svg = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true">`; const seen = new Set();
  r.srcs.forEach((s, i) => {
    const key = SG.footprintKey(s.x, s.y, s.rot_deg, e.d), c = rects[i].map(P);
    if (!seen.has(key)) { seen.add(key); svg += `<polygon points="${c.map(p => p.join(',')).join(' ')}" fill="rgba(232,119,34,.13)" stroke="${s.polarity < 0 ? '#e0584c' : '#e87722'}" stroke-width="1"/>`; }
    svg += `<line x1="${c[2][0]}" y1="${c[2][1]}" x2="${c[3][0]}" y2="${c[3][1]}" stroke="#f3f4f5" stroke-width="1.4"/>`;
  });
  return svg + '</svg>';
}
export function renderTplList() {
  const cats = [['Basis', ['single', 'broadside', 'split']], ['Abdeckung', ['arcdelay', 'arcphys', 'beam']], ['Richtwirkung', ['cardstack', 'cardinline', 'endfire', 'efcard', 'grad2']]];
  $('#tpl-list').innerHTML = cats.map(([cat, ids]) => `<div class="group-lbl">${cat}</div><div class="tpl-grid">${ids.map(id => {
    const t = TEMPLATES[id];
    return `<button class="tpl-btn" data-tpl="${id}" aria-pressed="${S.tpl.id === id && S.tpl.live}">${tplIcon(id)}<span class="t">${t.name}</span><span class="k">${t.chans === '1' ? '1 Kanal' : t.chans + ' Kanäle'}</span></button>`;
  }).join('')}</div>`).join('');
}
function apply(push) {
  const t = TEMPLATES[S.tpl.id], r = t.build(S.tpl.p, env());
  emit('useredit');
  if (push) pushUndo();
  S.sources = r.srcs.map(s => Object.assign(SG.makeSource(s), { pinned: false }));
  S.tpl.live = true; S.sel = []; emit('selection'); emit('template'); changed('src'); renderCalc();
}
export function selectTemplate(id) {
  S.tpl = { id, p: templateDefaults(id, env()), live: true };
  $$('.tpl-btn').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.tpl === id)));
  apply(true); renderTplForm(); fit();
}
export function detachTpl() { if (S.tpl.live) { S.tpl.live = false; renderTplForm(); $$('.tpl-btn').forEach(b => b.setAttribute('aria-pressed', 'false')); } }
export function renderTplForm() {
  const t = TEMPLATES[S.tpl.id]; if (!t) return;
  if (!S.tpl.p) S.tpl.p = templateDefaults(S.tpl.id, env());
  const p = S.tpl.p;
  $('#tpl-form-wrap').innerHTML = `<div class="form">
    <div class="group-lbl" style="margin:0">${t.name}${S.tpl.live ? '' : ' <span class="tag">nicht aktiv</span>'}</div>
    ${t.params.map(q => `<div class="field"><label for="tp-${q.k}">${q.label}</label><span class="iu"><input type="number" id="tp-${q.k}" data-k="${q.k}" min="${q.min}" max="${q.max}" step="${q.step}" value="${+(+p[q.k]).toFixed(3)}">${q.unit ? `<span class="unit">${q.unit}</span>` : ''}</span>
      <input type="range" data-k="${q.k}" min="${q.min}" max="${q.max}" step="${q.step}" value="${p[q.k]}" aria-label="${q.label}">${q.hint ? `<span class="hint">${q.hint}</span>` : ''}</div>`).join('')}
    <div id="tpl-state">${S.tpl.live ? '' : '<div class="note">Die Boxen auf dem Plan stammen nicht (mehr) aus dieser Vorlage. Ein Regler oder „Anwenden“ ersetzt sie.</div>'}</div>
    <div id="tpl-calc"></div>
    <div class="btnrow"><button class="btn" id="tpl-reset">Standardwerte</button><button class="btn primary" id="tpl-apply">Anwenden</button></div>
  </div>`;
  renderCalc();
}
function renderCalc() {
  const t = TEMPLATES[S.tpl.id], e = env(), calc = $('#tpl-calc'); if (!calc) return;
  let r; try { r = t.build(S.tpl.p, e); } catch (err) { return; }
  calc.innerHTML = `${(r.warn || []).map(w => `<div class="warnbox">${w}</div>`).join('')}<div class="calc"><div class="calc-t">Berechnung · c = ${fmt(e.c, 1)} m/s</div>${r.calc.map(l => `<div>${l}</div>`).join('')}</div>`;
}
export function initTemplates() {
  $('#tpl-list').addEventListener('click', e => { const b = e.target.closest('[data-tpl]'); if (b) selectTemplate(b.dataset.tpl); });
  const wrap = $('#tpl-form-wrap');
  wrap.addEventListener('input', e => {
    const k = e.target.dataset.k; if (!k) return;
    const t = TEMPLATES[S.tpl.id], q = t.params.find(x => x.k === k);
    let v = +e.target.value; if (!isFinite(v)) return;
    S.tpl.p[k] = clamp(v, q.min, q.max);
    if (t.linked) t.linked(S.tpl.p, env(), k);
    $$('[data-k]', wrap).forEach(el => { if (el !== e.target && S.tpl.p[el.dataset.k] != null) el.value = +(+S.tpl.p[el.dataset.k]).toFixed(3); });
    const wasLive = S.tpl.live; apply(!wasLive);
    if (!wasLive) { renderTplForm(); renderTplList(); }
  });
  wrap.addEventListener('click', e => {
    if (e.target.closest('#tpl-reset')) { S.tpl.p = templateDefaults(S.tpl.id, env()); apply(true); renderTplForm(); }
    if (e.target.closest('#tpl-apply')) { apply(true); renderTplForm(); renderTplList(); fit(); }
  });
}
