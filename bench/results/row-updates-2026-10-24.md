# Row selection, swaps and removal

HTMS has the lowest overall time among the five frameworks in this run:
1.0233× vanilla JS, compared with Solid's 1.0648×. That is 3.9% less time
across the nine operations, using their geometric mean. This is a result
from the repository's harness, not an official js-framework-benchmark ranking.

The compiler change improves row selection. The retained preceding build
also finished ahead of Solid in this run, at 1.0269× vanilla. The change
from the previous report's second place cannot all be attributed to this
optimization; the measured overall difference between the two HTMS builds
here is 0.35%.

## Comparison

The full run interleaved seven apps: the five frameworks, vanilla JS and
the retained HTMS build from `6c8439a`. Each operation has 15 samples. The
current compiler revision is `d7a563d`; browser, hardware, raw samples and
startup measurements are in
[the archived results](row-updates-results-2026-10-24.json). The retained
build is recorded there as `htms-base`. The generated
[framework report](RESULTS.md) shows the latest framework run.

| Operation | Before: click to paint | After: click to paint | Solid: click to paint | Before: scripting | After: scripting | Solid: scripting |
| :-- | --: | --: | --: | --: | --: | --: |
| Select row | 6.832 ms | 6.450 ms | 6.730 ms | 0.712 ms | 0.513 ms | 0.977 ms |
| Swap rows | 31.481 ms | 32.446 ms | 32.178 ms | 0.731 ms | 0.799 ms | 1.970 ms |
| Remove row | 22.126 ms | 21.641 ms | 22.084 ms | 0.489 ms | 0.489 ms | 0.589 ms |

Selection scripting fell 28%, and its click-to-paint median fell 5.6%.
The swap median increased 3.1%; removal fell 2.2% with unchanged scripting.
Those small swap/removal differences overlap the sample spread and do not
establish an improvement from this change.

## What changed

A row binding such as `class:danger="row.id === selected"` previously
checked every row when `selected` changed. For a keyed list whose other
bindings depend only on the list, the compiler now emits a selection lookup.
The first selection builds a map of keys to row blocks; later selections
update only the previously selected and newly selected blocks. A focused
test confirms two key reads on a repeated selection instead of scanning
the list.

List replacement, reordering, deletion and deep writes invalidate the map.
Duplicate keys use the ordinary all-row update path. Complex bindings,
additional component dependencies and unknown selector getters retain
the general renderer. Class toggles preserve classes added by other code.

The lookup costs O(n) memory after first use and an O(n) scan when rebuilt.
Lists that never select a row do not allocate it. For this benchmark app,
the compiled bundle grew from 4,523 to 4,729 bytes with gzip (+206 bytes).
The standard heap measurement happens before selection and therefore does
not measure the map's retained memory.

## Swaps and removal

Profiling showed that HTMS already spends less time in scripting than Solid
on these operations. Browser style, layout and paint account for most of
the duration. The existing keyed renderer preserves nodes and avoids
updating unchanged row bindings.

Experiments with single-removal shortcuts, prefix/suffix reconciliation
and atomic DOM moves did not give repeatable end-to-end improvements.
They were discarded. Direct class replacement was also discarded because
it could overwrite classes added outside the compiler. The shipped list
reconciliation and benchmark app markup/CSS are unchanged.

## Repeated selection check

`node bench/rows.mjs htms-base,htms,solid 1000` measures warmed script work
with a high-resolution clock at 4× CPU slowdown. App order rotates over
nine samples. Each sample discards ten updates, then takes the median of
25 timed updates; browser rendering runs outside those timed updates.
These times are separate from the full click-to-paint measurements above.

| Operation | Before | After | Solid |
| :-- | --: | --: | --: |
| Select row | 0.055 ms | 0.035 ms | 0.150 ms |
| Swap rows | 0.475 ms | 0.390 ms | 1.260 ms |
| Remove row | 0.420 ms | 0.415 ms | 1.180 ms |

Raw samples are in [row-scripting.json](row-scripting.json). Repeated
selection took 36% less script time in this check. The swap and removal
samples vary substantially; the full run does not confirm a gain for them.

## Validation

Lint, TypeScript checks, the production build and all 364 Jest tests passed,
including five new keyed selection tests. All 22 browser tests and the Vite
integration check passed. The full benchmark completed all 945 operation
samples, 105 startup samples and 21 heap measurement passes.
