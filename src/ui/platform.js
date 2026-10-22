/* SubGrid — platform layer: the Windows app (local HTTP API of SubGrid.exe, in its own window
   or as browser fallback) or a plain browser / artifact */
import { toast, showText } from './util.js';

/* the desktop app serves the page at http://127.0.0.1:<port>/s/<secret>/ */
const DESK = /^\/s\/[A-Za-z0-9_-]{16,}\//.test(location.pathname) && /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
export const isExe = () => DESK;
/* build-time edition of the HTML file; the desktop app reports its own */
// eslint-disable-next-line no-undef
let EDITION = typeof __EDITION__ !== 'undefined' ? __EDITION__ : 'studio';
export const edition = () => EDITION;
export let desktop = null;      // {edition, version, mode: 'webview'|'browser', file?}
const LS_KEY = 'subgrid2-state-v2';

async function api(path, body, method) {
  const opt = { method: method || (body !== undefined ? 'POST' : 'GET'), cache: 'no-store' };
  if (body !== undefined) { opt.body = typeof body === 'string' ? body : JSON.stringify(body); opt.headers = { 'Content-Type': 'application/json' }; }
  const r = await fetch('api/' + path, opt);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const ct = r.headers.get('content-type') || '';
  return ct.includes('json') ? r.json() : r.text();
}

/** call once at boot (before loadState) */
export async function initPlatform() {
  if (!DESK) return null;
  try { desktop = await api('info'); } catch (e) { desktop = { mode: 'browser' }; }
  if (desktop && desktop.edition) EDITION = desktop.edition;
  const ping = () => api('ping', {}).catch(() => {});
  setInterval(ping, 5000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ping(); });
  window.addEventListener('pagehide', () => { try { navigator.sendBeacon('api/bye', ''); } catch (e) { /* ignore */ } });
  const report = msg => { try { navigator.sendBeacon('api/log', String(msg).slice(0, 4000)); } catch (e) { /* ignore */ } };
  window.addEventListener('error', e => report('JS-Fehler: ' + e.message + ' @ ' + (e.filename || '').split('/').pop() + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => report('Promise: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason)));
  return desktop;
}
/** tell the desktop app the page is up (its selftest and crash detection wait for this) */
export function notifyReady() { if (DESK) api('ready', {}).catch(() => {}); }
/** project file the app was started with (double-click on a .subgrid file), once */
export function startupFile() { const f = desktop && desktop.file; if (desktop) desktop.file = null; return f && f.text ? f : null; }

function utf8ToB64(s) {
  const bytes = new TextEncoder().encode(s); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer()); let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function loadState() {
  try {
    if (DESK) { const s = await api('state'); return s && typeof s === 'object' ? s : null; }
    return JSON.parse(localStorage.getItem(LS_KEY) || 'null');
  } catch (e) { return null; }
}
let saveT = 0, pending = null;
export function saveState(obj) {
  pending = obj; clearTimeout(saveT);
  saveT = setTimeout(async () => {
    const txt = JSON.stringify(pending);
    try {
      if (DESK) await api('state', txt, 'PUT');
      else localStorage.setItem(LS_KEY, txt);
    } catch (e) { /* storage unavailable: keep working */ }
  }, 500);
}

/** offer a file: native save dialog in the app, downloads capability in an artifact, link download in a browser */
export async function saveFile(name, data, mime) {
  if (DESK) {
    try {
      const b64 = typeof data === 'string' ? utf8ToB64(data) : await blobToB64(data);
      const r = await api('save', { name, b64 });
      if (r.error) toast('Speichern fehlgeschlagen: ' + r.error, 'err');
      else if (r.path) { toast('Gespeichert: ' + r.path, 'ok'); return r; }
    } catch (e) { toast('Speichern fehlgeschlagen: ' + (e && e.message || e), 'err'); }
    return null;
  }
  try {
    if (window.claude && typeof window.claude.use === 'function') {
      const dl = await window.claude.use('downloads');
      if (dl) { await dl.save({ filename: name, data }); toast('Gespeichert: ' + name, 'ok'); return { name }; }
      if (typeof data === 'string') { showText('Speichern hier nicht verfügbar', data, 'Download ist in dieser Ansicht nicht möglich. Inhalt kopieren und als ' + name + ' speichern:'); return null; }
      toast('Download ist in dieser Ansicht nicht möglich.', 'err'); return null;
    }
  } catch (err) {
    if (err && err.code === 'declined') return null;
    if (typeof data === 'string') { showText('Speichern fehlgeschlagen', data, 'Inhalt kopieren und als ' + name + ' speichern:'); return null; }
    toast('Speichern fehlgeschlagen.', 'err'); return null;
  }
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('Gespeichert: ' + name, 'ok');
  return { name };
}

/** pick a project / Subarray file -> {name, text} or null */
export function openFile(exts) {
  exts = exts || ['.subgrid', '.json'];
  if (DESK) {
    return api('open', { exts }).then(r => { if (r.error) { toast('Öffnen fehlgeschlagen: ' + r.error, 'err'); return null; } return r.text ? { name: r.name, text: r.text } : null; })
      .catch(e => { toast('Öffnen fehlgeschlagen: ' + e.message, 'err'); return null; });
  }
  return pickLocal(exts.join(',') + ',application/json', 'text');
}
/** pick an image (hall plan) -> {name, url} (data URL) or null; works the same everywhere */
export function openImage() { return pickLocal('image/png,image/jpeg,image/webp,image/gif,image/svg+xml', 'dataurl'); }

function pickLocal(accept, as) {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = accept; inp.hidden = true;
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0]; inp.remove();
      if (!f) { resolve(null); return; }
      const rd = new FileReader();
      rd.onload = () => resolve(as === 'dataurl' ? { name: f.name, url: String(rd.result), size: f.size } : { name: f.name, text: String(rd.result) });
      rd.onerror = () => resolve(null);
      if (as === 'dataurl') rd.readAsDataURL(f); else rd.readAsText(f);
    });
    document.body.appendChild(inp); inp.click();
  });
}

export function openExternal(url) {
  if (DESK) { api('openurl', { url }).catch(() => {}); return; }
  window.open(url, '_blank', 'noopener');
}

export async function copyText(txt) {
  try { await navigator.clipboard.writeText(txt); toast('In die Zwischenablage kopiert', 'ok'); }
  catch (e) { showText('Zum Kopieren', txt, 'Automatisches Kopieren ist hier gesperrt – Text markieren und kopieren:'); }
}
