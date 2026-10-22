/* SubGrid — topology knowledge: task context, feasibility, the proven sub-array families.
   Families are built in a LOCAL frame (local +y = main audience direction, front line at
   local y1 of the placement area) and transformed to world coordinates afterwards, so a
   stage drawn at any angle still gets correctly aimed arrays. */
import SG from './engine.js';
const Z = SG.zones;
const D2R = Math.PI / 180, R2D = 180 / Math.PI;
export const fmt = (v, d) => (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d).replace('.', ',');

/* ---------- task context ---------- */
export function goalContext(zones, g) {
  const place = zones.filter(z => z.kind === 'place' && Z.area(z) > 0);
  const aud = zones.filter(z => z.kind === 'audience' && Z.area(z) > 0);
  if (!place.length) throw new Error('Es gibt keine Aufstellfläche. Zeichne eine (orange) oder wähle ein Szenario.');
  if (!aud.length) throw new Error('Es gibt keine Publikumsfläche. Zeichne eine (blau) oder wähle ein Szenario.');
  // world bbox + pivot
  const pts = [];
  place.forEach(z => {
    if (z.shape === 'grid') { const c = z.p[0]; (z.runs || []).forEach(([j, a, b]) => { pts.push([a * c, j * c], [(b + 1) * c, j * c], [a * c, (j + 1) * c], [(b + 1) * c, (j + 1) * c]); }); }
    else Z.outline(z, 72).forEach(l => l.forEach(p => pts.push(p)));
  });
  let wx0 = Infinity, wx1 = -Infinity, wy0 = Infinity, wy1 = -Infinity;
  pts.forEach(([x, y]) => { wx0 = Math.min(wx0, x); wx1 = Math.max(wx1, x); wy0 = Math.min(wy0, y); wy1 = Math.max(wy1, y); });
  const P = [(wx0 + wx1) / 2, (wy0 + wy1) / 2];
  // main audience direction (knowledge: aim the arrays at the audience)
  const rnd = SG.rng(7);
  const A = Z.sampleKind(zones, 'audience', 2400, rnd);
  let mx = 0, my = 0, md = 0;
  for (let i = 0; i < A.length; i += 2) { const dx = A[i] - P[0], dy = A[i + 1] - P[1]; mx += dx; my += dy; md += Math.hypot(dx, dy); }
  const n = A.length / 2; mx /= n; my /= n; md /= n;
  const surround = Math.hypot(mx, my) < 0.3 * md;
  let aim = 0;
  if (g.aim != null && isFinite(g.aim)) aim = g.aim;
  else if (!surround) {
    // snap to the usual stage orientations (multiples of 45°) unless clearly in between
    const raw = Math.atan2(mx, my) * R2D, s45 = Math.round(raw / 45) * 45;
    aim = Math.abs(raw - s45) <= 7 ? s45 : Math.round(raw);
    aim = ((aim % 360) + 540) % 360 - 180;
    if (Math.abs(aim) < 1e-9) aim = 0;
  }
  const a = aim * D2R, d = [Math.sin(a), Math.cos(a)], ex = [Math.cos(a), -Math.sin(a)];
  const toLocal = (x, y) => [(x - P[0]) * ex[0] + (y - P[1]) * ex[1], (x - P[0]) * d[0] + (y - P[1]) * d[1]];
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  pts.forEach(([x, y]) => { const [u, v] = toLocal(x, y); x0 = Math.min(x0, u); x1 = Math.max(x1, u); y0 = Math.min(y0, v); y1 = Math.max(y1, v); });
  const T = g.temp, c = SG.speedOfSound(T, g.RH);
  const [fLo, fHi] = g.band, fC = Math.sqrt(fLo * fHi);
  let xc = (x0 + x1) / 2;
  // symmetric venue around world x = 0: keep the array centred on it
  if (aim === 0 && Math.abs(P[0] + xc) < 0.3) xc = -P[0];
  const yFront = y1;
  const angs = [];
  for (let i = 0; i < A.length; i += 2) { const [u, v] = toLocal(A[i], A[i + 1]); angs.push(Math.abs(Math.atan2(u - xc, v - yFront) * R2D)); }
  angs.sort((p, q) => p - q);
  const thetaHalf = angs.length ? angs[Math.floor(0.92 * (angs.length - 1))] : 45;
  const dsp = g.dsp || 'full';
  const K = dsp === 'none' ? 1 : Math.max(1, g.channels | 0);
  // second frame aligned to the placement area (for electronically steered lines)
  const aimP = surround ? 0 : (((Math.round(aim / 90) * 90) % 360) + 540) % 360 - 180;
  const aP = aimP * D2R, dP = [Math.sin(aP), Math.cos(aP)], exP = [Math.cos(aP), -Math.sin(aP)];
  let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity;
  pts.forEach(([x, y]) => { const u = (x - P[0]) * exP[0] + (y - P[1]) * exP[1], v = (x - P[0]) * dP[0] + (y - P[1]) * dP[1]; px0 = Math.min(px0, u); px1 = Math.max(px1, u); py0 = Math.min(py0, v); py1 = Math.max(py1, v); });
  let pxc = (px0 + px1) / 2; if (aimP === 0 && Math.abs(P[0] + pxc) < 0.3) pxc = -P[0];
  const pframe = { aim: aimP, dir: dP, ex: exP, x0: px0, x1: px1, y0: py0, y1: py1, xc: pxc, yFront: py1, width: px1 - px0, depth: py1 - py0 };
  let steer = (((aim - aimP) % 360) + 540) % 360 - 180;
  if (surround) steer = 0;
  return {
    pframe, steer, walls: g.walls || [], wallSegs: SG.wallSegments(g.walls || []),
    zones, place, nogo: zones.filter(z => z.kind === 'nogo'),
    N: Math.max(1, g.boxes | 0), K, H: Math.max(1, g.maxStack | 0), dsp,
    w: g.box_w, d: g.box_d, T, RH: g.RH, c, fLo, fHi, fC,
    lamLo: c / fLo, lamHi: c / fHi, lamC: c / fC,
    x0, x1, y0, y1, xc, yFront, width: x1 - x0, depth: y1 - y0,
    P, aim, dir: d, ex, thetaHalf, omni: surround || thetaHalf >= 150,
    quiet: zones.some(z => (z.kind === 'quiet' || z.kind === 'stage') && Z.area(z) > 0),
    delayMax: g.delayMax || 50, gainMin: g.gainMin != null ? g.gainMin : -12,
    delayStep: g.delayStep || 0.01, gainStep: g.gainStep || 0.1,
  };
}

/** local design boxes -> world boxes */
export function toWorld(ctx, boxes, frame) {
  const f = frame || ctx;
  if (!f.aim && !ctx.P[0] && !ctx.P[1]) return boxes;
  const P = ctx.P, { dir, ex, aim } = f;
  return boxes.map(b => Object.assign({}, b, {
    x: P[0] + b.x * ex[0] + b.y * dir[0], y: P[1] + b.x * ex[1] + b.y * dir[1],
    rot: (((b.rot - aim) % 360) + 360) % 360,
  }));
}

/* ---------- feasibility (world coordinates) ---------- */
export function feasible(ctx, boxes, opts) {
  const { w, d } = ctx;
  const inPlace = (x, y) => ctx.place.some(z => Z.contains(z, x, y));
  const inNogo = (x, y) => ctx.nogo.some(z => Z.contains(z, x, y));
  const keys = new Map();
  for (const b of boxes) {
    const k = SG.footprintKey(b.x, b.y, b.rot, d);
    keys.set(k, (keys.get(k) || 0) + 1);
    if (keys.get(k) > ctx.H) return false;
    if (opts && opts.free && opts.free.has && !opts.free.has(k)) continue;
    const cen = SG.boxCentre(b.x, b.y, b.rot, d);
    // corners pulled 1 % + 3 mm towards the centre: tolerant to float noise on rotated layouts
    const cs = SG.boxCorners(b.x, b.y, b.rot, w, d).map(([x, y]) => {
      const dx = cen[0] - x, dy = cen[1] - y, l = Math.hypot(dx, dy) || 1;
      return [x + dx * 0.01 + dx / l * 0.003, y + dy * 0.01 + dy / l * 0.003];
    });
    for (const [x, y] of cs.concat([cen])) {
      if (ctx.place.length && !(opts && opts.noPlace) && !inPlace(x, y)) return false;
      if (inNogo(x, y)) return false;
    }
  }
  const uniq = [], seen = new Set();
  for (const b of boxes) { const k = SG.footprintKey(b.x, b.y, b.rot, d); if (!seen.has(k)) { seen.add(k); uniq.push(SG.boxCorners(b.x, b.y, b.rot, w, d)); } }
  if (ctx.wallSegs) for (const c of uniq) if (quadHitsWalls(c, ctx.wallSegs)) return false;
  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++)
    if (SG.rectPenetration(uniq[i], uniq[j]) > 0.01) return false;
  return true;
}

function segX(ax, ay, bx, by, cx, cy, dx, dy) {
  const d = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
  if (Math.abs(d) < 1e-12) return false;
  const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / d, u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / d;
  return t > 0 && t < 1 && u > 0 && u < 1;
}
export function quadHitsWalls(c, segs) {
  for (let k = 0; k < segs.S; k++) {
    const ax = segs.A[2 * k], ay = segs.A[2 * k + 1], bx = segs.B[2 * k], by = segs.B[2 * k + 1];
    for (let i = 0; i < 4; i++) { const p = c[i], q = c[(i + 1) % 4]; if (segX(p[0], p[1], q[0], q[1], ax, ay, bx, by)) return true; }
  }
  return false;
}

/* ---------- layout builders (local frame) ---------- */
function lineDesign(ctx, o) {
  const cols = o.cols, s = cols > 1 ? o.s : 0;
  const xs = []; for (let j = 0; j < cols; j++) xs.push((j - (cols - 1) / 2) * s);
  let gOf = xs.map(() => 0), gDelay = [0], R = 0;
  const nRoles = o.roles.length;
  if (o.phi > 0 && cols > 2) {
    const L = (cols - 1) * s;
    R = L / (2 * Math.sin(Math.min(o.phi, 179) * D2R / 2));
    const tau = xs.map(x => (R - Math.sqrt(Math.max(0, R * R - x * x))) / ctx.c * 1000);
    const G0 = Math.ceil(cols / 2);
    const G = Math.max(1, Math.min(G0, Math.floor(ctx.K / nRoles)));
    const rank = xs.map((x, j) => Math.floor(Math.abs(j - (cols - 1) / 2)));
    gOf = rank.map(r => Math.min(G - 1, Math.floor(r * G / G0)));
    gDelay = new Array(G).fill(0); const cnt = new Array(G).fill(0);
    tau.forEach((t, j) => { gDelay[gOf[j]] += t; cnt[gOf[j]]++; });
    gDelay = gDelay.map((v, g) => v / Math.max(1, cnt[g]));
  }
  const G = gDelay.length, chans = [], boxes = [];
  o.roles.forEach(r => { for (let g = 0; g < G; g++) chans.push({ delay: r.delay + gDelay[g], gain: r.gain, pol: r.pol }); });
  xs.forEach((x, j) => o.roles.forEach((r, ri) => {
    for (let k = 0; k < r.n; k++) boxes.push({ x: ctx.xc + x, y: ctx.yFront + r.dy, rot: r.rot, ch: ri * G + gOf[j] });
  }));
  return { boxes, chans, meta: { R, groups: G, arcDelays: gDelay } };
}
function stackOptions(N, H, m) { const out = []; for (let h = 1; h <= H; h++) if (N % (h * m) === 0) out.push(h); return out; }
function lin(a, b, n) { if (n <= 1 || Math.abs(b - a) < 1e-6) return [a]; const o = []; for (let i = 0; i < n; i++) o.push(a + (b - a) * i / (n - 1)); return o; }
function uniq(a) { return [...new Set(a.map(v => Math.round(v * 1000) / 1000))]; }
function sRange(ctx, cols, n) {
  if (cols === 1) return [0];
  const sMax = Math.min((ctx.width - ctx.w) / (cols - 1), ctx.lamHi);
  return sMax < ctx.w ? [] : uniq(lin(ctx.w, sMax, n));
}
const sBound = (ctx, cols) => [ctx.w, Math.max(ctx.w, (ctx.width - ctx.w) / Math.max(1, cols - 1))];
const stackWord = h => h > 1 ? h + 'er-Stacks' : 'Boxen';

export const FAM = {};

const arcTxt = p => p.phi > 0 ? ' · Arc' : '';
FAM.broadside = {
  label: 'Broadside-Linie', needs: 'none', directional: false,
  variant: p => ({ key: `h${p.h}c${p.cols}`, label: `${p.cols} × ${p.h}er` }),
  enumerate(ctx) {
    const out = [];
    for (const h of stackOptions(ctx.N, ctx.H, 1)) { const cols = ctx.N / h; for (const s of sRange(ctx, cols, 5)) out.push({ h, cols, s }); }
    return out;
  },
  build(ctx, p) { return lineDesign(ctx, { cols: p.cols, s: p.s, phi: 0, roles: [{ dy: 0, rot: 0, n: p.h, delay: 0, gain: 0, pol: 1 }] }); },
  cont: ['s'], bounds: (ctx, p) => ({ s: sBound(ctx, p.cols) }),
  explain(ctx, p) {
    const t = [];
    if (p.cols === 1) t.push(`Alle ${ctx.N} Boxen als ein Stapel – kompakt, alles auf einem Kanal.`);
    else t.push(`${p.cols} ${stackWord(p.h)} nebeneinander, Abstand ${fmt(p.s, 2)} m, ein Kanal ohne Delay. Maximaler Pegel nach vorne.`);
    if (p.cols > 1) t.push(`Regel: Abstand ≤ λ bei ${Math.round(ctx.fHi)} Hz (${fmt(ctx.lamHi, 2)} m), sonst Nebenkeulen. Je breiter die Linie, desto schmaler der Strahl.`);
    if (ctx.quiet) t.push('Keine Rückwärtsdämpfung: hinter der Linie ist es so laut wie davor.');
    return t;
  },
};

FAM.arcdelay = {
  label: 'Delay-Arc (elektronisch gebogen)', needs: 'full', directional: true,
  variant: p => ({ key: `h${p.h}c${p.cols}`, label: `${p.cols} × ${p.h}er` }),
  enumerate(ctx) {
    const out = [], base = Math.min(170, 2 * ctx.thetaHalf);
    for (const h of stackOptions(ctx.N, ctx.H, 1)) {
      const cols = ctx.N / h; if (cols < 3) continue;
      for (const s of sRange(ctx, cols, 4)) for (const k of [0.6, 0.85, 1.1]) out.push({ h, cols, s, phi: Math.max(15, Math.min(175, base * k)) });
    }
    return out;
  },
  build(ctx, p) { return lineDesign(ctx, { cols: p.cols, s: p.s, phi: p.phi, roles: [{ dy: 0, rot: 0, n: p.h, delay: 0, gain: 0, pol: 1 }] }); },
  cont: ['s', 'phi'], bounds: (ctx, p) => ({ s: sBound(ctx, p.cols), phi: [10, 178] }),
  explain(ctx, p, des) {
    return [
      `${p.cols} ${stackWord(p.h)} in gerader Linie (Abstand ${fmt(p.s, 2)} m), elektronisch gebogen: virtueller Bogen ${Math.round(p.phi)}°, Radius ${fmt(des.meta.R, 1)} m.`,
      'Die äußeren Boxen bekommen mehr Delay: t = (R − √(R² − x²)) / c. Die Abdeckung wird breiter, ohne die Boxen schräg zu stellen.',
      `${des.meta.groups} Delay-Gruppen (links/rechts gespiegelt auf demselben Kanal).`,
    ];
  },
};

FAM.arcphys = {
  label: 'Physischer Bogen', needs: 'none', directional: false,
  variant: p => ({ key: `h${p.h}c${p.cols}`, label: `${p.cols} × ${p.h}er` }),
  enumerate(ctx) {
    const out = [], base = Math.min(170, 2 * ctx.thetaHalf);
    for (const h of stackOptions(ctx.N, ctx.H, 1)) {
      const cols = ctx.N / h; if (cols < 3) continue;
      for (const s of uniq(lin(ctx.w * 1.02, Math.max(ctx.w * 1.02, Math.min(ctx.lamHi, ctx.width / (cols - 1))), 3)))
        for (const k of [0.5, 0.8, 1.1]) out.push({ h, cols, s, phi: Math.max(15, Math.min(178, base * k)) });
    }
    return out;
  },
  build(ctx, p) {
    const step = p.phi / (p.cols - 1), R = p.s / (2 * Math.sin(step * D2R / 2)), yc = ctx.yFront - R, boxes = [];
    for (let j = 0; j < p.cols; j++) {
      const t = (j - (p.cols - 1) / 2) * step, x = ctx.xc + R * Math.sin(t * D2R), y = yc + R * Math.cos(t * D2R);
      for (let k = 0; k < p.h; k++) boxes.push({ x, y, rot: -t, ch: 0 });
    }
    let ymax = -Infinity;
    boxes.forEach(b => SG.boxCorners(b.x, b.y, b.rot, ctx.w, ctx.d).forEach(c => { ymax = Math.max(ymax, c[1]); }));
    boxes.forEach(b => { b.y += ctx.yFront - ymax - 0.005; });
    return { boxes, chans: [{ delay: 0, gain: 0, pol: 1 }], meta: { R, sag: R * (1 - Math.cos(p.phi / 2 * D2R)) } };
  },
  cont: ['s', 'phi'], bounds: ctx => ({ s: [ctx.w * 1.02, Math.max(ctx.w * 1.05, ctx.lamHi)], phi: [10, 178] }),
  explain(ctx, p, des) {
    return [
      `${p.cols} ${stackWord(p.h)} auf einem echten Bogen (${Math.round(p.phi)}°, Radius ${fmt(des.meta.R, 1)} m), jede Box zeigt nach außen.`,
      `Breite Abdeckung ganz ohne Delays – geht auch ohne DSP. Braucht ${fmt(des.meta.sag + ctx.d, 2)} m Tiefe.`,
    ];
  },
};

FAM.cardstack = {
  label: 'Cardioid-Stack (Rückbox gedreht)', needs: 'pol', directional: true,
  variant: p => ({ key: `f${p.hf}r${p.hr}c${p.cols}a${p.phi > 0 ? 1 : 0}g${Math.round(p.gf)}`, label: `${p.cols} Stacks ${p.hf}+${p.hr}${arcTxt(p)}${p.gf ? ' · vorne ' + Math.round(p.gf) + ' dB' : ''}` }),
  enumerate(ctx) {
    const out = [];
    if (ctx.H < 2 || ctx.K < 2) return out;
    for (let hr = 1; hr <= 2; hr++) for (let hf = hr; hf + hr <= ctx.H; hf++) {
      const m = hf + hr; if (ctx.N % m) continue;
      const cols = ctx.N / m;
      const gfs = hf > hr ? [0, 20 * Math.log10(hr / hf)] : [0];
      const phis = (ctx.dsp === 'full' && cols >= 3 && ctx.K >= 4) ? [0, Math.min(170, 2 * ctx.thetaHalf)] : [0];
      for (const s of sRange(ctx, cols, 4)) for (const gf of gfs) for (const phi of phis) out.push({ hf, hr, cols, s, gf, phi });
    }
    return out;
  },
  build(ctx, p) {
    const t = ctx.dsp === 'full' ? ctx.d / ctx.c * 1000 : 0;
    return lineDesign(ctx, { cols: p.cols, s: p.s, phi: p.phi, roles: [
      { dy: 0, rot: 0, n: p.hf, delay: 0, gain: p.gf, pol: 1 },
      { dy: -ctx.d, rot: 180, n: p.hr, delay: t, gain: 0, pol: -1 }] });
  },
  cont: ['s'], bounds: (ctx, p) => ({ s: sBound(ctx, p.cols) }),
  explain(ctx, p) {
    const t = ctx.d / ctx.c * 1000;
    const out = [
      `${p.cols > 1 ? p.cols + ' Stacks' : '1 Stack'} aus je ${p.hf}× vorne + ${p.hr}× nach hinten gedreht${p.cols > 1 ? ', Abstand ' + fmt(p.s, 2) + ' m' : ''}.`,
      ctx.dsp === 'full'
        ? `Rückbox: Polarität invertiert + ${fmt(t, 2)} ms Delay (Laufzeit über die Boxtiefe ${fmt(ctx.d, 2)} m). Hinten treffen beide gleichzeitig und gegenphasig ein → Auslöschung. Vorne addieren sie sich.`
        : 'Ohne Delay nur Polaritäts-Cardioid: Auslöschung hinten nur bei tiefen Frequenzen wirksam.',
    ];
    if (p.hf > p.hr) out.push(`${p.hf}:${p.hr}-Verhältnis: vorne mehr Pegel, hinten bleibt ein Rest.`);
    if (p.phi > 0) out.push(`Zusätzlich Delay-Arc (${Math.round(p.phi)}°) für breitere Abdeckung.`);
    return out;
  },
};

FAM.gradient = {
  label: 'Gradient / Cardioid hintereinander', needs: 'pol', directional: true,
  variant: p => ({ key: `f${p.hf}r${p.hr}c${p.cols}a${p.phi > 0 ? 1 : 0}`, label: `${p.cols} Spalten ${p.hf}+${p.hr}${arcTxt(p)}` }),
  enumerate(ctx) {
    const out = [];
    if (ctx.K < 2) return out;
    const Dmax = Math.min(ctx.depth - ctx.d, ctx.c / (2.4 * ctx.fHi) * 1.3);
    if (Dmax < ctx.d) return out;
    const Dq = ctx.c / (4 * ctx.fC);
    const Ds = uniq(lin(ctx.d, Dmax, 4).concat(Dq >= ctx.d && Dq <= Dmax ? [Dq] : []));
    for (let hr = 1; hr <= ctx.H; hr++) for (let hf = hr; hf <= ctx.H && hf <= hr + 1; hf++) {
      const m = hf + hr; if (ctx.N % m) continue;
      const cols = ctx.N / m;
      const phis = (ctx.dsp === 'full' && cols >= 3 && ctx.K >= 4) ? [0, Math.min(170, 2 * ctx.thetaHalf)] : [0];
      for (const s of sRange(ctx, cols, 3)) for (const D of Ds) for (const phi of phis) out.push({ hf, hr, cols, s, D, phi, gf: hf > hr ? 20 * Math.log10(hr / hf) : 0 });
    }
    return out;
  },
  build(ctx, p) {
    const t = ctx.dsp === 'full' ? p.D / ctx.c * 1000 : 0;
    return lineDesign(ctx, { cols: p.cols, s: p.s, phi: p.phi, roles: [
      { dy: 0, rot: 0, n: p.hf, delay: 0, gain: p.gf, pol: 1 },
      { dy: -p.D, rot: 0, n: p.hr, delay: t, gain: 0, pol: -1 }] });
  },
  cont: ['s', 'D'], bounds: (ctx, p) => ({ s: sBound(ctx, p.cols), D: [ctx.d, Math.max(ctx.d, ctx.depth - ctx.d)] }),
  explain(ctx, p) {
    const fq = ctx.c / (4 * p.D);
    const out = [
      `Zwei Reihen hintereinander, ${p.cols > 1 ? p.cols + ' Spalten, ' : ''}Reihenabstand ${fmt(p.D, 2)} m (= λ/4 bei ${Math.round(fq)} Hz).`,
      ctx.dsp === 'full'
        ? `Hintere Reihe: invertiert + ${fmt(p.D / ctx.c * 1000, 2)} ms Delay (Laufzeit über ${fmt(p.D, 2)} m) → Niere (Cardioid), die Bühne bleibt leiser.`
        : 'Ohne Delay nur Polaritäts-Cardioid – Auslöschung hinten eingeschränkt.',
      `Vorne volle Summe bei ${Math.round(fq)} Hz; darunter verliert die Anordnung Pegel (Gradient), ab ${Math.round(2 * fq)} Hz Auslöschung nach vorne.`,
    ];
    if (p.phi > 0) out.push(`Zusätzlich Delay-Arc (${Math.round(p.phi)}°) für breitere Abdeckung.`);
    return out;
  },
};

FAM.endfire = {
  label: 'End-Fire', needs: 'full', directional: true,
  variant: p => ({ key: `R${p.R}h${p.h}c${p.cols}a${p.phi > 0 ? 1 : 0}`, label: `${p.R} Reihen · ${p.cols} Spalten · ${p.h}er${arcTxt(p)}` }),
  enumerate(ctx) {
    const out = [];
    for (let R = 2; R <= Math.min(5, ctx.K); R++) for (let h = 1; h <= ctx.H; h++) {
      if (ctx.N % (R * h)) continue;
      const cols = ctx.N / (R * h);
      const Dmax = Math.min((ctx.depth - ctx.d) / (R - 1), ctx.lamC / 2);
      if (Dmax < ctx.d) continue;
      const Ds = uniq(lin(ctx.d, Dmax, 4).concat([ctx.c / (4 * ctx.fC)].filter(v => v >= ctx.d && v <= Dmax)));
      const phis = (cols >= 3 && ctx.K >= 2 * R) ? [0, Math.min(170, 2 * ctx.thetaHalf)] : [0];
      for (const s of sRange(ctx, cols, 3)) for (const D of Ds) for (const phi of phis) out.push({ R, h, cols, s, D, phi });
    }
    return out;
  },
  build(ctx, p) {
    const roles = [];
    for (let k = 0; k < p.R; k++) roles.push({ dy: -k * p.D, rot: 0, n: p.h, delay: (p.R - 1 - k) * p.D / ctx.c * 1000, gain: 0, pol: 1 });
    return lineDesign(ctx, { cols: p.cols, s: p.s, phi: p.phi, roles });
  },
  cont: ['s', 'D'], bounds: (ctx, p) => ({ s: sBound(ctx, p.cols), D: [ctx.d, Math.max(ctx.d, (ctx.depth - ctx.d) / (p.R - 1))] }),
  explain(ctx, p) {
    const t = p.D / ctx.c * 1000;
    return [
      `${p.R} Reihen hintereinander${p.cols > 1 ? ' (' + p.cols + ' Spalten)' : ''}, Reihenabstand ${fmt(p.D, 2)} m.`,
      `Die vorderste Reihe bekommt das meiste Delay (${fmt((p.R - 1) * t, 2)} ms), die hinterste 0 ms. Δt = d / c = ${fmt(t, 2)} ms pro Reihe.`,
      `Prinzip: volle Summe nach vorne, Bündelung durch die Tiefe. Rückwärtsdämpfung frequenzabhängig; braucht ${p.R} DSP-Kanäle.`,
    ].concat(p.phi > 0 ? [`Zusätzlich Delay-Arc (${Math.round(p.phi)}°) für breitere Abdeckung.`] : []);
  },
};

FAM.split = {
  label: 'Split L/R', needs: 'none', directional: false,
  variant: p => ({ key: `h${p.h}s${p.cs}k${p.card ? 1 : 0}`, label: `je ${p.cs} × ${p.h}er${p.card ? ' · Cardioid' : ''}` }),
  enumerate(ctx) {
    const out = [];
    if (ctx.N < 2 || ctx.N % 2) return out;
    for (const card of [false, true]) {
      if (card && (ctx.H < 2 || ctx.K < 2 || ctx.dsp === 'none')) continue;
      const m = card ? 2 : 1;
      for (let h = 1; h * m <= ctx.H; h++) {
        if ((ctx.N / 2) % (h * m)) continue;
        const cs = ctx.N / 2 / (h * m);
        for (const u of [1.0, 0.8]) out.push({ h, cs, card, u });
      }
    }
    return out;
  },
  build(ctx, p) {
    const half = ctx.width / 2 - ctx.w / 2, xOut = half * p.u, boxes = [];
    const chans = p.card ? [{ delay: 0, gain: 0, pol: 1 }, { delay: ctx.dsp === 'full' ? ctx.d / ctx.c * 1000 : 0, gain: 0, pol: -1 }] : [{ delay: 0, gain: 0, pol: 1 }];
    const xm = (ctx.x0 + ctx.x1) / 2;
    for (const side of [-1, 1]) for (let j = 0; j < p.cs; j++) {
      const x = xm + side * (xOut - j * ctx.w * 1.02);
      for (let k = 0; k < p.h; k++) {
        boxes.push({ x, y: ctx.yFront, rot: 0, ch: 0 });
        if (p.card) boxes.push({ x, y: ctx.yFront - ctx.d, rot: 180, ch: 1 });
      }
    }
    return { boxes, chans, meta: { xOut } };
  },
  cont: ['u'], bounds: () => ({ u: [0.3, 1.0] }),
  explain(ctx, p, des) {
    return [
      `Je ${ctx.N / 2} Boxen links und rechts (±${fmt(des.meta.xOut, 1)} m von der Mitte)${p.card ? ', als Cardioid-Stacks' : ''}.`,
      'Klassisch an den Bühnenkanten, aber: In der Mitte entsteht eine laute „Power Alley“, daneben Auslöschungen (Kammfilter). Sinnvoll vor allem, wenn die Mitte frei bleiben muss.',
    ];
  },
};


FAM.cardarc = {
  label: 'Cardioid-Bogen', needs: 'pol', directional: true,
  variant: p => ({ key: `f${p.hf}r${p.hr}c${p.cols}`, label: `${p.cols} Stacks ${p.hf}+${p.hr} auf Bogen` }),
  enumerate(ctx) {
    const out = [];
    if (ctx.H < 2 || ctx.K < 2) return out;
    const base = Math.min(170, 2 * ctx.thetaHalf);
    for (let hr = 1; hr <= 2; hr++) for (let hf = hr; hf + hr <= ctx.H; hf++) {
      const m = hf + hr; if (ctx.N % m) continue;
      const cols = ctx.N / m; if (cols < 3) continue;
      for (const s of uniq(lin(ctx.w * 1.02, Math.max(ctx.w * 1.02, Math.min(ctx.lamHi, ctx.width / (cols - 1))), 3)))
        for (const k of [0.5, 0.8, 1.1]) out.push({ hf, hr, cols, s, phi: Math.max(15, Math.min(178, base * k)) });
    }
    return out;
  },
  build(ctx, p) {
    const step = p.phi / (p.cols - 1), R = p.s / (2 * Math.sin(step * D2R / 2)), yc = ctx.yFront - R, boxes = [];
    const t0 = ctx.dsp === 'full' ? ctx.d / ctx.c * 1000 : 0;
    for (let j = 0; j < p.cols; j++) {
      const t = (j - (p.cols - 1) / 2) * step, fx = Math.sin(t * D2R), fy = Math.cos(t * D2R);
      const x = ctx.xc + R * fx, y = yc + R * fy;
      for (let k = 0; k < p.hf; k++) boxes.push({ x, y, rot: -t, ch: 0 });
      for (let k = 0; k < p.hr; k++) boxes.push({ x: x - ctx.d * fx, y: y - ctx.d * fy, rot: -t + 180, ch: 1 });
    }
    let ymax = -Infinity;
    boxes.forEach(b => SG.boxCorners(b.x, b.y, b.rot, ctx.w, ctx.d).forEach(c => { ymax = Math.max(ymax, c[1]); }));
    boxes.forEach(b => { b.y += ctx.yFront - ymax - 0.005; });
    return { boxes, chans: [{ delay: 0, gain: p.hf > p.hr ? 20 * Math.log10(p.hr / p.hf) : 0, pol: 1 }, { delay: t0, gain: 0, pol: -1 }], meta: { R, sag: R * (1 - Math.cos(p.phi / 2 * D2R)) } };
  },
  cont: ['s', 'phi'], bounds: ctx => ({ s: [ctx.w * 1.02, Math.max(ctx.w * 1.05, ctx.lamHi)], phi: [10, 178] }),
  explain(ctx, p, des) {
    return [
      `${p.cols} Cardioid-Stacks (je ${p.hf}× vorne + ${p.hr}× gedreht) auf einem echten Bogen: ${Math.round(p.phi)}°, Radius ${fmt(des.meta.R, 1)} m.`,
      'Der Bogen sorgt ohne Delays für breite Abdeckung, die gedrehten Boxen (invertiert, Delay = Boxtiefe / c) halten die Bühne leise.',
      `Braucht nur 2 DSP-Kanäle und ${fmt(des.meta.sag + ctx.d, 2)} m Tiefe.`,
    ];
  },
};

FAM.centerouter = {
  label: 'Mitte + Außen', needs: 'pol', directional: false,
  variant: p => ({ key: `m${p.m}o${p.no}k${p.card ? 1 : 0}`, label: `Mitte ${p.tc} Stacks + außen je ${p.no}${p.card ? ' · Cardioid' : ''} (${p.m}er)` }),
  enumerate(ctx) {
    const out = [];
    if (ctx.K < 2) return out;
    for (const card of [false, true]) {
      if (card && (ctx.H < 2 || ctx.K < 4)) continue;
      for (let h = 1; h <= ctx.H; h++) {
        const m = card ? 2 : h; if (card && h > 1) continue;
        if (ctx.N % m) continue;
        const T = ctx.N / m;
        for (let no = 1; no <= 2; no++) {
          const tc = T - 2 * no; if (tc < 1) continue;
          for (const u of [1.0, 0.75, 0.5]) out.push({ card, m, no, tc, u });
        }
      }
    }
    return out;
  },
  build(ctx, p) {
    const boxes = [], half = ctx.width / 2 - ctx.w / 2, xo = Math.max(ctx.w * (p.tc / 2 + p.no + 0.6), half * p.u), xm = (ctx.x0 + ctx.x1) / 2;
    const roles = p.card ? [{ dy: 0, rot: 0, n: 1, off: 0 }, { dy: -ctx.d, rot: 180, n: 1, off: 1 }] : [{ dy: 0, rot: 0, n: p.m, off: 0 }];
    const nr = roles.length;
    const put = (x, grp) => roles.forEach((r, ri) => { for (let k = 0; k < r.n; k++) boxes.push({ x, y: ctx.yFront + r.dy, rot: r.rot, ch: grp * nr + ri }); });
    for (let j = 0; j < p.tc; j++) put(xm + (j - (p.tc - 1) / 2) * ctx.w * 1.02, 0);
    for (const side of [-1, 1]) for (let j = 0; j < p.no; j++) put(xm + side * (xo - j * ctx.w * 1.02), 1);
    const t = ctx.dsp === 'full' ? ctx.d / ctx.c * 1000 : 0;
    const chans = p.card ? [{ delay: 0, gain: 0, pol: 1 }, { delay: t, gain: 0, pol: -1 }, { delay: 0, gain: -3, pol: 1 }, { delay: t, gain: -3, pol: -1 }]
      : [{ delay: 0, gain: 0, pol: 1 }, { delay: 0, gain: -3, pol: 1 }];
    return { boxes, chans, meta: { xo } };
  },
  cont: ['u'], bounds: () => ({ u: [0.3, 1.0] }),
  explain(ctx, p, des) {
    return [
      `${p.tc} Stack${p.tc > 1 ? 's' : ''} in der Mitte, dazu außen je ${p.no} bei ±${fmt(des.meta.xo, 1)} m${p.card ? ', alles als Cardioid' : ''}.`,
      'Die Mitte trägt den Pegel, die Außen-Stacks bekommen eigenes Delay und weniger Gain und füllen die Ränder. Die Power Alley eines reinen Split L/R wird so gezähmt.',
    ];
  },
};

FAM.steer = {
  label: 'Gelenkte Linie (Beam Steering)', needs: 'full', directional: true, frame: 'placement',
  variant: p => ({ key: `h${p.h}c${p.cols}k${p.card ? 1 : 0}`, label: `${p.cols} × ${p.h}er${p.card ? ' · Cardioid' : ''} · ${Math.round(p.theta)}°` }),
  enumerate(ctx) {
    const out = [], th = ctx.steer;
    if (Math.abs(th) < 7 || Math.abs(th) > 70 || ctx.omni) return out;
    const f = Object.assign({}, ctx, ctx.pframe);
    for (const card of [false, true]) {
      if (card && ctx.H < 2) continue;
      for (let h = 1; h <= ctx.H; h++) {
        const m = card ? h + 1 : h; if (card && h + 1 > ctx.H) continue;
        if (ctx.N % m) continue;
        const cols = ctx.N / m; if (cols < 3) continue;
        if (cols * (card ? 2 : 1) > ctx.K && Math.floor(ctx.K / (card ? 2 : 1)) < 2) continue;
        for (const s of sRange(f, cols, 3)) for (const k of [0.8, 1.0]) out.push({ h, cols, s, card, theta: th * k });
      }
    }
    return out;
  },
  build(ctx, p) {
    const f = Object.assign({}, ctx, ctx.pframe), cols = p.cols, sn = Math.sin(p.theta * D2R);
    const xs = []; for (let j = 0; j < cols; j++) xs.push((j - (cols - 1) / 2) * p.s);
    const tau = xs.map(x => x * sn / ctx.c * 1000), mn = Math.min(...tau);
    const nRoles = p.card ? 2 : 1, G = Math.max(1, Math.min(cols, Math.floor(ctx.K / nRoles)));
    const gOf = xs.map((_, j) => Math.min(G - 1, Math.floor(j * G / cols))), gD = new Array(G).fill(0), cnt = new Array(G).fill(0);
    tau.forEach((t, j) => { gD[gOf[j]] += t - mn; cnt[gOf[j]]++; });
    const gDelay = gD.map((v, g) => v / Math.max(1, cnt[g])), boxes = [], chans = [];
    const roles = p.card ? [{ dy: 0, rot: 0, n: p.h, delay: 0, pol: 1 }, { dy: -ctx.d, rot: 180, n: 1, delay: ctx.d / ctx.c * 1000, pol: -1 }] : [{ dy: 0, rot: 0, n: p.h, delay: 0, pol: 1 }];
    roles.forEach(r => { for (let g = 0; g < G; g++) chans.push({ delay: r.delay + gDelay[g], gain: 0, pol: r.pol }); });
    xs.forEach((x, j) => roles.forEach((r, ri) => { for (let k = 0; k < r.n; k++) boxes.push({ x: f.xc + x, y: f.yFront + r.dy, rot: r.rot, ch: ri * G + gOf[j] }); }));
    return { boxes, chans, meta: { groups: G, inc: p.s * sn / ctx.c * 1000 } };
  },
  cont: ['s', 'theta'], bounds: (ctx, p) => ({ s: sBound(Object.assign({}, ctx, ctx.pframe), p.cols), theta: [-75, 75] }),
  explain(ctx, p, des) {
    return [
      `${p.cols} ${stackWord(p.h)} in einer Linie entlang der Aufstellfläche${p.card ? ', als Cardioid' : ''} – der Strahl wird elektronisch um ${Math.round(p.theta)}° zum Publikum gedreht.`,
      `Δt = s · sin θ / c = ${fmt(Math.abs(des.meta.inc), 2)} ms pro Stack (${des.meta.groups} Delay-Gruppen). So bleiben die Boxen parallel zur Bühnenkante stehen.`,
      `Grating-Lobe-Grenze: s ≤ λmin / (1 + |sin θ|) = ${fmt(ctx.lamHi / (1 + Math.abs(Math.sin(p.theta * D2R))), 2)} m.`,
    ];
  },
};

export const DSP_RANK = { none: 0, pol: 1, full: 2 };

export function whyNot(k, ctx) {
  if (k === 'cardstack') return ctx.H < 2 ? 'braucht Stapelhöhe ≥ 2' : ctx.K < 2 ? 'braucht ≥ 2 Kanäle' : 'Boxanzahl passt nicht auf Stacks';
  if (k === 'gradient') return ctx.K < 2 ? 'braucht ≥ 2 Kanäle' : ctx.depth < 2 * ctx.d ? 'Aufstellfläche zu flach für zwei Reihen' : 'Boxanzahl passt nicht';
  if (k === 'endfire') return ctx.K < 2 ? 'braucht ≥ 2 Kanäle' : ctx.depth < 2 * ctx.d ? 'Aufstellfläche zu flach für mehrere Reihen' : 'Boxanzahl passt nicht auf die Reihen';
  if (k === 'arcdelay' || k === 'arcphys') return 'braucht ≥ 3 Spalten';
  if (k === 'split') return 'braucht eine gerade Boxanzahl';
  if (k === 'cardarc') return ctx.H < 2 ? 'braucht Stapelhöhe ≥ 2' : 'braucht ≥ 3 Cardioid-Stacks';
  if (k === 'centerouter') return ctx.K < 2 ? 'braucht ≥ 2 Kanäle' : 'zu wenige Boxen für Mitte + Außen';
  if (k === 'steer') return Math.abs(ctx.steer) < 7 ? 'Publikum liegt gerade vor der Fläche – Lenken unnötig' : 'braucht ≥ 3 Stacks und genug Kanäle';
  return 'nicht möglich';
}

export function weightsFor(goal) {
  const pr = goal.priority || 'balanced';
  const base = { w_even: 1, w_quiet: 1, quiet_target: goal.quietTarget != null ? goal.quietTarget : -15,
    w_stage: 1, stage_target: goal.stageTarget != null ? goal.stageTarget : -10, w_eff: 0.5, eff_allow: 6 };
  if (pr === 'rear') Object.assign(base, { w_quiet: 2.2, w_stage: 2, w_even: 0.7, w_eff: 0.3, eff_allow: 9 });
  if (pr === 'even') Object.assign(base, { w_even: 2, w_quiet: 0.6 });
  if (pr === 'level') Object.assign(base, { w_eff: 1.6, eff_allow: 3, w_even: 0.8, w_quiet: 0.6 });
  return base;
}

/** parametric scenario -> zones (the "Szenario" chips) */
export function zonesFromGoal(g) {
  const z = [];
  const half = Math.max(5, Math.min(180, g.audAngle / 2));
  if (half >= 180) z.push({ kind: 'audience', shape: 'ring', p: [0, 0, g.audR1, g.audR2] });
  else z.push({ kind: 'audience', shape: 'sector', p: [0, 0, g.audR1, g.audR2, -half, half] });
  if (g.stageOn !== false && g.stageD) z.push({ kind: 'stage', shape: 'rect', p: [-g.stageW / 2, -(g.placeD || 0) - g.stageD, g.stageW / 2, -(g.placeD || 0) - 0.5] });
  if (g.quietOn) z.push({ kind: 'quiet', shape: 'sector', p: [0, 0, g.quietR1, g.quietR2, 180 - g.quietAngle / 2, 180 + g.quietAngle / 2] });
  if (half >= 180) z.push({ kind: 'place', shape: 'rect', p: [-g.placeW / 2, -g.placeD / 2, g.placeW / 2, g.placeD / 2] });
  else z.push({ kind: 'place', shape: 'rect', p: [-g.placeW / 2, -g.placeD, g.placeW / 2, 0] });
  if (g.gap > 0) z.push({ kind: 'nogo', shape: 'rect', p: [-g.gap / 2, -g.placeD - 0.5, g.gap / 2, 0.5] });
  return z;
}
