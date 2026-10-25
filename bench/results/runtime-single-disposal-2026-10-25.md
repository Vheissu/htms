# Locate single-effect disposals with native search

Effect compaction scanned each surviving record before the first hole. Clearing
many components, each owning one effect, repeated those JavaScript property
reads for every disconnect. The existing compaction flag now holds the first
disposed record. A single disposal uses `indexOf` to locate it; multiple
disposals keep the full scan. Pending records absent from the active array fall
back to the original scan. Compaction timing, cleanup order and array identity
are unchanged. This adds no fields or allocations and retains no extra records
after compaction. The search remains linear.

A browser comparison against 13ace33 clears 1,000 compiled components, each
owning one effect, while 1,000 unrelated effects remain ahead of them.

| Click-to-paint cohort | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| Initial screen, 15 samples per revision | 17.800 ms | 13.495 ms | -24.19% |
| Independent confirmation, 62 samples per revision | 16.956 ms | 13.4585 ms | -20.63% |

Confirmation scripting fell from 14.2475 to 10.8055 ms, or 24.16%.
The click-to-paint median-difference 95% interval is [-3.865, -3.1235] ms;
the paired mean interval is [-3.6951, -3.0231] ms. Both pass the criterion
recorded before confirmation: negative upper bounds. All samples are retained.

Each of 31 mirrored rounds measures candidate, baseline, baseline, candidate.
Every sample uses a fresh Chromium page, five warmup clear/refill cycles and
4x CPU throttling. The trace calculation is copied unchanged from
`bench/run.mjs`, from click dispatch through the first painted commit.
Assertions check zero rows, 1,000 surviving unrelated effects without extra
runs, zero pending effects and no page/render errors. Intervals use 20,000
whole-round bootstrap resamples with seed 0x251029 and Student t with 30 degrees
of freedom for the paired mean. No builds, tests or CPU profiling ran alongside
qualifying timings.

Preservation checks against the same baseline:

| Browser workload, 15 samples per revision | Before median | After median |
| --- | ---: | ---: |
| Update 1,000 runtime bindings | 30.945 ms | 30.696 ms |
| Update alongside 10,000 stable effects | 9.828 ms | 9.904 ms |
| Clear 1,000 unowned components | 5.949 ms | 5.637 ms |

All three median-difference confidence intervals include zero. The unchanged
5,000-effect benchmark used 201 samples: first registration was 2.7864 ms before
and 2.8298 ms after, re-registration 1.8605 and 1.7692 ms, and single-owner
cleanup 0.9185 and 0.9090 ms. Their paired bootstrap median-difference intervals
also include zero. Both versions retain 5,000 records after registration and
re-registration, deduplicate owner/ID pairs and remove all owned records on
disposal. No additional gains are claimed for these checks.

All 24 existing benchmark input hashes are unchanged. The default table's
generated source and 13,689-byte minified bundle remain byte-identical,
preserving its creation, clearing and heap behaviour. Bundle SHA-256 remains
`551d10d171b9ec71a505031615bb421a0d1618795eafcffed0ee8d7376b079b6`.
The table contains no runtime effects; the measured gain applies to the stated
teardown workflow. Framework charts were not regenerated.

Validation passed: lint, types, build, 413 unit tests in 31 suites with coverage,
29 browser tests, Vite integration and strict CLI compilation. Two new cases
cover cleanup that disposes an earlier effect and disposal of a pending record
while active effects survive. Existing cases cover prefix writes, removal at
each array position, nested cleanup and replacement registrations.

```sh
npm run build
node bench/effects.mjs /path/to/13ace33/dist --count 5000 --runs 201
node dist/cli.js compile demos/counter-component.html -o /tmp/single-disposal.js --format esm --strict
```

Measurements used Apple M2 Max, Darwin 25.3.0 arm64, Node 25.2.1 and Chromium
141.0.7390.37. [Evidence](runtime-single-disposal.json) includes the criteria,
full fixture, raw samples, field layouts, unchanged input hashes and local
archive path for the exact runners, compiled apps and traces.
