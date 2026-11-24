// Headless screenshot / playtest helper.
// usage: node scripts/shot.mjs --q "cam=..&look=.." --out a.png [--w 1280 --h 720] [--pre 10] [--js "code"] [--steps 30]
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const root = path.resolve('dist');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;
const W = Number(args.w || 1280), H = Number(args.h || 720);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: args.touch === '1' });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/Download the React DevTools|GPU stall|GroupMarkerNotSet/.test(t)) logs.push(`[${m.type()}] ${t}`); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 6).join('\n')));
await page.goto(`http://localhost:${port}/?test&${args.q || ''}`);
try {
  await page.waitForFunction(() => window.__game && window.__game.ready && window.__step, null, { timeout: 90000 });
  const t0 = Date.now();
  if (args.file) {
    const mod = await import(path.resolve(args.file));
    await mod.default(page, { shot: (name) => page.screenshot({ path: name }), args });
  } else {
    await page.evaluate(([n]) => window.__step(1 / 30, n, false), [Number(args.pre || 6)]);
    if (args.js) console.log('js>', JSON.stringify(await page.evaluate(args.js)));
    await page.evaluate(([n]) => window.__step(1 / 30, n, true), [Number(args.steps || 2)]);
    await page.screenshot({ path: args.out || 'shot.png' });
  }
  console.log('done in', Date.now() - t0, 'ms');
} catch (e) {
  console.log('ERROR', e.message);
}
console.log(logs.slice(0, 40).join('\n'));
await browser.close();
server.close();
