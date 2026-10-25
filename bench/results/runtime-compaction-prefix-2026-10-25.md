# Skip writes to the live prefix during effect compaction

Effect compaction rewrote every surviving record, including the prefix before
the first disposed effect. It now scans past that prefix and starts moving
records after the first hole. Record order, cleanup timing, array identity and
compaction boundaries are unchanged. The change adds no fields or allocations.

A browser comparison against 5b148d8 clears 1,000 compiled components, each
owning one effect, while 1,000 unrelated effects remain ahead of them in the
runtime array. Skipping that live prefix avoids one million redundant record
writes across the clear operation. Compaction still scans the prefix; this is
not a change to its asymptotic complexity.

| Click-to-paint cohort | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| Initial screen, 15 samples per revision | 26.589 ms | 17.318 ms | -34.87% |
| Independent confirmation, 62 samples per revision | 27.788 ms | 18.1165 ms | -34.80% |

Confirmation scripting medians fell from 24.9765 to 14.8355 ms, or 40.60%.
The click-to-paint median-difference 95% interval is [-10.746, -8.918] ms;
the paired mean interval is [-10.528, -9.405] ms. Both pass the criterion
recorded before confirmation: their upper bounds must be negative.

Confirmation uses 31 mirrored rounds in candidate, baseline, baseline,
candidate order. Each sample uses a fresh page, five warmup clear/refill cycles
and 4x CPU throttling. Timing includes click dispatch through the first painted
commit, using the existing framework benchmark's trace calculation. Every
sample asserts zero rows, 1,000 retained unrelated effects with no extra runs,
zero pending effects and no page/render errors. All samples are retained.
Intervals use 20,000 whole-round bootstrap resamples with seed 0x251029 and
Student t with 30 degrees of freedom for the paired mean.

Preservation checks used the existing supplementary workflows:

| Browser check, 15 samples per revision | Before median | After median |
| --- | ---: | ---: |
| Counter update alongside 10,000 stable effects | 10.459 ms | 10.153 ms |
| Clear 1,000 unowned components | 5.877 ms | 5.707 ms |

These are regression checks; no additional speedup is claimed. The unchanged
5,000-effect benchmark used 101 alternating samples. First registration was
1.691 ms before and 1.669 ms after; re-registration was 1.420 and 1.409 ms.
Single-owner cleanup was initially higher, at 1.044 versus 1.165 ms. An
independent 201-sample run reversed the module roles and measured 1.279 ms
before versus 1.201 ms after for cleanup. In that reversed run, registration
was 1.936 versus 1.920 ms and re-registration 1.592 versus 1.627 ms. The
cleanup slowdown did not repeat. Both comparisons are retained in the evidence;
the reversed raw labels are current=old build and baseline=candidate.

All effect benchmark runs retain exactly 5,000 records after registration and
re-registration, deduplicate owner/ID pairs and immediately leave zero owned
records after disposal. The owner-index and dependency-snapshot implementations
are unchanged.

The existing benchmark inputs are unchanged, with all 24 hashes verified.
The default table's generated source and bundle remain byte-identical,
preserving its creation, clearing and heap behaviour. Bundle SHA-256 remains
`551d10d171b9ec71a505031615bb421a0d1618795eafcffed0ee8d7376b079b6`:
13,689 bytes minified, 5,013 gzip and 4,433 Brotli. The original table has no
effects; the 34.80% improvement applies to the stated runtime teardown workflow.
Framework charts were not regenerated.

Validation passed: lint, types, build, 400 unit tests in 30 suites with coverage,
28 browser tests, Vite integration and strict CLI compilation. Three new cases
remove an effect at the beginning, middle and end of an array, verify survivor
order and array identity, and assert that the retained prefix is never rewritten.
Existing tests cover complete removal, pending effects and nested cleanup.

```sh
npm run build
node bench/effects.mjs /path/to/5b148d8/dist --count 5000 --runs 101
node dist/cli.js compile demos/counter-component.html -o /tmp/prefix-counter.js --format esm --strict
```

The CLI still emits `customElements.define('counter-box', CounterBoxComponent)`.
Measurements used Apple M2 Max, Darwin 25.3.0 arm64, Node 25.2.1 and Chromium
141.0.7390.37. No builds, test suites or profiling ran alongside qualifying
timings. The analysis includes the full fixture, unchanged input hashes and a
local archive path containing exact runners, compiled apps and traces.

Evidence: [analysis](runtime-compaction-prefix-analysis.json),
[screen](runtime-compaction-prefix-screen.json),
[confirmation](runtime-compaction-prefix-confirmation.json),
[preservation checks](runtime-compaction-prefix-guards.json).
