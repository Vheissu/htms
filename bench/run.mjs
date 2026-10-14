// Runs the js-framework-benchmark operations against each built app in
// Chromium and writes results/results.json.
//
//   node run.mjs [--runs 15] [--apps htms,svelte] [--ops run1k,select,startup]
//
// Each sample loads a fresh page, performs the operation's warm-up steps,
// then clicks the operation's button with a real (CDP) mouse click while a
// performance trace records. The duration runs from the start of the click
// event to the end of the paint that shows the result, the definition used
// by js-framework-benchmark. CPU throttling matches that benchmark too.

import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.join(here, 'dist');
const require = createRequire(path.join(here, '..', 'package.json'));
const { chromium } = require('@playwright/test');

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const RUNS = Number(option('runs', '15'));
const WARMUP_RUNS = 5;
const APPS = option('apps', 'vanilla,htms,svelte,solid,vue,react').split(',');

const row = (n, cell) => `tbody>tr:nth-of-type(${n})>td:nth-of-type(${cell})>a`;

// Warm-up steps follow js-framework-benchmark's definitions.
const OPERATIONS = [
  {
    id: 'run1k',
    name: 'create rows',
    description: 'creating 1,000 rows',
    throttle: 1,
    async setup(page) {
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
        await click(page, '#clear', null, 'tbody>tr');
      }
    },
    selector: '#run',
    expect: 'tbody>tr:nth-of-type(1000)',
  },
  {
    id: 'replace1k',
    name: 'replace all rows',
    description: 'replacing all 1,000 rows',
    throttle: 1,
    async setup(page) {
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
      }
    },
    selector: '#run',
    expect: 'tbody>tr:nth-of-type(1000)',
  },
  {
    id: 'update10th',
    name: 'partial update',
    description: 'updating every 10th row of 1,000 (4x CPU slowdown)',
    throttle: 4,
    async setup(page) {
      await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        await click(page, '#update');
      }
    },
    selector: '#update',
  },
  {
    id: 'select',
    name: 'select row',
    description: 'highlighting a selected row (4x CPU slowdown)',
    throttle: 4,
    async setup(page) {
      await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
      for (let i = 0; i <= WARMUP_RUNS; i += 1) {
        await click(page, row(i + 5, 2));
      }
    },
    selector: row(2, 2),
    expect: 'tbody>tr:nth-of-type(2).danger',
  },
  {
    id: 'swap',
    name: 'swap rows',
    description: 'swapping 2 rows of 1,000 (4x CPU slowdown)',
    throttle: 4,
    async setup(page) {
      await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
      for (let i = 0; i <= WARMUP_RUNS; i += 1) {
        await click(page, '#swaprows');
      }
    },
    selector: '#swaprows',
  },
  {
    id: 'remove',
    name: 'remove row',
    description: 'removing one row (2x CPU slowdown)',
    throttle: 2,
    async setup(page) {
      await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        const id = await text(page, 'tbody>tr:nth-of-type(' + (WARMUP_RUNS - i + 4) + ')>td:nth-of-type(1)');
        await click(page, row(WARMUP_RUNS - i + 4, 3));
        await gone(page, id, WARMUP_RUNS - i + 4);
      }
      return text(page, 'tbody>tr:nth-of-type(4)>td:nth-of-type(1)');
    },
    selector: row(4, 3),
    async verify(page, removedId) {
      await gone(page, removedId, 4);
    },
  },
  {
    id: 'run10k',
    name: 'create many rows',
    description: 'creating 10,000 rows',
    throttle: 1,
    async setup(page) {
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
        await click(page, '#clear', null, 'tbody>tr');
      }
    },
    selector: '#runlots',
    expect: 'tbody>tr:nth-of-type(10000)',
  },
  {
    id: 'append1k',
    name: 'append rows',
    description: 'appending 1,000 rows to 1,000 (2x CPU slowdown)',
    throttle: 2,
    async setup(page) {
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
        await click(page, '#clear', null, 'tbody>tr');
      }
      await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
    },
    selector: '#add',
    expect: 'tbody>tr:nth-of-type(2000)',
  },
  {
    id: 'clear',
    name: 'clear rows',
    description: 'clearing 1,000 rows (4x CPU slowdown)',
    throttle: 4,
    async setup(page) {
      for (let i = 0; i < WARMUP_RUNS; i += 1) {
        await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
        await click(page, '#clear', null, 'tbody>tr');
      }
      await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
    },
    selector: '#clear',
    expectGone: 'tbody>tr',
  },
];

const OPS = option('ops', [...OPERATIONS.map((op) => op.id), 'startup'].join(',')).split(',');

async function click(page, selector, expect, expectGone) {
  await page.click(selector);
  if (expect) await page.waitForSelector(expect, { state: 'attached' });
  if (expectGone) await page.waitForSelector(expectGone, { state: 'detached' });
}

async function text(page, selector) {
  return page.$eval(selector, (node) => node.textContent);
}

async function gone(page, id, position) {
  await page.waitForFunction(
    ([rowId, at]) =>
      document.querySelector(`tbody>tr:nth-of-type(${at})>td:nth-of-type(1)`)?.textContent !== rowId,
    [id, position]
  );
}

function serve(root) {
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.ttf': 'font/ttf',
    '.svg': 'image/svg+xml',
    '.eot': 'application/vnd.ms-fontobject',
  };
  const server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    let file = path.normalize(path.join(root, decodeURIComponent(url.pathname)));
    if (!file.startsWith(root)) {
      response.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    fs.createReadStream(file).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

const SCRIPT_EVENTS = new Set([
  'EventDispatch',
  'FunctionCall',
  'RunMicrotasks',
  'V8.RunMicrotasks',
  'TimerFire',
  'FireAnimationFrame',
  'v8.callFunction',
]);

// Duration from the click event to the end of the first frame that paints
// after it. Every app here updates the DOM synchronously in the click's
// task (or its microtasks), so that frame shows the result. Later frames,
// such as one requested by the harness's own requestAnimationFrame wait,
// are not counted.
function traceDuration(buffer) {
  const events = JSON.parse(buffer.toString()).traceEvents ?? [];
  const click = events.find(
    (event) =>
      event.name === 'EventDispatch' && event.args?.data?.type === 'click'
  );
  if (!click) throw new Error('No click event in trace');
  const frame = (name, after) =>
    events
      .filter(
        (event) =>
          event.name === name &&
          event.ph === 'X' &&
          event.pid === click.pid &&
          event.tid === click.tid &&
          event.ts >= after
      )
      .sort((a, b) => a.ts - b.ts)[0];
  const paint = frame('Paint', click.ts);
  if (!paint) throw new Error('No paint after click in trace');
  const commit = frame('Commit', paint.ts);
  const end = commit ? commit.ts + (commit.dur ?? 0) : paint.ts + (paint.dur ?? 0);
  // Scripting: main-thread time covered by script entry points (handlers,
  // microtasks, timers), with nested events merged.
  const intervals = events
    .filter(
      (event) =>
        event.ph === 'X' &&
        event.tid === click.tid &&
        event.ts >= click.ts &&
        event.ts < end &&
        SCRIPT_EVENTS.has(event.name)
    )
    .map((event) => [event.ts, event.ts + (event.dur ?? 0)])
    .sort((a, b) => a[0] - b[0]);
  let script = 0;
  let coveredUntil = 0;
  for (const [start, stop] of intervals) {
    if (stop <= coveredUntil) continue;
    script += stop - Math.max(start, coveredUntil);
    coveredUntil = stop;
  }
  return { total: (end - click.ts) / 1000, script: script / 1000 };
}

async function measureOperation(browser, baseUrl, app, operation) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  try {
    await page.goto(`${baseUrl}/${app}/`);
    await page.waitForSelector('#run');
    const state = await operation.setup(page);
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: operation.throttle });
    await browser.startTracing(page, {
      categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'],
    });
    await page.click(operation.selector);
    if (operation.expect) await page.waitForSelector(operation.expect, { state: 'attached' });
    if (operation.expectGone) await page.waitForSelector(operation.expectGone, { state: 'detached' });
    if (operation.verify) await operation.verify(page, state);
    // Let the frame that shows the change paint before the trace stops.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 50)))
    );
    const trace = await browser.stopTracing();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    return traceDuration(trace);
  } finally {
    await context.close();
  }
}

const BOOT_EVENTS = new Set([
  'EvaluateScript',
  'v8.compile',
  'v8.compileModule',
  'v8.evaluateModule',
  'v8.run',
  'FunctionCall',
  'RunMicrotasks',
  'V8.RunMicrotasks',
  'TimerFire',
]);

// Page load: main-thread script time (compiling and running the bundle,
// which renders the app) and the first contentful paint, both from a trace
// of a fresh navigation.
async function measureStartup(browser, baseUrl, app) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  try {
    await page.goto('about:blank');
    await browser.startTracing(page, {
      categories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'loading',
        'blink.user_timing',
        'v8',
        'v8.execute',
        '__metadata',
      ],
    });
    await page.goto(`${baseUrl}/${app}/`, { waitUntil: 'load' });
    await page.waitForSelector('#run');
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 100)))
    );
    const events = JSON.parse((await browser.stopTracing()).toString()).traceEvents ?? [];
    const fcp = events.find((event) => event.name === 'firstContentfulPaint');
    if (!fcp) throw new Error('No first contentful paint in trace');
    const navigation = events.find(
      (event) =>
        event.name === 'navigationStart' &&
        event.pid === fcp.pid &&
        event.args?.data?.documentLoaderURL?.startsWith(baseUrl)
    );
    if (!navigation) throw new Error('No navigation start in trace');
    const main = events.find(
      (event) =>
        event.name === 'thread_name' &&
        event.pid === fcp.pid &&
        event.args?.name === 'CrRendererMain'
    );
    const intervals = events
      .filter(
        (event) =>
          event.ph === 'X' &&
          event.pid === fcp.pid &&
          event.tid === main.tid &&
          event.ts >= navigation.ts &&
          BOOT_EVENTS.has(event.name)
      )
      .map((event) => [event.ts, event.ts + (event.dur ?? 0)])
      .sort((a, b) => a[0] - b[0]);
    let script = 0;
    let coveredUntil = 0;
    for (const [start, stop] of intervals) {
      if (stop <= coveredUntil) continue;
      script += stop - Math.max(start, coveredUntil);
      coveredUntil = stop;
    }
    return { script: script / 1000, fcp: (fcp.ts - navigation.ts) / 1000 };
  } finally {
    await context.close();
  }
}

async function measureMemory(browser, baseUrl, app) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((metric) => metric.name === 'JSHeapUsedSize').value / 1048576;
  };
  try {
    await page.goto(`${baseUrl}/${app}/`);
    await page.waitForSelector('#run');
    const ready = await heap();
    await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
    const run = await heap();
    for (let i = 0; i < 5; i += 1) {
      await click(page, '#run', 'tbody>tr:nth-of-type(1000)');
    }
    await click(page, '#clear', null, 'tbody>tr');
    const cleared = await heap();
    return { ready, run1k: run, clear: cleared };
  } finally {
    await context.close();
  }
}

function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / Math.max(1, values.length - 1);
  const middle = Math.floor(sorted.length / 2);
  return {
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    mean,
    stddev: Math.sqrt(variance),
    min: sorted[0],
    max: sorted[sorted.length - 1],
    samples: values,
  };
}

const server = await serve(dist);
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({
  channel: 'chromium',
  args: ['--js-flags=--expose-gc', '--disable-renderer-backgrounding'],
});
const sizes = JSON.parse(fs.readFileSync(path.join(dist, 'sizes.json'), 'utf8'));
const results = {
  date: new Date().toISOString(),
  environment: {
    browser: `Chromium ${browser.version()}`,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? 'unknown',
    cores: os.cpus().length,
    node: process.version,
    runs: RUNS,
  },
  operations: OPERATIONS.filter((op) => OPS.includes(op.id)).map(
    ({ id, name, description, throttle }) => ({ id, name, description, throttle })
  ),
  apps: {},
};

try {
  for (const app of APPS) {
    results.apps[app] = { label: sizes[app].label, size: sizes[app], timings: {} };
  }
  // Interleave apps for each sample so drift in machine load affects all
  // of them equally.
  for (const operation of OPERATIONS.filter((op) => OPS.includes(op.id))) {
    const samples = Object.fromEntries(APPS.map((app) => [app, []]));
    const scripts = Object.fromEntries(APPS.map((app) => [app, []]));
    for (let run = 0; run < RUNS; run += 1) {
      for (const app of APPS) {
        const { total, script } = await measureOperation(browser, baseUrl, app, operation);
        samples[app].push(total);
        scripts[app].push(script);
      }
    }
    for (const app of APPS) {
      results.apps[app].timings[operation.id] = {
        ...stats(samples[app]),
        script: stats(scripts[app]).median,
      };
    }
    console.log(
      `${operation.name.padEnd(18)} ` +
        APPS.map(
          (app) => `${app} ${results.apps[app].timings[operation.id].median.toFixed(1)}ms`
        ).join('  ')
    );
  }
  if (OPS.includes('startup')) {
    const boot = Object.fromEntries(APPS.map((app) => [app, { script: [], fcp: [] }]));
    for (let run = 0; run < RUNS; run += 1) {
      for (const app of APPS) {
        const { script, fcp } = await measureStartup(browser, baseUrl, app);
        boot[app].script.push(script);
        boot[app].fcp.push(fcp);
      }
    }
    for (const app of APPS) {
      results.apps[app].startup = {
        script: stats(boot[app].script),
        fcp: stats(boot[app].fcp),
      };
    }
    console.log(
      'startup script     ' +
        APPS.map((app) => `${app} ${results.apps[app].startup.script.median.toFixed(1)}ms`).join('  ')
    );
    console.log(
      'first paint        ' +
        APPS.map((app) => `${app} ${results.apps[app].startup.fcp.median.toFixed(1)}ms`).join('  ')
    );
  }
  for (const app of APPS) {
    const memory = [];
    for (let run = 0; run < 3; run += 1) {
      memory.push(await measureMemory(browser, baseUrl, app));
    }
    results.apps[app].memory = {
      ready: stats(memory.map((entry) => entry.ready)).median,
      run1k: stats(memory.map((entry) => entry.run1k)).median,
      clear: stats(memory.map((entry) => entry.clear)).median,
    };
    console.log(
      `memory ${app.padEnd(12)} ready ${results.apps[app].memory.ready.toFixed(2)} MB  1k rows ${results.apps[app].memory.run1k.toFixed(2)} MB`
    );
  }
} finally {
  await browser.close();
  server.close();
}

fs.mkdirSync(path.join(here, 'results'), { recursive: true });
const output = path.join(here, 'results', option('out', 'results.json'));
fs.writeFileSync(output, JSON.stringify(results, null, 2));
console.log(`Wrote ${path.relative(process.cwd(), output)}`);
