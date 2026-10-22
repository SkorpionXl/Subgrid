/* SubGrid — Web Worker entry: runs the live optimizer off the UI thread */
import { createRunner } from './core/runner.js';
const onMessage = createRunner(msg => self.postMessage(msg));
self.onmessage = e => onMessage(e.data);
