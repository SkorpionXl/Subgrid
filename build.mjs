import * as esbuild from 'esbuild';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const R = p => path.join(ROOT, p);
fs.mkdirSync(R('build'), { recursive: true });
fs.mkdirSync(R('dist'), { recursive: true });
const minify = !process.argv.includes('--dev');
// 1. worker bundle -> text
const w = await esbuild.build({ entryPoints: [R('src/worker.js')], bundle: true, format: 'iife', minify, write: false, target: ['chrome100'] });
fs.writeFileSync(R('build/worker.txt'), w.outputFiles[0].text);
// 2. app bundles (worker embedded as text): desktop (edition reported by the exe) + Lite HTML
const appBuild = async ed => {
  const a = await esbuild.build({ entryPoints: [R('src/ui/main.js')], bundle: true, format: 'iife', minify, write: false, target: ['chrome100'], loader: { '.txt': 'text' },
    define: ed ? { __EDITION__: JSON.stringify(ed) } : {} });
  return a.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
};
let js = await appBuild(null);
const jsLite = await appBuild('lite');
fs.writeFileSync(R('build/app.js'), js);
const css = fs.readFileSync(R('src/style.css'), 'utf8');
const body = fs.readFileSync(R('src/body.html'), 'utf8');
const gfonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Exo+2:wght@400;500;600;700;800&family=Share+Tech+Mono&display=swap">';
const meta = '<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">';
// 3a. exe web folder (offline fonts)
const web = R('app/web');
fs.rmSync(web, { recursive: true, force: true }); fs.mkdirSync(path.join(web, 'fonts'), { recursive: true });
for (const f of fs.readdirSync(R('fonts'))) if (f.endsWith('.woff2')) fs.copyFileSync(R('fonts/' + f), path.join(web, 'fonts', f));
fs.copyFileSync(R('fonts/fonts.css'), path.join(web, 'fonts.css'));
fs.writeFileSync(path.join(web, 'style.css'), css);
fs.writeFileSync(path.join(web, 'app.js'), js);
fs.writeFileSync(path.join(web, 'index.html'), `<!doctype html>\n<html lang="de">\n<head>\n${meta}\n<title>SubGrid</title>\n<link rel="stylesheet" href="fonts.css">\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n${body}\n<script src="app.js"></script>\n</body>\n</html>\n`);
// 3b. single-file browser version = Lite (fonts inlined so it also works offline)
const fontCss = fs.readFileSync(R('fonts/fonts.css'), 'utf8').replace(/url\(["']?(?:fonts\/)?([^"')]+\.woff2)["']?\)/g, (m, f) => `url(data:font/woff2;base64,${fs.readFileSync(R('fonts/' + path.basename(f))).toString('base64')})`);
fs.writeFileSync(R('dist/SubGrid-Lite.html'), `<!doctype html>\n<html lang="de">\n<head>\n${meta}\n<title>SubGrid Lite</title>\n<style>\n${fontCss}\n${css}\n</style>\n</head>\n<body>\n${body}\n<script>\n${jsLite}\n</script>\n</body>\n</html>\n`);
// 3c. artifact (skeleton added by the publisher)
fs.writeFileSync(R('dist/artifact.html'), `<title>SubGrid Lite</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n${gfonts}\n<style>\n${css}\n</style>\n${body}\n<script>\n${jsLite}\n</script>\n`);
console.log('worker', w.outputFiles[0].text.length, 'app', js.length, 'lite html', fs.statSync(R('dist/SubGrid-Lite.html')).size);
