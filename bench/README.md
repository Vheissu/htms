# HTMS benchmarks

This directory runs the operations of
[js-framework-benchmark](https://github.com/krausest/js-framework-benchmark)
against the same app written for each framework:

| App | Source |
| :-- | :-- |
| **HTMS** | [`apps/htms/app.html`](apps/htms/app.html), compiled with the default block renderer |
| **Svelte 5** | [`apps/svelte/Main.svelte`](apps/svelte/Main.svelte), the official keyed Svelte (runes) implementation |
| **Solid** | [`apps/solid/main.jsx`](apps/solid/main.jsx), the official keyed Solid implementation |
| **Vue** | [`apps/vue/App.vue`](apps/vue/App.vue), the official keyed Vue 3 implementation |
| **React** | [`apps/react/main.jsx`](apps/react/main.jsx), the official keyed React hooks implementation |
| **Vanilla JS** | [`apps/vanilla/Main.js`](apps/vanilla/Main.js), the official hand-written keyed implementation |
| HTMS (reconciler) | the same `app.html`, compiled with `renderer: 'legacy'`; built, but only measured with `--apps htms-legacy,...` |

The Svelte, Solid, Vue, React and vanilla sources are copied unmodified from
js-framework-benchmark, as are `css/main.css` and the operation definitions
(Apache License 2.0). Only their `index.html` pages differ, to load the
bundle as a module. The HTMS app uses ordinary HTMS: `<var>` state,
`<function>` methods, a keyed `<repeat>`, `on:click` handlers and in-place
array mutation.

Versions: Svelte 5.57.1, Solid 1.9.17, Vue 3.5.44, React 19.3.0.

## Running

```bash
cd bench
npm install
npm run build          # builds the compiler, then every app into dist/
npm run bench          # writes results/results.json (15 runs, about an hour)
node report.mjs        # writes results/RESULTS.md, the charts and the README summary
```

`node run.mjs --runs 5 --apps htms,svelte --ops run1k,select` runs a subset.
`node micro.mjs` is a quick script-only comparison (no layout or paint).

`node rows.mjs htms,solid 1000,10000` isolates selection, swaps and removal
at both list sizes. It rotates app order across nine samples, uses 4× CPU
slowdown and a high-resolution clock, and lets layout/paint finish outside
each timed update. Results are written to `results/row-scripting.json`.
An optional retained build can be included by app directory name.

Pass `--trace-dir /tmp/htms-traces` to `run.mjs` to retain the first browser
trace for each app/operation. Use a fresh directory for each comparison.

The [24 October row update investigation](results/row-updates-2026-10-24.md)
compares the selection optimization with a retained build of the preceding
revision, measured alongside the frameworks in the same run.
The [swap follow-up](results/swaps-2026-10-24.md) profiles DOM moves and
compares native moves with the previous renderer.
The [reconciler investigation](results/reconciler-2026-10-24.md) measures
allocation reductions in the fallback renderer. The default block-renderer
bundle is unchanged in that comparison.

## Compiler and effect registration

`compiler.mjs`, `derived.mjs` and `effects.mjs` compare the current package build with a
baseline build. Both accept the baseline's `dist` directory:

```bash
# From the repository root, after building both revisions:
node bench/compiler.mjs /path/to/baseline/dist --runs 15 --warmup 30
node bench/derived.mjs /path/to/baseline/dist
node bench/effects.mjs /path/to/baseline/dist --count 5000 --runs 9
```

These measure compiler throughput and effect registration separately from
browser layout and paint. They don't update the framework comparison charts.
The [23 October runtime checks](results/runtime-2026-10-23.md) record the
derived-calculation and effect-registry changes, including raw samples.
The framework table app uses neither `<derive>` nor `<effect>`, so it does
not exercise those optimizations.

## Vite integration check

After installing the dependencies in this directory, run `npm run test:vite`.
It builds the package and tests the plugin against Vite in Chromium: a
production bundle, development imports, reloads, raw HTML imports, compiler
errors and recovery after an edit. Install the browser with
`npx playwright install chromium` from the repository root if needed.

## Method

- **Same toolchain.** Every app is bundled and minified by the same Vite
  8.3.1 production build, with each framework's official Vite plugin
  (`@sveltejs/vite-plugin-svelte` 7.3.1, `vite-plugin-solid` 2.11.14,
  `@vitejs/plugin-vue` 6.0.10; React's JSX uses Vite's built-in automatic
  runtime). Sizes are of that output.
- **Same page.** Every app renders the benchmark's markup with Bootstrap 3.3.6
  and `main.css`. HTMS renders into light DOM (`shadow="none"`) so the global
  stylesheet applies, as it does for the others.
- **Real clicks.** Each sample loads a fresh page in Chromium (new headless
  mode, through Playwright), performs the operation's warm-up steps, then
  clicks the operation's button with a CDP mouse event.
- **Click to paint.** A performance trace records the click. The duration
  runs from the start of the click's `EventDispatch` to the end of the
  first frame that paints after it (its `Commit`). Every app updates the DOM
  in the click's task or its microtasks, so that frame shows the result.
  It includes script, style, layout and paint. Frames after it, such as one
  the harness itself requests while waiting, are not counted.
- **Scripting** is the main-thread time inside event dispatch, function
  calls, microtasks and timers in the same window, with nested events merged.
- **CPU throttling** follows js-framework-benchmark: 4× for partial update,
  select, swap and clear; 2× for remove and append; none for the creates.
- **Interleaved samples.** For every operation, the apps take turns, so a
  change in machine load affects all of them rather than one.
- **Startup** loads each page fresh under a trace and adds up main-thread
  time spent compiling and running scripts (the bundle, which renders the
  app) from navigation until shortly after the first paint. Median of the
  same number of runs. The runner also records first contentful paint in
  `results.json`; it is left out of the report because it tracks machine
  load more than the app.
- **Memory** is `JSHeapUsedSize` after two forced garbage collections, median
  of three page loads.

## Operations

| Operation | Measures |
| :-- | :-- |
| create rows | creating 1,000 rows after 5 create/clear warm-ups |
| replace all rows | replacing 1,000 rows with 1,000 new ones |
| partial update | appending `" !!!"` to every 10th label of 1,000 rows |
| select row | highlighting the clicked row |
| swap rows | swapping rows 2 and 999 |
| remove row | removing one row |
| create many rows | creating 10,000 rows |
| append rows | appending 1,000 rows to 1,000 |
| clear rows | removing 1,000 rows |

## Caveats

- This harness reproduces js-framework-benchmark's operations and duration
  definition; it is not that project's runner. Numbers are comparable within
  one run of this harness, not with the published js-framework-benchmark
  tables.
- Layout and paint are most of the duration for the large operations, and
  they are the same work for every app (the DOM is identical). The
  scripting table in `RESULTS.md` shows framework cost more directly.
- Pages are served from localhost without compression, so the startup
  numbers measure parse and run cost rather than download time.
- Results depend on the machine. The environment is recorded in
  `results/results.json` and printed at the top of `results/RESULTS.md`.
  Report dates use the recorded machine time zone, with UTC as the fallback
  for older results.
- Per-row bolding and match counts compare displayed values, so ties can
  reflect rounding. The overall geometric mean uses unrounded measurements.
