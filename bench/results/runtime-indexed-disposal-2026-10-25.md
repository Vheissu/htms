# Dispose effects through the owner index

Effect-owning components still scanned every live and pending effect when they
disconnected. The runtime now snapshots the existing owner index and disposes
those records in registration order. Cleanup can create replacement effects
without adding them to the current disposal pass. Nested disposal remains
idempotent, and compaction happens at the same outer boundary.

Against e89fb6b, a supplementary browser workflow clears 1,000 compiled custom
elements, each owning one effect, while 1,000 unrelated live effects remain.
The default block renderer handles the button and list update. Measurements
include the click through the first painted commit, with 4x CPU throttling,
five warmups and a fresh page per sample.

| Cohort | Before median | After median | Change |
| --- | ---: | ---: | ---: |
| Initial screen, 15 samples per revision | 45.649 ms | 32.561 ms | -28.67% |
| Independent confirmation, 62 samples per revision | 46.3155 ms | 33.8955 ms | -26.82% |

Confirmation uses 31 mirrored rounds in candidate, baseline, baseline,
candidate order. Its paired bootstrap median-difference 95% interval is
[-14.867, -11.017] ms; the paired mean interval is [-14.585, -12.610] ms.
Both pass the criterion recorded before confirmation: negative upper bounds.
All samples are retained. Intervals use 20,000 whole-round resamples, seed
0x251029, and Student t with 30 degrees of freedom for the paired mean.
Scripting medians fell from 42.766 to 30.265 ms.

Every browser sample asserts zero remaining rows, 1,000 surviving unrelated
effects, no extra executions of those effects, no pending records, and no
render or page errors. Regression tests verify that owned disposal never reads
unrelated record owners, and that nested cleanup preserves ordering and newly
registered replacements. Independent code review checked active/pending order
and re-registration semantics.

The prior unowned-component teardown workflow was repeated for 31 samples per
revision: 6.924 ms before, 6.800 ms after. The unchanged effects benchmark,
with 5,000 effects and 101 alternating samples, produced these preservation
checks; no additional speedup is claimed from these small differences:

| Operation | Before median | After median |
| --- | ---: | ---: |
| First registration | 2.132 ms | 2.085 ms |
| Re-registration | 1.655 ms | 1.595 ms |
| Single-owner disposal | 1.280 ms | 1.244 ms |

Both versions keep 5,000 records after registration/re-registration, deduplicate
owner/ID pairs, and immediately leave zero owned records after disposal.

The snapshot allocates a temporary array per effect-owning disposal. It is
released when the call returns; no persistent per-effect or per-component
fields were added. Compaction still visits surviving records, so removing many
effect-owning components can still have quadratic compaction cost. This change
removes the separate owner-selection scans.

The existing benchmark inputs are unchanged, with all 24 hashes checked.
The original table benchmark contains no effects, so these timings describe a
separate runtime workflow. Its generated source and bundle remain byte-identical,
preserving the established creation, clearing and heap behaviour. Bundle SHA-256:
`551d10d171b9ec71a505031615bb421a0d1618795eafcffed0ee8d7376b079b6`.
The bundle remains 13,689 bytes minified, 5,013 gzip and 4,433 Brotli.
Framework charts were not regenerated.

Validation passed: lint, types, build, 393 unit tests in 30 suites with
coverage, 28 browser tests, Vite integration and strict CLI compilation. The
CLI still emits `customElements.define('counter-box', CounterBoxComponent)`.

The complete fixture, measurement settings, raw samples and unchanged input
hashes are in the linked evidence. Exact temporary runners and representative
traces are archived locally with the investigation. Measurements used Apple
M2 Max, Darwin 25.3.0 arm64, Node 25.2.1 and Chromium 141.0.7390.37.
Builds, tests and profiling did not run alongside qualifying timings.

```sh
npm run build
node bench/effects.mjs /path/to/e89fb6b/dist --count 5000 --runs 101
node dist/cli.js compile demos/counter-component.html -o /tmp/indexed-counter.js --format esm --strict
```

Evidence: [analysis](runtime-indexed-disposal-analysis.json),
[screen](runtime-indexed-disposal-screen.json),
[confirmation](runtime-indexed-disposal-confirmation.json),
[previous teardown check](runtime-indexed-disposal-preservation.json),
[unchanged effects benchmark](runtime-indexed-disposal-effects.json).
