/* SubGrid — live optimizer (runs in a Web Worker, step by step).
   Design mode:  controlled racing – every textbook topology in all structural variants
                 (rows, spacing, stacking …) is screened, then rounds with equal budgets
                 drop the weaker half; finalists are refined, "Freiform" moves single stacks
                 of the leader beyond the textbook. Reproducible with the same seed.
   Setup mode:   keep the user's layout, optimise DSP per channel, optionally let unpinned
                 stacks move a little. */
import SG from './engine.js';
import { FAM, goalContext, toWorld, feasible, weightsFor, whyNot, DSP_RANK, fmt } from './families.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function gauss(rnd) { let u = 0, v = 0; while (u === 0) u = rnd(); v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function makeScorer(zones, goal, temps) {
  const sc = new SG.Scorer(zones, Object.assign(weightsFor(goal), {
    band: goal.band, temps, RH: goal.RH, box_spl: goal.box_spl || 0, target_spl: goal.target_spl || 0, nAud: 180, nQuiet: 110, nStage: 80,
    walls: goal.walls || null, refl_order: goal.reflOrder != null ? goal.reflOrder : 1,
  }));
  if (!sc.ok) throw new Error('Die Publikumsfläche ist leer oder liegt komplett in der Ruhezone.');
  return sc;
}

class Base {
  constructor(zones, goal) {
    this.goal = goal;
    const T = goal.temp;
    this.temps = goal.robust ? [T - 5, T, T + 5] : [T];
    this.mid = goal.robust ? 1 : 0;
    this.allT = this.temps.map((_, i) => i);
    this.scorer = makeScorer(zones, goal, this.temps);
    this.geoCache = new Map();
    this.evals = 0; this.t0 = now(); this.lastImprove = now();
    this.rnd = SG.rng((goal.seed || (Date.now() ^ 0x5bd1e995)) >>> 0);
    this.history = [];
    this.best = null;
    this.nextId = 1;
  }
  geo(pos) {
    const key = Array.from(pos, v => v.toFixed(3)).join(',');
    let g = this.geoCache.get(key);
    if (!g) { g = this.scorer.geometry(pos); if (this.geoCache.size > 300) this.geoCache.clear(); this.geoCache.set(key, g); }
    return g;
  }
  scoreSrcs(srcs, temps) {
    const pos = new Float64Array(srcs.length * 2);
    srcs.forEach((s, i) => { pos[2 * i] = s.x; pos[2 * i + 1] = s.y; });
    const r = this.scorer.score(this.geo(pos), SG.sourceWeights(srcs, this.scorer.F), temps);
    this.evals++;
    return r;
  }
  noteBest(cost) {
    const t = (now() - this.t0) / 1000;
    if (!this.history.length || cost < this.history[this.history.length - 1][1] - 1e-9) { this.history.push([t, cost]); this.lastImprove = now(); }
  }
  elapsed() { return (now() - this.t0) / 1000; }
  sinceImprove() { return (now() - this.lastImprove) / 1000; }
  hist() {
    const h = this.history, t = this.elapsed();
    const out = h.length > 160 ? h.filter((_, i) => i % Math.ceil(h.length / 160) === 0 || i === h.length - 1) : h.slice();
    if (out.length) out.push([t, out[out.length - 1][1]]);
    return out;
  }
}

/* ===================================================================== design mode */
/* Controlled racing over "approaches" (= topology × structural variant):
   screen   every knowledge seed once (single temperature)
   race     3 rounds with growing budget per approach (robust cost); after each round the
            weaker half drops out – round 1 also keeps the best variant of every topology
   final    the survivors keep evolving; "Freiform" moves single stacks of the leader      */
const ROUNDS = [{ budget: 16, keep: 0.5, min: 8 }, { budget: 40, keep: 0.5, min: 4 }, { budget: 90, keep: 0.5, min: 3 }];
const EFFORT = { fast: 0.6, normal: 1, thorough: 2.2 };

export class LiveOptimizer extends Base {
  constructor(zones, goal) {
    super(zones, goal);
    this.ctx = goalContext(zones, goal);
    this.rnd = SG.rng((goal.seed || 1) >>> 0);
    this.skipped = [];
    this.app = new Map();           // key -> approach
    this.seedQueue = [];
    this.phase = 'screen'; this.round = -1; this.turn = 0; this.iter = 0;
    this.descCache = new Map();
    this.scale = EFFORT[goal.effort || 'normal'] || 1;
    const ctx = this.ctx, on = goal.families ? new Set(goal.families) : null;
    /* audience clearly off the placement axis: besides "turned towards the audience" every
       topology is also tried "straight" (aligned to the placement area, aimed by its pattern) */
    this.ctxP = !ctx.omni && Math.abs(ctx.steer) >= 7
      ? Object.assign({}, ctx, ctx.pframe, { steer: 0, thetaHalf: Math.min(180, ctx.thetaHalf + Math.abs(ctx.steer)) }) : null;
    for (const k of Object.keys(FAM)) {
      const F = FAM[k];
      if (on && !on.has(k)) { this.skipped.push({ fam: k, why: 'abgewählt' }); continue; }
      if (DSP_RANK[ctx.dsp] < DSP_RANK[F.needs]) { this.skipped.push({ fam: k, why: F.needs === 'full' ? 'braucht DSP mit Delay' : 'braucht DSP (Polarität/Gain)' }); continue; }
      if (ctx.omni && !ctx.quiet && F.directional) { this.skipped.push({ fam: k, why: 'Publikum rundum – Richtwirkung bringt hier nichts' }); continue; }
      const frames = this.ctxP && F.frame !== 'placement' ? ['A', 'P'] : ['A'];
      let any = false;
      frames.forEach(fr => {
        const ps = F.enumerate(this.cx(fr));
        ps.forEach(p => {
          const v = F.variant(p), key = k + ':' + v.key + (fr === 'P' ? ':P' : '');
          const label = v.label + (frames.length > 1 ? (fr === 'P' ? ' · gerade' : ' · gedreht') : '');
          if (!this.app.has(key)) this.app.set(key, { key, fam: k, fr, label, nSeeds: 0, screen: null, best: null, status: 'screen', spent: 0, spentRound: 0, st: null, out: null });
          this.app.get(key).nSeeds++;
          this.seedQueue.push({ key, fam: k, fr, p });
          any = true;
        });
      });
      if (!any) { this.skipped.push({ fam: k, why: whyNot(k, ctx) }); continue; }
    }
    this.seedTotal = this.seedQueue.length;
  }

  cx(fr) { return fr === 'P' ? this.ctxP : this.ctx; }
  nChans(fam, p, fr) { return FAM[fam].build(this.cx(fr), p).chans.length; }
  build(cand) {
    const ctx = this.cx(cand.fr), fam = cand.fam === 'free' ? cand.src : cand.fam, F = FAM[fam];
    const des = F.build(ctx, cand.p);
    const tr = cand.trims || [];
    const chans = des.chans.map((c, k) => ({ delay: c.delay + (tr[2 * k] || 0), gain: Math.min(0, Math.max(ctx.gainMin, c.gain + (tr[2 * k + 1] || 0))), pol: c.pol }));
    const m = Math.min(...chans.map(c => c.delay)); if (m < 0) chans.forEach(c => { c.delay -= m; });
    let boxes = des.boxes;
    if (ctx.omni && F.frame !== 'placement') {
      let y0 = Infinity, y1 = -Infinity;
      boxes.forEach(b => SG.boxCorners(b.x, b.y, b.rot, ctx.w, ctx.d).forEach(c => { y0 = Math.min(y0, c[1]); y1 = Math.max(y1, c[1]); }));
      const dy = (ctx.y0 + ctx.y1) / 2 - (y0 + y1) / 2;
      boxes = boxes.map(b => Object.assign({}, b, { y: b.y + dy }));
    }
    boxes = toWorld(this.ctx, boxes, F.frame === 'placement' || cand.fr === 'P' ? this.ctx.pframe : null);
    if (cand.fam === 'free' && cand.offs) {
      const idx = new Map(); let k = 0;
      boxes = boxes.map(b => {
        const key = SG.footprintKey(b.x, b.y, b.rot, ctx.d);
        if (!idx.has(key)) idx.set(key, k++);
        const i = idx.get(key);
        return Object.assign({}, b, { x: b.x + (cand.offs[2 * i] || 0), y: b.y + (cand.offs[2 * i + 1] || 0) });
      });
    }
    return { boxes, chans, meta: des.meta };
  }
  toSrcs(des) {
    const ctx = this.ctx;
    return des.boxes.map(b => {
      const ch = des.chans[b.ch];
      return SG.makeSource({ x: b.x, y: b.y, rot_deg: ((b.rot % 360) + 360) % 360,
        delay_ms: ctx.dsp === 'full' ? ch.delay : 0, gain_db: ctx.dsp === 'none' ? 0 : Math.min(0, ch.gain),
        polarity: ctx.dsp === 'none' ? 1 : ch.pol, channel: b.ch + 1 });
    });
  }
  evaluate(cand, temps) {
    const ctx = this.ctx, des = this.build(cand);
    if (!des.boxes.length || !feasible(ctx, des.boxes)) return null;
    const srcs = this.toSrcs(des), r = this.scoreSrcs(srcs, temps);
    const used = new Set(des.boxes.map(b => b.ch)).size;
    let cost = r.cost + 0.04 * used;
    if (des.boxes.length < ctx.N) cost += 12 * Math.log10(ctx.N / des.boxes.length);
    return { cost, ms: r.ms, srcs };
  }
  setBest(a, cand, ev) {
    a.best = { id: this.nextId++, fam: a.fam, cand, cost: ev.cost, ms: ev.ms, srcs: ev.srcs };
    if (!this.best || ev.cost < this.best.cost - 1e-9) { this.best = a.best; this.bestKey = a.key; this.noteBest(ev.cost); }
  }
  active() { return [...this.app.values()].filter(a => a.status === (this.phase === 'final' ? 'final' : 'race')); }

  step(ms) {
    const end = now() + ms;
    while (now() < end) {
      if (this.phase === 'screen') { if (!this.screenStep()) this.startRound(0); }
      else if (this.phase === 'race') this.raceStep();
      else if (this.phase === 'final') this.finalStep();
      else return;
    }
  }
  screenStep() {
    const s = this.seedQueue.shift();
    if (!s) return false;
    const a = this.app.get(s.key), cand = { fam: s.fam, fr: s.fr, p: s.p, trims: [] };
    const ev = this.evaluate(cand, [this.mid]);
    if (ev && (!a.screen || ev.cost < a.screen.cost)) a.screen = { cand, cost: ev.cost };
    if (ev && (!this.preview || ev.cost < this.preview.cost)) this.preview = { srcs: ev.srcs, cost: ev.cost };
    return true;
  }
  startRound(r) {
    if (r === 0) {
      for (const a of this.app.values()) {
        if (!a.screen) { a.status = 'out'; a.out = { round: 0, why: 'passt nicht auf die Fläche' }; }
        else a.status = 'race';
      }
      const fams = new Set([...this.app.values()].map(a => a.fam));
      for (const f of fams) if (![...this.app.values()].some(a => a.fam === f && a.status === 'race')) this.skipped.push({ fam: f, why: 'passt nicht auf die Aufstellfläche' });
    }
    const act = this.active();
    if (!act.length) { this.phase = 'done'; return; }
    this.phase = 'race'; this.round = r; this.turn = 0;
    for (const a of act) {
      a.spentRound = 0;
      if (!a.best) {
        const cand = { fam: a.fam, fr: a.fr, p: a.screen.cand.p, trims: new Array(2 * this.nChans(a.fam, a.screen.cand.p, a.fr)).fill(0) };
        const ev = this.evaluate(cand, this.allT); a.spent++; a.spentRound++;
        if (ev) this.setBest(a, cand, ev); else { a.status = 'out'; a.out = { round: r + 1, why: 'bei ±5 °C nicht stabil' }; }
      }
    }
  }
  raceStep() {
    const act = this.active().filter(a => a.best);
    const budget = Math.round(ROUNDS[this.round].budget * this.scale);
    const todo = act.filter(a => a.spentRound < budget);
    if (!todo.length) { this.endRound(); return; }
    const a = todo[this.turn++ % todo.length];
    this.localStep(a);
  }
  endRound() {
    const r = this.round, R = ROUNDS[r], act = this.active().filter(a => a.best).sort((x, y) => x.best.cost - y.best.cost);
    const keepN = Math.max(R.min, Math.ceil(act.length * R.keep));
    const keep = new Set(act.slice(0, keepN).map(a => a.key));
    if (r === 0) { const seen = new Set(); act.forEach(a => { if (!seen.has(a.fam)) { seen.add(a.fam); keep.add(a.key); } }); }
    act.forEach((a, i) => { if (!keep.has(a.key)) { a.status = 'out'; a.out = { round: r + 1, why: `Runde ${r + 1}: Platz ${i + 1} von ${act.length}` }; } });
    if (r + 1 < ROUNDS.length) { this.startRound(r + 1); return; }
    // finals
    const fin = this.active().filter(a => a.best).sort((x, y) => x.best.cost - y.best.cost);
    fin.forEach((a, i) => { if (i < 4) a.status = 'final'; else { a.status = 'out'; a.out = { round: ROUNDS.length, why: `Runde ${ROUNDS.length}: Platz ${i + 1} von ${fin.length}` }; } });
    this.phase = 'final'; this.round = ROUNDS.length;
    this.seedFree();
  }
  seedFree() {
    const lead = [...this.app.values()].filter(a => a.status === 'final' && a.fam !== 'free' && a.best).sort((x, y) => x.best.cost - y.best.cost)[0];
    if (!lead) return;
    let fa = this.app.get('free');
    const des = this.build(lead.best.cand);
    const nSt = new Set(des.boxes.map(b => SG.footprintKey(b.x, b.y, b.rot, this.ctx.d))).size;
    const cand = { fam: 'free', src: lead.fam, fr: lead.fr, p: lead.best.cand.p, trims: lead.best.cand.trims.slice(), offs: new Array(2 * nSt).fill(0) };
    if (!fa) { fa = { key: 'free', fam: 'free', label: 'Freiform', nSeeds: 0, screen: null, best: null, status: 'final', spent: 0, spentRound: 0, st: null, out: null }; this.app.set('free', fa); }
    if (!fa.best || lead.best.cost < fa.best.cost - 1e-6) {
      fa.st = null; fa.srcKey = lead.key;
      fa.best = { id: this.nextId++, fam: 'free', cand, cost: lead.best.cost, ms: lead.best.ms, srcs: lead.best.srcs };
      fa.label = 'Freiform aus ' + FAM[lead.fam].label.replace(/ \(.*\)/, '') + ' · ' + lead.label;
    }
  }
  finalStep() {
    this.iter++;
    if (this.iter % 250 === 0) this.seedFree();
    const fin = this.active().filter(a => a.best);
    if (!fin.length) { this.phase = 'done'; return; }
    const cmin = Math.min(...fin.map(a => a.best.cost)), tau = Math.max(0.5, 0.2 * Math.abs(cmin));
    const w = fin.map(a => 0.1 + Math.exp(-(a.best.cost - cmin) / tau) + (a.fam === 'free' ? 0.4 : 0));
    let r = this.rnd() * w.reduce((x, y) => x + y, 0), pick = fin[fin.length - 1];
    for (let i = 0; i < fin.length; i++) { r -= w[i]; if (r <= 0) { pick = fin[i]; break; } }
    this.localStep(pick);
  }

  varsFor(cand) {
    const ctx = this.cx(cand.fr), fam = cand.fam === 'free' ? cand.src : cand.fam, F = FAM[fam], p = cand.p, vars = [];
    if (cand.fam !== 'free') {
      const bnd = F.bounds(ctx, p);
      F.cont.forEach(k => {
        if (p[k] == null || !bnd[k] || (k === 's' && (p.cols || 2) < 2) || (k === 'phi' && !(p.phi > 0))) return;
        vars.push({ t: 'geo', k, lo: bnd[k][0], hi: bnd[k][1], step: k === 'phi' || k === 'theta' ? 10 : k === 'u' ? 0.08 : 0.12, min: k === 'phi' || k === 'theta' ? 0.8 : 0.01 });
      });
    } else for (let i = 0; i < cand.offs.length; i++) vars.push({ t: 'off', i, lo: -2.5, hi: 2.5, step: 0.25, min: 0.02 });
    const nch = (cand.trims || []).length / 2;
    if (nch > 1) for (let c = 0; c < nch; c++) {
      if (ctx.dsp === 'full') vars.push({ t: 'dt', c, lo: -8, hi: 8, step: 0.5, min: 0.02 });
      if (ctx.dsp !== 'none') vars.push({ t: 'dg', c, lo: -9, hi: 0, step: 1.2, min: 0.1 });
    }
    return vars;
  }
  getV(c, v) { return v.t === 'geo' ? c.p[v.k] : v.t === 'off' ? c.offs[v.i] : v.t === 'dt' ? c.trims[2 * v.c] : c.trims[2 * v.c + 1]; }
  withV(c, v, val) {
    const n = { fam: c.fam, src: c.src, fr: c.fr, p: c.p, trims: c.trims, offs: c.offs };
    if (v.t === 'geo') n.p = Object.assign({}, c.p, { [v.k]: val });
    else if (v.t === 'off') { n.offs = c.offs.slice(); n.offs[v.i] = val; }
    else { n.trims = c.trims.slice(); n.trims[v.t === 'dt' ? 2 * v.c : 2 * v.c + 1] = val; }
    return n;
  }
  /** one controlled step on an approach: pattern search, with an occasional random kick */
  localStep(a) {
    const before = a.spentRound;
    this.localStep0(a);
    if (a.spentRound === before) a.spentRound += 0.25;   // a turn without evaluation still counts – rounds always end
  }
  localStep0(a) {
    const vars = this.varsFor(a.best.cand);
    if (!vars.length) { a.spent++; a.spentRound++; return; }
    if (!a.st || a.st.steps.length !== vars.length) a.st = { steps: vars.map(v => v.step), i: 0, fails: 0 };
    const st = a.st;
    if (this.rnd() < 0.25) {
      let c = a.best.cand, ch = false;
      vars.forEach(v => { if (this.rnd() < 0.35) { c = this.withV(c, v, clamp(this.getV(c, v) + gauss(this.rnd) * v.step * 1.2, v.lo, v.hi)); ch = true; } });
      if (!ch) { const v = vars[Math.floor(this.rnd() * vars.length)]; c = this.withV(c, v, clamp(this.getV(c, v) + gauss(this.rnd) * v.step, v.lo, v.hi)); }
      const ev = this.evaluate(c, this.allT); a.spent++; a.spentRound++;
      if (ev && ev.cost < a.best.cost - 1e-5) { this.setBest(a, c, ev); st.steps = vars.map(v => v.step); st.fails = 0; }
      return;
    }
    const i = st.i % vars.length, v = vars[i]; st.i++;
    if (st.steps[i] < v.min) {
      if (st.steps.every((s2, k) => s2 < vars[k].min)) st.steps = vars.map(q => q.step * 0.5);
      return;
    }
    let ok = false;
    for (const dir of [1, -1]) {
      const cur = a.best.cand, val = clamp(this.getV(cur, v) + dir * st.steps[i], v.lo, v.hi);
      if (val === this.getV(cur, v)) continue;
      const c2 = this.withV(cur, v, val), ev = this.evaluate(c2, this.allT); a.spent++; a.spentRound++;
      if (ev && ev.cost < a.best.cost - 1e-5) { this.setBest(a, c2, ev); ok = true; break; }
    }
    if (!ok) { st.fails++; if (st.fails >= vars.length) { st.steps = st.steps.map(q => q * 0.5); st.fails = 0; } } else st.fails = 0;
  }
  sinceImprove() { return this.phase === 'final' || this.phase === 'done' ? (now() - this.lastImprove) / 1000 : 0; }

  describe(e, a) {
    if (this.descCache.has(e.id)) return this.descCache.get(e.id);
    const ctx = this.cx(e.cand.fr), fam = e.fam === 'free' ? e.cand.src : e.fam, F = FAM[fam];
    const srcs = e.srcs.map(s => SG.makeSource(s));
    SG.normalizeDelays(srcs);
    const summary = this.scorer.summary(e.ms);
    const met = SG.computeMetrics(srcs, SG.bandFreqs(this.goal.band[0], this.goal.band[1]), ctx.c);
    const band = SG.bandSummary(met, this.goal.band[0], this.goal.band[1]);
    const des = F.build(ctx, e.cand.p);
    let explain = F.explain(ctx, e.cand.p, des);
    if (e.cand.fr === 'P') explain = [`Gerade aufgestellt (parallel zur Aufstellfläche) – das Publikum liegt ${fmt(Math.abs(this.ctx.steer), 0)}° seitlich, die Richtwirkung deckt das trotzdem ab.`].concat(explain);
    if (e.fam === 'free') {
      const moved = [];
      for (let i = 0; i < e.cand.offs.length / 2; i++) { const dx = e.cand.offs[2 * i], dy = e.cand.offs[2 * i + 1]; if (Math.hypot(dx, dy) > 0.05) moved.push(`Stack ${i + 1}: ${dx >= 0 ? '+' : '−'}${fmt(Math.abs(dx), 2)} / ${dy >= 0 ? '+' : '−'}${fmt(Math.abs(dy), 2)} m`); }
      explain = [`Freiform: ausgehend von „${F.label}“ verschiebt der Optimierer einzelne Stacks und passt die DSP-Werte neu an – über die Lehrbuch-Regeln hinaus.`]
        .concat(moved.length ? ['Verschoben (x / y): ' + moved.join(' · ')] : ['Noch keine Verschiebung besser als das Original.'], explain.slice(0, 2));
    }
    explain.push(band.bw_mean >= 300 ? 'Ergebnis im Band: praktisch rundstrahlend.'
      : `Ergebnis im Band: −6-dB-Öffnung ${Math.round(band.bw_min)}–${Math.round(band.bw_max)}°, hinten ${band.rear_worst <= 0 ? '−' + fmt(-band.rear_worst, 0) : '+' + fmt(band.rear_worst, 0)} dB (schlechteste Frequenz).`);
    if (ctx.dsp !== 'none') {
      const chs = new Map(); srcs.forEach(s => { if (!chs.has(s.channel)) chs.set(s.channel, s); });
      const g = v => (v < -0.05 ? '−' : '') + fmt(Math.abs(v), 1);
      explain.push('DSP: ' + [...chs.entries()].sort((x, y) => x[0] - y[0]).map(([k, s]) => `K${k} ${fmt(s.delay_ms, 2)} ms, ${g(s.gain_db)} dB${s.polarity < 0 ? ', invertiert' : ''}`).join(' · ') + '.');
    }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    srcs.forEach(s => SG.boxCorners(s.x, s.y, s.rot_deg, ctx.w, ctx.d).forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
    const d = {
      id: e.id, fam: e.fam, key: a ? a.key : e.fam, variant: a ? a.label : '',
      label: e.fam === 'free' ? 'Freiform (aus ' + F.label.replace(/ \(.*\)/, '') + ')' : F.label,
      cost: e.cost, summary, band, explain, srcs, channels: new Set(srcs.map(s => s.channel)).size, nBoxes: srcs.length, size: [x1 - x0, y1 - y0],
    };
    this.descCache.set(e.id, d);
    if (this.descCache.size > 300) this.descCache.delete(this.descCache.keys().next().value);
    return d;
  }
  snapshot() {
    const ctx = this.ctx, all = [...this.app.values()];
    const base = { mode: 'design', phase: this.phase === 'screen' ? 'seed' : this.phase, stage: this.phase, round: this.round, rounds: ROUNDS.length,
      evals: this.evals, elapsed: this.elapsed(), sinceImprove: this.sinceImprove(),
      seedDone: this.seedTotal - this.seedQueue.length, seedTotal: this.seedTotal, skipped: this.skipped, hist: this.hist(),
      aim: ctx.aim, steer: ctx.steer, thetaHalf: ctx.thetaHalf, omni: ctx.omni,
      counts: { total: all.length, race: all.filter(a => a.status === 'race').length, final: all.filter(a => a.status === 'final').length, out: all.filter(a => a.status === 'out').length } };
    // protocol: every approach with its status
    const rank = a => a.status === 'final' ? 0 : a.status === 'race' ? 1 : a.status === 'screen' ? 2 : 3;
    base.protocol = all.map(a => ({ key: a.key, fam: a.fam, famLabel: a.fam === 'free' ? 'Freiform' : FAM[a.fam].label, label: a.label, status: a.status,
      cost: a.best ? a.best.cost : a.screen ? a.screen.cost : null, rough: !a.best, spent: a.spent, why: a.out ? a.out.why : '', leader: a.key === this.bestKey }))
      .sort((x, y) => rank(this.app.get(x.key)) - rank(this.app.get(y.key)) || (x.cost == null) - (y.cost == null) || (x.cost || 0) - (y.cost || 0));
    if (this.phase === 'screen') return Object.assign(base, { results: [], preview: this.preview || null });
    // results: best approach per topology (finalists first)
    const byFam = new Map();
    all.filter(a => a.best).forEach(a => { const f = a.fam; if (!byFam.has(f) || a.best.cost < byFam.get(f).best.cost) byFam.set(f, a); });
    const results = [...byFam.values()].map(a => Object.assign({ status: a.status }, this.describe(a.best, a))).sort((x, y) => x.cost - y.cost);
    return Object.assign(base, { results, bestCost: results.length ? results[0].cost : null });
  }
}

/* ===================================================================== setup mode */
export class SetupOptimizer extends Base {
  constructor(zones, goal, sources, opts) {
    super(zones, goal);
    this.opts = Object.assign({ move: false, maxMove: 1.5 }, opts || {});
    this.dsp = goal.dsp || 'full';
    const on = sources.filter(s => s.enabled).map(s => Object.assign(SG.makeSource(s), { pinned: !!s.pinned }));
    if (!on.length) throw new Error('Keine aktiven Boxen zum Verbessern.');
    if (on.some(s => !s.channel)) SG.assignChannels(on);
    this.src0 = on;
    this.chs = [...new Set(on.map(s => s.channel))].sort((a, b) => a - b);
    this.base = this.chs.map(c => { const s = on.find(b => b.channel === c); return { ch: c, delay: s.delay_ms, gain: s.gain_db, pol: s.polarity }; });
    const st = SG.stacks(on, goal.box_d);
    this.stacks = st.map(g => ({ idx: g.idx, movable: this.opts.move && !g.idx.some(i => on[i].pinned) }));
    this.movable = this.stacks.filter(s => s.movable);
    const place = zones.filter(z => z.kind === 'place' && SG.zones.area(z) > 0);
    this.ctx = { place, nogo: zones.filter(z => z.kind === 'nogo'), w: goal.box_w, d: goal.box_d, H: 99 };
    const inPlace = (x, y) => place.some(z => SG.zones.contains(z, x, y));
    this.placeOk = this.stacks.map(s => !place.length || s.idx.every(i => { const b = on[i]; return SG.boxCorners(b.x, b.y, b.rot_deg, goal.box_w * 0.98, goal.box_d * 0.98).every(([x, y]) => inPlace(x, y)); }));
    this.cur = { trims: new Array(2 * this.chs.length).fill(0), pols: this.base.map(b => b.pol), offs: new Array(2 * this.movable.length).fill(0) };
    const ev = this.evaluate(this.cur);
    this.cost0 = ev ? ev.cost : Infinity;
    this.best = { id: this.nextId++, cand: this.cur, cost: this.cost0, ms: ev && ev.ms, srcs: ev && ev.srcs };
    this.noteBest(this.cost0);
    this.phase = 'pol'; this.polI = 0; this.steps = null; this.vi = 0; this.fails = 0;
    this.descCache = null;
  }
  srcsOf(c) {
    const on = this.src0.map(s => SG.makeSource(s));
    this.base.forEach((b, k) => {
      const d = Math.max(0, b.delay + (this.dsp === 'full' ? c.trims[2 * k] : 0));
      const g = Math.min(0, Math.max(-24, b.gain + (this.dsp !== 'none' ? c.trims[2 * k + 1] : 0)));
      on.forEach(s => { if (s.channel === b.ch) { s.delay_ms = d; s.gain_db = g; s.polarity = c.pols[k]; } });
    });
    this.movable.forEach((st, m) => st.idx.forEach(i => { on[i].x += c.offs[2 * m]; on[i].y += c.offs[2 * m + 1]; }));
    return on;
  }
  evaluate(c) {
    const srcs = this.srcsOf(c);
    if (this.movable.length && c.offs.some(v => v !== 0)) {
      const { w, d } = this.ctx;
      if (SG.collisions(srcs, w, d).size) return null;
      for (let m = 0; m < this.movable.length; m++) {
        const si = this.stacks.indexOf(this.movable[m]);
        for (const i of this.movable[m].idx) {
          const b = srcs[i];
          const pts = SG.boxCorners(b.x, b.y, b.rot_deg, w * 0.98, d * 0.98);
          if (pts.some(([x, y]) => this.ctx.nogo.some(z => SG.zones.contains(z, x, y)))) return null;
          if (this.placeOk[si] && this.ctx.place.length && !pts.every(([x, y]) => this.ctx.place.some(z => SG.zones.contains(z, x, y)))) return null;
        }
      }
    }
    const r = this.scoreSrcs(srcs, this.allT);
    return { cost: r.cost, ms: r.ms, srcs };
  }
  vars() {
    const v = [];
    for (let k = 0; k < this.chs.length; k++) {
      if (this.dsp === 'full' && this.chs.length > 1) v.push({ t: 'dt', k, lo: -10, hi: 10, step: 0.6, min: 0.02 });
      if (this.dsp !== 'none' && this.chs.length > 1) v.push({ t: 'dg', k, lo: -12, hi: 0, step: 1.5, min: 0.1 });
    }
    for (let m = 0; m < this.movable.length; m++) for (const ax of [0, 1]) v.push({ t: 'off', i: 2 * m + ax, lo: -this.opts.maxMove, hi: this.opts.maxMove, step: 0.3, min: 0.02 });
    return v;
  }
  get(c, v) { return v.t === 'off' ? c.offs[v.i] : c.trims[v.t === 'dt' ? 2 * v.k : 2 * v.k + 1]; }
  set(c, v, val) {
    const n = { trims: c.trims.slice(), pols: c.pols.slice(), offs: c.offs.slice() };
    if (v.t === 'off') n.offs[v.i] = val; else n.trims[v.t === 'dt' ? 2 * v.k : 2 * v.k + 1] = val;
    return n;
  }
  accept(c, ev) {
    if (ev && ev.cost < this.best.cost - 1e-5) { this.best = { id: this.nextId++, cand: c, cost: ev.cost, ms: ev.ms, srcs: ev.srcs }; this.noteBest(ev.cost); return true; }
    return false;
  }
  step(ms) {
    const end = now() + ms, vars = this.vars();
    while (now() < end) {
      if (this.phase === 'pol') {
        if (this.dsp === 'none' || this.chs.length < 2 || this.polI >= this.chs.length) { this.phase = 'search'; continue; }
        const c = { trims: this.best.cand.trims.slice(), pols: this.best.cand.pols.slice(), offs: this.best.cand.offs.slice() };
        c.pols[this.polI] *= -1; this.polI++;
        this.accept(c, this.evaluate(c));
        continue;
      }
      if (!vars.length) { this.phase = 'done'; return; }
      if (!this.steps) this.steps = vars.map(v => v.step);
      if (this.rnd() < 0.15) {
        // random kick around the best to get out of local optima
        let c = this.best.cand;
        vars.forEach(v => { if (this.rnd() < 0.3) c = this.set(c, v, clamp(this.get(c, v) + gauss(this.rnd) * v.step, v.lo, v.hi)); });
        if (this.accept(c, this.evaluate(c))) this.steps = vars.map(v => v.step);
        continue;
      }
      const i = this.vi % vars.length, v = vars[i]; this.vi++;
      if (this.steps[i] < v.min) { if (this.steps.every((s, k) => s < vars[k].min)) this.steps = vars.map(q => q.step * 0.5); continue; }
      let ok = false;
      for (const dir of [1, -1]) {
        const c = this.best.cand, val = clamp(this.get(c, v) + dir * this.steps[i], v.lo, v.hi);
        if (val === this.get(c, v)) continue;
        if (this.accept(this.set(c, v, val), this.evaluate(this.set(c, v, val)))) { ok = true; break; }
      }
      if (!ok) { this.fails++; if (this.fails >= vars.length) { this.steps = this.steps.map(s => s * 0.5); this.fails = 0; } } else this.fails = 0;
    }
  }
  snapshot() {
    const b = this.best;
    let res = null;
    if (b && b.srcs) {
      const srcs = b.srcs.map(s => SG.makeSource(s));
      SG.normalizeDelays(srcs);
      res = { id: b.id, fam: 'setup', label: 'Dein Setup – verbessert', cost: b.cost, summary: this.scorer.summary(b.ms), srcs, channels: this.chs.length, nBoxes: srcs.length };
    }
    return { mode: 'setup', phase: this.phase, evals: this.evals, elapsed: this.elapsed(), sinceImprove: this.sinceImprove(), hist: this.hist(),
      cost0: this.cost0, bestCost: b ? b.cost : null, result: res, movable: this.movable.length };
  }
}
