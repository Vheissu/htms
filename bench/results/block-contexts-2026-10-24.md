# Default block renderer: event context storage

Clearing 1,000 rows is 9.2% faster in the mirrored confirmation and 6.4%
faster in an independent full run. The change moves delegated event block
references from DOM-node properties into a weak map owned by the component.
Shared handler functions stay on the nodes. Keyed reconciliation, markup
and rendering schedules are unchanged.

There is a measured tradeoff: the confirmation's median for creating
10,000 rows rises by 4.55 ms, or 1.2%. Creation also uses more scripting time,
and the weak map retains some table capacity after clearing. This change
favors clearing; the evidence does not establish an improvement in every
operation.

| Clear 1,000 rows, 4x CPU slowdown | Before | After | Change | Paired mean difference, 95% interval |
| :-- | --: | --: | --: | :-- |
| Full run, 15 rounds | 21.644 ms | 20.252 ms | -6.4% | -2.002 ms [-3.183, -0.820] |
| Mirrored confirmation, 31 rounds | 17.925 ms | 16.280 ms | -9.2% | -1.778 ms [-2.110, -1.446] |

The confirmation's paired bootstrap interval for the median difference is
[-2.086, -1.265] ms. Both its mean and median intervals exclude zero. The
full run's median interval is [-3.556, +0.006] ms, so that smaller cohort
alone does not resolve the median difference.

For 10,000-row creation, the confirmation medians are 366.988 and
371.542 ms. Its median-difference interval is [+2.265, +7.679] ms. The mean
interval includes zero. Scripting medians for the two control copies are
30.994/30.791 ms, versus 37.025/36.577 ms for the candidate copies.

The independent full comparison covers all nine unchanged operations:

| Operation | Before | After | Median change |
| :-- | --: | --: | --: |
| Create 1,000 | 38.075 ms | 37.823 ms | -0.7% |
| Replace 1,000 | 42.193 ms | 43.817 ms | +3.8% |
| Update every tenth | 36.067 ms | 34.462 ms | -4.5% |
| Select | 11.286 ms | 11.456 ms | +1.5% |
| Swap | 41.948 ms | 39.965 ms | -4.7% |
| Remove | 24.189 ms | 23.792 ms | -1.6% |
| Create 10,000 | 446.221 ms | 440.917 ms | -1.2% |
| Append 1,000 | 106.227 ms | 101.752 ms | -4.2% |
| Clear | 21.644 ms | 20.252 ms | -6.4% |

Every full-run operation except clearing has a paired mean interval that
includes zero. Those other median changes are descriptive, not established
speedups or regressions. Background simulator and browser activity made the
large-render samples particularly variable.

The full run measured 270 clicks and 30 startup samples. Confirmation added
248 clicks in before/after/after-copy/before-copy order. Each confirmation
round averages the two samples per revision before calculating the paired
mean difference. Median intervals resample complete paired rounds, with
20,000 draws and a fixed seed. Samples are click-to-paint durations from
`run.mjs`, including its normal warmups, garbage collection and CPU rates.
The app source, CSS, build script, runner and operation definitions have no
changes. The additional app directories are retained build aliases under
ignored `bench/dist`.

In the full run, the 1,000-row heap measurement rises from 2.327 to
2.359 MiB. After six creations/replacements and a clear, it rises from
1.993 to 2.243 MiB. A separate GC/retention check at 6, 30 and 90
create/clear cycles found the same 109 DOM nodes and 15 CDP-reported event
listeners in both builds at every checkpoint. The extra post-clear JS heap
in that check stayed within 128–130 KiB. It is a capacity cost rather than
an accumulation of detached rows in the tested workload.

The before build is revision `8096bbe`. The candidate was measured before
committing; source and bundle SHA-256 values are in the
[analysis](block-context-analysis.json). Its minified bundle grows from
13,066 to 13,278 bytes, and gzip from 4,747 to 4,781 bytes. The fallback
renderer remains byte-identical to the control from its previous report.

Raw evidence: [full run](block-context-full.json),
[confirmation](block-context-confirmation.json), and
[retention check](block-context-memory.json). The analysis script, retained
bundles, traces and rejected prototypes are archived locally in
`htms-default-block-investigation` alongside the earlier renderer
investigations.

Verification passed: lint, type checking, 374 unit tests with coverage,
28 browser tests, package build and Vite integration. New cases cover
multiple event types on a keyed row after replacement, non-bubbling events,
and event context survival after browser garbage collection. Browser tests
used an isolated demo-server port because the normal port was occupied.
