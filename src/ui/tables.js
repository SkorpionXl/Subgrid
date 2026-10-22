/* SubGrid — boxes table + DSP channel table */
import SG from '../core/engine.js';
import { $, fmt, chColor } from './util.js';
import { S, pushUndo, changed, emit } from './state.js';

function chanGroups() {
  const m = new Map();
  S.sources.forEach((s, i) => { const k = s.channel || 0; if (!m.has(k)) m.set(k, []); m.get(k).push(i); });
  return [...m.entries()].sort((a, b) => (a[0] || 999) - (b[0] || 999));
}
export { chanGroups };

const DIRS = [[0, '↑ vorne'], [90, '← links'], [180, '↓ hinten'], [270, '→ rechts']];
export function renderTable() {
  const wrap = $('#tbl');
  document.querySelectorAll('#tbl-tab button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.tblTab)));
  if (!S.sources.length) { wrap.innerHTML = '<div class="tbl-empty">Keine Boxen. Box-Werkzeug (A) oder Doppelklick in die Draufsicht.</div>'; $('#tbl-note').textContent = ''; return; }
  const sel = new Set(S.sel);
  if (S.tblTab === 'boxes') {
    $('#tbl-note').textContent = 'Werte direkt ändern · Klick auf eine Zeile wählt den Stack';
    wrap.innerHTML = `<table><thead><tr><th>#</th><th>Kanal</th><th>X m</th><th>Y m</th><th>Richtung</th><th>Delay ms</th><th>Gain dB</th><th>Pol.</th><th>LP Hz</th><th>Fix</th><th>An</th><th></th></tr></thead><tbody>${
      S.sources.map((s, i) => {
        const r = Math.round(s.rot_deg);
        return `<tr data-i="${i}" class="${sel.has(i) ? 'sel' : ''}">
        <td class="mono dim">${i + 1}</td>
        <td><span class="chdot" style="background:${chColor(s.channel)}"></span><input class="w-s" type="number" data-f="channel" min="0" max="64" step="1" value="${s.channel}" aria-label="Kanal Box ${i + 1}"></td>
        <td><input type="number" data-f="x" step="0.05" value="${+s.x.toFixed(3)}" aria-label="X Box ${i + 1}"></td>
        <td><input type="number" data-f="y" step="0.05" value="${+s.y.toFixed(3)}" aria-label="Y Box ${i + 1}"></td>
        <td><select data-f="rot_deg" aria-label="Richtung Box ${i + 1}">${DIRS.map(([v, t]) => `<option value="${v}" ${r === v ? 'selected' : ''}>${t}</option>`).join('')}${DIRS.some(([v]) => v === r) ? '' : `<option value="${s.rot_deg}" selected>${fmt(s.rot_deg, 0)}°</option>`}</select></td>
        <td><input type="number" data-f="delay_ms" step="0.01" min="0" value="${+s.delay_ms.toFixed(3)}" aria-label="Delay Box ${i + 1}"></td>
        <td><input class="w-s" type="number" data-f="gain_db" step="0.5" value="${+s.gain_db.toFixed(2)}" aria-label="Gain Box ${i + 1}"></td>
        <td><button class="pol ${s.polarity < 0 ? 'inv' : ''}" data-f="polarity" aria-label="Polarität Box ${i + 1}">${s.polarity < 0 ? '−' : '+'}</button></td>
        <td><input class="w-s" type="number" data-f="lp_f" step="1" min="0" value="${s.lp_f || 0}" aria-label="Tiefpass Box ${i + 1}"></td>
        <td><input type="checkbox" data-f="pinned" ${s.pinned ? 'checked' : ''} aria-label="Box ${i + 1} fixieren" title="Fixiert: der Optimierer lässt die Box stehen"></td>
        <td><input type="checkbox" data-f="enabled" ${s.enabled ? 'checked' : ''} aria-label="Box ${i + 1} an"></td>
        <td><button class="btn icon ghost small" data-del="${i}" aria-label="Box ${i + 1} löschen"><svg><use href="#i-del"/></svg></button></td></tr>`;
      }).join('')}</tbody></table>`;
  } else {
    $('#tbl-note').textContent = 'Änderung gilt für alle Boxen des Kanals – wie im DSP';
    wrap.innerHTML = `<table><thead><tr><th>Kanal</th><th>Boxen</th><th>Delay ms</th><th>Gain dB</th><th>Pol.</th><th>LP (LR4) Hz</th><th>Allpass Hz</th><th>AP Q</th><th></th></tr></thead><tbody>${
      chanGroups().map(([ch, idx]) => {
        const s = S.sources[idx[0]];
        const mixed = idx.some(i => { const b = S.sources[i]; return Math.abs(b.delay_ms - s.delay_ms) > 1e-6 || Math.abs(b.gain_db - s.gain_db) > 1e-6 || b.polarity !== s.polarity || b.lp_f !== s.lp_f || b.ap_f !== s.ap_f; });
        return `<tr data-ch="${ch}" class="${idx.some(i => sel.has(i)) ? 'sel' : ''}">
          <td><span class="chdot" style="background:${chColor(ch)}"></span><b class="mono">${ch ? 'K' + ch : 'ohne'}</b></td>
          <td class="mono dim">${idx.map(i => i + 1).join(', ')}</td>
          <td><input type="number" data-c="delay_ms" step="0.01" min="0" value="${+s.delay_ms.toFixed(3)}" aria-label="Delay Kanal ${ch}"></td>
          <td><input class="w-s" type="number" data-c="gain_db" step="0.5" value="${+s.gain_db.toFixed(2)}" aria-label="Gain Kanal ${ch}"></td>
          <td><button class="pol ${s.polarity < 0 ? 'inv' : ''}" data-c="polarity" aria-label="Polarität Kanal ${ch}">${s.polarity < 0 ? '−' : '+'}</button></td>
          <td><input class="w-s" type="number" data-c="lp_f" step="1" min="0" value="${s.lp_f || 0}" aria-label="Tiefpass Kanal ${ch}"></td>
          <td><input class="w-s" type="number" data-c="ap_f" step="1" min="0" value="${s.ap_f || 0}" aria-label="Allpass Kanal ${ch}"></td>
          <td><input class="w-s" type="number" data-c="ap_q" step="0.05" min="0.1" value="${s.ap_q}" aria-label="Allpass Q Kanal ${ch}"></td>
          <td>${mixed ? '<span class="tag w" title="Boxen dieses Kanals haben unterschiedliche Werte">uneinheitlich</span>' : ''}</td></tr>`;
      }).join('')}</tbody></table><div class="note" style="padding:8px 6px">0 Hz = Filter aus. „Delays nullen“ setzt das kleinste Delay auf 0 ms.</div>`;
  }
}
export function initTables() {
  const wrap = $('#tbl');
  wrap.addEventListener('change', e => {
    const t = e.target, tr = t.closest('tr'); if (!tr) return;
    if (t.dataset.f) {
      const s = S.sources[+tr.dataset.i]; if (!s) return;
      pushUndo(); emit('useredit');
      const f = t.dataset.f;
      if (f === 'enabled') s.enabled = t.checked;
      else if (f === 'pinned') s.pinned = t.checked;
      else if (f === 'channel') s.channel = Math.max(0, Math.round(+t.value || 0));
      else if (f === 'rot_deg') {
        const c = SG.boxCentre(s.x, s.y, s.rot_deg, S.settings.box_d); s.rot_deg = +t.value;
        const fr = SG.boxFront(s.rot_deg); s.x = +(c[0] + fr[0] * S.settings.box_d / 2).toFixed(3); s.y = +(c[1] + fr[1] * S.settings.box_d / 2).toFixed(3);
      } else { let v = +t.value; if (!isFinite(v)) return; if (f === 'delay_ms' || f === 'lp_f') v = Math.max(0, v); s[f] = v; }
      changed('src');
    } else if (t.dataset.c) {
      const ch = +tr.dataset.ch, f = t.dataset.c; let v = +t.value; if (!isFinite(v)) return;
      if (f === 'delay_ms' || f === 'lp_f' || f === 'ap_f') v = Math.max(0, v);
      if (f === 'ap_q') v = Math.max(0.1, v);
      pushUndo(); emit('useredit');
      S.sources.forEach(s => { if ((s.channel || 0) === ch) s[f] = v; });
      changed('src');
    }
  });
  wrap.addEventListener('click', e => {
    const b = e.target.closest('button'), tr = e.target.closest('tr');
    if (b && b.dataset.del != null) { pushUndo(); emit('useredit'); S.sources.splice(+b.dataset.del, 1); S.sel = []; changed('src'); return; }
    if (b && b.dataset.f === 'polarity') { pushUndo(); emit('useredit'); S.sources[+tr.dataset.i].polarity *= -1; changed('src'); return; }
    if (b && b.dataset.c === 'polarity') {
      const ch = +tr.dataset.ch, p = -S.sources.find(s => (s.channel || 0) === ch).polarity;
      pushUndo(); emit('useredit'); S.sources.forEach(s => { if ((s.channel || 0) === ch) s.polarity = p; }); changed('src'); return;
    }
    if (tr && !e.target.closest('input,select,button')) {
      if (tr.dataset.i != null) {
        const s = S.sources[+tr.dataset.i], k = SG.footprintKey(s.x, s.y, s.rot_deg, S.settings.box_d);
        S.sel = S.sources.map((q, i) => SG.footprintKey(q.x, q.y, q.rot_deg, S.settings.box_d) === k ? i : -1).filter(i => i >= 0);
      } else if (tr.dataset.ch != null) { const ch = +tr.dataset.ch; S.sel = S.sources.map((q, i) => (q.channel || 0) === ch ? i : -1).filter(i => i >= 0); }
      S.selZone = null; emit('selection'); changed('view');
    }
  });
}
