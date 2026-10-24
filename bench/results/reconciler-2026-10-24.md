# Fallback renderer reconciliation

The reconciling renderer now avoids thousands of temporary allocations on
an ordinary update. This affects components that automatically fall back
from block rendering, including selectors that match loop-generated markup,
and components compiled with `renderer: 'legacy'`. The default block renderer's
benchmark bundle is byte-for-byte unchanged; the framework charts retain
their existing results.

The source comparison is `39e2de6` before and `8378a32` after. Both builds
compile the existing `bench/apps/htms/app.html`. The apps, CSS, build pipeline,
runner, warm-ups, operation definitions and CPU throttling are unchanged.
Operation timings cover the click through the first paint/commit boundary.

The fixed confirmation ran 31 rounds in the order `after, before,
before-copy, after-copy`. Each copy is byte-identical to its revision,
giving 62 samples per revision per operation across mirrored positions.

| Confirmation   |     Before |      After | Change | Paired mean difference, 95% interval |
| :------------- | ---------: | ---------: | -----: | :----------------------------------- |
| Partial update | 229.697 ms | 194.076 ms | −15.5% | −37.67 to −28.51 ms                  |
| Select row     | 188.369 ms | 158.546 ms | −15.8% | −34.56 to −25.77 ms                  |
| Clear          |  26.426 ms |  20.659 ms | −21.8% | −6.32 to −5.18 ms                    |

For each round, the paired difference is the average of its two after
samples minus the average of its two before samples. All three mean
intervals exclude zero. A separate paired-group bootstrap of pooled median
differences also excludes zero for each operation, using 20,000 draws and
a fixed seed. [Raw confirmation samples](reconciler-confirmation.json) and
[calculated statistics](reconciler-analysis.json) retain the distributions,
formulas and bundle hashes.

The focused confirmation ran from the worktree before the source commit,
so its environment field records `39e2de6`. The measured after bundle
matches the compiled `8378a32` source exactly. Its SHA-256 is
`2a2e4fcb63932ff0a4a3831a5798e87661752d92010dd899f63385e00645acce`;
the before bundle is
`3da57e7717447e627d7379f3cb8e8dca8bdfdcf21d868ea1f119fe0ec9c4edf6`.
The unchanged default bundle is
`b500dae90d294e9e461fbd9931a4223ea407c289f61199d907a60aeca687eef8`.

An independent full run used 15 samples per operation, with before first
and after second. It measured every operation and startup, and records
`8378a32` in its environment. The main gains repeat in this run.

| Full run       |     Before |      After | Change |
| :------------- | ---------: | ---------: | -----: |
| Create 1,000   |  50.045 ms |  48.217 ms |  −3.7% |
| Replace 1,000  |  59.011 ms |  59.813 ms |  +1.4% |
| Partial update | 168.190 ms | 142.085 ms | −15.5% |
| Select row     | 137.635 ms | 113.507 ms | −17.5% |
| Swap rows      | 358.130 ms | 319.052 ms | −10.9% |
| Remove row     | 160.885 ms | 153.590 ms |  −4.5% |
| Create 10,000  | 515.774 ms | 483.728 ms |  −6.2% |
| Append 1,000   | 198.465 ms | 174.759 ms | −11.9% |
| Clear          |  25.968 ms |  20.078 ms | −22.7% |

Replacement was 0.802 ms slower at the median. Its paired mean difference
has a 95% interval of −0.248 to +2.246 ms, so that result is inconclusive.
Startup scripting medians were 8.414 and 8.623 ms, while first paint was
35.533 and 35.019 ms. [All full-run samples](reconciler-results.json) retain
those results alongside the other operations. Absolute times differ
between cohorts; each comparison uses controls from its own run.

The implementation returns before allocating arrays and lookup maps for
an empty source list, and clears populated child lists with one
`textContent` write. Key and ID maps are allocated only when an existing
child has an identity to index. Their first-match and duplicate handling
remain the same.

Missing property metadata no longer creates an empty array. Empty
attribute snapshots use `null`, while `undefined` still marks a node's first
adoption. That distinction preserves attributes changed outside HTMS
through later renders. Non-empty snapshots read the `NamedNodeMap` directly
without copying it into an array.

A separate instrumented diagnostic counts the work during one update.
Its wrappers are absent from the benchmark runs; these are call and
allocation counts, with no timing claims.

| Per select or partial update     | Before |  After |
| :------------------------------- | -----: | -----: |
| Map allocations                  | 16,046 |      7 |
| `Array.from` calls               | 24,069 | 12,045 |
| Allocated attribute dictionaries |  8,022 |  6,020 |

Clear changed from 1,000 `removeChild` calls to one bulk `textContent` write.
[reconciler-profile.json](reconciler-profile.json) records all three
operations and the measured bundle hashes. The initial seven-sample screen
is retained in [reconciler-screen.json](reconciler-screen.json).

The compiled reconciler bundle grew from 16,923 to 17,089 minified bytes,
and from 4,853 to 4,913 bytes with gzip (+60 bytes). It still builds a
temporary render tree; this change reduces reconciliation overhead.

All 372 unit tests, 27 browser tests, lint, type checks, the production build
and Vite integration passed. New regression cases cover first adoption and
later external attributes, empty and populated snapshots, unusual attribute
names, keyed/ID matching, duplicate keys, clearing and repopulation, live
input properties and automatic fallback. The browser case also checks node
identity, unfinished input values, focus, selection and externally opened
`details` elements across updates and list clearing.

The final confirmation and full run completed 642 operation samples,
30 startup samples and 18 heap passes. The browser was Chromium
141.0.7390.37 on an Apple M2 Max; the raw files record the full environment.

To reproduce, build revision `39e2de6` separately and retain its
`bench/dist/htms-legacy` bundle. Build the current revision with
`node bench/build.mjs`, then restore the retained bundle under
`bench/dist/htms-legacy-base`, with its matching `sizes.json` entry.
Create byte-identical copies as `htms-legacy-base-copy` and
`htms-legacy-copy`, also retaining their size entries. Run the existing
harness:

```sh
node bench/run.mjs --runs 31 --apps htms-legacy,htms-legacy-base,htms-legacy-base-copy,htms-legacy-copy --ops select,update10th,clear --out reconciler-confirmation.json
node bench/run.mjs --runs 15 --apps htms-legacy-base,htms-legacy --out reconciler-results.json
```

Experiments with default-renderer bulk removal, fragments, batch cloning,
precise text edits and native insertion variants did not establish a
repeatable end-to-end gain. They were discarded, including bulk insertion
after a 51-round mirrored confirmation.
