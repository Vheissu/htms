# Default block renderer: delegated context keys

Empty delegated-event context keys now have a null prototype. The independent mirrored confirmation reduces 10,000-row click-to-paint time by 1.37% against `dbc7bb6`; the full run reduces it by 2.12%. The implementation changes one object literal. Handler snapshots, weak-map ownership, cached Text nodes, reconciliation and synchronous insertion are unchanged.

| Independent confirmation, 31 mirrored rounds | Current dbc7bb6 | Candidate | Median change |
| :--- | ---: | ---: | ---: |
| Create 10,000, 1x CPU | 331.820 ms | 327.284 ms | -1.37% |
| Clear 1,000, 4x CPU | 13.739 ms | 13.945 ms | +1.50% |

Creation's paired mean 95% interval is [-5.670, -1.660] ms. The paired bootstrap interval for the difference of pooled medians is [-9.413, -1.585] ms; the interval for the median of paired round differences is [-5.802, -0.940] ms. All favor the candidate. The earlier 31-round confirmation also has a negative paired mean interval, [-7.418, -1.971] ms, and the full run has [-9.470, -0.561] ms.

Clearing does not establish an improvement over dbc7bb6. Its confirmation median is 1.50% higher, while the paired mean interval [-0.194, +0.580] ms includes no change. The earlier clearing advantage over `8096bbe` remains in the full comparison: 14.508 to 13.830 ms (-4.67%), with mean interval [-1.186, -0.178] ms. This result should not be described as faster clearing than dbc7bb6.

The independent full run covers all nine operations with 15 samples per revision:

| Operation | Current dbc7bb6 | Candidate | Median change |
| :--- | ---: | ---: | ---: |
| Create 1,000 | 31.551 | 31.300 | -0.80% |
| Replace 1,000 | 35.894 | 35.581 | -0.87% |
| Update every tenth | 16.533 | 16.650 | +0.71% |
| Select | 3.778 | 3.909 | +3.47% |
| Swap | 20.903 | 20.056 | -4.05% |
| Remove | 15.017 | 14.923 | -0.63% |
| Create 10,000 | 334.394 | 327.320 | -2.12% |
| Append 1,000 | 78.869 | 78.514 | -0.45% |
| Clear | 13.736 | 13.830 | +0.68% |

Timings are milliseconds. No operation other than creation has a paired mean interval establishing a change against dbc7bb6. The original 8096bbe control still has faster 1,000-row creation and replacement; those differences already exist in the dbc7bb6 control. Startup medians are 7.898 to 7.780 ms for script and 31.790 to 32.490 ms for first paint; no startup gain is claimed.

The 1,000-row JS heap rises from 2.399 to 2.460 MiB, about 63 KiB (2.5% of total measured heap). After clearing, both are 2.130 MiB. Separate forced-GC checks at 6, 30 and 90 create/clear cycles hold at 107 DOM nodes and 15 listeners for both revisions. At 90 cycles their JS heaps are 1,764,996 and 1,764,200 bytes. Deterministic rendered tbody HTML is identical in both controls and the candidate.

The app, CSS, build script, runner, warmups, operation sequence, CPU throttles and click-to-paint boundary are unchanged. All 21 tracked benchmark inputs were compared byte-for-byte with HEAD. The 18-variant exploration is archived separately; these committed comparisons contain 901 timed clicks and 45 startup samples. Screen confirmation uses control/candidate/candidate-copy/control-copy order. Independent confirmation reverses that to candidate/control/control-copy/candidate-copy. Each mirrored round averages its two samples per revision for paired means. Bootstrap resampling uses whole paired rounds, 20,000 draws and seed 0x251026; analysis order is screen confirmation, full current, full original, independent confirmation.

Measured with Chromium 141.0.7390.37 on Apple M2 Max / Darwin 25.3.0 arm64. Raw metadata identifies HEAD dbc7bb6; source and bundle hashes in [the analysis](block-keys-analysis.json) identify the working-tree candidate. The source-built bundle exactly matches the screened bundle:

- Candidate SHA-256: `2049a840ce35fae5746571a6919419a1bb23b050781485e4eb96445aac539bb9`
- Current SHA-256: `31d2fa14467560458f950caaa49a8ae876cbd9aa842719cc0e35d4ae9a0c0faf`
- Minified bundle: 13,689 to 13,717 bytes; gzip: 5,010 to 5,020 bytes.

Verification passed: lint, type checking, 381 Jest tests across 29 suites with coverage, build, 28 browser tests, and Vite production/dev imports, reload, raw imports, error overlay and recovery. The strict CLI command also passed:

```sh
node dist/cli.js compile demos/counter-component.html -o /tmp/htms-null-strict-demo.js --format esm --strict
```

Its generated registration includes:

```js
const $$k = { __proto__: null };
this.__htmsEventBlocks.set($$k, $$b);
```

Raw evidence: [full run](block-keys-full.json), [independent confirmation](block-keys-confirmation.json), [screen confirmation](block-keys-screen-confirmation.json), [retention and DOM equivalence](block-keys-memory.json).
