// Compare compiler throughput with a baseline dist directory.
//
// Build both compiler versions, then run:
//
//   node bench/compiler.mjs /tmp/htms-before/dist --runs 11 --warmup 30
//
// The baseline and current component compilers are loaded by absolute module path,
// warmed in the same process, and interleaved for every sample. The source
// workload is deliberately directive-heavy so repeated IR walks are visible.
// Set HTMS_CURRENT_DIST to benchmark a separately built current dist without
// touching the repository's shared dist directory.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const require = createRequire(import.meta.url);

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error(
    'Usage: node bench/compiler.mjs <baseline-dist> [--runs N] [--warmup N]'
  );
  process.exit(1);
}

const args = process.argv.slice(2);
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

const runs = option('--runs', 9);
const warmup = option('--warmup', 20);
const currentDirectory = process.env.HTMS_CURRENT_DIST
  ? path.resolve(process.env.HTMS_CURRENT_DIST)
  : path.join(repo, 'dist');
function loadCompiler(directory) {
  const modulePath = path.join(directory, 'component', 'compiler.js');
  let module;
  try {
    module = require(modulePath);
  } catch (error) {
    usage(`could not load ${modulePath}: ${error.message}`);
  }
  if (!module || typeof module.compileComponents !== 'function') {
    usage(`${modulePath} does not export compileComponents()`);
  }
  return { modulePath, compileComponents: module.compileComponents };
}

const compilers = [
  { name: 'current', ...loadCompiler(currentDirectory) },
  {
    name: 'baseline',
    ...loadCompiler(path.resolve(baselineDirectory)),
  },
];

const source = `<component name="compiler-bench" props="label:string, count:number">
  <var name="counter" value="0"></var>
  <function name="increment">
    <set name="counter" op="++"></set>
    <emit name="changed"></emit>
  </function>
  <div id="app">
    <button id="btn0" on:click="increment()">{label}</button>
    ${Array.from(
      { length: 50 },
      (_, index) => `
      <if condition="counter >= ${index}">
        <span data-index="${index}">{counter}</span>
        <event target="#btn${index}" type="click">
          <set name="counter" op="++"></set>
        </event>
      </if>`
    ).join('')}
    <repeat variable="items" item="item">
      <button on:click="increment()">{item}</button>
    </repeat>
  </div>
</component>`;

const options = { mode: 'component', renderer: 'auto' };

function digest(result) {
  return crypto
    .createHash('sha256')
    .update(result.code ?? '')
    .digest('hex');
}

const outputs = compilers.map(({ compileComponents }) =>
  compileComponents(source, options)
);
for (const result of outputs) {
  assert.equal(result.success, true, JSON.stringify(result.errors));
  assert.equal(result.errors.length, 0);
}
assert.equal(digest(outputs[0]), digest(outputs[1]), 'compiler output differs');
assert.equal(outputs[0].code, outputs[1].code, 'compiler output differs');

for (let index = 0; index < warmup; index += 1) {
  for (const { compileComponents } of compilers) {
    compileComponents(source, options);
  }
}

const samples = Object.fromEntries(compilers.map(({ name }) => [name, []]));
for (let run = 0; run < runs; run += 1) {
  // Alternate the order on each sample to reduce systematic JIT/GC bias.
  const order = run % 2 === 0 ? compilers : [...compilers].reverse();
  for (const compiler of order) {
    const start = performance.now();
    const result = compiler.compileComponents(source, options);
    const elapsed = performance.now() - start;
    assert.equal(result.success, true, `${compiler.name} compile failed`);
    assert.equal(
      digest(result),
      digest(outputs[0]),
      `${compiler.name} output changed`
    );
    samples[compiler.name].push(elapsed);
  }
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)];
}

const results = compilers.map((compiler) => ({
  name: compiler.name,
  module: compiler.path,
  samplesMs: samples[compiler.name].map((value) => Number(value.toFixed(3))),
  medianMs: Number(median(samples[compiler.name]).toFixed(3)),
}));
const baseline = results.find((result) => result.name === 'baseline');
const current = results.find((result) => result.name === 'current');
const speedup = baseline.medianMs / current.medianMs;

console.log(
  `HTMS compiler (${source.length} bytes, ${runs} samples, ${warmup} warmups)`
);
console.table(
  results.map(({ name, medianMs }) => ({ compiler: name, medianMs }))
);
console.log(
  JSON.stringify(
    {
      sourceBytes: source.length,
      runs,
      warmup,
      outputSha256: digest(outputs[0]),
      results,
      speedup: Number(speedup.toFixed(3)),
    },
    null,
    2
  )
);
