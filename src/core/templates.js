/* SubGrid — templates + knowledge cards */
import SG from './engine.js';


const D2R = Math.PI / 180;
const f2 = v => (Math.round(v * 100) / 100).toFixed(2).replace('.', ',');
const f1 = v => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',');
const f0 = v => String(Math.round(v));
const S = o => SG.makeSource(o);
const ms = (dist, c) => dist / c * 1000;
const fv = (v, u) => `<span class="fv">${v}${u ? ' ' + u : ''}</span>`;

const T = SG.TEMPLATES = {};

T.single = {
  name: 'Mono-Stack', cat: 'Basis', chans: '1',
  params: [{ k: 'h', label: 'Boxen im Stack', min: 1, max: 6, step: 1, def: 2 }],
  build(p) {
    const out = []; for (let i = 0; i < p.h; i++) out.push(S({ x: 0, y: 0, channel: 1 }));
    return { srcs: out, calc: [`${p.h} Boxen gestapelt: ${fv('+' + f1(20 * Math.log10(p.h)), 'dB')} vorne (Kopplung, 20·log n)`, 'Rundstrahlend – keine Richtwirkung im Bass.'] };
  },
};

T.broadside = {
  name: 'Linie (Broadside)', cat: 'Basis', chans: '1',
  params: [
    { k: 'n', label: 'Stacks', min: 2, max: 16, step: 1, def: 4 },
    { k: 'h', label: 'Boxen pro Stack', min: 1, max: 4, step: 1, def: 1 },
    { k: 's', label: 'Abstand', unit: 'm', min: 0.6, max: 6, step: 0.05, def: e => Math.max(e.w, Math.round(e.c / e.fHi / 2 * 20) / 20) },
  ],
  build(p, e) {
    const out = [], x0 = -(p.n - 1) * p.s / 2;
    for (let i = 0; i < p.n; i++) for (let k = 0; k < p.h; k++) out.push(S({ x: x0 + i * p.s, y: 0, channel: 1 }));
    const lam = e.c / e.fHi, L = (p.n - 1) * p.s;
    const warn = p.s > lam ? [`Abstand > λ bei ${f0(e.fHi)} Hz (${f2(lam)} m): Nebenkeulen im oberen Band.`] : [];
    return { srcs: out, warn, calc: [
      `Länge L = (n − 1)·s = ${fv(f2(L), 'm')}`,
      `λ bei f<sub>max</sub> ${f0(e.fHi)} Hz = c/f = ${fv(f2(lam), 'm')} → Abstand ≤ λ, besser ≤ λ/2 = ${fv(f2(lam / 2), 'm')}`,
      `Bündelung: je länger die Linie im Verhältnis zu λ, desto schmaler der Strahl. Bei ${f0(e.fC)} Hz ist L/λ = ${fv(f2(L / (e.c / e.fC)))}`,
    ] };
  },
};

T.arcdelay = {
  name: 'Delay-Arc', cat: 'Abdeckung', chans: 'n/2',
  params: [
    { k: 'n', label: 'Stacks', min: 3, max: 16, step: 1, def: 6 },
    { k: 'h', label: 'Boxen pro Stack', min: 1, max: 4, step: 1, def: 1 },
    { k: 's', label: 'Abstand', unit: 'm', min: 0.6, max: 5, step: 0.05, def: 1.4 },
    { k: 'phi', label: 'Bogenwinkel', unit: '°', min: 10, max: 175, step: 5, def: 90 },
  ],
  build(p, e) {
    const out = [], x0 = -(p.n - 1) * p.s / 2, L = (p.n - 1) * p.s;
    const R = L / (2 * Math.sin(p.phi * D2R / 2));
    const lines = [`Radius R = L / (2·sin(φ/2)) = ${fv(f2(L), 'm')} / (2·sin ${p.phi / 2}°) = ${fv(f2(R), 'm')}`, 'Delay je Stack t = (R − √(R² − x²)) / c:'];
    for (let i = 0; i < p.n; i++) {
      const x = x0 + i * p.s, t = ms(R - Math.sqrt(Math.max(0, R * R - x * x)), e.c);
      for (let k = 0; k < p.h; k++) out.push(S({ x, y: 0, delay_ms: Math.round(t * 100) / 100 }));
      if (i >= (p.n - 1) / 2) lines.push(`&nbsp;&nbsp;x = ±${f2(Math.abs(x))} m → ${fv(f2(t), 'ms')}`);
    }
    SG.assignChannels(out);
    return { srcs: out, calc: lines };
  },
};

T.arcphys = {
  name: 'Bogen (physisch)', cat: 'Abdeckung', chans: '1',
  params: [
    { k: 'n', label: 'Stacks', min: 3, max: 16, step: 1, def: 6 },
    { k: 'h', label: 'Boxen pro Stack', min: 1, max: 4, step: 1, def: 1 },
    { k: 'R', label: 'Radius', unit: 'm', min: 1, max: 40, step: 0.5, def: 6 },
    { k: 'phi', label: 'Bogenwinkel', unit: '°', min: 10, max: 180, step: 5, def: 60 },
  ],
  build(p, e) {
    const out = [], step = p.n > 1 ? p.phi / (p.n - 1) : 0;
    for (let i = 0; i < p.n; i++) {
      const t = (i - (p.n - 1) / 2) * step;
      for (let k = 0; k < p.h; k++) out.push(S({ x: p.R * Math.sin(t * D2R), y: p.R * Math.cos(t * D2R) - p.R, rot_deg: (-t + 360) % 360, channel: 1 }));
    }
    const chord = 2 * p.R * Math.sin(step * D2R / 2), sag = p.R * (1 - Math.cos(p.phi / 2 * D2R));
    return { srcs: out, calc: [`Abstand entlang Bogen = 2R·sin(Δφ/2) = ${fv(f2(chord), 'm')}`, `Tiefe des Bogens (Stich) = R·(1 − cos φ/2) = ${fv(f2(sag), 'm')}`, 'Kein Delay nötig – Abdeckung ≈ Bogenwinkel, solange die Linie im Verhältnis zu λ lang ist.'],
      warn: chord < e.w ? ['Boxen überlappen – Radius größer oder Winkel kleiner.'] : [] };
  },
};

T.split = {
  name: 'Split L/R', cat: 'Basis', chans: '1',
  params: [
    { k: 'n', label: 'Boxen pro Seite', min: 1, max: 8, step: 1, def: 2 },
    { k: 'X', label: 'Abstand der Seiten', unit: 'm', min: 2, max: 30, step: 0.5, def: 12 },
  ],
  build(p, e) {
    const out = [];
    for (const sgn of [-1, 1]) for (let i = 0; i < p.n; i++) out.push(S({ x: sgn * p.X / 2, y: 0, channel: 1 }));
    const lamC = e.c / e.fC;
    return { srcs: out, calc: [`Abstand ${fv(f1(p.X), 'm')} = ${fv(f1(p.X / lamC), 'λ')} bei ${f0(e.fC)} Hz`, 'In der Mitte: beide Seiten gleich weit → +6 dB „Power Alley“.', `Daneben Auslöschungen, erste bei Wegunterschied λ/2 – bei ${f0(e.fC)} Hz schon ${fv(f2(lamC / 2), 'm')} Wegdifferenz.`] };
  },
};

T.cardstack = {
  name: 'Cardioid-Stack', cat: 'Richtwirkung', chans: '2',
  params: [
    { k: 'n', label: 'Stacks', min: 1, max: 12, step: 1, def: 3 },
    { k: 'hf', label: 'Boxen vorne', min: 1, max: 3, step: 1, def: 2 },
    { k: 's', label: 'Abstand', unit: 'm', min: 0.6, max: 5, step: 0.05, def: 1.2 },
  ],
  build(p, e) {
    const out = [], x0 = -(p.n - 1) * p.s / 2, t = ms(e.d, e.c);
    for (let i = 0; i < p.n; i++) {
      for (let k = 0; k < p.hf; k++) out.push(S({ x: x0 + i * p.s, y: 0, channel: 1 }));
      out.push(S({ x: x0 + i * p.s, y: -e.d, rot_deg: 180, delay_ms: Math.round(t * 100) / 100, polarity: -1, channel: 2 }));
    }
    return { srcs: out, calc: [
      `Rückbox gedreht, Abstand der Membranen = Boxtiefe d = ${fv(f2(e.d), 'm')}`,
      `Delay Rückbox = d / c = ${f2(e.d)} / ${f1(e.c)} = ${fv(f2(t), 'ms')} · Polarität ${fv('invertiert')}`,
      `Hinten treffen vordere und hintere Box gleichzeitig und gegenphasig ein → Auslöschung.`,
      p.hf > 1 ? `${p.hf}:1 – die Rückbox kann ${p.hf} Boxen nicht vollständig auslöschen, vorne aber mehr Pegel.` : '1:1 – maximale Auslöschung hinten.',
    ] };
  },
};

T.cardinline = {
  name: 'Cardioid hintereinander', cat: 'Richtwirkung', chans: '2',
  params: [
    { k: 'n', label: 'Paare nebeneinander', min: 1, max: 12, step: 1, def: 2 },
    { k: 'f', label: 'Zielfrequenz', unit: 'Hz', min: 30, max: 150, step: 1, def: e => Math.round(e.fC) },
    { k: 'D', label: 'Abstand vorne–hinten', unit: 'm', min: 0.5, max: 4, step: 0.01, def: e => Math.round(e.c / 4 / e.fC * 100) / 100, hint: 'λ/4 der Zielfrequenz', link: 'f' },
    { k: 's', label: 'Abstand der Paare', unit: 'm', min: 0.6, max: 5, step: 0.05, def: 1.5 },
  ],
  linked(p, e, changed) { if (changed === 'f') p.D = Math.round(e.c / 4 / p.f * 100) / 100; },
  build(p, e) {
    const out = [], x0 = -(p.n - 1) * p.s / 2, t = ms(p.D, e.c);
    for (let i = 0; i < p.n; i++) {
      out.push(S({ x: x0 + i * p.s, y: 0, channel: 1 }));
      out.push(S({ x: x0 + i * p.s, y: -p.D, delay_ms: Math.round(t * 100) / 100, polarity: -1, channel: 2 }));
    }
    const fq = e.c / 4 / p.D;
    return { srcs: out, warn: p.D < e.d ? ['Abstand kleiner als Boxtiefe – Boxen überlappen.'] : [], calc: [
      `λ/4 bei ${f0(p.f)} Hz = c / (4·f) = ${fv(f2(e.c / 4 / p.f), 'm')}`,
      `Delay hinten = D / c = ${fv(f2(t), 'ms')} · Polarität ${fv('invertiert')}`,
      `Vorne maximale Summe bei ${fv(f0(fq), 'Hz')}, Auslöschung vorne bei ${fv(f0(2 * fq), 'Hz')} (D = λ/2).`,
      'Unterhalb verliert die Anordnung vorne Pegel (6 dB/Oktave) – das ist der Preis für die Rückwärtsdämpfung.',
    ] };
  },
};

T.endfire = {
  name: 'End-Fire', cat: 'Richtwirkung', chans: 'Reihen',
  params: [
    { k: 'R', label: 'Reihen', min: 2, max: 8, step: 1, def: 4 },
    { k: 'n', label: 'Spalten', min: 1, max: 8, step: 1, def: 1 },
    { k: 'D', label: 'Reihenabstand', unit: 'm', min: 0.6, max: 4, step: 0.01, def: e => Math.max(e.d, Math.round(e.c / 4 / e.fC * 100) / 100) },
    { k: 's', label: 'Spaltenabstand', unit: 'm', min: 0.6, max: 5, step: 0.05, def: 1.4 },
  ],
  build(p, e) {
    const out = [], t = ms(p.D, e.c), x0 = -(p.n - 1) * p.s / 2;
    const lines = [`Δt = D / c = ${f2(p.D)} / ${f1(e.c)} = ${fv(f2(t), 'ms')} pro Reihe`];
    for (let r = 0; r < p.R; r++) {
      const dl = (p.R - 1 - r) * t;
      for (let i = 0; i < p.n; i++) out.push(S({ x: x0 + i * p.s, y: -r * p.D, delay_ms: Math.round(dl * 100) / 100, channel: r + 1 }));
      lines.push(`&nbsp;&nbsp;Reihe ${r + 1}${r === 0 ? ' (vorne)' : r === p.R - 1 ? ' (hinten)' : ''}: ${fv(f2(dl), 'ms')}`);
    }
    lines.push('Vorderste Reihe = meistes Delay, hinterste = 0 ms: alle Wellen laufen nach vorne gemeinsam los.');
    lines.push(`Gesamttiefe ${fv(f2((p.R - 1) * p.D), 'm')} · Rückwärtsdämpfung frequenzabhängig.`);
    return { srcs: out, calc: lines };
  },
};

T.efcard = {
  name: 'End-Fire-Cardioid', cat: 'Richtwirkung', chans: '2×Paare',
  params: [
    { k: 'pairs', label: 'Cardioid-Paare', min: 2, max: 4, step: 1, def: 2 },
    { k: 'd', label: 'Abstand im Paar', unit: 'm', min: 0.5, max: 2, step: 0.01, def: e => Math.max(e.d, 0.8) },
    { k: 'D', label: 'Abstand der Paare', unit: 'm', min: 1, max: 5, step: 0.05, def: 2.5 },
  ],
  build(p, e) {
    const out = [], tD = ms(p.D, e.c), td = ms(p.d, e.c);
    for (let k = 0; k < p.pairs; k++) {
      const ex = (p.pairs - 1 - k) * tD;
      out.push(S({ x: 0, y: -k * p.D, delay_ms: Math.round(ex * 100) / 100 }));
      out.push(S({ x: 0, y: -k * p.D - p.d, delay_ms: Math.round((ex + td) * 100) / 100, polarity: -1 }));
    }
    SG.assignChannels(out);
    return { srcs: out, calc: [`Im Paar: ${fv(f2(td), 'ms')} + invertiert (Cardioid)`, `Zwischen den Paaren: ${fv(f2(tD), 'ms')} (End-Fire)`, 'Kombiniert starke Vorwärtsbündelung mit breitbandiger Rückwärtsdämpfung.'] };
  },
};

T.grad2 = {
  name: 'Gradient 2. Ordnung', cat: 'Richtwirkung', chans: '4',
  params: [
    { k: 'd', label: 'Abstand im Paar', unit: 'm', min: 0.5, max: 2, step: 0.01, def: 0.8 },
    { k: 'D', label: 'Abstand der Paare', unit: 'm', min: 0.5, max: 3, step: 0.01, def: 0.8 },
  ],
  build(p, e) {
    const td = ms(p.d, e.c), tD = ms(p.D, e.c);
    const out = [S({ x: 0, y: 0 }), S({ x: 0, y: -p.d, delay_ms: r(td), polarity: -1 }),
      S({ x: 0, y: -p.D, delay_ms: r(tD), polarity: -1 }), S({ x: 0, y: -p.D - p.d, delay_ms: r(tD + td), polarity: 1 })];
    SG.assignChannels(out);
    return { srcs: out, calc: ['Cardioid-Paar minus verzögertes Cardioid-Paar.', 'Sehr starke Richtwirkung, aber 12 dB/Oktave Pegelverlust zu tiefen Frequenzen – eher Lehrbeispiel.'] };
  },
};
function r(v) { return Math.round(v * 100) / 100; }

T.beam = {
  name: 'Beam Steering', cat: 'Abdeckung', chans: 'n',
  params: [
    { k: 'n', label: 'Stacks', min: 2, max: 12, step: 1, def: 6 },
    { k: 's', label: 'Abstand', unit: 'm', min: 0.6, max: 4, step: 0.05, def: 1.2 },
    { k: 'th', label: 'Steer-Winkel', unit: '°', min: -60, max: 60, step: 1, def: 20, hint: '+ = rechts, − = links' },
  ],
  build(p, e) {
    const out = [], x0 = -(p.n - 1) * p.s / 2, sn = Math.sin(p.th * D2R);
    const inc = ms(p.s * sn, e.c);
    const raw = []; for (let i = 0; i < p.n; i++) raw.push(i * inc);
    const m = Math.min(...raw);
    for (let i = 0; i < p.n; i++) out.push(S({ x: x0 + i * p.s, y: 0, delay_ms: r(raw[i] - m), channel: i + 1 }));
    const lamMin = e.c / e.fHi, sMax = lamMin / (1 + Math.abs(sn));
    return { srcs: out, warn: p.s > sMax ? [`Abstand > ${f2(sMax)} m: Grating Lobes (Nebenkeulen) bei ${f0(e.fHi)} Hz.`] : [], calc: [
      `Δt = s·sin θ / c = ${f2(p.s)}·sin ${p.th}° / ${f1(e.c)} = ${fv(f2(Math.abs(inc)), 'ms')} pro Stack`,
      `Gesamt-Delay ${fv(f2(Math.abs(inc) * (p.n - 1)), 'ms')} über die Linie`,
      `Grating-Lobe-Grenze: s ≤ λ<sub>min</sub> / (1 + |sin θ|) = ${fv(f2(sMax), 'm')}`,
    ] };
  },
};

SG.TEMPLATE_ORDER = ['single', 'broadside', 'split', 'arcdelay', 'arcphys', 'beam', 'cardstack', 'cardinline', 'endfire', 'efcard', 'grad2'];

SG.templateDefaults = function (id, env) {
  const p = {};
  T[id].params.forEach(q => { p[q.k] = typeof q.def === 'function' ? q.def(env) : q.def; });
  return p;
};

/* ---------- knowledge cards ---------- */
SG.KNOW = [
  { id: 'broadside', tpl: 'broadside', title: 'Broadside-Linie', chans: '1 Kanal',
    idea: 'Boxen nebeneinander, alle gleich angesteuert. Im Bass addieren sich nah stehende Boxen fast perfekt (+6 dB pro Verdopplung).',
    plus: ['Maximaler Pegel nach vorne', 'Kein DSP nötig', 'Gleichmäßig in der Tiefe'],
    minus: ['Keine Rückwärtsdämpfung', 'Lange Linie = schmaler Strahl, Nebenkeulen bei großem Abstand'],
    rule: 'Abstand ≤ λ bei der höchsten Frequenz (besser λ/2).' },
  { id: 'arcdelay', tpl: 'arcdelay', title: 'Delay-Arc', chans: '≈ n/2 Kanäle',
    idea: 'Gerade Linie, aber die äußeren Boxen bekommen mehr Delay, als stünden sie auf einem Bogen. Die Wellenfront wird gekrümmt.',
    plus: ['Breite, gleichmäßige Abdeckung', 'Boxen bleiben in einer Reihe (z. B. vor der Bühne)'],
    minus: ['Braucht mehrere DSP-Kanäle', 'Etwas weniger Pegel auf der Mittelachse'],
    rule: 't = (R − √(R² − x²)) / c,  R = L / (2·sin(φ/2))' },
  { id: 'arcphys', tpl: 'arcphys', title: 'Physischer Bogen', chans: '1 Kanal',
    idea: 'Die Boxen stehen wirklich auf einem Kreisbogen und zeigen nach außen.',
    plus: ['Breite Abdeckung ohne Delays', 'Funktioniert ohne DSP'],
    minus: ['Braucht Tiefe', 'Schwer vor einer geraden Bühnenkante aufzubauen'],
    rule: 'Abdeckung ≈ Bogenwinkel, wenn die Linie lang im Verhältnis zu λ ist.' },
  { id: 'split', tpl: 'split', title: 'Split L/R', chans: '1 Kanal',
    idea: 'Je eine Gruppe links und rechts, meist unter den Tops an den Bühnenkanten.',
    plus: ['Mitte bleibt frei', 'Einfach aufzubauen'],
    minus: ['„Power Alley“: +6 dB auf der Mittelachse', 'Daneben Kammfilter mit starken Auslöschungen'],
    rule: 'Je größer der Abstand im Verhältnis zu λ, desto dichter liegen die Auslöschungen.' },
  { id: 'cardstack', tpl: 'cardstack', title: 'Cardioid-Stack', chans: '2 Kanäle',
    idea: 'Im Stapel zeigt eine Box nach hinten. Sie bekommt das Delay der Boxtiefe und die invertierte Polarität.',
    plus: ['Starke Rückwärtsdämpfung (Bühne leiser)', 'Kompakt, kaum Tiefe nötig'],
    minus: ['Pegelverlust gegenüber gleich vielen Boxen nach vorne', 'Braucht 2 Kanäle mit Delay'],
    rule: 'Delay = Boxtiefe / c, Rückbox invertiert.' },
  { id: 'cardinline', tpl: 'cardinline', title: 'Cardioid hintereinander (Gradient)', chans: '2 Kanäle',
    idea: 'Zwei Boxen hintereinander, beide nach vorne. Die hintere wird um die Laufzeit verzögert und invertiert.',
    plus: ['Breitbandige Rückwärtsdämpfung', 'Abstand frei wählbar (λ/4 der Zielfrequenz)'],
    minus: ['Pegelverlust zu tiefen Frequenzen (6 dB/Okt.)', 'Auslöschung vorne bei D = λ/2'],
    rule: 'D = λ/4 der Zielfrequenz, Delay = D / c, hintere Box invertiert.' },
  { id: 'endfire', tpl: 'endfire', title: 'End-Fire', chans: '1 Kanal pro Reihe',
    idea: 'Reihen hintereinander. Die vorderste Reihe wartet am längsten, bis die Welle der hinteren Reihen ankommt.',
    plus: ['Volle Summe nach vorne', 'Starke Bündelung'],
    minus: ['Rückwärtsdämpfung schwankt stark über die Frequenz', 'Viel Tiefe und viele Kanäle'],
    rule: 'Δt = D / c pro Reihe – vorne das meiste Delay, hinten 0 ms.' },
  { id: 'beam', tpl: 'beam', title: 'Beam Steering', chans: '1 Kanal pro Stack',
    idea: 'Ein linear ansteigendes Delay über die Linie dreht den Strahl zur Seite.',
    plus: ['Strahl lässt sich ohne Umbauen schwenken', 'Gut für asymmetrische Flächen'],
    minus: ['Viele Kanäle', 'Grating Lobes bei zu großem Abstand'],
    rule: 'Δt = s·sin θ / c,  s ≤ λmin / (1 + |sin θ|)' },
];


export const TEMPLATES = SG.TEMPLATES, TEMPLATE_ORDER = SG.TEMPLATE_ORDER, KNOW = SG.KNOW;
export const templateDefaults = SG.templateDefaults;
