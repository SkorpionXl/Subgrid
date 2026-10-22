/* SubGrid — setup files: JSON (subarray compatible), CSV, DSP text, PNG */
import SG from '../core/engine.js';
import { $, fmt, sfmt, toast } from './util.js';
import { S, DEF_SETTINGS, DEF_GOAL, pushUndo, changed, emit, zonesClean, setZones, setWalls, wallsClean, c0, band } from './state.js';
import { saveFile, openFile, copyText } from './platform.js';
import { chanGroups } from './tables.js';
import { analysis } from './analysis.js';

/** project file: Subarray-compatible core + everything SubGrid needs in "subgrid".
    forSubarray: stage zones become quiet zones (Subarray knows no stage), marked with sg_kind */
export function exportJSON(forSubarray) {
  const st = S.settings;
  const zones = zonesClean().map(z => z.kind === 'stage' && forSubarray ? Object.assign(z, { kind: 'quiet', sg_kind: 'stage' }) : z);
  const o = {
    temp_c: st.temp, box_w: st.box_w, box_d: st.box_d,
    sources: S.sources.map(s => ({ x: s.x, y: s.y, delay_ms: s.delay_ms, gain_db: s.gain_db, polarity: s.polarity, enabled: s.enabled, channel: s.channel, rot_deg: s.rot_deg, ap_f: s.ap_f, ap_q: s.ap_q, lp_f: s.lp_f, pinned: !!s.pinned })),
    zones, walls: wallsClean(),
    opt: { boxes: S.goal.boxes, channels: S.goal.channels, max_stack: S.goal.maxStack, band: band(), temps: [st.temp - 5, st.temp, st.temp + 5], quiet_target: S.goal.quietTarget, box_spl: st.box_spl, delay_step: st.delayStep, gain_step: st.gainStep, refl_order: st.reflOrder },
    subgrid: { version: 3, settings: st, goal: S.goal },
  };
  if (!forSubarray && S.bg) o.subgrid.bg = S.bg;
  return JSON.stringify(o, null, forSubarray ? 2 : 1);
}
export function importJSON(txt, name) {
  let o; try { o = JSON.parse(txt); } catch (e) { toast('Die Datei ist kein gültiges JSON.', 'err'); return false; }
  if (!o || !Array.isArray(o.sources)) { toast('Keine Boxen in der Datei (Feld „sources“ fehlt).', 'err'); return false; }
  pushUndo();
  const keys = ['x', 'y', 'delay_ms', 'gain_db', 'polarity', 'enabled', 'channel', 'rot_deg', 'ap_f', 'ap_q', 'lp_f'];
  S.sources = o.sources.map(s => { const t = {}; keys.forEach(k => { if (s[k] != null) t[k] = s[k]; }); return Object.assign(SG.makeSource(t), { pinned: !!s.pinned }); });
  const notes = [];
  if (o.subgrid && o.subgrid.settings) S.settings = Object.assign({}, DEF_SETTINGS, o.subgrid.settings);
  if (o.subgrid && o.subgrid.goal) S.goal = Object.assign({}, DEF_GOAL, o.subgrid.goal);
  if (o.temp_c != null) S.settings.temp = +o.temp_c;
  if (o.box_w) S.settings.box_w = +o.box_w;
  if (o.box_d) S.settings.box_d = +o.box_d;
  if (o.opt && Array.isArray(o.opt.band)) S.settings.band = [+o.opt.band[0], +o.opt.band[1]];
  if (o.opt && !o.subgrid) {
    if (o.opt.boxes) S.goal.boxes = +o.opt.boxes; if (o.opt.channels) S.goal.channels = +o.opt.channels; if (o.opt.max_stack) S.goal.maxStack = +o.opt.max_stack;
    if (o.opt.quiet_target != null) S.goal.quietTarget = +o.opt.quiet_target;
  }
  const ok = ['circle', 'ring', 'sector', 'rect', 'poly', 'grid'];
  const zs = Array.isArray(o.zones) ? o.zones : [];
  const kept = zs.filter(z => ok.includes(z.shape) && SG.zones.KINDS.includes(z.kind)).map(z => z.sg_kind === 'stage' ? Object.assign({}, z, { kind: 'stage' }) : z);
  if (kept.length < zs.length) notes.push(`${zs.length - kept.length} Zone(n) (Linie/Bogen) übersprungen`);
  if (kept.length || zs.length) setZones(kept);
  setWalls(o.walls);
  if (S.walls.length) notes.push(S.walls.length + ' Wand/Wände');
  if (o.opt && o.opt.refl_order != null && !(o.subgrid && o.subgrid.settings)) S.settings.reflOrder = +o.opt.refl_order;
  S.bg = o.subgrid && o.subgrid.bg && o.subgrid.bg.url ? o.subgrid.bg : null;
  S.sel = []; S.selZone = null; S.selWall = null; S.tpl.live = false;
  emit('loaded'); changed('all');
  toast(`${name ? name + ': ' : ''}${S.sources.length} Boxen, ${kept.length} Zonen geladen` + (notes.length ? ' · ' + notes.join(' · ') : ''), 'ok');
  return true;
}
export function exportCSV() {
  const lines = ['#;channel;x_m;y_m;rot_deg;delay_ms;gain_db;polarity;allpass_hz;allpass_q;lowpass_hz;enabled'];
  S.sources.forEach((s, i) => lines.push(`${i + 1};${s.channel};${s.x.toFixed(3)};${s.y.toFixed(3)};${Math.round(s.rot_deg)};${s.delay_ms.toFixed(3)};${s.gain_db.toFixed(2)};${s.polarity > 0 ? '+' : '-'};${(+s.ap_f).toFixed(1)};${(+s.ap_q).toFixed(2)};${(+s.lp_f).toFixed(1)};${s.enabled ? 1 : 0}`));
  return lines.join('\n') + '\n';
}
const DIRN = { 0: 'vorne', 90: 'links', 180: 'hinten', 270: 'rechts' };
export function dspText() {
  const st = S.settings, out = [`SubGrid – DSP-Liste · ${new Date().toLocaleString('de-DE')}`, `Temperatur ${st.temp} °C · c = ${fmt(c0(), 1)} m/s · Band ${band()[0]}–${band()[1]} Hz`, ''];
  chanGroups().forEach(([ch, idx]) => {
    const s = S.sources[idx[0]];
    out.push(`${ch ? 'Kanal ' + ch : 'Ohne Kanal'}: Delay ${fmt(s.delay_ms, 2)} ms | Gain ${sfmt(s.gain_db, 1)} dB | Polarität ${s.polarity < 0 ? 'INVERTIERT' : 'normal'}${s.lp_f ? ' | LP ' + s.lp_f + ' Hz' : ''}${s.ap_f ? ' | AP ' + s.ap_f + ' Hz Q ' + s.ap_q : ''} | Boxen ${idx.map(i => i + 1).join(', ')}`);
  });
  out.push('', 'Positionen (x rechts, y nach vorne, m):');
  S.sources.forEach((s, i) => out.push(`  #${i + 1}  K${s.channel || '-'}  x ${fmt(s.x, 2)}  y ${fmt(s.y, 2)}  ${DIRN[Math.round(s.rot_deg)] || fmt(s.rot_deg, 0) + '°'}${s.pinned ? '  (fixiert)' : ''}`));
  const A = analysis();
  if (A) out.push('', `Pegel vorne ${sfmt(A.bs.on_mean, 1)} dB re 1 Box · Rückwärts ${sfmt(A.bs.rear_worst, 1)} dB · Öffnung ${Math.round(A.bs.bw_mean)}°`);
  return out.join('\n');
}
let projName = '';
export async function fileAction(a) {
  if (a === 'new') { pushUndo(); S.sources = []; S.sel = []; S.tpl.live = false; emit('selection'); changed('all'); toast('Neues Setup – Zonen sind geblieben'); }
  if (a === 'open') { const f = await openFile(); if (f) { importJSON(f.text, f.name); projName = f.name.replace(/\.(subgrid|json)$/i, ''); } }
  if (a === 'save') { const r = await saveFile((projName || 'projekt') + '.subgrid', exportJSON(false), 'application/json'); if (r && r.name) projName = r.name.replace(/\.(subgrid|json)$/i, ''); }
  if (a === 'subarray') saveFile((projName || 'subgrid-setup') + '.json', exportJSON(true), 'application/json');
  if (a === 'csv') saveFile('subgrid-dsp.csv', exportCSV(), 'text/csv');
  if (a === 'copy') copyText(dspText());
  if (a === 'png') $('#plan').toBlob(bl => { if (bl) saveFile('subgrid-draufsicht.png', bl, 'image/png'); });
}
