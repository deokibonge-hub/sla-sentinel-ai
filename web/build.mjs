// Build the web UI: esbuild bundles React + JSX + CSS into web/dist. (npm i -D esbuild react react-dom  — or use NODE_PATH)
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname);
const dist = path.join(here, 'dist');
fs.mkdirSync(dist, { recursive: true });
await build({
  entryPoints: [path.join(here, 'src/main.jsx')], bundle: true, minify: true, outfile: path.join(dist, 'app.js'),
  jsx: 'automatic', loader: { '.jsx': 'jsx' }, define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [process.env.NODE_PATH || '', path.join(here, '..', 'node_modules')].filter(Boolean), logLevel: 'info',
});
fs.writeFileSync(path.join(dist, 'index.html'), `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#e60000">
<title>SLA Sentinel AI</title><link rel="icon" href="/tobi.png"><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/app.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
for (const d of ['samples']) { const src = path.join(here, '..', d); if (fs.existsSync(src)) { fs.mkdirSync(path.join(dist, d), { recursive: true }); for (const f of fs.readdirSync(src).filter(f => /\.(png|jpe?g)$/i.test(f))) fs.copyFileSync(path.join(src, f), path.join(dist, d, f)); } }
for (const f of fs.readdirSync(path.join(here, 'public'))) fs.copyFileSync(path.join(here, 'public', f), path.join(dist, f));
console.log('Built →', dist);
