# Remove a single disposed effect with splice

When exactly one active effect was disposed, compaction still copied its live
suffix through a JavaScript loop. It now uses `splice` after the existing native
reference search. Multiple disposals and pending records absent from the active
array keep the previous loop. Cleanup timing, survivor order and array identity
are unchanged. The change adds no runtime or effect fields.

A browser comparison against f932d03 clears 1,000 compiled components, each
owning one effect, while 1,000 unrelated effects remain ahead of them.

| Click-to-paint cohort | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| Initial screen, 15 samples per revision | 13.588 ms | 10.357 ms | -23.78% |
| Independent confirmation, 62 samples per revision | 13.575 ms | 10.0935 ms | -25.65% |

Confirmation scripting fell from 10.6835 to 7.2445 ms, or 32.19%.
The click-to-paint median-difference 95% interval is [-3.732, -3.2375] ms;
the paired mean interval is [-3.6699, -3.2883] ms. Both satisfy the criterion
recorded before confirmation: negative upper bounds. Every sample is retained.

Each of 31 mirrored rounds measures baseline, candidate, candidate, baseline.
Samples use fresh Chromium pages, five warmup clear/refill cycles and 4x CPU
throttling. The trace calculation is copied unchanged from `bench/run.mjs`,
from click dispatch through the first painted commit. Assertions check zero
rows, 1,000 surviving unrelated effects without extra runs, zero pending effects
and no page/render errors. Intervals use 20,000 whole-round bootstrap resamples,
seed 0x251029, and Student t with 30 degrees of freedom for the paired mean.
No builds, tests or CPU profiling ran alongside qualifying timings.

Preservation checks, each with 15 browser samples per revision:

| Workload | Before median | After median |
| --- | ---: | ---: |
| Update 1,000 runtime bindings | 30.582 ms | 30.168 ms |
| Update alongside 10,000 stable effects | 9.832 ms | 9.737 ms |
| Clear 1,000 unowned components | 5.669 ms | 5.614 ms |
| Clear one component owning 5,000 effects | 3.775 ms | 3.675 ms |

All four click-to-paint median-difference intervals include zero. The unchanged
5,000-effect benchmark used 201 samples. First registration was 1.8211 ms before
and 1.9199 ms after, re-registration 1.4130 and 1.3999 ms, and single-owner cleanup
0.7074 and 0.7120 ms. An independent 201-sample run reversed the module roles:
registration was 2.2572 versus 2.0474 ms, re-registration 1.5367 versus 1.5230 ms,
and cleanup 0.7425 versus 0.7939 ms. The registration slowdown did not repeat.
Cleanup was higher in the reversed run; the browser bulk-cleanup check above
found no clear end-to-end difference. Both microbenchmark cohorts and their
intervals are retained. Reversed raw labels are current=old and baseline=candidate.
All runs preserve record counts, owner/ID deduplication and immediate disposal.

The effect fixture's retained heap was 2,408 bytes higher both before and after
clearing, with both revisions releasing exactly 698,540 bytes. Before forced GC,
the candidate used 30,416 more bytes after the operation. `splice` returns a
temporary one-element array, so this is not a zero-allocation change. Heap
samples do not measure peak memory. The default table's generated source and
13,689-byte bundle remain byte-identical, preserving its creation, clearing and
heap gains. Bundle SHA-256 remains
`551d10d171b9ec71a505031615bb421a0d1618795eafcffed0ee8d7376b079b6`.
That table contains no global runtime effects; the measured improvement applies
to the stated teardown workflow. All 24 benchmark input hashes are unchanged.
Framework charts were not regenerated.

Lint, types, build, 413 unit tests in 31 suites with coverage, 29 browser tests,
Vite integration and strict CLI compilation passed. Existing runtime cases
cover holes at the beginning, middle and end, untouched live prefixes, multiple
disposals, backward nested cleanup, pending records and replacement registrations.

A `copyWithin` trial was discarded: click-to-paint rose from 13.744 to 57.378 ms.
[Evidence](runtime-native-compaction.json) includes criteria, raw samples,
guard results, the full fixture, unchanged input hashes and a local archive of
the exact runners, compiled apps and traces. Measurements used Apple M2 Max,
Darwin 25.3.0 arm64, Node 25.2.1 and Chromium 141.0.7390.37.
