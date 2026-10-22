import { LiveOptimizer } from '../src/core/live.js';
import { zonesFromGoal } from '../src/core/families.js';
const base = {boxes:8, channels:4, maxStack:2, dsp:'full', band:[40,100], temp:20, RH:0, box_w:0.6, box_d:0.8,
   audAngle:100, audR1:5, audR2:30, quietOn:true, quietAngle:110, quietR1:1.5, quietR2:10, quietTarget:-15,
   placeW:12, placeD:3, gap:0, priority:'balanced', robust:true, seed: 7};
function run(label, zones, goal, secs, verbose){
  const o = new LiveOptimizer(zones, goal); const t0=Date.now(); let last='';
  while ((Date.now()-t0)/1000 < secs) { o.step(50); const s=o.snapshot(); const tag=s.stage+s.round; if(tag!==last){ last=tag; console.log(`  t=${((Date.now()-t0)/1000).toFixed(1)}s ${s.stage} r${s.round} evals=${s.evals} active=${s.counts.race}/${s.counts.final} out=${s.counts.out} best=${s.bestCost!=null?s.bestCost.toFixed(2):'-'}`);} if (s.phase==='done') break; }
  const s=o.snapshot(); console.log('== '+label+' approaches', s.counts.total, 'evals', s.evals, 'stage', s.stage);
  s.results.slice(0,6).forEach(r=>console.log(`   ${r.cost.toFixed(2)} ${r.label} [${r.variant}] ${r.status} ch${r.channels} n${r.nBoxes}`));
  if (verbose) s.protocol.forEach(p=>console.log(`     ${p.status.padEnd(6)} ${(p.cost!=null?p.cost.toFixed(2):'-').padStart(6)} ${p.famLabel} · ${p.label} ${p.why}`));
  console.log('   skipped', s.skipped.map(x=>x.fam+': '+x.why).join(' | '));
  return {o,s};
}
const a = run('Festival default', zonesFromGoal(base), base, 12, true);
// determinism: same seed, fixed eval count
function evalsTo(goal, n){ const o=new LiveOptimizer(zonesFromGoal(goal), goal); while(o.evals<n) o.step(5); return o.snapshot().bestCost; }
console.log('determinism', evalsTo(base, 600), evalsTo(base, 600));
// with stage + walls
const g2 = Object.assign({}, base, {stageW: 10, stageD: 6, stageTarget: -10, walls: [{p:[-15,-8,15,-8], loss: 3},{p:[-15,-8,-15,30], loss: 1},{p:[15,-8,15,30], loss: 1}], reflOrder: 1});
run('Stage + back wall', zonesFromGoal(g2), g2, 8);
// steered audience (offset to the right)
const g3 = Object.assign({}, base, {quietOn:false});
const z3 = zonesFromGoal(g3).map(z=> z.kind==='audience' && z.shape==='sector' ? Object.assign({}, z, {p:[z.p[0],z.p[1],z.p[2],z.p[3],z.p[4]-35,z.p[5]-35]}) : z);
run('Audience steered 35°', z3, g3, 8);
