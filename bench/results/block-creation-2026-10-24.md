# Default block renderer: creation and clearing

The 10,000-row creation regression is removed in the measured workload.
Against `af0aa09`, the mirrored confirmation improves creation by
3.7% and clearing by 5.2%.
The original `8096bbe` creation median is 465.699 ms;
the candidate is 460.478 ms. Clearing also remains faster
than that original control.

| Mirrored confirmation, 31 rounds | Original 8096bbe | Current af0aa09 |  Candidate |
| :------------------------------- | ---------------: | --------------: | ---------: |
| Create 10,000, 1x CPU            |       465.699 ms |      478.207 ms | 460.478 ms |
| Clear 1,000, 4x CPU              |        20.410 ms |       19.399 ms |  18.392 ms |

Against the current renderer, the paired mean 95% intervals are
[-25.138, -11.959] ms for creation and
[-1.272, -0.477] ms for clearing. Their paired
bootstrap median intervals are [-27.096, -12.184] ms
and [-1.577, -0.476] ms. The creation
median-difference interval against the original is
[-13.835, +0.087] ms; the clearing
interval is [-2.607, -1.567] ms.

Ordinary delegated handlers now share one weak-map registration per block. A node's
metadata property name identifies its handler; its value is a shared key
that does not reference the render block. Handler functions are captured
on the block, preserving their creation-time value. Forms and selects keep
direct lookup because they expose enumerable control indices.

Simple cloned blocks containing text and class toggles construct leaf Text
nodes with their initial values. This avoids cloning blank text and then
changing it. The nodes are cached immediately and later updates still change
the same nodes. Hydration, structural parts, custom elements and creation
effects retain their existing initialization path. No visible render work
is deferred beyond the measured frame.

The independent full run covers all nine operations with 15 rounds:

| Operation          | Original | Current | Candidate | Change vs current |
| :----------------- | -------: | ------: | --------: | ----------------: |
| Create 1,000       |   43.134 |  44.325 |    44.333 |              0.0% |
| Replace 1,000      |   47.627 |  49.210 |    49.257 |              0.1% |
| Update every tenth |   25.289 |  25.473 |    25.415 |             -0.2% |
| Select             |    5.878 |   6.563 |     5.937 |             -9.5% |
| Swap               |   29.855 |  31.159 |    30.485 |             -2.2% |
| Remove             |   21.561 |  22.061 |    21.533 |             -2.4% |
| Create 10,000      |  463.145 | 479.296 |   453.781 |             -5.3% |
| Append 1,000       |  107.613 | 107.766 |   107.748 |              0.0% |
| Clear              |   21.153 |  19.035 |    18.062 |             -5.1% |

All timings above are medians in ms. The full run's creation mean interval
against current is [-31.417, -9.980] ms; clearing
is [-1.664, +0.054] ms. No other operation has a paired mean interval establishing a regression.
Other median differences should be read with the intervals in the analysis,
particularly under the variable background simulator and browser load.

Confirmation uses original/current/candidate/candidate-copy/current-copy/
original-copy order, with 62 samples per revision. Each paired round averages
the two samples per revision. Mean intervals use Student's t; median intervals
resample whole paired rounds 20,000 times with seed 0x241026. The final runs
contain 777 timed clicks
and 45 startup samples. The app, CSS, build script, runner, operation
sequence, warmups, CPU rates and click-to-paint boundary are unchanged.
Raw metadata names the checked-out HEAD, af0aa09; candidate source and
bundle hashes identify the working-tree build in the analysis.

The full-run 1,000-row JS heap is 2.398 MiB versus
2.359 MiB currently. After replacement warmups and clearing, it is
2.129 versus 2.243 MiB. Separate forced-GC diagnostics
at 6, 30 and 90 create/clear cycles found:

| Build         | Native DOM nodes after clear | CDP listeners | Heap at 6 / 30 / 90 cycles, MiB |
| :------------ | ---------------------------: | ------------: | :------------------------------ |
| htms-original |                          109 |            15 | 1.545 / 1.560 / 1.610           |
| htms-af0      |                          109 |            15 | 1.667 / 1.685 / 1.861           |
| htms          |                          107 |            15 | 1.612 / 1.627 / 1.746           |

DOM and listener counts stay constant within each build. The candidate's template
omits the two blank Text nodes that initializers now construct. A separate
check produces identical tbody HTML in all three revisions for fixed data,
including escaped text and selection. These checks are not benchmark timings.

The default bundle is 13689 bytes minified and 5010 bytes gzip,
versus 13278 and 4781 bytes currently. The fallback renderer
remains byte-identical. Verification passed: lint, type checking, 381 unit
tests with coverage, 28 browser tests, build and Vite integration. New cases
cover handler routing, indexed controls, retained keyed contexts and indices,
GC survival, single evaluation of text values, empty Text nodes and node
identity after object-value updates.

Raw evidence: [confirmation](block-creation-confirmation.json),
[full run](block-creation-full.json), [analysis](block-creation-analysis.json)
and [GC/DOM checks](block-creation-memory.json). Scripts, retained builds,
traces and rejected candidates are archived locally in
`htms-block-creation-investigation` under this task's visualization folder.
