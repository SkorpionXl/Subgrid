/* SubGrid — application state, zones (drawn shapes + painted cells), undo, change bus */
import SG from '../core/engine.js';
import { zonesFromGoal } from '../core/families.js';
import { saveState } from './platform.js';
import { can } from './edition.js';

export const CELL = 0.5;               // painted cells, same as subarray
export const DEF_SETTINGS = { temp: 20, RH: 50, band: [40, 100], box_w: 0.6, box_d: 0.8, box_spl: 130, mapFreq: 63, mapBand: false,
  mapMode: 'spl', showZones: true, showContours: true, polarFreqs: [40, 63, 80, 100], delayStep: 0.01, gainStep: 0.1, reflOrder: 1 };
export const DEF_GOAL = { boxes: 8, channels: 4, maxStack: 2, dsp: 'full', quietTarget: -15, stageTarget: -10, priority: 'balanced', robust: true,
  mode: 'design', move: false, preview: true, effort: 'normal', seed: 1, families: null };
export const SCENARIOS = [
  { name: 'Festival-Bühne', g: { boxes: 12, channels: 6, maxStack: 2, dsp: 'full' }, z: { audAngle: 100, audR1: 8, audR2: 40, quietOn: true, quietAngle: 120, quietR1: 1.5, quietR2: 12, placeW: 16, placeD: 3, gap: 0 } },
  { name: 'Club', g: { boxes: 6, channels: 4, maxStack: 3, dsp: 'full' }, z: { audAngle: 90, audR1: 3, audR2: 18, quietOn: true, quietAngle: 100, quietR1: 1, quietR2: 6, placeW: 8, placeD: 2, gap: 0 } },
  { name: 'Stadtfest, Anwohner hinten', g: { boxes: 8, channels: 4, maxStack: 2, dsp: 'full', priority: 'rear', quietTarget: -20 }, z: { audAngle: 80, audR1: 6, audR2: 35, quietOn: true, quietAngle: 140, quietR1: 3, quietR2: 40, placeW: 10, placeD: 4, gap: 0 } },
  { name: 'Bühnenkanten, Mitte frei', g: { boxes: 8, channels: 4, maxStack: 2, dsp: 'full' }, z: { audAngle: 100, audR1: 6, audR2: 30, quietOn: true, quietAngle: 110, quietR1: 1.5, quietR2: 10, placeW: 14, placeD: 2, gap: 8 } },
  { name: 'Aula ohne DSP', g: { boxes: 4, channels: 1, maxStack: 2, dsp: 'none', priority: 'even' }, z: { audAngle: 90, audR1: 3, audR2: 20, quietOn: false, placeW: 8, placeD: 1.5, gap: 0 } },
  { name: 'Rundum 360°', g: { boxes: 8, channels: 4, maxStack: 2, dsp: 'full', priority: 'even' }, z: { audAngle: 360, audR1: 5, audR2: 22, quietOn: false, placeW: 4, placeD: 3, gap: 0 } },
];

export const S = {
  sources: [],
  shapes: [],                 // drawn zones {id, kind, shape, p}
  paint: new Map(),           // "i,j" -> kind
  paintVer: 0,
  walls: [],                  // {id, p: [x0,y0,x1,y1,…], loss}  (same format as Subarray)
  bg: null,                   // hall plan {url, name, x, y, mpp, opacity, invert, w, h}
  selWall: null,
  settings: Object.assign({}, DEF_SETTINGS), goal: Object.assign({}, DEF_GOAL),
  sel: [], selZone: null,
  view: { x: 0, y: 8, s: 20 },
  page: 'sim', left: 'live', anaTab: 'polar', tblTab: 'boxes',
  tool: 'select', kind: 'audience', brush: 1.5,
  tpl: { id: 'cardstack', p: null, live: false },
};
let zid = 1;
export const newZoneId = () => 'z' + (zid++);
export const wallsClean = () => S.walls.filter(w => w.p.length >= 4).map(w => ({ p: w.p.slice(), loss: +w.loss || 0 }));
export const setWalls = list => { S.walls = (list || []).filter(w => w && Array.isArray(w.p) && w.p.length >= 4).map(w => ({ id: newZoneId(), p: w.p.map(Number), loss: +w.loss || 0 })); S.selWall = null; };

/* ---------- zones ---------- */
let gridCache = { ver: -1, grids: [] };
export function paintGrids() {
  if (gridCache.ver === S.paintVer) return gridCache.grids;
  const by = {};
  S.paint.forEach((k, key) => { (by[k] || (by[k] = [])).push(key.split(',').map(Number)); });
  const grids = Object.keys(by).map(k => Object.assign(SG.zones.gridFromCells(k, CELL, by[k]), { id: 'grid-' + k }));
  gridCache = { ver: S.paintVer, grids };
  return grids;
}
export const allZones = () => S.shapes.concat(paintGrids());
export const zonesClean = () => allZones().map(z => { const o = { kind: z.kind, shape: z.shape, p: z.p.slice() }; if (z.runs) o.runs = z.runs; return o; });
export function setZones(list) {
  S.shapes = []; S.paint = new Map();
  for (const z of list) {
    if (z.shape === 'grid') {
      const c = z.p[0] || CELL;
      SG.zones.gridCells(z).forEach(([i, j]) => {
        if (Math.abs(c - CELL) < 1e-9) S.paint.set(i + ',' + j, z.kind);
        else { // resample other cell sizes onto 0.5 m
          for (let x = i * c; x < (i + 1) * c - 1e-9; x += CELL) for (let y = j * c; y < (j + 1) * c - 1e-9; y += CELL)
            S.paint.set(Math.floor((x + CELL / 2) / CELL) + ',' + Math.floor((y + CELL / 2) / CELL), z.kind);
        }
      });
    } else S.shapes.push({ id: newZoneId(), kind: z.kind, shape: z.shape, p: z.p.slice() });
  }
  S.paintVer++; S.selZone = null;
}
export function scenarioZones(z) { setZones(zonesFromGoal(z)); }

/** rasterise a drawn shape into painted cells (used before erasing inside it) */
export function rasterizeShape(z) {
  const b = SG.zones.bbox(z);
  for (let i = Math.floor(b[0] / CELL); i <= Math.floor(b[2] / CELL); i++)
    for (let j = Math.floor(b[1] / CELL); j <= Math.floor(b[3] / CELL); j++)
      if (SG.zones.contains(z, (i + 0.5) * CELL, (j + 0.5) * CELL)) S.paint.set(i + ',' + j, z.kind);
  S.shapes = S.shapes.filter(s => s !== z); S.paintVer++;
}

/* ---------- undo ---------- */
const undoStack = [], redoStack = [];
const snap = () => JSON.stringify({ sources: S.sources, shapes: S.shapes, paint: [...S.paint.entries()], walls: S.walls });
function restore(t) {
  const o = JSON.parse(t);
  S.sources = o.sources.map(s => Object.assign(SG.makeSource(s), { pinned: !!s.pinned }));
  S.shapes = o.shapes; S.paint = new Map(o.paint); S.paintVer++;
  S.walls = o.walls || [];
  S.sel = []; S.selZone = null; S.selWall = null;
}
export function pushUndo() { undoStack.push(snap()); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; emit('undo'); }
export function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); emit('undo'); changed('all'); }
export function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); emit('undo'); changed('all'); }
export const canUndo = () => undoStack.length > 0, canRedo = () => redoStack.length > 0;

/* ---------- bus + change flags ---------- */
const L = {};
export function on(ev, fn) { (L[ev] || (L[ev] = [])).push(fn); }
export function emit(ev, d) { (L[ev] || []).forEach(f => f(d)); }
/** what: 'src' (boxes), 'zones', 'settings', 'view', 'all' */
export function changed(what) { emit('changed', what || 'all'); if (what !== 'view') persist(); }

export function persist() {
  saveState({ v: 3, sources: S.sources, zones: zonesClean(), walls: wallsClean(), bg: S.bg, view: S.view, settings: S.settings, goal: S.goal, tpl: { id: S.tpl.id, p: S.tpl.p }, left: S.left, anaTab: S.anaTab });
}
export function applyLoaded(o) {
  if (!o || !Array.isArray(o.sources)) return false;
  S.sources = o.sources.map(s => Object.assign(SG.makeSource(s), { pinned: !!s.pinned }));
  setZones(Array.isArray(o.zones) ? o.zones : []);
  setWalls(o.walls);
  S.bg = o.bg && o.bg.url ? o.bg : null;
  S.settings = Object.assign({}, DEF_SETTINGS, o.settings || {});
  S.goal = Object.assign({}, DEF_GOAL, o.goal || {});
  if (o.tpl && o.tpl.id) S.tpl = { id: o.tpl.id, p: o.tpl.p || null, live: false };
  if (o.left) S.left = o.left;
  if (o.anaTab) S.anaTab = o.anaTab;
  return true;
}

/* ---------- derived ---------- */
export const c0 = () => SG.speedOfSound(S.settings.temp, S.settings.RH);
export const band = () => S.settings.band;
export const env = () => { const [lo, hi] = band(); return { c: c0(), fLo: lo, fHi: hi, fC: Math.sqrt(lo * hi), w: S.settings.box_w, d: S.settings.box_d }; };
export const onSrc = () => S.sources.filter(s => s.enabled);
export function fullGoal() {
  const st = S.settings;
  const g = Object.assign({}, S.goal, { band: band().slice(), temp: st.temp, RH: st.RH, box_w: st.box_w, box_d: st.box_d, box_spl: st.box_spl, delayStep: st.delayStep, gainStep: st.gainStep });
  const room = activeRoom();
  g.walls = room ? wallsClean() : null; g.reflOrder = room ? room.order : 0;
  if (!can('families')) g.families = null;
  if (!can('thorough') && g.effort === 'thorough') g.effort = 'normal';
  return g;
}
/** walls that take part in the simulation (Studio, reflection order > 0) */
export function activeRoom() {
  if (!can('walls') || !S.walls.length || !(S.settings.reflOrder > 0)) return null;
  const segs = SG.wallSegments(wallsClean());
  return segs ? { segs, order: S.settings.reflOrder } : null;
}
export const roomKey = () => { const r = activeRoom(); return r ? JSON.stringify([wallsClean(), r.order]) : ''; };
let scorerCache = { key: '', sc: null };
export function getScorer() {
  const zs = zonesClean(), room = activeRoom();
  const key = JSON.stringify([zs, band(), S.settings.temp, S.settings.RH, S.goal.quietTarget, S.goal.stageTarget, S.settings.box_spl, roomKey()]);
  if (scorerCache.key !== key) {
    let sc = null;
    try {
      sc = new SG.Scorer(zs, { band: band(), temps: [S.settings.temp], RH: S.settings.RH, quiet_target: S.goal.quietTarget, stage_target: S.goal.stageTarget, box_spl: S.settings.box_spl,
        nAud: 180, nQuiet: 110, nStage: 80, walls: room ? wallsClean() : null, refl_order: room ? room.order : 0 });
      if (!sc.ok) sc = null;
    }
    catch (e) { sc = null; }
    scorerCache = { key, sc };
  }
  return scorerCache.sc;
}
export function zoneSummary() {
  const out = { audience: 0, stage: 0, quiet: 0, place: 0, nogo: 0, n: { audience: 0, stage: 0, quiet: 0, place: 0, nogo: 0 } };
  allZones().forEach(z => { const a = SG.zones.area(z); if (a > 0) { out[z.kind] += a; out.n[z.kind]++; } });
  return out;
}
