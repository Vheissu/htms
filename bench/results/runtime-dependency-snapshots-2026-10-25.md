# Reuse unchanged effect dependency snapshots

Every runtime flush allocated a new array for every effect's dependency values.
The runtime now keeps the previous snapshot when all evaluated values and their
count remain unchanged. On the first changed value, it copies the evaluated
prefix and collects the remaining values into a new snapshot. Earlier snapshots
are never mutated. No persistent fields or caches were added.

A supplementary browser workflow measures one compiled counter update alongside
10,000 live effects, each with three stable dependencies. The button increments
the rendered counter and calls runtime.notify. Timing runs from click dispatch
through the first painted commit, using the existing benchmark's trace-duration
calculation. The comparison baseline is bd094ce.

| Cohort | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| Initial screen, 15 samples per revision | 13.335 ms | 11.008 ms | -17.45% |
| Independent confirmation, 62 samples per revision | 13.627 ms | 11.439 ms | -16.06% |

Confirmation scripting medians fell from 10.847 to 8.367 ms, or 22.86%.
The click-to-paint median-difference 95% interval is [-2.498, -1.864] ms;
the paired mean interval is [-3.684, -1.659] ms. Both satisfy the criterion
recorded before confirmation: their upper bounds must be negative.

Confirmation uses 31 mirrored rounds in candidate, baseline, baseline,
candidate order. Every sample has a fresh page, five warmup clicks, 4x CPU
throttling and a sixth measured click. Assertions check the rendered counter,
effect execution and retention counts, empty pending records and absence of
page/render errors. All samples are retained. Bootstrap intervals use 20,000
whole-round resamples with seed 0x251029; mean intervals use Student t with
30 degrees of freedom. No builds, tests or profiling ran alongside timings.

Preservation checks against the same baseline:

| Browser workload | Samples per revision | Before median | After median |
| --- | ---: | ---: | ---: |
| Every effect's first dependency changes | 15 | 14.839 ms | 9.532 ms |
| Clear 1,000 effect-owning components | 15 | 27.212 ms | 26.497 ms |
| Clear 1,000 unowned components | 15 | 5.632 ms | 5.912 ms |
| Independent reversed unowned check | 31 | 5.468 ms | 5.582 ms |

These are regression checks; no additional speedup is claimed. Both unowned
median-difference intervals include zero: [-0.418, +0.674] ms and
[-0.156, +0.282] ms. The disposal implementation itself is unchanged.

The unchanged 5,000-effect benchmark initially showed cleanup medians of
1.166 ms before and 1.252 ms after across 101 alternating samples. An independent
201-sample comparison reversed the module roles and measured 0.899 ms before
and 0.898 ms after. First registration was 1.548 versus 1.574 ms and
re-registration 1.300 versus 1.269 ms in that reversed comparison. Every run
retained 5,000 records after registration/re-registration, deduplicated owner/ID
pairs and immediately removed all owned records on disposal. The raw reversed
result labels are current=old build and baseline=candidate.

The existing benchmark inputs remain unchanged; all 24 hashes were verified.
The default table benchmark has no effects, and its generated source and bundle
are byte-identical, preserving its creation, clearing and heap behaviour.
Bundle SHA-256 remains
`551d10d171b9ec71a505031615bb421a0d1618795eafcffed0ee8d7376b079b6`:
13,689 bytes minified, 5,013 gzip and 4,433 Brotli. Framework charts were not
regenerated. The measured 16.06% gain applies to the stated effect-heavy update
workflow, not to every renderer operation.

Validation passed: lint, types, build, 397 unit tests in 30 suites with coverage,
28 browser tests, Vite integration and strict CLI compilation. Four new tests
cover snapshot reuse without mutation, NaN's existing strict-inequality
behaviour, dependency callbacks that grow or shrink the list during evaluation,
and skipped initial effects. The implementation records the number of callbacks
actually evaluated, even when a callback changes the dependency list mid-loop.

```sh
npm run build
node bench/effects.mjs /path/to/bd094ce/dist --count 5000 --runs 101
node dist/cli.js compile demos/counter-component.html -o /tmp/dependency-counter.js --format esm --strict
```

The CLI still emits `customElements.define('counter-box', CounterBoxComponent)`.
Measurements used Apple M2 Max, Darwin 25.3.0 arm64, Node 25.2.1 and Chromium
141.0.7390.37. The analysis includes the full fixture, input hashes and the
local archive path containing exact runners, compiled apps and traces.

Evidence: [analysis](runtime-dependency-snapshots-analysis.json),
[screen](runtime-dependency-snapshots-screen.json),
[confirmation](runtime-dependency-snapshots-confirmation.json),
[preservation checks](runtime-dependency-snapshots-guards.json).
