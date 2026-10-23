// Interleaved script-only row updates; layout/paint run outside each sample.
// Build apps first. Optional app names are comma-separated in argv[2].
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const apps = (process.argv[2] ?? 'htms,solid').split(',');
const counts = (process.argv[3] ?? '1000,10000').split(',').map(Number);
if (!counts.every((count) => count === 1000 || count === 10000))
  throw new Error('Row counts must be 1000 or 10000');
const root = path.join(here, 'dist');
const server = http.createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  let file = path.join(root, new URL(req.url, 'http://localhost').pathname);
  if (fs.existsSync(file) && fs.statSync(file).isDirectory())
    file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader(
    'content-type',
    file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : 'text/html'
  );
  res.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'chromium' });
const output = {};
try {
  for (const count of counts) {
    const samples = Object.fromEntries(
      apps.map((app) => [app, { select: [], swap: [], remove: [] }])
    );
    for (let sample = 0; sample < 9; sample++) {
      const order = apps.map((_, i) => apps[(i + sample) % apps.length]);
      for (const app of order) {
        const page = await browser.newPage();
        try {
          await page.goto(`http://127.0.0.1:${server.address().port}/${app}/`);
          await page.locator('#run').waitFor();
          const cdp = await page.context().newCDPSession(page);
          await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
          const times = await page.evaluate(async (count) => {
            if (!crossOriginIsolated)
              throw new Error(
                'High-resolution timing requires cross-origin isolation'
              );
            const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
            const flush = async () => {
              await Promise.resolve();
              await Promise.resolve();
            };
            const create = async () => {
              document
                .querySelector(count === 1000 ? '#run' : '#runlots')
                .click();
              await flush();
              await tick();
            };
            const out = {};
            for (const op of ['select', 'swap', 'remove']) {
              await create();
              const times = [];
              for (let i = 0; i < 35; i++) {
                const target =
                  op === 'swap'
                    ? document.querySelector('#swaprows')
                    : document.querySelector(
                        `tbody>tr:nth-child(${op === 'select' ? 2 + (i % 5) : 4})>td:nth-child(${op === 'select' ? 2 : 3})>a`
                      );
                const rowCount = document.querySelectorAll('tbody>tr').length;
                const selectedId =
                  op === 'select'
                    ? target.parentNode.previousSibling.textContent
                    : null;
                const start = performance.now();
                target.click();
                await flush();
                const duration = performance.now() - start;
                if (
                  op === 'select' &&
                  document.querySelector('tbody>tr.danger>td').textContent !==
                    selectedId
                )
                  throw new Error('Selection did not update');
                if (
                  op === 'remove' &&
                  document.querySelectorAll('tbody>tr').length !== rowCount - 1
                )
                  throw new Error('Removal did not update');
                if (i >= 10) times.push(duration);
                await tick();
              }
              times.sort((a, b) => a - b);
              out[op] = times[Math.floor(times.length / 2)];
            }
            return out;
          }, count);
          for (const op of Object.keys(times)) samples[app][op].push(times[op]);
        } finally {
          await page.close();
        }
      }
    }
    output[count] = samples;
    const summary = Object.fromEntries(
      apps.map((app) => [
        app,
        Object.fromEntries(
          Object.entries(samples[app]).map(([op, values]) => [
            op,
            [...values].sort((a, b) => a - b)[4],
          ])
        ),
      ])
    );
    console.log(count, JSON.stringify(summary));
  }
  fs.writeFileSync(
    path.join(here, 'results', 'row-scripting.json'),
    JSON.stringify(
      { browser: browser.version(), throttle: 4, runs: 9, samples: output },
      null,
      2
    ) + '\n'
  );
} finally {
  await browser.close();
  server.close();
}
