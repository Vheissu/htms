# Reuse read-only parses during compilation

The component compiler repeatedly parses the same JavaScript while scoping names, analysing dependencies and planning text bindings. Sharing these read-only syntax trees within one compilation reduces parsing attempts from 326 to 162 on the existing 10,558-byte compiler fixture. A second invocation still performs 162 parses: compiled files and their ASTs are not retained between calls.

The unchanged compiler benchmark confirms a throughput improvement against d3a856f:

| Comparison | Before median | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Screen, 101 samples per version | 3.501 ms | 3.338 ms | -4.66% |
| Independent reversed-role confirmation, 251 samples | 3.136 ms | 2.971 ms | -5.26% |

The confirmation's paired bootstrap 95% interval for the median difference is [-0.226, -0.083] ms. Its paired mean difference is -0.119 ms, with 95% interval [-0.188, -0.050] ms. Both meet the criterion recorded before confirmation: their upper bounds must be negative. Each run uses the original fixture, alternating sample order and 30 warmups. The confirmation reverses the module roles through the benchmark's existing HTMS_CURRENT_DIST option; its raw `current` label is the old build and `baseline` label is the candidate.

Full public-API checks include parseHTML's validation and formatting. They provide a more limited result:

| Public compile workload | Before median | Candidate median | Change |
| --- | ---: | ---: | ---: |
| Original directive fixture, 251 rounds | 8.074 ms | 7.770 ms | -3.78% |
| All 14 demo components, 251 rounds | 15.960 ms | 15.678 ms | -1.77% |
| Independent reversed-order demo batch, 501 rounds | 15.455 ms | 14.993 ms | -2.99% |

All three median-difference intervals are negative. The first demo-batch run also has a negative paired mean interval. However, the directive fixture's mean interval [-0.381, +0.217] ms and the demo holdout's [-1.208, +0.075] ms cross zero. Those two comparisons fail the combined criterion requiring both intervals below zero. No verified full-public-API speedup is claimed. These measurements include every sample, with no outlier removal or extension of a finished cohort. Browser rendering, network work and whole Vite/CLI process time were not measured as compiler gains.

The cache is bounded to 256 syntax trees and 65,536 source code units per compilation. It is released in finally, restoring any outer context during nested compilation. Script and module grammars have separate entries. Formatting and comment attachment continue to receive fresh, mutable ASTs. Scope rewriting and security checks still run for each use; only parsing is shared. Large or additional snippets use ordinary parsing once either bound is reached.

Generated results are identical across 96 comparisons: 16 sources, both auto and legacy renderers, and ESM/CJS/IIFE output. Comparisons include code, diagnostics and component metadata. The benchmark's default-renderer bundle is also byte-identical to d3a856f:

- SHA-256: `551d10d171b9ec71a505031615bb421a0d1618795eafcffed0ee8d7376b079b6`
- 13,689 bytes minified, 5,013 gzip, 4,433 Brotli, unchanged.

The renderer's executable code is unchanged, preserving its creation, clearing and heap behaviour. The existing framework and compiler benchmarks are unchanged, including fixtures, CSS, runners, warmups and timing boundaries. All 22 input hashes are recorded in the analysis. Framework charts were not regenerated.

Validation passed: lint, TypeScript checks, build, 387 Jest tests in 30 suites with coverage, 28 browser tests, Vite production/dev imports, reload, raw imports, error overlay/recovery and strict CLI compilation. Six added tests cover cache lifetime, mutable/comment isolation, script/module separation, nested error recovery, resource bounds and scoping with shared trees.

```sh
node dist/cli.js compile demos/counter-component.html -o /tmp/counter-cache-check.js --format esm --strict
node bench/compiler.mjs /path/to/baseline/dist --runs 251 --warmup 30
```

The CLI emits the same component registration as before, including:

```js
customElements.define('counter-box', CounterBoxComponent);
```

Measurements ran on Apple M2 Max, Darwin 25.3.0 arm64, Node 25.2.1. Builds, tests and other profiling jobs did not run alongside timed comparisons. Bootstrap intervals resample paired rounds with 20,000 draws and seed 0x251028; mean intervals use conservative Student t critical values. The analysis records traversal order, source hashes, input hashes and acceptance criteria.

Evidence: [analysis and criteria](compiler-parse-cache-analysis.json), [unchanged compiler confirmation](compiler-parse-cache-confirmation.json), [screen](compiler-parse-cache-screen.json), [public API checks](compiler-parse-cache-public.json), [public API holdout](compiler-parse-cache-holdout.json), [parse counts](compiler-parse-cache-counts.json), [output equivalence](compiler-parse-cache-equivalence.json).
