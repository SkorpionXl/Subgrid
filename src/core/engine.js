/* SubGrid — acoustics engine (port of subarray core.py / zones.py / Scorer) */
const SG = {};
export default SG;


const TAU = 2 * Math.PI;
const D2R = Math.PI / 180;

/* ---------- basics ---------- */
SG.speedOfSound = function (T, RH) {
  return 331.3 * Math.sqrt(1 + T / 273.15) + 0.0124 * (RH || 0);
};

/** 1/n-octave frequencies (base 1 kHz) between lo and hi (like subarray band_freqs) */
SG.bandFreqs = function (lo, hi, perOct) {
  perOct = perOct || 6;
  const out = [];
  for (let k = -10 * perOct; k <= 0; k++) {
    const f = 1000 * Math.pow(2, k / perOct);
    if (f >= lo * 0.97 && f <= hi * 1.03) out.push(f);
  }
  return out;
};

SG.logspace = function (lo, hi, n) {
  const a = Math.log(lo), b = Math.log(hi), out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.exp(a + (b - a) * i / (n - 1));
  return out;
};

SG.makeSource = function (o) {
  return Object.assign({ x: 0, y: 0, delay_ms: 0, gain_db: 0, polarity: 1, enabled: true,
    channel: 0, rot_deg: 0, ap_f: 0, ap_q: 0.7, lp_f: 0 }, o || {});
};

/* ---------- filters ---------- */
/** complex response [re, im] of a source's all-pass (2nd order) and LR4 low-pass at f */
function filterResp(f, s) {
  let re = 1, im = 0;
  const w = TAU * f;
  if (s.ap_f > 0) {
    const w0 = TAU * s.ap_f, q = Math.max(s.ap_q || 0.7, 0.05);
    const ph = -2 * Math.atan2((w0 / q) * w, w0 * w0 - w * w);
    const c = Math.cos(ph), sn = Math.sin(ph);
    const r2 = re * c - im * sn; im = re * sn + im * c; re = r2;
  }
  if (s.lp_f > 0) {
    const w0 = TAU * s.lp_f;
    // b2 = w0^2 / ((w0^2 - w^2) + j sqrt2 w0 w);  H = b2^2
    const dr = w0 * w0 - w * w, di = Math.SQRT2 * w0 * w;
    const den = dr * dr + di * di;
    const br = w0 * w0 * dr / den, bi = -w0 * w0 * di / den;
    const hr = br * br - bi * bi, hi = 2 * br * bi;
    const r2 = re * hr - im * hi; im = re * hi + im * hr; re = r2;
  }
  return [re, im];
}
SG.filterResp = filterResp;

/** per-source complex weights H[f][n] = amp * pol * e^{-jw delay} * filters  (as Float64Array re/im) */
SG.sourceWeights = function (srcs, freqs) {
  const N = srcs.length, F = freqs.length;
  const re = new Float64Array(F * N), im = new Float64Array(F * N);
  for (let n = 0; n < N; n++) {
    const s = srcs[n];
    const a = s.polarity * Math.pow(10, s.gain_db / 20);
    const tau = s.delay_ms * 1e-3;
    const filt = s.ap_f > 0 || s.lp_f > 0;
    for (let i = 0; i < F; i++) {
      const ph = -TAU * freqs[i] * tau;
      let r = a * Math.cos(ph), m = a * Math.sin(ph);
      if (filt) {
        const h = filterResp(freqs[i], s);
        const r2 = r * h[0] - m * h[1]; m = r * h[1] + m * h[0]; r = r2;
      }
      re[i * N + n] = r; im[i * N + n] = m;
    }
  }
  return { re, im, N, F };
};


/* ---------- walls: image sources (port of subarray core.reflections) ---------- */
/** walls: [{p:[x0,y0,x1,y1,...], loss: dB}] -> {A, B, g} flat arrays or null */
SG.wallSegments = function (walls) {
  const A = [], B = [], g = [];
  for (const w of walls || []) {
    const p = w.p || [], k = Math.pow(10, -(+w.loss || 0) / 20);
    if (w.loss >= 60) continue;                                   // fully absorbing: no reflection
    for (let i = 0; i + 3 < p.length; i += 2) {
      if (Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]) > 1e-6) { A.push(p[i], p[i + 1]); B.push(p[i + 2], p[i + 3]); g.push(k); }
    }
  }
  return g.length ? { A: Float64Array.from(A), B: Float64Array.from(B), g: Float64Array.from(g), S: g.length } : null;
};
function mirrorPt(x, y, ax, ay, bx, by) {
  const ex = bx - ax, ey = by - ay, l = Math.hypot(ex, ey), nx = -ey / l, ny = ex / l;
  const d = (x - ax) * nx + (y - ay) * ny;
  return [x - 2 * d * nx, y - 2 * d * ny];
}
/** does I->P cross segment A-B? returns t on A-B (>=0) or -1 */
function crossT(ix, iy, px, py, ax, ay, bx, by) {
  const dx = px - ix, dy = py - iy, ex = bx - ax, ey = by - ay;
  const den = dx * ey - dy * ex;
  if (Math.abs(den) < 1e-12) return -1;
  const wx = ax - ix, wy = ay - iy;
  const s = (wx * ey - wy * ex) / den, t = (wx * dy - wy * dx) / den;
  return (s > 1e-9 && s < 1 - 1e-9 && t >= 0 && t <= 1) ? t : -1;
}
/**
 * reflected paths from sources xy (flat 2N) to points (flat 2P), order 1 or 2.
 * returns [{n, D: Float64Array(P), W: Float64Array(P)}] (images that reach at least one point)
 */
SG.reflections = function (xy, pts, segs, order) {
  const out = [];
  if (!segs || !order) return out;
  const N = xy.length / 2, P = pts.length / 2, S = segs.S, A = segs.A, B = segs.B, g = segs.g;
  for (let n = 0; n < N; n++) {
    const sx = xy[2 * n], sy = xy[2 * n + 1];
    const I1 = [];
    for (let k = 0; k < S; k++) I1.push(mirrorPt(sx, sy, A[2 * k], A[2 * k + 1], B[2 * k], B[2 * k + 1]));
    for (let k = 0; k < S; k++) {
      const [ix, iy] = I1[k], D = new Float64Array(P), W = new Float64Array(P); let any = false;
      for (let p = 0; p < P; p++) {
        const px = pts[2 * p], py = pts[2 * p + 1];
        D[p] = Math.hypot(px - ix, py - iy);
        if (crossT(ix, iy, px, py, A[2 * k], A[2 * k + 1], B[2 * k], B[2 * k + 1]) >= 0) { W[p] = g[k]; any = true; }
      }
      if (any) out.push({ n, D, W });
    }
    if (order >= 2 && S > 1) for (let k1 = 0; k1 < S; k1++) for (let k2 = 0; k2 < S; k2++) {
      if (k1 === k2) continue;
      const [i1x, i1y] = I1[k1];
      const [ix, iy] = mirrorPt(i1x, i1y, A[2 * k2], A[2 * k2 + 1], B[2 * k2], B[2 * k2 + 1]);
      const D = new Float64Array(P), W = new Float64Array(P); let any = false;
      for (let p = 0; p < P; p++) {
        const px = pts[2 * p], py = pts[2 * p + 1];
        D[p] = Math.hypot(px - ix, py - iy);
        const t = crossT(ix, iy, px, py, A[2 * k2], A[2 * k2 + 1], B[2 * k2], B[2 * k2 + 1]);
        if (t < 0) continue;
        const qx = A[2 * k2] + t * (B[2 * k2] - A[2 * k2]), qy = A[2 * k2 + 1] + t * (B[2 * k2 + 1] - A[2 * k2 + 1]);
        if (crossT(i1x, i1y, qx, qy, A[2 * k1], A[2 * k1 + 1], B[2 * k1], B[2 * k1 + 1]) < 0) continue;
        W[p] = g[k1] * g[k2]; any = true;
      }
      if (any) out.push({ n, D, W });
    }
  }
  return out;
};

/* ---------- pressure ---------- */
/**
 * Complex pressure at points (Float64Array xy interleaved) for each frequency.
 * Returns {re, im} Float64Array of size F*P  (index f*P + p).
 */
SG.pressure = function (srcs, pts, freqs, c, rmin, room) {
  rmin = rmin || 0.2;
  const on = srcs.filter(s => s.enabled);
  const P = pts.length / 2, F = freqs.length, N = on.length;
  const re = new Float64Array(F * P), im = new Float64Array(F * P);
  if (!N) return { re, im, P, F };
  const W = SG.sourceWeights(on, freqs);
  const dist = new Float64Array(P);
  for (let n = 0; n < N; n++) {
    const sx = on[n].x, sy = on[n].y;
    for (let p = 0; p < P; p++) {
      const dx = pts[2 * p] - sx, dy = pts[2 * p + 1] - sy;
      dist[p] = Math.max(Math.sqrt(dx * dx + dy * dy), rmin);
    }
    for (let i = 0; i < F; i++) {
      const k = -TAU * freqs[i] / c;
      const wr = W.re[i * N + n], wi = W.im[i * N + n];
      const base = i * P;
      for (let p = 0; p < P; p++) {
        const d = dist[p], ph = k * d;
        const cr = Math.cos(ph) / d, ci = Math.sin(ph) / d;
        re[base + p] += wr * cr - wi * ci;
        im[base + p] += wr * ci + wi * cr;
      }
    }
  }
  if (room && room.segs && room.order) {
    const xy = new Float64Array(N * 2); on.forEach((s, i) => { xy[2 * i] = s.x; xy[2 * i + 1] = s.y; });
    for (const img of SG.reflections(xy, pts, room.segs, room.order)) {
      const n = img.n;
      for (let i = 0; i < F; i++) {
        const k = -TAU * freqs[i] / c, wr = W.re[i * N + n], wi = W.im[i * N + n], base = i * P;
        for (let p = 0; p < P; p++) {
          const w = img.W[p]; if (!w) continue;
          const d = Math.max(img.D[p], rmin), ph = k * d, cr = w * Math.cos(ph) / d, ci = w * Math.sin(ph) / d;
          re[base + p] += wr * cr - wi * ci; im[base + p] += wr * ci + wi * cr;
        }
      }
    }
  }
  return { re, im, P, F };
};

SG.directionPoints = function (anglesDeg, R) {
  const pts = new Float64Array(anglesDeg.length * 2);
  anglesDeg.forEach((a, i) => { pts[2 * i] = R * Math.sin(a * D2R); pts[2 * i + 1] = R * Math.cos(a * D2R); });
  return pts;
};

/** level in dB re one box on a circle of radius R: returns Float64Array F*A */
SG.polarDb = function (srcs, freqs, c, anglesDeg, R) {
  R = R || 100;
  const pts = SG.directionPoints(anglesDeg, R);
  const p = SG.pressure(srcs, pts, freqs, c);
  const A = anglesDeg.length, out = new Float64Array(freqs.length * A);
  for (let i = 0; i < out.length; i++) {
    out[i] = 10 * Math.log10((p.re[i] * p.re[i] + p.im[i] * p.im[i]) * R * R + 1e-24);
  }
  return out;
};

/** port of core.compute_metrics (1° grid) */
SG.computeMetrics = function (srcs, freqs, c, R) {
  const ang = []; for (let a = 0; a < 360; a++) ang.push(a);
  const L = SG.polarDb(srcs, freqs, c, ang, R || 100);
  const F = freqs.length;
  const m = { freqs: freqs.slice(), on_axis: [], beamwidth: [], rear: [], rear_worst: [], sidelobe: [], side90: [] };
  for (let i = 0; i < F; i++) {
    const on = L[i * 360];
    const rel = new Float64Array(360);
    for (let a = 0; a < 360; a++) rel[a] = L[i * 360 + a] - on;
    let cw = 180, ccw = 180;
    for (let a = 1; a <= 180; a++) if (rel[a] < -6) { cw = a; break; }
    for (let k = 1; k <= 180; k++) if (rel[(360 - k) % 360] < -6) { ccw = k; break; }
    m.on_axis.push(on);
    m.beamwidth.push(Math.min(cw + ccw, 360));
    m.rear.push(rel[180]);
    let rw = -999; for (let a = 150; a <= 210; a++) rw = Math.max(rw, rel[a]);
    m.rear_worst.push(rw);
    m.side90.push(Math.max(rel[90], rel[270]));
    // side lobes: beyond the first minimum on each side of the main beam
    let a = cw; while (a < 180 && rel[a + 1] <= rel[a]) a++;
    let b = ccw; while (b < 180 && rel[(360 - b - 1) % 360] <= rel[(360 - b) % 360]) b++;
    const lo = a, hi = 360 - b;
    let side = -99;
    if (lo <= hi) for (let k = lo; k <= hi; k++) side = Math.max(side, rel[k]);
    m.sidelobe.push(side);
  }
  return m;
};

SG.bandSummary = function (m, lo, hi) {
  const idx = []; m.freqs.forEach((f, i) => { if (f >= lo && f <= hi) idx.push(i); });
  if (!idx.length) return null;
  const pick = k => idx.map(i => m[k][i]);
  const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  return {
    bw_mean: mean(pick('beamwidth')), bw_min: Math.min(...pick('beamwidth')), bw_max: Math.max(...pick('beamwidth')),
    on_mean: mean(pick('on_axis')), on_min: Math.min(...pick('on_axis')), on_max: Math.max(...pick('on_axis')),
    rear_worst: Math.max(...pick('rear_worst')), rear_mean: mean(pick('rear_worst')),
    sidelobe: Math.max(...pick('sidelobe')), side90: mean(pick('side90')),
  };
};

/* ---------- footprints ---------- */
SG.boxFront = function (rot) { const a = rot * D2R; return [-Math.sin(a), Math.cos(a)]; };
/** corners [4][2]: rear-left, rear-right, front-right, front-left  (2-3 = front edge) */
SG.boxCorners = function (x, y, rot, w, d) {
  const a = rot * D2R;
  const ux = [Math.cos(a), Math.sin(a)], uy = [-Math.sin(a), Math.cos(a)];
  const cx = x - d / 2 * uy[0], cy = y - d / 2 * uy[1];
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) =>
    [cx + sx * w / 2 * ux[0] + sy * d / 2 * uy[0], cy + sx * w / 2 * ux[1] + sy * d / 2 * uy[1]]);
};
SG.boxCentre = function (x, y, rot, d) { const f = SG.boxFront(rot); return [x - d / 2 * f[0], y - d / 2 * f[1]]; };
SG.footprintKey = function (x, y, rot, d) {
  const c = SG.boxCentre(x, y, rot, d);
  const r = ((rot % 180) + 180) % 180;
  return Math.round(c[0] * 1000) + ',' + Math.round(c[1] * 1000) + ',' + Math.round(r * 10);
};
/** penetration depth of two convex quads (separating axis); 0 = no overlap */
SG.rectPenetration = function (A, B) {
  const axes = [];
  for (const R of [A, B]) for (const [i, j] of [[0, 1], [0, 3]]) {
    const ex = R[j][0] - R[i][0], ey = R[j][1] - R[i][1], l = Math.hypot(ex, ey) || 1;
    axes.push([ex / l, ey / l]);
  }
  let best = Infinity;
  for (const ax of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const v = p[0] * ax[0] + p[1] * ax[1]; a0 = Math.min(a0, v); a1 = Math.max(a1, v); }
    for (const p of B) { const v = p[0] * ax[0] + p[1] * ax[1]; b0 = Math.min(b0, v); b1 = Math.max(b1, v); }
    best = Math.min(best, Math.min(a1, b1) - Math.max(a0, b0));
  }
  return Math.max(0, best);
};

/** group sources into stacks (same footprint) -> [{key, idx:[...], cx, cy, rot}] */
SG.stacks = function (srcs, d) {
  const map = new Map();
  srcs.forEach((s, i) => {
    const k = SG.footprintKey(s.x, s.y, s.rot_deg, d);
    if (!map.has(k)) map.set(k, { key: k, idx: [], rot: s.rot_deg });
    map.get(k).idx.push(i);
  });
  return [...map.values()];
};

/** overlap / clearance problems -> Set of source indices that collide */
SG.collisions = function (srcs, w, d) {
  const st = SG.stacks(srcs, d), bad = new Set();
  const rects = st.map(g => { const s = srcs[g.idx[0]]; return SG.boxCorners(s.x, s.y, s.rot_deg, w, d); });
  for (let i = 0; i < st.length; i++) for (let j = i + 1; j < st.length; j++) {
    if (SG.rectPenetration(rects[i], rects[j]) > 0.005) { st[i].idx.forEach(k => bad.add(k)); st[j].idx.forEach(k => bad.add(k)); }
  }
  return bad;
};

/* ---------- zones (subarray format {kind, shape, p}) ---------- */
const Z = SG.zones = {};
Z.KINDS = ['audience', 'quiet', 'stage', 'place', 'nogo'];
Z.SHAPES = ['circle', 'ring', 'sector', 'rect', 'poly', 'grid'];
/* painted zones: {kind, shape:'grid', p:[cell], runs:[[j, i0, i1], ...]}  (subarray format)
   cell (i, j) covers x = i*cell..(i+1)*cell, y = j*cell..(j+1)*cell */
const GRID_CACHE = new WeakMap();
const ckey = (i, j) => (i + 100000) * 200003 + (j + 100000);
Z.gridInfo = function (z) {
  let g = GRID_CACHE.get(z);
  if (g && g.runs === z.runs) return g;
  const I = [], J = [], set = new Set();
  for (const [j, i0, i1] of z.runs || []) for (let i = i0; i <= i1; i++) { I.push(i); J.push(j); set.add(ckey(i, j)); }
  g = { runs: z.runs, I, J, set, cell: z.p[0] };
  GRID_CACHE.set(z, g);
  return g;
};
Z.gridFromCells = function (kind, cell, cells) {
  const rows = new Map();
  for (const [i, j] of cells) { if (!rows.has(j)) rows.set(j, []); rows.get(j).push(i); }
  const runs = [];
  [...rows.keys()].sort((a, b) => a - b).forEach(j => {
    const xs = [...new Set(rows.get(j))].sort((a, b) => a - b);
    let st = xs[0], pv = xs[0];
    for (let k = 1; k < xs.length; k++) { if (xs[k] !== pv + 1) { runs.push([j, st, pv]); st = xs[k]; } pv = xs[k]; }
    runs.push([j, st, pv]);
  });
  return { kind, shape: 'grid', p: [cell], runs };
};
Z.gridCells = function (z) { const g = Z.gridInfo(z); return g.I.map((i, k) => [i, g.J[k]]); };

Z.angSpan = function (a0, a1) {
  const d = a1 - a0;
  if (Math.abs(d) >= 360) return 360;
  const s = ((d % 360) + 360) % 360;
  return s > 1e-9 ? s : 360;
};
function asSector(z) {
  const p = z.p;
  if (z.shape === 'circle') return [p[0], p[1], 0, p[2], 0, 360];
  if (z.shape === 'ring') return [p[0], p[1], p[2], p[3], 0, 360];
  if (z.shape === 'sector') return p.slice(0, 6);
  return null;
}
Z.contains = function (z, x, y) {
  if (z.shape === 'grid') { const g = Z.gridInfo(z); return g.set.has(ckey(Math.floor(x / g.cell), Math.floor(y / g.cell))); }
  const sec = asSector(z);
  if (sec) {
    const [cx, cy, r1, r2, a0, a1] = sec;
    const dx = x - cx, dy = y - cy, r = Math.hypot(dx, dy);
    if (r < r1 || r > r2) return false;
    const span = Z.angSpan(a0, a1);
    if (span >= 360) return true;
    const a = ((Math.atan2(dx, dy) / D2R) % 360 + 360) % 360;
    return (((a - a0) % 360) + 360) % 360 <= span;
  }
  if (z.shape === 'rect') {
    const [x0, y0, x1, y1] = z.p;
    return x >= Math.min(x0, x1) && x <= Math.max(x0, x1) && y >= Math.min(y0, y1) && y <= Math.max(y0, y1);
  }
  if (z.shape === 'poly') {
    const v = z.p; let inside = false;
    for (let i = 0, j = v.length / 2 - 1; i < v.length / 2; j = i++) {
      const xi = v[2 * i], yi = v[2 * i + 1], xj = v[2 * j], yj = v[2 * j + 1];
      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi + 1e-30) + xi)) inside = !inside;
    }
    return inside;
  }
  return false;
};
Z.area = function (z) {
  if (z.shape === 'grid') { const g = Z.gridInfo(z); return g.I.length * g.cell * g.cell; }
  const sec = asSector(z);
  if (sec) { const [, , r1, r2, a0, a1] = sec; return Math.PI * (r2 * r2 - r1 * r1) * Z.angSpan(a0, a1) / 360; }
  if (z.shape === 'rect') { const [x0, y0, x1, y1] = z.p; return Math.abs((x1 - x0) * (y1 - y0)); }
  if (z.shape === 'poly') {
    const v = z.p, n = v.length / 2; let s = 0;
    for (let i = 0; i < n; i++) { const j = (i + 1) % n; s += v[2 * i] * v[2 * j + 1] - v[2 * j] * v[2 * i + 1]; }
    return Math.abs(s) / 2;
  }
  return 0;
};
/** outline as array of polylines [[x,y],...] for drawing */
Z.outline = function (z, n) {
  n = n || 120;
  const p = z.p;
  if (z.shape === 'grid') {
    const g = Z.gridInfo(z); if (!g.I.length) return [];
    const c = g.cell, x0 = Math.min(...g.I) * c, x1 = (Math.max(...g.I) + 1) * c, y0 = Math.min(...g.J) * c, y1 = (Math.max(...g.J) + 1) * c;
    return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]];
  }
  if (z.shape === 'rect') { const [x0, y0, x1, y1] = p; return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]; }
  if (z.shape === 'poly') { const pts = []; for (let i = 0; i < p.length; i += 2) pts.push([p[i], p[i + 1]]); pts.push(pts[0]); return [pts]; }
  if (z.shape === 'line') return [[[p[0], p[1]], [p[2], p[3]]]];
  if (z.shape === 'arc') {
    const [cx, cy, r, a0, a1] = p, span = Z.angSpan(a0, a1), out = [];
    for (let i = 0; i <= n; i++) { const a = (a0 + span * i / n) * D2R; out.push([cx + r * Math.sin(a), cy + r * Math.cos(a)]); }
    return [out];
  }
  const sec = asSector(z); if (!sec) return [];
  const [cx, cy, r1, r2, a0, a1] = sec, span = Z.angSpan(a0, a1);
  const arc = (r, rev) => { const o = []; for (let i = 0; i <= n; i++) { const t = rev ? n - i : i; const a = (a0 + span * t / n) * D2R; o.push([cx + r * Math.sin(a), cy + r * Math.cos(a)]); } return o; };
  if (span >= 360) return r1 > 0 ? [arc(r2), arc(r1)] : [arc(r2)];
  const outer = arc(r2), inner = r1 > 0 ? arc(r1, true) : [[cx, cy]];
  return [outer.concat(inner, [outer[0]])];
};
Z.bbox = function (z) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  Z.outline(z, 60).forEach(l => l.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
  return [x0, y0, x1, y1];
};

/** move a zone by dx, dy (grid zones move by whole cells) */
Z.translate = function (z, dx, dy) {
  const p = z.p.slice();
  if (z.shape === 'grid') {
    const c = p[0], di = Math.round(dx / c), dj = Math.round(dy / c);
    return Object.assign({}, z, { runs: (z.runs || []).map(([j, a, b]) => [j + dj, a + di, b + di]) });
  }
  if (z.shape === 'rect') { p[0] += dx; p[2] += dx; p[1] += dy; p[3] += dy; }
  else if (z.shape === 'poly') { for (let i = 0; i < p.length; i += 2) { p[i] += dx; p[i + 1] += dy; } }
  else { p[0] += dx; p[1] += dy; }
  return Object.assign({}, z, { p });
};
/* small seeded RNG (mulberry32) so scores are repeatable */
SG.rng = function (seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

Z.sample = function (z, n, rnd) {
  const out = [];
  if (z.shape === 'grid') {
    const g = Z.gridInfo(z); if (!g.I.length) return out;
    for (let k = 0; k < n; k++) { const m = Math.min(g.I.length - 1, Math.floor(rnd() * g.I.length)); out.push((g.I[m] + rnd()) * g.cell, (g.J[m] + rnd()) * g.cell); }
    return out;
  }
  const sec = asSector(z);
  if (sec) {
    const [cx, cy, r1, r2, a0, a1] = sec, span = Z.angSpan(a0, a1);
    // stratified: sqrt-uniform radius, uniform angle
    for (let i = 0; i < n; i++) {
      const u = (i + rnd()) / n, v = rnd();
      const r = Math.sqrt(r1 * r1 + u * (r2 * r2 - r1 * r1));
      const a = (a0 + v * span) * D2R;
      out.push(cx + r * Math.sin(a), cy + r * Math.cos(a));
    }
    return out;
  }
  const [x0, y0, x1, y1] = Z.bbox(z);
  let guard = 0;
  while (out.length < 2 * n && guard++ < 200 * n) {
    const x = x0 + rnd() * (x1 - x0), y = y0 + rnd() * (y1 - y0);
    if (Z.contains(z, x, y)) out.push(x, y);
  }
  return out;
};
/** n points over all zones of a kind (by area), minus points in zones of the opposite kind */
Z.sampleKind = function (zones, kind, n, rnd) {
  const zs = zones.filter(z => z.kind === kind && Z.area(z) > 0);
  if (!zs.length) return new Float64Array(0);
  const areas = zs.map(Z.area), tot = areas.reduce((a, b) => a + b, 0);
  let pts = [];
  zs.forEach((z, i) => { pts = pts.concat(Z.sample(z, Math.max(1, Math.round(n * areas[i] / tot)), rnd)); });
  // audience minus quiet and stage; quiet minus audience (subarray semantics); stage stays whole
  const other = kind === 'audience' ? ['quiet', 'stage'] : kind === 'quiet' ? ['audience'] : null;
  if (other) {
    const ox = zones.filter(z => other.includes(z.kind));
    const keep = [];
    for (let i = 0; i < pts.length; i += 2) if (!ox.some(z => Z.contains(z, pts[i], pts[i + 1]))) keep.push(pts[i], pts[i + 1]);
    pts = keep;
  }
  return Float64Array.from(pts);
};

/* ---------- zone scorer (port of optimize.Scorer) ---------- */
/**
 * opts: {band:[lo,hi], temps:[...], RH, w_even, w_quiet, quiet_target, w_eff, eff_allow,
 *        box_spl, target_spl, nAud, nQuiet}
 */
class Scorer {
  constructor(zones, opts) {
    this.o = Object.assign({ band: [40, 100], temps: [20], RH: 50, w_even: 1, w_quiet: 1, quiet_target: -15,
      w_stage: 1, stage_target: -10, w_eff: 0.5, eff_allow: 6, box_spl: 0, target_spl: 0, nAud: 200, nQuiet: 120, nStage: 90,
      walls: null, refl_order: 1 }, opts || {});
    const rnd = SG.rng(12345);
    this.A = Z.sampleKind(zones, 'audience', this.o.nAud, rnd);
    this.Q = Z.sampleKind(zones, 'quiet', this.o.nQuiet, rnd);
    this.St = Z.sampleKind(zones, 'stage', this.o.nStage, rnd);
    this.nA = this.A.length / 2; this.nQ = this.Q.length / 2; this.nS = this.St.length / 2;
    this.P = this.nA + this.nQ + this.nS;
    this.pts = new Float64Array(this.P * 2); this.pts.set(this.A, 0); this.pts.set(this.Q, this.A.length); this.pts.set(this.St, this.A.length + this.Q.length);
    this.segs = SG.wallSegments(this.o.walls);
    this.order = this.segs ? Math.max(0, Math.min(2, this.o.refl_order | 0)) : 0;
    this.F = SG.bandFreqs(this.o.band[0], this.o.band[1]);
    this.cs = this.o.temps.map(t => SG.speedOfSound(t, this.o.RH));
  }
  get ok() { return this.nA > 0 && this.F.length > 0; }

  /** geometry cache for positions pos (Float64Array 2N): E per temperature  (F*N*P complex) + coherent sum */
  geometry(pos) {
    const N = pos.length / 2, P = this.P, F = this.F.length;
    const dist = new Float64Array(N * P);
    const coh = new Float64Array(this.nA);
    for (let n = 0; n < N; n++) for (let p = 0; p < P; p++) {
      const dx = this.pts[2 * p] - pos[2 * n], dy = this.pts[2 * p + 1] - pos[2 * n + 1];
      const d = Math.max(Math.sqrt(dx * dx + dy * dy), 0.3);
      dist[n * P + p] = d;
      if (p < this.nA) coh[p] += 1 / d;
    }
    let coh2 = 0; for (let p = 0; p < this.nA; p++) coh2 += coh[p] * coh[p]; coh2 /= Math.max(1, this.nA);
    const E = this.cs.map(c => {
      const re = new Float32Array(F * N * P), im = new Float32Array(F * N * P);
      for (let i = 0; i < F; i++) {
        const k = -TAU * this.F[i] / c;
        for (let n = 0; n < N; n++) {
          const off = (i * N + n) * P, doff = n * P;
          for (let p = 0; p < P; p++) {
            const d = dist[doff + p], ph = k * d;
            re[off + p] = Math.cos(ph) / d; im[off + p] = Math.sin(ph) / d;
          }
        }
      }
      return { re, im };
    });
    if (this.order) {
      // image sources carry their box's signal: add them into the box's transfer term
      const imgs = SG.reflections(pos, this.pts, this.segs, this.order);
      this.cs.forEach((c, ti) => {
        const { re, im } = E[ti];
        for (const img of imgs) for (let i = 0; i < F; i++) {
          const k = -TAU * this.F[i] / c, off = (i * N + img.n) * P;
          for (let p = 0; p < P; p++) {
            const w = img.W[p]; if (!w) continue;
            const d = Math.max(img.D[p], 0.3), ph = k * d;
            re[off + p] += w * Math.cos(ph) / d; im[off + p] += w * Math.sin(ph) / d;
          }
        }
      });
    }
    return { N, E, coh2 };
  }

  /** metrics per frequency for one temperature index; H = sourceWeights(...) */
  scenario(geo, H, ti) {
    const { N } = geo, P = this.P, F = this.F.length, nA = this.nA;
    const E = geo.E[ti];
    const spread = new Float64Array(F), eff = new Float64Array(F), rej = new Float64Array(F), rejS = new Float64Array(F), la10 = new Float64Array(F);
    const pr = new Float64Array(P), pi = new Float64Array(P), La = new Float64Array(nA);
    for (let i = 0; i < F; i++) {
      pr.fill(0); pi.fill(0);
      for (let n = 0; n < N; n++) {
        const hr = H.re[i * N + n], hi = H.im[i * N + n];
        if (hr === 0 && hi === 0) continue;
        const off = (i * N + n) * P;
        for (let p = 0; p < P; p++) {
          const er = E.re[off + p], ei = E.im[off + p];
          pr[p] += hr * er - hi * ei; pi[p] += hr * ei + hi * er;
        }
      }
      let sa = 0, sl = 0, sl2 = 0;
      for (let p = 0; p < nA; p++) {
        const q = pr[p] * pr[p] + pi[p] * pi[p];
        sa += q; const l = 10 * Math.log10(q + 1e-24); La[p] = l; sl += l; sl2 += l * l;
      }
      const Pa = sa / nA, ml = sl / nA;
      spread[i] = Math.sqrt(Math.max(0, sl2 / nA - ml * ml));
      eff[i] = 10 * Math.log10(Pa / geo.coh2 + 1e-30);
      if (this.nQ) {
        let sq = 0; for (let p = nA; p < nA + this.nQ; p++) sq += pr[p] * pr[p] + pi[p] * pi[p];
        rej[i] = 10 * Math.log10((sq / this.nQ) / (Pa + 1e-30) + 1e-30);
      }
      if (this.nS) {
        let ss = 0; for (let p = nA + this.nQ; p < P; p++) ss += pr[p] * pr[p] + pi[p] * pi[p];
        rejS[i] = 10 * Math.log10((ss / this.nS) / (Pa + 1e-30) + 1e-30);
      }
      if (this.o.box_spl > 0) {
        const s = Array.from(La).sort((a, b) => a - b);
        la10[i] = s[Math.floor(0.1 * (s.length - 1))];
      }
    }
    return { spread, eff, rej: this.nQ ? rej : null, rejS: this.nS ? rejS : null, la10 };
  }

  costOf(m) {
    const o = this.o, mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    let cost = o.w_even * mean(m.spread);
    if (m.rej) {
      cost += o.w_quiet * (mean(Array.from(m.rej, r => Math.max(0, r - o.quiet_target))) + 0.05 * mean(m.rej));
    }
    if (m.rejS) {
      cost += o.w_stage * (mean(Array.from(m.rejS, r => Math.max(0, r - o.stage_target))) + 0.05 * mean(m.rejS));
    }
    cost += o.w_eff * mean(Array.from(m.eff, e => Math.max(0, -e - o.eff_allow)));
    if (o.box_spl > 0 && o.target_spl > 0) {
      cost += mean(Array.from(m.la10, l => Math.max(0, o.target_spl - (o.box_spl + l))));
    }
    return cost;
  }

  /** robust cost over all temperatures: mean + half the gap to the worst (like subarray) */
  score(geo, H, temps) {
    const idx = temps || this.cs.map((_, i) => i);
    const costs = [], ms = [];
    for (const ti of idx) { const m = this.scenario(geo, H, ti); costs.push(this.costOf(m)); ms.push(m); }
    const mean = costs.reduce((a, b) => a + b, 0) / costs.length;
    return { cost: mean + 0.5 * (Math.max(...costs) - mean), ms };
  }

  summary(ms) {
    const mean = a => a.reduce((s, v) => s + v, 0) / a.length;
    const out = { spread: Math.max(...ms.map(m => mean(m.spread))), eff: Math.min(...ms.map(m => mean(m.eff))) };
    if (ms[0].rej) {
      out.rej = Math.max(...ms.map(m => mean(m.rej)));
      out.rej_worst_f = Math.max(...ms.map(m => Math.max(...m.rej)));
    }
    if (ms[0].rejS) out.rejS = Math.max(...ms.map(m => mean(m.rejS)));
    if (this.o.box_spl > 0) out.spl10 = this.o.box_spl + Math.min(...ms.map(m => Math.min(...m.la10)));
    return out;
  }

  /** convenience: assess a list of sources */
  assess(srcs) {
    const on = srcs.filter(s => s.enabled);
    if (!this.ok || !on.length) return null;
    const pos = new Float64Array(on.length * 2);
    on.forEach((s, i) => { pos[2 * i] = s.x; pos[2 * i + 1] = s.y; });
    const geo = this.geometry(pos);
    const r = this.score(geo, SG.sourceWeights(on, this.F));
    return Object.assign(this.summary(r.ms), { cost: r.cost });
  }
}
SG.Scorer = Scorer;

/* ---------- map field (grid) ---------- */
/**
 * level map on a grid: returns Float32Array ny*nx of dB re 1 box (energy average over freqs)
 * x from x0..x1 (nx), y from y1 (top row) .. y0
 */
SG.fieldMap = function (srcs, freqs, c, x0, x1, y0, y1, nx, ny, room) {
  const on = srcs.filter(s => s.enabled);
  const P = nx * ny, F = freqs.length, N = on.length;
  const pow = new Float64Array(P);
  const out = new Float32Array(P);
  if (!N) { out.fill(-200); return out; }
  const W = SG.sourceWeights(on, freqs);
  const dist = new Float32Array(N * P);
  const dxs = (x1 - x0) / (nx - 1 || 1), dys = (y1 - y0) / (ny - 1 || 1);
  for (let n = 0; n < N; n++) {
    const sx = on[n].x, sy = on[n].y, off = n * P;
    for (let j = 0; j < ny; j++) {
      const y = y1 - j * dys, dy = y - sy;
      for (let i = 0; i < nx; i++) {
        const dx = x0 + i * dxs - sx;
        dist[off + j * nx + i] = Math.max(Math.sqrt(dx * dx + dy * dy), 0.2);
      }
    }
  }
  let imgs = null;
  if (room && room.segs && room.order) {
    const pts = new Float64Array(P * 2), dxs2 = (x1 - x0) / (nx - 1 || 1), dys2 = (y1 - y0) / (ny - 1 || 1);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { pts[2 * (j * nx + i)] = x0 + i * dxs2; pts[2 * (j * nx + i) + 1] = y1 - j * dys2; }
    const xy = new Float64Array(N * 2); on.forEach((s, i) => { xy[2 * i] = s.x; xy[2 * i + 1] = s.y; });
    imgs = SG.reflections(xy, pts, room.segs, room.order);
  }
  const re = new Float64Array(P), im = new Float64Array(P);
  for (let f = 0; f < F; f++) {
    re.fill(0); im.fill(0);
    const k = -TAU * freqs[f] / c;
    for (let n = 0; n < N; n++) {
      const wr = W.re[f * N + n], wi = W.im[f * N + n], off = n * P;
      for (let p = 0; p < P; p++) {
        const d = dist[off + p], ph = k * d;
        const cr = Math.cos(ph) / d, ci = Math.sin(ph) / d;
        re[p] += wr * cr - wi * ci; im[p] += wr * ci + wi * cr;
      }
    }
    if (imgs) for (const img of imgs) {
      const n = img.n, wr = W.re[f * N + img.n], wi = W.im[f * N + img.n];
      for (let p = 0; p < P; p++) {
        const w = img.W[p]; if (!w) continue;
        const d = Math.max(img.D[p], 0.2), ph = k * d, cr = w * Math.cos(ph) / d, ci = w * Math.sin(ph) / d;
        re[p] += wr * cr - wi * ci; im[p] += wr * ci + wi * cr;
      }
    }
    for (let p = 0; p < P; p++) pow[p] += re[p] * re[p] + im[p] * im[p];
  }
  for (let p = 0; p < P; p++) out[p] = 10 * Math.log10(pow[p] / F + 1e-24);
  return out;
};

/** directivity map: rows = freqs, cols = angles; dB re on-axis per frequency */
SG.directivityMap = function (srcs, freqs, c, anglesDeg) {
  const L = SG.polarDb(srcs, freqs, c, anglesDeg, 100);
  const A = anglesDeg.length, i0 = anglesDeg.indexOf(0);
  const out = new Float32Array(L.length);
  for (let i = 0; i < freqs.length; i++) {
    const on = L[i * A + (i0 >= 0 ? i0 : Math.floor(A / 2))];
    for (let a = 0; a < A; a++) out[i * A + a] = L[i * A + a] - on;
  }
  return out;
};

/* ---------- channels ---------- */
/** give boxes with identical DSP settings the same channel (like templates.assign_channels) */
SG.assignChannels = function (srcs, start) {
  start = start || 1;
  const keys = new Map();
  srcs.forEach(s => {
    const k = [s.delay_ms.toFixed(3), s.gain_db.toFixed(2), s.polarity, (+s.ap_f).toFixed(1), (+s.ap_q).toFixed(2), (+s.lp_f).toFixed(1)].join('|');
    if (!keys.has(k)) keys.set(k, start + keys.size);
    s.channel = keys.get(k);
  });
  return start + keys.size;
};

/** zero the smallest delay (DSP friendly) */
SG.normalizeDelays = function (srcs) {
  const on = srcs.filter(s => s.enabled);
  if (!on.length) return;
  const m = Math.min(...on.map(s => s.delay_ms));
  srcs.forEach(s => { s.delay_ms = Math.round((s.delay_ms - m) * 1000) / 1000; });
};

