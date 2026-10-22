/* SubGrid 2 — app entry: wiring, scheduler, keys, pages */
import SG from '../core/engine.js';
import { TEMPLATES, templateDefaults } from '../core/templates.js';
import { $, $$, clamp, fmt, fHz, num, toast, closeModal, openModal, KIND } from './util.js';
import { S, SCENARIOS, on, emit, changed, persist, undo, redo, canUndo, canRedo, pushUndo, applyLoaded, scenarioZones, env, c0 } from './state.js';
import { loadState, isExe, initPlatform, notifyReady, startupFile, desktop } from './platform.js';
import { studio, can, STUDIO_ONLY } from './edition.js';
import { initPlan, renderPlan, fitView, setTool, TOOLS, lowRes, setLowRes, setRenderRequest, setUserEditHook, rotSel, polSel, pinSel, dupSel, delSel, nudge, setSelZoneKind, closePoly, cancelDraw, drawing, closeMenu, menuOpen, onResize, invalidateMap, zoomBy, deleteSelWall, setSelWallLoss } from './plan.js';
import { computeAnalysis, renderKpis, renderAna } from './analysis.js';
import { renderTable, initTables } from './tables.js';
import { initTemplates, renderTplList, renderTplForm, selectTemplate, detachTpl, setFit } from './panels-templates.js';
import { initZonePanel, renderZonePanel, renderKindPicker, setZoneFit } from './panels-zones.js';
import { initLive, goalToForm, renderZoneStatus, setLiveHooks, stop as stopLive } from './panels-live.js';
import { renderCalc, renderKnow } from './pages.js';
import { fileAction, importJSON } from './files.js';

/* ---------- scheduler ---------- */
const dirty = { plan: true, ana: true, tbl: true, zones: true };
let raf = 0, hrT = 0;
function schedule() { if (!raf) raf = requestAnimationFrame(frame); }
function frame() {
  raf = 0;
  if (S.page === 'sim') {
    renderPlan(); dirty.plan = false;
    if (dirty.tbl) { renderTable(); dirty.tbl = false; }
    if (dirty.zones) { renderZonePanel(); renderZoneStatus(); dirty.zones = false; }
    if (dirty.ana && !lowRes) { computeAnalysis(); renderKpis(); renderAna(); dirty.ana = false; }
  }
  if (lowRes) { clearTimeout(hrT); hrT = setTimeout(() => { setLowRes(false); schedule(); }, 140); }
}
on('changed', what => {
  if (what !== 'view') { dirty.ana = dirty.tbl = true; if (what === 'zones' || what === 'all') dirty.zones = true; }
  if (what === 'all' || what === 'settings') settingsToForm();
  schedule();
});
on('selection', () => { dirty.tbl = dirty.zones = true; schedule(); });
on('undo', () => { $('#b-undo').disabled = !canUndo(); $('#b-redo').disabled = !canRedo(); });
on('tool', () => { renderToolbar(); schedule(); });
on('kind', () => renderToolbar());
on('useredit', () => detachTpl());
on('loaded', () => { settingsToForm(); goalToForm(); renderTplForm(); renderTplList(); invalidateMap(); fitView(); });
on('goal', () => goalToForm());
on('fit', () => fitView());
on('planchanged', () => { dirty.zones = true; schedule(); });
on('settings', () => settingsToForm());

/* ---------- settings bar ---------- */
function settingsToForm() {
  const st = S.settings;
  $('#s-temp').value = st.temp; $('#s-rh').value = st.RH; $('#s-flo').value = st.band[0]; $('#s-fhi').value = st.band[1];
  $('#s-bw').value = st.box_w; $('#s-bd').value = st.box_d; $('#s-spl').value = st.box_spl;
  $('#s-c').textContent = `c = ${fmt(c0(), 1)} m/s`;
  $('#p-freq').value = Math.round(1000 * Math.log10(st.mapFreq / 20));
  $('#p-freq-v').textContent = st.mapBand ? `${st.band[0]}–${st.band[1]} Hz` : fHz(st.mapFreq) + ' Hz';
  $('#p-band').classList.toggle('on', st.mapBand);
  $('#p-zones').classList.toggle('on', st.showZones); $('#p-cont').classList.toggle('on', st.showContours);
  $$('#p-mode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === st.mapMode)));
  $$('#ana-tab button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === S.anaTab)));
}
function renderToolbar() {
  $('#tools').innerHTML = TOOLS.filter(t => !t.hidden).map(t => {
    const locked = t.studio && !can(t.studio);
    return `<button class="tool ${locked ? 'locked' : ''}" data-tool="${t.id}" aria-pressed="${S.tool === t.id}" title="${t.label} (${t.key})${locked ? ' – nur in Studio' : ''}" aria-label="${t.label}"><svg><use href="#t-${t.id}"/></svg></button>`;
  }).join('')
    + '<span class="tsep"></span>' + Object.keys(KIND).map(k => `<button class="kind-sw" data-setkind="${k}" aria-pressed="${S.kind === k}" title="${KIND[k].label} (${KIND[k].key})" aria-label="${KIND[k].label}" style="--k:${KIND[k].col}"><i></i></button>`).join('');
  const t = TOOLS.find(q => q.id === S.tool) || TOOLS[0];
  const kindTxt = ['rect', 'poly', 'circle', 'fan', 'brush'].includes(S.tool) ? ` · <b style="color:${KIND[S.kind].col}">${KIND[S.kind].label}</b>` : '';
  const brushTxt = (S.tool === 'brush' || S.tool === 'eraser') ? ` · Radius ${fmt(S.brush, 1)} m ([ ])` : '';
  $('#toolhint').innerHTML = `<b>${t.label}</b>${kindTxt}${brushTxt}<span>${t.hint}</span>`;
  renderKindPicker();
}

/* ---------- pages + tabs ---------- */
function showLeft(v) {
  S.left = v; $$('[data-left]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.left === v)));
  ['live', 'zones', 'tpl'].forEach(k => { $('#left-' + k).hidden = k !== v; });
  if (v === 'tpl') { renderTplList(); renderTplForm(); }
  persist();
}
function showPage(p) {
  S.page = p;
  $$('.nav button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.page === p)));
  ['sim', 'calc', 'know'].forEach(k => { $('#page-' + k).hidden = k !== p; });
  if (p === 'sim') { invalidateMap(); dirty.ana = dirty.tbl = dirty.zones = true; schedule(); }
  if (p === 'calc') { $('#c1-t').value = S.settings.temp; renderCalc(); }
  if (p === 'know') renderKnow();
}

/* ---------- events ---------- */
function initEvents() {
  $('#envbar').addEventListener('change', e => {
    const st = S.settings, v = num(e.target.value, NaN); if (!isFinite(v)) return;
    const id = e.target.id;
    if (id === 's-temp') st.temp = clamp(v, -30, 50);
    if (id === 's-rh') st.RH = clamp(v, 0, 100);
    if (id === 's-flo') st.band = [clamp(v, 10, st.band[1] - 5), st.band[1]];
    if (id === 's-fhi') st.band = [st.band[0], clamp(v, st.band[0] + 5, 300)];
    if (id === 's-bw') st.box_w = clamp(v, 0.2, 3);
    if (id === 's-bd') st.box_d = clamp(v, 0.2, 3);
    if (id === 's-spl') st.box_spl = clamp(v, 60, 170);
    renderTplList(); renderTplForm(); changed('settings');
  });
  $('#p-freq').addEventListener('input', e => {
    const f = 20 * Math.pow(10, +e.target.value / 1000), nice = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200].find(n => Math.abs(Math.log(f / n)) < 0.035);
    S.settings.mapFreq = nice || Math.round(f); S.settings.mapBand = false; settingsToForm(); setLowRes(true); changed('view'); persist();
  });
  $('#p-band').addEventListener('click', () => { S.settings.mapBand = !S.settings.mapBand; settingsToForm(); changed('view'); persist(); });
  $('#p-zones').addEventListener('click', () => { S.settings.showZones = !S.settings.showZones; settingsToForm(); changed('view'); persist(); });
  $('#p-cont').addEventListener('click', () => { S.settings.showContours = !S.settings.showContours; settingsToForm(); changed('view'); persist(); });
  $('#p-mode').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; S.settings.mapMode = b.dataset.v; settingsToForm(); changed('view'); persist(); });
  $('#p-fit').addEventListener('click', fitView);
  $('#tools').addEventListener('click', e => { const b = e.target.closest('[data-tool]'); if (b) setTool(b.dataset.tool); });
  $('#ana-tab').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; S.anaTab = b.dataset.v; settingsToForm(); renderAna(); persist(); });
  $('#fchips').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (!b) return; const f = +b.dataset.f, a = S.settings.polarFreqs; S.settings.polarFreqs = a.includes(f) ? a.filter(x => x !== f) : a.concat([f]); renderAna(); persist(); });
  $('#tbl-tab').addEventListener('click', e => { const b = e.target.closest('[data-v]'); if (!b) return; S.tblTab = b.dataset.v; renderTable(); });
  $('#t-assign').addEventListener('click', () => { pushUndo(); emit('useredit'); SG.assignChannels(S.sources); changed('src'); toast('Kanäle nach gleichen Einstellungen zugeordnet'); });
  $('#t-zero').addEventListener('click', () => { pushUndo(); emit('useredit'); SG.normalizeDelays(S.sources); changed('src'); });
  $('#t-clear').addEventListener('click', () => { if (!S.sources.length) return; pushUndo(); emit('useredit'); S.sources = []; S.sel = []; emit('selection'); changed('src'); toast('Alle Boxen gelöscht – Strg+Z holt sie zurück'); });
  $('#sel-rot').addEventListener('click', () => rotSel(180)); $('#sel-pol').addEventListener('click', polSel); $('#sel-pin').addEventListener('click', pinSel);
  $('#sel-dup').addEventListener('click', dupSel); $('#sel-del').addEventListener('click', delSel); $('#sel-zdel').addEventListener('click', delSel);
  $('#sel-zone').addEventListener('click', e => { const b = e.target.closest('[data-selkind]'); if (b) setSelZoneKind(b.dataset.selkind); });
  $('#sel-zone-kinds').innerHTML = Object.keys(KIND).map(k => `<button class="kind-sw small" data-selkind="${k}" style="--k:${KIND[k].col}" title="Typ: ${KIND[k].label}" aria-label="Typ ${KIND[k].label}"><i></i></button>`).join('');
  $('#sel-wall-mat').addEventListener('change', e => setSelWallLoss(+e.target.value));
  $('#sel-wdel').addEventListener('click', deleteSelWall);
  $('#p-zin').addEventListener('click', () => zoomBy(1.4)); $('#p-zout').addEventListener('click', () => zoomBy(1 / 1.4));
  $('#plan-legend').innerHTML = Object.keys(KIND).map(k => `<span class="lg" style="color:${KIND[k].col}"><i></i><span class="k">${KIND[k].label}</span></span>`).join('')
    + '<span class="lg wall"><i></i><span class="k">Wand</span></span>';
  $('#b-undo').addEventListener('click', undo); $('#b-redo').addEventListener('click', redo);
  $('#b-keys').addEventListener('click', showKeys);
  $$('.nav button').forEach(b => b.addEventListener('click', () => showPage(b.dataset.page)));
  $$('[data-left]').forEach(b => b.addEventListener('click', () => showLeft(b.dataset.left)));
  $('#page-know').addEventListener('click', e => { const b = e.target.closest('[data-open-tpl]'); if (!b) return; showPage('sim'); showLeft('tpl'); selectTemplate(b.dataset.openTpl); });
  $('#page-calc').addEventListener('input', () => renderCalc());
  const pop = $('#m-file'), fb = $('#b-file');
  fb.addEventListener('click', e => { e.stopPropagation(); pop.hidden = !pop.hidden; fb.setAttribute('aria-expanded', String(!pop.hidden)); });
  document.addEventListener('click', e => { if (!pop.hidden && !e.target.closest('.menu')) { pop.hidden = true; fb.setAttribute('aria-expanded', 'false'); } });
  pop.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (!b) return; pop.hidden = true; fb.setAttribute('aria-expanded', 'false'); fileAction(b.dataset.act); });
  $('#modal-x').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  new ResizeObserver(() => { onResize(); schedule(); }).observe($('#plan-wrap'));
  let raAna = 0;
  new ResizeObserver(() => { cancelAnimationFrame(raAna); raAna = requestAnimationFrame(() => { if (S.page === 'sim') renderAna(); }); }).observe($('.ana-cv'));
  window.addEventListener('resize', () => { if (S.page === 'calc') renderCalc(); });
}
function showKeys() {
  openModal('Maus & Tasten', `<div class="keys">
    <kbd>S</kbd><span>Auswahl: Boxen/Zonen wählen, ziehen, an den Griffen verformen</span>
    <kbd>A</kbd><span>Box setzen</span>
    <kbd>R G C F</kbd><span>Rechteck · Polygon · Kreis · Fächer zeichnen</span>
    <kbd>B / X</kbd><span>Pinsel / Radierer (rechte Maustaste radiert, [ ] = Größe)</span>
    <kbd>K</kbd><span>Zone per Klick löschen</span>
    <kbd>W</kbd><span>Wand zeichnen (Studio) – Klick auf Startpunkt schließt den Raum, ⇧ = 15°-Schritte</span>
    <kbd>M</kbd><span>Messen: Abstand, Winkel, Laufzeit</span>
    <kbd>1 2 3 4 5</kbd><span>Flächenart: Publikum · Bühne · Ruhezone · Aufstellfläche · Sperrfläche</span>
    <kbd>T / ⇧T</kbd><span>Auswahl um 180° / 90° drehen</span>
    <kbd>I</kbd><span>Polarität umkehren</span><kbd>L</kbd><span>Fixieren (Optimierer lässt sie stehen)</span>
    <kbd>Strg+D</kbd><span>Duplizieren</span><kbd>Entf</kbd><span>Löschen (Box oder Zone)</span>
    <kbd>Pfeile</kbd><span>Auswahl 10 cm schieben (⇧ = 1 cm)</span><kbd>0 / + / −</kbd><span>Ansicht einpassen / zoomen</span>
    <kbd>Strg+Z / Strg+Y</kbd><span>Rückgängig / Wiederholen</span><kbd>Strg+S / Strg+O</kbd><span>Speichern / Öffnen</span>
    <kbd>Rechtsklick</kbd><span>Kontextmenü auf Box, Zone oder freier Fläche</span>
    <kbd>Mausrad / Mitteltaste</kbd><span>Zoomen / Verschieben</span></div>
    <p class="note" style="margin:0">Konventionen wie im Python-Subarray: x = rechts, y = nach vorne, 0° = vorne. Die Schallquelle sitzt in der Mitte der Boxfront (weiße Kante). Gemalte Flächen haben 0,5-m-Raster.</p>`);
}
function initKeys() {
  document.addEventListener('keydown', e => {
    if (e.target.closest('input,select,textarea')) return;
    if (!$('#modal').hidden) { if (e.key === 'Escape') closeModal(); return; }
    const mod = e.ctrlKey || e.metaKey, k = e.key;
    if (mod && k.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return; }
    if (mod && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) { e.preventDefault(); redo(); return; }
    if (mod && k.toLowerCase() === 's') { e.preventDefault(); fileAction('save'); return; }
    if (mod && k.toLowerCase() === 'o') { e.preventDefault(); fileAction('open'); return; }
    if (S.page !== 'sim') return;
    if (mod && k.toLowerCase() === 'd') { e.preventDefault(); dupSel(); return; }
    if (mod) return;
    if (k === 'Escape') { if (menuOpen()) closeMenu(); else if (drawing()) cancelDraw(); else if (S.measure) { S.measure = null; schedule(); } else { S.sel = []; S.selZone = null; S.selWall = null; emit('selection'); changed('view'); } return; }
    if (k === '+' || k === '=') { zoomBy(1.4); return; }
    if (k === '-' || k === '_') { zoomBy(1 / 1.4); return; }
    if (k === 'Enter' && drawing()) { closePoly(); return; }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); delSel(); return; }
    const tool = TOOLS.find(t => t.key.toLowerCase() === k.toLowerCase());
    if (tool && !e.shiftKey) { setTool(tool.id); return; }
    const kind = Object.keys(KIND).find(q => KIND[q].key === k);
    if (kind) { S.kind = kind; emit('kind'); if (!['rect', 'poly', 'circle', 'fan', 'brush'].includes(S.tool)) setTool('rect'); return; }
    if (k === 't' || k === 'T') { rotSel(e.shiftKey ? 90 : 180); return; }
    if (k === 'i' || k === 'I') { polSel(); return; }
    if (k === 'l' || k === 'L') { pinSel(); return; }
    if (k === '0' || k === 'Home') { fitView(); return; }
    if (k === '[' || k === ']') { S.brush = clamp(+(S.brush + (k === ']' ? 0.5 : -0.5)).toFixed(1), 0.5, 15); renderToolbar(); schedule(); return; }
    if (k.startsWith('Arrow')) {
      if (!S.sel.length) return; e.preventDefault();
      const st = e.shiftKey ? 0.01 : 0.1;
      nudge(k === 'ArrowLeft' ? -st : k === 'ArrowRight' ? st : 0, k === 'ArrowUp' ? st : k === 'ArrowDown' ? -st : 0);
    }
  });
}

/* ---------- init ---------- */
async function init() {
  await initPlatform();
  document.body.classList.add(studio() ? 'ed-studio' : 'ed-lite');
  $('#brand-ed').textContent = studio() ? 'STUDIO' : 'LITE';
  document.title = studio() ? 'SubGrid Studio' : 'SubGrid Lite';
  const saved = await loadState();
  if (!applyLoaded(saved)) {
    scenarioZones(Object.assign({}, SCENARIOS[0].z, { placeW: 12 }));
    S.tpl = { id: 'cardstack', p: Object.assign(templateDefaults('cardstack', env()), { n: 4, hf: 1, s: 1.6 }), live: true };
    S.sources = TEMPLATES.cardstack.build(S.tpl.p, env()).srcs.map(s => Object.assign(SG.makeSource(s), { pinned: false }));
  }
  if (isExe()) {
    document.body.classList.add('is-exe');
    // desktop app: no browser context menu (Back/Reload/Print) outside text fields
    document.addEventListener('contextmenu', e => { if (!e.target.closest('input,textarea')) e.preventDefault(); });
  }
  window.__subgrid = { S };
  setRenderRequest(schedule);
  setUserEditHook(() => emit('useredit'));
  setFit(fitView); setZoneFit(fitView);
  setLiveHooks({ fit: fitView, gotoZones: () => { showLeft('zones'); setTool('rect'); } });
  settingsToForm(); goalToForm(); renderToolbar();
  initPlan(); initTables(); initTemplates(); initZonePanel(); initLive(); initEvents(); initKeys();
  showLeft(['live', 'zones', 'tpl'].includes(S.left) ? S.left : 'live');
  emit('undo');
  showPage('sim');
  requestAnimationFrame(() => { fitView(); changed('view'); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { invalidateMap(); dirty.ana = true; schedule(); renderTplList(); });
  const f = startupFile(); if (f) importJSON(f.text, f.name);
  if (desktop && desktop.mode === 'browser') toast('SubGrid läuft im Browser (Programmfenster nicht verfügbar). Tab offen lassen – Speichern geht wie gewohnt.', 'ok');
  notifyReady();
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
