// Compare block-rendered derived updates with a baseline dist directory.
//
//   node bench/derived.mjs /tmp/htms-before/dist --runs 5 --updates 200
//
// The component projects a large array in a derived expression, then updates
// an unrelated rendered field. The current compiler skips the projection when
// only that unrelated field is dirty; the baseline evaluates it on every
// render. Each compiler gets its own JSDOM component, and samples are
// interleaved to reduce process-level timing bias.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const require = createRequire(import.meta.url);
const args = process.argv.slice(2);

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error(
    'Usage: node bench/derived.mjs <baseline-dist> [--runs N] [--updates N]'
  );
  process.exit(1);
}

const baselineDirectory = args[0];
if (!baselineDirectory || baselineDirectory.startsWith('--')) {
  usage('a baseline dist directory is required');
}

function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  if (!Number.isInteger(value) || value < 1)
    usage(`${name} must be a positive integer`);
  return value;
}

const runs = option('--runs', 5);
const updates = option('--updates', 200);
const currentDirectory = process.env.HTMS_CURRENT_DIST
  ? path.resolve(process.env.HTMS_CURRENT_DIST)
  : path.join(repo, 'dist');

function loadCompiler(directory) {
  const modulePath = path.join(directory, 'parser.js');
  let module;
  try {
    module = require(modulePath);
  } catch (error) {
    usage(`could not load ${modulePath}: ${error.message}`);
  }
  if (!module || typeof module.parseHTML !== 'function') {
    usage(`${modulePath} does not export parseHTML()`);
  }
  return { modulePath, parseHTML: module.parseHTML };
}

const compilers = [
  { name: 'current', ...loadCompiler(currentDirectory) },
  { name: 'baseline', ...loadCompiler(path.resolve(baselineDirectory)) },
];
const items = Array.from({ length: 5000 }, (_, index) => index);
const source = `<component name="derived-bench">
  <var name="items" value='${JSON.stringify(items)}' mutable="true"></var>
  <var name="other" value="0" mutable="true"></var>
  <derive name="projected" expr="items.map((item) => item * 2)"></derive>
  <p id="length">{projected.length}</p>
  <p id="other">{other}</p>
</component>`;

function compile(parseHTML) {
  const result = parseHTML(source, { mode: 'component', renderer: 'auto' });
  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.ok(result.code);
  return result.code.replace(/export\s*\{[^}]*\};?/g, '');
}

function mounted(code) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
  });
  new vm.Script(code).runInContext(dom.getInternalVMContext());
  const element = dom.window.document.createElement('derived-bench');
  dom.window.document.body.appendChild(element);
  return { dom, element };
}

async function settle(element) {
  await element.updateComplete;
}

const compiled = compilers.map((compiler) => ({
  ...compiler,
  code: compile(compiler.parseHTML),
}));
for (const compiler of compiled) {
  const { dom, element } = mounted(compiler.code);
  await settle(element);
  assert.equal(element.shadowRoot.querySelector('#length').textContent, '5000');
  dom.window.close();
}

const samples = Object.fromEntries(compilers.map(({ name }) => [name, []]));
for (let run = 0; run < runs; run += 1) {
  const order = run % 2 === 0 ? compiled : [...compiled].reverse();
  for (const compiler of order) {
    const { dom, element } = mounted(compiler.code);
    await settle(element);
    for (let index = 0; index < 50; index += 1) {
      element.other = index + 1;
      await settle(element);
    }
    let projected = element.projected;
    let projectedReplacements = 0;
    const start = performance.now();
    for (let index = 0; index < updates; index += 1) {
      element.other = index + 1;
      await settle(element);
      if (element.projected !== projected) {
        projectedReplacements += 1;
        projected = element.projected;
      }
    }
    samples[compiler.name].push({
      elapsed: performance.now() - start,
      projectedReplacements,
    });
    assert.equal(
      element.shadowRoot.querySelector('#length').textContent,
      '5000'
    );
    assert.equal(
      element.shadowRoot.querySelector('#other').textContent,
      String(updates)
    );
    assert.equal(
      projectedReplacements,
      compiler.name === 'baseline' ? updates : 0,
      `${compiler.name} derived array replacement count changed`
    );
    dom.window.close();
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

const results = compiled.map((compiler) => ({
  name: compiler.name,
  module: compiler.modulePath,
  samplesMs: samples[compiler.name].map((sample) =>
    Number(sample.elapsed.toFixed(3))
  ),
  projectedReplacements: samples[compiler.name].map(
    (sample) => sample.projectedReplacements
  ),
  medianMs: Number(
    median(samples[compiler.name].map((sample) => sample.elapsed)).toFixed(3)
  ),
}));
const baseline = results.find((result) => result.name === 'baseline');
const current = results.find((result) => result.name === 'current');

console.log(
  `HTMS derived updates (${items.length} projected items, ${updates} updates, ${runs} samples)`
);
console.table(
  results.map(({ name, medianMs }) => ({ compiler: name, medianMs }))
);
console.log(
  JSON.stringify(
    {
      projectedItems: items.length,
      updates,
      runs,
      results,
      speedup: Number((baseline.medianMs / current.medianMs).toFixed(3)),
    },
    null,
    2
  )
);
