// Compare the built effect runtime with a built baseline.
//
// Build the current runtime first, then pass a directory containing the
// baseline's dist/utils/runtime.js:
//
//   npm run build
//   git worktree add /tmp/htms-before HEAD
//   (cd /tmp/htms-before && npm ci && npm run build)
//   node bench/effects.mjs /tmp/htms-before/dist --count 5000 --runs 5
//
// The benchmark measures registration only. Runtime flushes are drained
// between phases so first registration and re-registration are comparable.
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { Script } from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error(
    'Usage: node bench/effects.mjs <baseline-dist> [--count N] [--runs N]'
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

const count = option('--count', 5000);
const runs = option('--runs', 5);
const currentRuntimePath = path.resolve(
  here,
  '..',
  'dist',
  'utils',
  'runtime.js'
);
const baselineRuntimePath = path.resolve(
  baselineDirectory,
  'utils',
  'runtime.js'
);

function loadRuntime(modulePath) {
  let module;
  try {
    module = require(modulePath);
  } catch (error) {
    usage(`could not load ${modulePath}: ${error.message}`);
  }
  if (!module || typeof module.ensureRuntime !== 'function') {
    usage(`${modulePath} does not export ensureRuntime()`);
  }
  return module.ensureRuntime;
}

const runtimes = [
  {
    name: 'current',
    path: currentRuntimePath,
    ensureRuntime: loadRuntime(currentRuntimePath),
  },
  {
    name: 'baseline',
    path: baselineRuntimePath,
    ensureRuntime: loadRuntime(baselineRuntimePath),
  },
];

function makeRuntime(ensureRuntime) {
  const dom = new JSDOM('<!doctype html><body></body>', {
    runScripts: 'outside-only',
  });
  new Script(ensureRuntime()).runInContext(dom.getInternalVMContext());
  if (!dom.window.__htms) throw new Error('runtime did not install');
  const owner = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(owner);
  return { dom, owner, runtime: dom.window.__htms };
}

async function settle(dom) {
  await dom.window.Promise.resolve();
  await new dom.window.Promise((resolve) => dom.window.setTimeout(resolve, 0));
}

function register(runtime, owner, prefix, total) {
  const run = () => undefined;
  const deps = [];
  for (let index = 0; index < total; index += 1) {
    runtime.registerEffect({
      owner,
      id: `${prefix}:${index}`,
      deps,
      run,
    });
  }
}

async function firstRegistration(ensureRuntime) {
  const { dom, owner, runtime } = makeRuntime(ensureRuntime);
  const start = performance.now();
  register(runtime, owner, 'first', count);
  const elapsed = performance.now() - start;
  const records = runtime.effects.length;
  await settle(dom);
  dom.window.close();
  return { elapsed, records };
}

async function reRegistration(ensureRuntime) {
  const { dom, owner, runtime } = makeRuntime(ensureRuntime);
  register(runtime, owner, 'repeat', count);
  await settle(dom);
  const start = performance.now();
  register(runtime, owner, 'repeat', count);
  const elapsed = performance.now() - start;
  const records = runtime.effects.length;
  await settle(dom);
  dom.window.close();
  return { elapsed, records };
}

async function cleanup(ensureRuntime) {
  const { dom, owner, runtime } = makeRuntime(ensureRuntime);
  register(runtime, owner, 'cleanup', count);
  await settle(dom);
  const start = performance.now();
  runtime.disposeEffectsFor(owner);
  const elapsed = performance.now() - start;
  const remaining = runtime.effects.filter(
    (effect) => effect.owner === owner
  ).length;
  await settle(dom);
  dom.window.close();
  return { elapsed, remaining };
}

async function semantics(ensureRuntime) {
  const { dom, owner, runtime } = makeRuntime(ensureRuntime);
  const duplicateId = 'duplicate';
  const run = () => undefined;
  runtime.registerEffect({ owner, id: duplicateId, deps: [], run });
  runtime.registerEffect({ owner, id: duplicateId, deps: [], run });
  runtime.registerEffect({ owner: null, id: duplicateId, deps: [], run });
  runtime.registerEffect({ owner: null, id: duplicateId, deps: [], run });
  const duplicateOwnerRecords = runtime.effects.filter(
    (effect) => effect.owner === owner && effect.id === duplicateId
  ).length;
  const ownerlessRecords = runtime.effects.filter(
    (effect) => effect.owner === null && effect.id === duplicateId
  ).length;
  runtime.disposeEffectsFor(owner);
  const disposedOwnerRecords = runtime.effects.filter(
    (effect) => effect.owner === owner
  ).length;
  dom.window.close();
  return { duplicateOwnerRecords, ownerlessRecords, disposedOwnerRecords };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

const samples = new Map(
  runtimes.map((runtime) => [
    runtime.name,
    { first: [], repeat: [], disposed: [], records: null },
  ])
);

// Warm each implementation once before recording. Measured runs alternate
// the implementation order so a busy machine does not favour one side.
for (const runtime of runtimes) {
  await firstRegistration(runtime.ensureRuntime);
  await reRegistration(runtime.ensureRuntime);
  await cleanup(runtime.ensureRuntime);
}
for (let run = 0; run < runs; run += 1) {
  const order = run % 2 === 0 ? runtimes : [...runtimes].reverse();
  for (const runtime of order) {
    const firstSample = await firstRegistration(runtime.ensureRuntime);
    const repeatSample = await reRegistration(runtime.ensureRuntime);
    const cleanupSample = await cleanup(runtime.ensureRuntime);
    const result = samples.get(runtime.name);
    result.first.push(firstSample.elapsed);
    result.repeat.push(repeatSample.elapsed);
    result.disposed.push(cleanupSample.elapsed);
    result.records = {
      first: firstSample.records,
      repeat: repeatSample.records,
      remaining: cleanupSample.remaining,
    };
  }
}

const results = await Promise.all(
  runtimes.map(async (runtime) => {
    const result = samples.get(runtime.name);
    return {
      name: runtime.name,
      module: runtime.path,
      firstRegistrationMs: median(result.first),
      reRegistrationMs: median(result.repeat),
      cleanupMs: median(result.disposed),
      rawMs: {
        firstRegistration: result.first,
        reRegistration: result.repeat,
        cleanup: result.disposed,
      },
      firstRecords: result.records.first,
      reRegistrationRecords: result.records.repeat,
      remainingOwnedRecords: result.records.remaining,
      semantics: await semantics(runtime.ensureRuntime),
    };
  })
);

console.log(`HTMS effect runtime (${count} effects, ${runs} samples)`);
console.table(
  results.map(({ name, firstRegistrationMs, reRegistrationMs, cleanupMs }) => ({
    runtime: name,
    firstRegistrationMs: firstRegistrationMs.toFixed(3),
    reRegistrationMs: reRegistrationMs.toFixed(3),
    cleanupMs: cleanupMs.toFixed(3),
  }))
);
console.log(JSON.stringify({ count, runs, results }, null, 2));
