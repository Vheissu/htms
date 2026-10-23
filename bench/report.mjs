// Turns results/results.json into results/RESULTS.md, three SVG charts and
// the summary block in the repository README.
//
//   node report.mjs [results.json] [--no-readme]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const resultsDir = path.join(here, 'results');
const inputName = process.argv.slice(2).find((arg) => !arg.startsWith('--'));
const input = path.join(resultsDir, inputName ?? 'results.json');
const results = JSON.parse(fs.readFileSync(input, 'utf8'));
const { apps, operations, environment } = results;
const measurementDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: environment.timeZone ?? 'UTC',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date(results.date));

const BASELINE = 'vanilla';
// Frameworks in categorical palette order; vanilla JS is the reference and
// takes the last slot. Colour follows the framework in every chart.
const FRAMEWORKS = ['htms', 'svelte', 'solid', 'vue', 'react'].filter((app) => apps[app]);
const ORDER = [...FRAMEWORKS, BASELINE, 'htms-legacy'].filter((app) => apps[app]);
const CHARTED = [...FRAMEWORKS, BASELINE];
const SLOTS = { htms: 1, svelte: 2, solid: 3, vue: 4, react: 5, vanilla: 6 };

const ms = (value) => (value >= 100 ? value.toFixed(0) : value.toFixed(1));
const kb = (bytes) => (bytes / 1024).toFixed(1);
const ratio = (app, op) =>
  apps[app].timings[op].median / apps[BASELINE].timings[op].median;
const geomean = (app) =>
  Math.exp(
    operations.reduce((sum, op) => sum + Math.log(ratio(app, op.id)), 0) /
      operations.length
  );
const hasStartup = ORDER.every((app) => apps[app].startup);

// ---------------------------------------------------------------------------
// Charts. Colours are the validated reference palette (categorical slots
// 1-6 in order), with dark-mode steps for viewers whose README renders dark.

const STYLE = `
  <style>
    .surface { fill: #fcfcfb; }
    .ink { fill: #0b0b0b; }
    .secondary { fill: #52514e; }
    .grid { stroke: #e1e0d9; stroke-width: 1; }
    .axis { stroke: #c3c2b7; stroke-width: 1; }
    .reference { stroke: #52514e; stroke-width: 1.5; stroke-dasharray: 4 3; }
    .s1 { fill: #2a78d6; } .s2 { fill: #eb6834; } .s3 { fill: #1baf7a; }
    .s4 { fill: #eda100; } .s5 { fill: #e87ba4; } .s6 { fill: #008300; }
    text { font-family: system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif; font-variant-numeric: tabular-nums; }
    @media (prefers-color-scheme: dark) {
      .surface { fill: #1a1a19; }
      .ink { fill: #f0efec; }
      .secondary { fill: #c3c2b7; }
      .grid { stroke: #2c2c2a; }
      .axis { stroke: #383835; }
      .reference { stroke: #c3c2b7; }
      .s1 { fill: #3987e5; } .s2 { fill: #d95926; } .s3 { fill: #199e70; }
      .s4 { fill: #c98500; } .s5 { fill: #d55181; } .s6 { fill: #008300; }
    }
  </style>`;

const color = (app) => `s${SLOTS[app]}`;

// Horizontal bar anchored at the axis, with a 4px rounded data end.
function bar(x, y, width, height, cls) {
  if (width <= 0) return '';
  const r = Math.min(4, width / 2, height / 2);
  return `<path class="${cls}" d="M${x},${y} h${width - r} a${r},${r} 0 0 1 ${r},${r} v${height - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${width - r} z"/>`;
}

function escape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;');
}

function svgOpen(width, height, id, title, desc) {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="${id}-title ${id}-desc">`,
    `<title id="${id}-title">${escape(title)}</title>`,
    `<desc id="${id}-desc">${escape(desc)}</desc>`,
    STYLE,
    `<rect class="surface" width="${width}" height="${height}" rx="8"/>`,
  ];
}

const subtitle = `Median of ${environment.runs} runs · ${environment.browser} · ${environment.cpu}`;

// Headline: one number per framework, the geometric mean of its time
// relative to vanilla JS across all nine operations.
function overallChart() {
  const width = 760;
  const left = 150;
  const right = 90;
  const top = 76;
  const rowHeight = 34;
  const barHeight = 20;
  const ranked = [...CHARTED].sort((a, b) => geomean(a) - geomean(b));
  const height = top + ranked.length * rowHeight + 44;
  const max = Math.max(...ranked.map(geomean)) * 1.05;
  const scale = (value) => ((width - left - right) * value) / max;
  const parts = svgOpen(
    width,
    height,
    'overall',
    'Overall speed relative to vanilla JS',
    `Geometric mean of the median time of nine js-framework-benchmark operations, divided by vanilla JS. Lower is faster. ${ranked
      .map((app) => `${apps[app].label} ${geomean(app).toFixed(2)}×`)
      .join(', ')}.`
  );
  parts.push(
    `<text class="ink" x="24" y="32" font-size="17" font-weight="600">Overall time relative to vanilla JS (lower is faster)</text>`,
    `<text class="secondary" x="24" y="52" font-size="12">Geometric mean over ${operations.length} operations · ${escape(subtitle)}</text>`
  );
  const step = max > 2 ? 0.5 : 0.25;
  for (let tick = 0; tick <= max + 1e-9; tick += step) {
    const x = left + scale(tick);
    parts.push(
      `<line class="${tick === 1 ? 'reference' : 'grid'}" x1="${x}" x2="${x}" y1="${top - 6}" y2="${height - 38}"/>`,
      `<text class="secondary" x="${x}" y="${height - 20}" font-size="11" text-anchor="middle">${tick.toFixed(2)}×</text>`
    );
  }
  ranked.forEach((app, index) => {
    const y = top + index * rowHeight;
    const value = geomean(app);
    const bold = app === 'htms' ? ' font-weight="600"' : '';
    parts.push(
      `<text class="ink" x="${left - 12}" y="${y + 16}" font-size="13" text-anchor="end"${bold}>${escape(apps[app].label)}</text>`,
      bar(left, y + 2, scale(value), barHeight, color(app)),
      `<text class="ink" x="${left + scale(value) + 8}" y="${y + 16}" font-size="12.5"${bold}>${value.toFixed(2)}×</text>`
    );
  });
  parts.push(
    `<line class="axis" x1="${left}" x2="${left}" y1="${top - 6}" y2="${height - 38}"/>`,
    '</svg>'
  );
  return parts.join('\n');
}

// Per operation: each framework's median relative to vanilla JS. The axis
// stops at 2.5×; a longer bar is cut there and labelled with its value.
// HTMS's time in milliseconds sits in its own column on the right.
function speedChart() {
  const width = 760;
  const left = 170;
  const right = 150;
  const top = 92;
  const barHeight = 8;
  const gap = 2;
  const groupHeight = FRAMEWORKS.length * (barHeight + gap) - gap + 20;
  const height = top + operations.length * groupHeight + 36;
  const highest = Math.max(
    1.25,
    ...operations.flatMap((op) => FRAMEWORKS.map((app) => ratio(app, op.id)))
  );
  const max = Math.min(highest, 2.5);
  const step = max > 2 ? 0.5 : 0.25;
  const plotRight = width - right;
  const scale = (value) => ((plotRight - left) * Math.min(value, max)) / max;
  const parts = svgOpen(
    width,
    height,
    'speed',
    'Time per operation relative to vanilla JS',
    `Median time for each js-framework-benchmark operation divided by vanilla JS; lower is faster. ${operations
      .map(
        (op) =>
          `${op.name}: ${FRAMEWORKS.map((app) => `${apps[app].label} ${ms(apps[app].timings[op.id].median)} ms`).join(', ')}, vanilla ${ms(apps[BASELINE].timings[op.id].median)} ms`
      )
      .join('. ')}.`
  );
  parts.push(
    `<text class="ink" x="24" y="32" font-size="17" font-weight="600">Time per operation relative to vanilla JS (lower is faster)</text>`,
    `<text class="secondary" x="24" y="52" font-size="12">${escape(subtitle)}</text>`
  );
  FRAMEWORKS.forEach((app, index) => {
    const x = 24 + index * 96;
    parts.push(
      `<rect class="${color(app)}" x="${x}" y="66" width="12" height="12" rx="2"/>`,
      `<text class="ink" x="${x + 18}" y="76" font-size="12">${escape(apps[app].label)}</text>`
    );
  });
  parts.push(
    `<text class="secondary" x="${width - 24}" y="76" font-size="11" text-anchor="end">HTMS time</text>`
  );
  for (let tick = 0; tick <= max + 1e-9; tick += step) {
    const x = left + scale(tick);
    parts.push(
      `<line class="${tick === 1 ? 'reference' : 'grid'}" x1="${x}" x2="${x}" y1="${top - 6}" y2="${height - 30}"/>`,
      `<text class="secondary" x="${x}" y="${height - 12}" font-size="11" text-anchor="middle">${tick.toFixed(step < 0.5 ? 2 : 1)}×</text>`
    );
  }
  operations.forEach((op, index) => {
    const y = top + index * groupHeight;
    parts.push(
      `<text class="ink" x="${left - 12}" y="${y + 12}" font-size="12.5" text-anchor="end">${escape(op.name)}</text>`,
      `<text class="secondary" x="${left - 12}" y="${y + 27}" font-size="10.5" text-anchor="end">vanilla ${ms(apps[BASELINE].timings[op.id].median)} ms${op.throttle > 1 ? ` · ${op.throttle}× CPU` : ''}</text>`,
      `<text class="ink" x="${width - 24}" y="${y + 12}" font-size="12" font-weight="600" text-anchor="end">${ms(apps.htms.timings[op.id].median)} ms</text>`
    );
    FRAMEWORKS.forEach((app, row) => {
      const barY = y + row * (barHeight + gap);
      const value = ratio(app, op.id);
      parts.push(bar(left, barY, scale(value), barHeight, color(app)));
      if (value > max) {
        parts.push(
          `<text class="ink" x="${plotRight + 6}" y="${barY + barHeight}" font-size="10.5">${value.toFixed(1)}×</text>`
        );
      }
    });
  });
  parts.push(
    `<line class="axis" x1="${left}" x2="${left}" y1="${top - 6}" y2="${height - 30}"/>`,
    '</svg>'
  );
  return parts.join('\n');
}

// Small multiples: bundle size, startup and memory, one panel each with
// its own scale.
function footprintChart() {
  const panels = [
    {
      title: 'Bundle size (minified + gzip)',
      value: (app) => apps[app].size.gzip / 1024,
      label: (value) => `${value.toFixed(1)} KB`,
    },
    hasStartup && {
      title: 'Script time during page load',
      value: (app) => apps[app].startup.script.median,
      label: (value) => `${value.toFixed(1)} ms`,
    },
    {
      title: 'JS heap after load',
      value: (app) => apps[app].memory.ready,
      label: (value) => `${value.toFixed(2)} MB`,
    },
    {
      title: 'JS heap with 1,000 rows',
      value: (app) => apps[app].memory.run1k,
      label: (value) => `${value.toFixed(2)} MB`,
    },
  ].filter(Boolean);
  const width = 760;
  const panelWidth = 340;
  const labelWidth = 84;
  const rowHeight = 26;
  const panelHeight = 44 + CHARTED.length * rowHeight + 18;
  const top = 24;
  const height = top + Math.ceil(panels.length / 2) * panelHeight + 34;
  const parts = svgOpen(
    width,
    height,
    'footprint',
    'Bundle size, startup and memory',
    CHARTED.map(
      (app) =>
        `${apps[app].label}: ${kb(apps[app].size.gzip)} KB gzip${hasStartup ? `, ${apps[app].startup.script.median.toFixed(1)} ms script during load` : ''}, ${apps[app].memory.ready.toFixed(2)} MB heap after load, ${apps[app].memory.run1k.toFixed(2)} MB with 1,000 rows`
    ).join('; ') + '. Lower is better.'
  );
  panels.forEach((panel, index) => {
    const x0 = 24 + (index % 2) * (panelWidth + 48);
    const y0 = top + Math.floor(index / 2) * panelHeight;
    const max = Math.max(...CHARTED.map(panel.value));
    const scale = (value) => ((panelWidth - labelWidth - 70) * value) / max;
    parts.push(
      `<text class="ink" x="${x0}" y="${y0 + 18}" font-size="14" font-weight="600">${panel.title}</text>`,
      `<line class="axis" x1="${x0 + labelWidth}" x2="${x0 + labelWidth}" y1="${y0 + 32}" y2="${y0 + 32 + CHARTED.length * rowHeight}"/>`
    );
    CHARTED.forEach((app, row) => {
      const y = y0 + 34 + row * rowHeight;
      const value = panel.value(app);
      const bold = app === 'htms' ? ' font-weight="600"' : '';
      parts.push(
        `<text class="ink" x="${x0 + labelWidth - 10}" y="${y + 14}" font-size="12" text-anchor="end"${bold}>${escape(apps[app].label)}</text>`,
        bar(x0 + labelWidth, y + 2, scale(value), 16, color(app)),
        `<text class="ink" x="${x0 + labelWidth + scale(value) + 7}" y="${y + 14}" font-size="11.5"${bold}>${panel.label(value)}</text>`
      );
    });
  });
  parts.push(
    `<text class="secondary" x="24" y="${height - 18}" font-size="11">Lower is better. One Vite production build minifies every app; heap is measured after garbage collection.</text>`,
    '</svg>'
  );
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Markdown

function table(headers, rows) {
  const align = headers.map((_, index) => (index === 0 ? ':--' : '--:'));
  return [
    `| ${headers.join(' | ')} |`,
    `| ${align.join(' | ')} |`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

// Bold goes to the best framework. Vanilla JS is the hand-written
// reference and the previous HTMS renderer is shown for comparison; neither
// takes bold.
const CONTENDERS = FRAMEWORKS;

// A row of values with the best framework bold. Values that print the
// same as the best are ties and are bold too.
function boldRow(label, list, value, format) {
  const best = format(Math.min(...list.filter((app) => CONTENDERS.includes(app)).map(value)));
  return [
    label,
    ...list.map((app) => {
      const text = format(value(app));
      return text === best && CONTENDERS.includes(app) ? `**${text}**` : text;
    }),
  ];
}

const durationRows = operations.map((op) => {
  const best = ms(Math.min(...CONTENDERS.map((app) => apps[app].timings[op.id].median)));
  return [
    `${op.name}<br><sub>${op.description}</sub>`,
    ...ORDER.map((app) => {
      const timing = apps[app].timings[op.id];
      const text = `${ms(timing.median)} ± ${ms(timing.stddev)}`;
      return ms(timing.median) === best && CONTENDERS.includes(app) ? `**${text}**` : text;
    }),
  ];
});
durationRows.push(
  boldRow('**geometric mean vs vanilla**', ORDER, geomean, (v) => `${v.toFixed(2)}×`)
);

const scriptRows = operations.map((op) =>
  boldRow(op.name, ORDER, (app) => apps[app].timings[op.id].script, ms)
);

const footprintRows = [
  boldRow('minified', ORDER, (app) => apps[app].size.minified, (v) => `${kb(v)} KB`),
  boldRow('minified + gzip', ORDER, (app) => apps[app].size.gzip, (v) => `${kb(v)} KB`),
  boldRow('minified + brotli', ORDER, (app) => apps[app].size.brotli, (v) => `${kb(v)} KB`),
  ...(hasStartup
    ? [
        boldRow('script time during page load', ORDER, (app) => apps[app].startup.script.median, (v) => `${ms(v)} ms`),
      ]
    : []),
  boldRow('heap after load', ORDER, (app) => apps[app].memory.ready, (v) => `${v.toFixed(2)} MB`),
  boldRow('heap with 1,000 rows', ORDER, (app) => apps[app].memory.run1k, (v) => `${v.toFixed(2)} MB`),
  boldRow('heap after 5 replaces + clear', ORDER, (app) => apps[app].memory.clear, (v) => `${v.toFixed(2)} MB`),
];

const labels = ORDER.map((app) => apps[app].label);

const resultsMarkdown = `# Benchmark results

Generated by \`bench/report.mjs\` on ${measurementDate} from \`${path.basename(input)}\`.
See [the benchmark README](../README.md) for the method.

- ${escape(environment.browser)}, ${environment.os}
- ${environment.cpu} (${environment.cores} cores), Node ${environment.node}
- ${environment.runs} samples per operation, apps interleaved

![Overall time relative to vanilla JS](overall.svg)

## Duration (ms, click to paint, median ± standard deviation)

Lower is better. Bold marks the best framework in each row; vanilla JS is the hand-written reference${apps['htms-legacy'] ? ' and the HTMS (reconciler) column is the previous renderer' : ''}.

${table(['operation', ...labels], durationRows)}

![Time per operation relative to vanilla JS](speed.svg)

## Scripting time (ms, median)

Main-thread time spent in event handlers, microtasks and timers between the
click and the paint. Layout and paint are excluded.

${table(['operation', ...labels], scriptRows)}

## Size, startup and memory

${table(['', ...labels], footprintRows)}

![Bundle size, startup and memory](footprint.svg)
`;

// README summary: the frameworks, then vanilla JS.
const summary = [
  ['**overall time vs vanilla JS**', geomean, (v) => `${v.toFixed(2)}×`],
  ['bundle size (min + gzip)', (app) => apps[app].size.gzip, (v) => `${kb(v)} KB`],
  ...(hasStartup
    ? [['script time during page load', (app) => apps[app].startup.script.median, (v) => `${ms(v)} ms`]]
    : []),
  ['JS heap after load', (app) => apps[app].memory.ready, (v) => `${v.toFixed(2)} MB`],
  ['JS heap with 1,000 rows', (app) => apps[app].memory.run1k, (v) => `${v.toFixed(2)} MB`],
  ...operations.map((op) => [
    `${op.name}${op.throttle > 1 ? ` (${op.throttle}× CPU slowdown)` : ''}`,
    (app) => apps[app].timings[op.id].median,
    (v) => `${ms(v)} ms`,
  ]),
];
const summaryRows = summary.map(([label, value, format]) => boldRow(label, CHARTED, value, format));

// Rows where HTMS matches or beats each other framework.
const headToHead = FRAMEWORKS.filter((app) => app !== 'htms').map((app) => {
  // Compared as printed, so a row that shows the same value counts as a match.
  const wins = summary.filter(
    ([, value, format]) => parseFloat(format(value('htms'))) <= parseFloat(format(value(app)))
  ).length;
  return `${apps[app].label} ${wins} of ${summary.length}`;
});
// Operations where HTMS runs no more JavaScript than any other framework.
const scriptLeads = operations.filter((op) =>
  FRAMEWORKS.every(
    (app) =>
      parseFloat(ms(apps.htms.timings[op.id].script)) <=
      parseFloat(ms(apps[app].timings[op.id].script))
  )
).length;
const ranking = [...FRAMEWORKS].sort((a, b) => geomean(a) - geomean(b));
const standing =
  ranking[0] === 'htms'
    ? 'HTMS has the lowest overall time of the frameworks tested'
    : `HTMS ranks ${ranking.indexOf('htms') + 1} of ${FRAMEWORKS.length} frameworks on overall time`;

const readmeBlock = `<!-- bench:start -->
![Overall time relative to vanilla JS for ${FRAMEWORKS.map((app) => apps[app].label).join(', ')}](bench/results/overall.svg)

![Time per operation relative to vanilla JS](bench/results/speed.svg)

![Bundle size, startup and memory](bench/results/footprint.svg)

${table(['', ...CHARTED.map((app) => (app === 'htms' ? `**${apps[app].label}**` : apps[app].label))], summaryRows)}

${standing} (${geomean('htms').toFixed(2)}× vanilla JS). Its scripting time is lowest or tied for lowest on ${scriptLeads} of ${operations.length} operations ([scripting table](bench/results/RESULTS.md#scripting-time-ms-median)). Rows where HTMS matches or beats each framework: ${headToHead.join(', ')}.
Bold marks the best framework in each row; vanilla JS is the hand-written reference. ${escape(environment.browser)} on ${escape(environment.cpu)},
median of ${environment.runs} runs, measured ${measurementDate}. Full tables are in
[bench/results/RESULTS.md](bench/results/RESULTS.md); the method and caveats are in
[bench/README.md](bench/README.md).
<!-- bench:end -->`;

fs.writeFileSync(path.join(resultsDir, 'overall.svg'), overallChart());
fs.writeFileSync(path.join(resultsDir, 'speed.svg'), speedChart());
fs.writeFileSync(path.join(resultsDir, 'footprint.svg'), footprintChart());
fs.writeFileSync(path.join(resultsDir, 'RESULTS.md'), resultsMarkdown);

if (!process.argv.includes('--no-readme')) {
  const readmePath = path.join(here, '..', 'README.md');
  const readme = fs.readFileSync(readmePath, 'utf8');
  if (readme.includes('<!-- bench:start -->')) {
    fs.writeFileSync(
      readmePath,
      readme.replace(/<!-- bench:start -->[\s\S]*<!-- bench:end -->/, readmeBlock)
    );
    console.log('Updated README benchmark summary');
  }
}
console.log('Wrote results/RESULTS.md, overall.svg, speed.svg and footprint.svg');
