import SG from '../src/core/engine.js';
import fs from 'fs';
const ref = JSON.parse(fs.readFileSync('walls_ref.json'));
const src=[SG.makeSource({x:-1,y:0}),SG.makeSource({x:1,y:0,gain_db:-2}),SG.makeSource({x:0,y:-1,delay_ms:2.9,polarity:-1})];
const walls=[{p:[-8,-4,8,-4],loss:1.0},{p:[-8,-4,-8,20,0,26],loss:3.0}];
const segs=SG.wallSegments(walls), c=SG.speedOfSound(20,0);
const pts=Float64Array.from([0,10,5,15,-6,8,3,-2,-7,0,0,25]);
for (const order of [1,2]) {
  const p=SG.pressure(src,pts,[40,63,100],c,0.2,{segs,order}); let md=0;
  ref['p'+order].forEach((row,i)=>row.forEach(([r,im],j)=>{ md=Math.max(md,Math.abs(r-p.re[i*6+j]),Math.abs(im-p.im[i*6+j])); }));
  console.log('order',order,'max abs diff',md.toExponential(2));
}
const sc=new SG.Scorer(ref.zones,{band:[31.5,100],temps:[20],RH:0,walls,refl_order:2});
sc.A=Float64Array.from(ref.A.flat()); sc.Q=Float64Array.from(ref.Q.flat()); sc.St=new Float64Array(0);
sc.nA=ref.A.length; sc.nQ=ref.Q.length; sc.nS=0; sc.P=sc.nA+sc.nQ; sc.pts=new Float64Array(sc.P*2); sc.pts.set(sc.A,0); sc.pts.set(sc.Q,sc.A.length);
console.log('JS', sc.assess(src)); console.log('PY', ref.cost, ref.sum);
