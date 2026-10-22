import SG from '../src/core/engine.js';
import { LiveOptimizer, SetupOptimizer } from '../src/core/live.js';
import { zonesFromGoal } from '../src/core/families.js';
const base = {boxes:8, channels:4, maxStack:2, dsp:'full', band:[40,100], temp:20, RH:0, box_w:0.6, box_d:0.8,
   audAngle:100, audR1:5, audR2:30, quietOn:true, quietAngle:110, quietR1:1.5, quietR2:10, quietTarget:-15,
   placeW:12, placeD:3, gap:0, priority:'balanced', robust:true};
function run(label, zones, goal, secs){
  const o = new LiveOptimizer(zones, goal); const t0=Date.now(); let marks=[2,5,10,20].filter(s=>s<=secs);
  while ((Date.now()-t0)/1000 < secs) { o.step(50); const t=(Date.now()-t0)/1000; if (marks.length && t>=marks[0]) { marks.shift(); const s=o.snapshot(); console.log(`  t=${t.toFixed(0)}s phase=${s.phase} evals=${s.evals} best=${s.results[0]?s.results[0].cost.toFixed(2)+' '+s.results[0].label:'-'}`);} }
  const s=o.snapshot(); console.log('== '+label+' aim', s.aim, 'thetaHalf', s.thetaHalf.toFixed(0));
  s.results.forEach(r=>console.log(`   ${r.cost.toFixed(2)} ${r.label} ch${r.channels} σ${r.summary.spread.toFixed(1)} rej${r.summary.rej!=null?r.summary.rej.toFixed(1):'-'} eff${r.summary.eff.toFixed(1)}`));
  return s;
}
const s1 = run('Festival default', zonesFromGoal(base), base, 3);
console.log('   free explain:', (s1.results.find(r=>r.fam==='free')||{explain:['-']}).explain.slice(0,2).join(' | '));
// rotated: stage on the left, audience to the right (+x)
const rot = zonesFromGoal(base).map(z=>{ const p=z.p.slice(); if (z.shape==='sector'){p[4]+=90;p[5]+=90; return {...z,p};} if(z.shape==='rect'){ const [x0,y0,x1,y1]=p; return {...z,p:[y0,-x1,y1,-x0]}; } return z;});
const s2 = run('Rotated 90° (audience +x)', rot, base, 6);
const b = s2.results[0].srcs; console.log('   rot of boxes', [...new Set(b.map(s=>Math.round(s.rot_deg)))], 'x range', Math.min(...b.map(s=>s.x)).toFixed(2), Math.max(...b.map(s=>s.x)).toFixed(2));
// setup mode
const srcs=[SG.makeSource({x:-1,y:0,channel:1}),SG.makeSource({x:1,y:0,channel:1}),SG.makeSource({x:-1,y:-1,channel:2,delay_ms:0.5}),SG.makeSource({x:1,y:-1,channel:2,delay_ms:0.5, pinned:true})];
const so = new SetupOptimizer(zonesFromGoal(base), base, srcs, {move:true}); const t0=Date.now(); while(Date.now()-t0<4000) so.step(50);
const ss=so.snapshot(); console.log('== setup: cost0', ss.cost0.toFixed(2), '-> best', ss.bestCost.toFixed(2), 'evals', ss.evals, 'movable', ss.movable);
ss.result.srcs.forEach(s=>console.log('   ', s.x.toFixed(2), s.y.toFixed(2), 'ch', s.channel, s.delay_ms.toFixed(2), s.gain_db.toFixed(1), s.polarity));
