/* SubGrid — editions: Lite (open directly: HTML / portable exe) and Studio (installer, full scope) */
import { edition } from './platform.js';
import { toast } from './util.js';

export const STUDIO_ONLY = {
  walls: 'Wände & Reflexionen',
  plan: 'Hallenplan als Hintergrund',
  families: 'Topologien gezielt an-/abwählen',
  thorough: 'Gründliche Suche',
};
export const studio = () => edition() === 'studio';
export const can = f => studio() || !STUDIO_ONLY[f];
export function needStudio(f) {
  if (can(f)) return false;
  toast(`${STUDIO_ONLY[f] || 'Diese Funktion'} gibt's in SubGrid Studio (Installer-Version).`);
  return true;
}
