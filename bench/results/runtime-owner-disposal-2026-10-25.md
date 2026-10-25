# Skip unrelated effect owners during component teardown

Every compiled component calls `disposeEffectsFor(this)` when it disconnects.
Previously, that call scanned and compacted the entire effects array even when
the component had never owned an effect. Clearing a list of stateless components
therefore repeated work over effects belonging to other parts of the page.

The runtime now checks its existing owner index first. A single runtime flag
tracks whether disposed records need compaction. Cleanup remains synchronous,
surviving effects retain their order, and disposed records leave the active and
pending arrays at the same boundaries as before. There are no new per-component
or per-effect fields, allocations or indexes. Owners that do have effects still
use the existing ordered disposal path.

A supplementary browser workflow measures a real clear-button click through the
first painted commit: remove 1,000 compiled custom elements while 1,000 unrelated
live effects remain. The elements use the default block renderer. A diagnostic
baseline CPU profile identified `disposeEffectsFor` as the largest named runtime
cost, with 12.653 ms of self time. Profiling was disabled for qualifying runs.

| Click-to-paint comparison against ef7e86c | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| First cohort, 62 samples per revision | 21.995 ms | 6.377 ms | -71.01% |
| Independent reversed-order confirmation, 62 samples per revision | 21.795 ms | 6.4065 ms | -70.61% |

In confirmation, scripting fell from 18.8115 to 4.298 ms, or 77.15%. The
click-to-paint median difference has a paired bootstrap 95% interval of
[-15.667, -15.171] ms. The paired mean interval is [-15.718, -15.209] ms. Both
cohorts pass the criterion recorded before measurement: both upper bounds must
be negative. All 248 timed clicks are included, without outlier filtering or
extending a completed cohort.

Each cohort has 31 mirrored rounds with two samples per revision per round.
Ordering is baseline, candidate, candidate, baseline in the first cohort and
the reverse in confirmation. Each sample uses a fresh page, five warmup
clear/refill cycles and 4x CPU throttling during measurement. The runner copies
the existing framework benchmark's trace-duration calculation, from click
dispatch through the first Paint/Commit, including merged scripting intervals.
Every sample checks that all rows were removed, all 1,000 effects remain alive,
none ran again, no effects remain pending, and no render or page error occurred.

The original framework benchmark has no effects and does not exercise this
teardown cost. Its fixture, CSS, runner, warmups and timing boundaries are
unchanged. The default table's generated source and minified bundle are
byte-identical to ef7e86c, preserving its creation, clearing and heap behaviour:

- Generated source SHA-256: `70e3206310d71e1ea3940310dfb2547d58e2cae61887b36450afbe635867629c`
- Bundle SHA-256: `551d10d171b9ec71a505031615bb421a0d1618795eafcffed0ee8d7376b079b6`
- 13,689 bytes minified, 5,013 gzip, 4,433 Brotli, unchanged.

The unchanged effects benchmark provides a separate preservation check, using
5,000 effects and 101 alternating samples:

| Operation | Before median | After median |
| --- | ---: | ---: |
| First registration | 1.933 ms | 1.940 ms |
| Re-registration | 1.514 ms | 1.490 ms |
| Dispose one owner's effects | 1.185 ms | 1.168 ms |

All three median-difference confidence intervals include zero. No additional
speedup is claimed for these operations. Both versions retain exactly 5,000
records after registration and re-registration, deduplicate owner/ID pairs and
leave zero owned records immediately after disposal. The analysis records all
24 unchanged benchmark input hashes. Framework charts were not regenerated.

Validation passed: lint, TypeScript checks, build, 391 Jest tests in 30 suites
with coverage, 28 browser tests, Vite production/dev integration and strict CLI
compilation. Four added regression cases cover the unrelated-owner scan,
compaction after handle disposal for the same and a different owner, and pending
effects disposed during cleanup. Existing flush coverage now also checks that
unrelated disposal preserves live pending effects. Runtime tests use a fresh
bootstrap host because the installed runtime property is non-configurable.

```sh
npm run build
node bench/effects.mjs /path/to/ef7e86c/dist --count 5000 --runs 101
node dist/cli.js compile demos/counter-component.html -o /tmp/runtime-counter.js --format esm --strict
```

The CLI still emits `customElements.define('counter-box', CounterBoxComponent)`.
The analysis includes the complete supplementary HTML fixture and an archive
path for its exact builder, browser runner, analysis script, compiled apps, CPU
profile and representative traces. The browser setup registers 1,000 effects
with stable dependencies on a connected element outside the list; each run
fills the list with keys 0 through 999, then clicks its compiled clear handler.
This result applies to teardown alongside unrelated effects; it is not a claim
of a 71% improvement across all runtime operations.

Measurements ran on Apple M2 Max, Darwin 25.3.0 arm64, Node 25.2.1 and Chromium
141.0.7390.37. No build, test suite or CPU profiler ran alongside qualifying
timings. Bootstrap intervals use 20,000 whole-round resamples with seed
0x251029; paired mean intervals use Student t with 30 degrees of freedom.

Evidence: [analysis and preservation checks](runtime-owner-disposal-analysis.json),
[first cohort](runtime-owner-disposal-screen.json),
[independent confirmation](runtime-owner-disposal-confirmation.json),
[unchanged effects benchmark](runtime-owner-disposal-effects.json).
