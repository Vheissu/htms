# Native ID lookup for runtime bindings

Runtime bindings used CSS selector lookup for every target on every flush.
Simple ASCII ID selectors now use getElementById in standards-mode HTML.
Other selectors, quirks mode and XML retain querySelector. Targets are resolved
again on every update; no node references or lookup caches are added.

The lookup expression is generated inline from one TypeScript helper. This keeps
the installed runtime and effect field layouts unchanged and avoids adding an
outer helper closure to effect registration.

A supplementary browser workflow updates a compiled counter and 1,000 text
bindings. It measures click dispatch through the first painted commit, using
the existing framework benchmark's trace calculation. The baseline is 8876b6a;
Claude's subsequent CLI cleanup, b62e388, was integrated before final checks.
The measured application bundle was unchanged by that integration.

| Cohort | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| Final implementation screen, 15 samples per revision | 31.842 ms | 29.416 ms | -7.62% |
| Independent confirmation, 62 samples per revision | 32.029 ms | 29.062 ms | -9.26% |

Confirmation scripting fell from 5.4705 to 3.605 ms, or 34.10%. The paired
bootstrap median-difference 95% interval is [-3.365, -2.473] ms; the paired mean
interval is [-3.311, -2.437] ms. Both satisfy the criterion recorded before
measurement: negative upper bounds. All samples are retained.

Confirmation has 31 mirrored rounds in candidate, baseline, baseline, candidate
order. Each sample uses a fresh page, five warmup updates and 4x CPU throttling.
Assertions check the counter, all 1,000 original target elements and their text,
watcher count, empty effect/pending arrays and absence of page/render errors.
Intervals use 20,000 whole-round resamples, seed 0x251029, and Student t with
30 degrees of freedom for the paired mean. Builds, tests and CPU profiling did
not run alongside qualifying timings.

Preservation checks against the same baseline:

| Browser workload, 15 samples per revision | Before median | After median |
| --- | ---: | ---: |
| Clear 1,000 effect-owning components | 16.194 ms | 16.016 ms |
| Clear 1,000 unowned components | 5.351 ms | 5.157 ms |
| Update alongside 10,000 stable effects | 9.448 ms | 9.686 ms |

All three median-difference confidence intervals include zero. These are
regression checks; no additional speedups are claimed. The unchanged
5,000-effect benchmark, with 201 alternating samples, measured first registration
at 1.729 ms before and 1.727 ms after, re-registration at 1.276 and 1.257 ms,
and cleanup at 0.635 and 0.637 ms. Both versions retain 5,000 records after
registration/re-registration, deduplicate owner/ID pairs and immediately remove
all owned records on disposal.

The existing benchmark inputs are unchanged, with all 24 hashes verified.
The default table's generated source and 13,689-byte minified bundle remain
byte-identical, preserving its creation, clearing and heap behaviour. Bundle
SHA-256 remains
`551d10d171b9ec71a505031615bb421a0d1618795eafcffed0ee8d7376b079b6`.
The table contains no global runtime bindings; the 9.26% result applies to the
stated binding workflow. Framework charts were not regenerated.

Validation passed: lint, types, build, 411 unit tests in 31 suites with coverage,
29 browser tests, Vite integration and strict CLI compilation. Eleven focused
unit cases cover replacement targets, duplicate IDs, fallback selectors,
missing targets, cancellation, invalid-selector errors, quirks mode and XML.
A real-browser test checks quirks-mode case-insensitive CSS ID matching.
Component-test cleanup also stops attempting to delete the non-configurable
runtime singleton; removing the mounted components disposes their effects.

```sh
npm run build
node bench/effects.mjs /path/to/8876b6a/dist --count 5000 --runs 201
node dist/cli.js compile demos/counter-component.html -o /tmp/binding-id.js --format esm --strict
```

Earlier completion-closure and empty-dependency trials did not establish an
end-to-end gain and were discarded. Helper-based ID lookup variants increased
registration cost; the final inline form restored parity. The archive recorded
in the evidence contains those investigations, exact runners, apps and traces.
Measurements used Apple M2 Max, Darwin 25.3.0 arm64, Node 25.2.1 and Chromium
141.0.7390.37.

[Criteria, analysis and every qualifying raw sample](runtime-binding-id.json).
