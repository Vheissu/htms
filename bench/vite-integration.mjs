// Run after `npm run build` at the repository root and `npm ci` in bench/.
// Uses the benchmark's Vite install, without adding Vite to HTMS dependencies.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build, createServer } from 'vite';
import { chromium } from '@playwright/test';
import { htms } from '../dist/vite.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'htms-vite-integration-'));
const component = path.join(root, 'counter.html');
const source = (label) => `<component name="vite-counter">
  <var name="count" value="0" mutable="true"></var>
  <button on:click="count++">${label}: {count}</button>
</component>`;
let server;
let browser;
try {
  await fs.writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ type: 'module', sideEffects: false })
  );
  await fs.writeFile(component, source('Count'));
  await fs.writeFile(
    path.join(root, 'index.html'),
    '<!doctype html><html><body><vite-counter></vite-counter><pre id="source"></pre><script type="module" src="/main.js"></script></body></html>'
  );
  await fs.writeFile(
    path.join(root, 'main.js'),
    `import './counter.html?htms';
import raw from './counter.html?raw';
document.querySelector('#source').textContent = raw;`
  );

  const output = await build({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [htms()],
    build: { write: false },
  });
  const chunks = output.output.filter((entry) => entry.type === 'chunk');
  assert.ok(
    chunks.some((chunk) => chunk.code.includes('customElements.define'))
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.setContent('<vite-counter></vite-counter><pre id="source"></pre>');
  for (const chunk of chunks) {
    await page.addScriptTag({ content: chunk.code, type: 'module' });
  }
  await page.getByRole('button', { name: 'Count: 0' }).click();
  await page.getByRole('button', { name: 'Count: 1' }).waitFor();

  server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [htms()],
    server: { host: '127.0.0.1', port: 0 },
  });
  await server.listen();
  const address = server.httpServer.address();
  await page.goto(`http://127.0.0.1:${address.port}`);
  await page.getByRole('button', { name: 'Count: 0' }).click();
  await page.getByRole('button', { name: 'Count: 1' }).waitFor();

  await fs.writeFile(component, source('Updated'));
  await page.getByRole('button', { name: 'Updated: 0' }).waitFor();
  assert.match(await page.locator('#source').textContent(), /Updated/);

  await fs.writeFile(
    component,
    '<component name="vite-counter"><var></var></component>'
  );
  await page.locator('vite-error-overlay').waitFor();
  await fs.writeFile(component, source('Recovered'));
  await page.getByRole('button', { name: 'Recovered: 0' }).click();
  await page.getByRole('button', { name: 'Recovered: 1' }).waitFor();
  assert.equal(await page.locator('vite-error-overlay').count(), 0);
  console.log(
    'Vite integration passed: production bundle, dev imports, reload, raw imports, error overlay and recovery.'
  );
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(root, { recursive: true, force: true });
}
