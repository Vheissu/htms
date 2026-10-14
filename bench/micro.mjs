// Script-only microbenchmark: repeats an operation in one page and times
// the synchronous work plus the render microtask (no layout or paint).
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(here, '..', 'package.json'));
const { chromium } = require('@playwright/test');
const dist = path.join(here, 'dist');
const server = http.createServer((req, res) => {
  let file = path.join(dist, new URL(req.url, 'http://x').pathname);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chromium' });
const apps = (process.argv[2] ?? 'vanilla,htms,svelte,solid,vue,react').split(',');
for (const app of apps) {
  const page = await browser.newPage();
  await page.goto(`${base}/${app}/`);
  await page.waitForSelector('#run');
  const result = await page.evaluate(async () => {
    const tick = () => new Promise((r) => setTimeout(r, 0));
    const time = async (selector) => {
      const t0 = performance.now();
      document.querySelector(selector).click();
      await Promise.resolve();
      await Promise.resolve();
      const t = performance.now() - t0;
      await tick();
      return t;
    };
    const out = { create: [], replace: [], update: [], select: [], swap: [], clear: [], create10k: [] };
    for (let i = 0; i < 25; i++) {
      out.create.push(await time('#run'));
      out.replace.push(await time('#run'));
      out.update.push(await time('#update'));
      const link = document.querySelector('tbody>tr:nth-of-type(' + (2 + (i % 5)) + ')>td:nth-of-type(2)>a');
      const t0 = performance.now(); link.click(); await Promise.resolve(); await Promise.resolve(); out.select.push(performance.now() - t0); await tick();
      out.swap.push(await time('#swaprows'));
      out.clear.push(await time('#clear'));
    }
    for (let i = 0; i < 6; i++) { out.create10k.push(await time('#runlots')); await time('#clear'); }
    const med = (a) => { const s = a.slice(5).sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, +(k === 'create10k' ? [...v].sort((a,b)=>a-b)[3] : med(v)).toFixed(3)]));
  });
  console.log(app.padEnd(12), JSON.stringify(result));
  await page.close();
}
await browser.close();
server.close();
