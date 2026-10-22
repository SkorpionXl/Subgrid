/* SubGrid — optimizer runner: same message protocol inside a Web Worker or inline (fallback) */
import { LiveOptimizer, SetupOptimizer } from './live.js';

const tick = () => new Promise(r => setTimeout(r, 0));
export function createRunner(post) {
  let token = 0, opt = null;
  async function loop(my, m) {
    let last = 0;
    const stopAfter = m.stopAfter || 60;
    while (my === token) {
      opt.step(m.inline ? 14 : 32);
      const t = (typeof performance !== 'undefined' ? performance.now() : Date.now());
      if (t - last > 280) { last = t; post(Object.assign({ type: 'status', running: true }, opt.snapshot())); }
      if ((opt.phase !== 'seed' && opt.sinceImprove() > stopAfter) || opt.phase === 'done') {
        token++; post(Object.assign({ type: 'status', running: false, converged: true }, opt.snapshot())); return;
      }
      await tick();
    }
  }
  return function onMessage(m) {
    if (m.type === 'start') {
      token++; const my = token;
      try { opt = m.mode === 'setup' ? new SetupOptimizer(m.zones, m.goal, m.sources, m.opts) : new LiveOptimizer(m.zones, m.goal); }
      catch (e) { post({ type: 'error', msg: e && e.message ? e.message : String(e) }); return; }
      post(Object.assign({ type: 'status', running: true }, opt.snapshot()));
      loop(my, m);
    } else if (m.type === 'stop') {
      token++;
      if (opt) post(Object.assign({ type: 'status', running: false, stopped: true }, opt.snapshot()));
    }
  };
}
