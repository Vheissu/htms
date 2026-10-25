# Default block renderer: recover delegated-key heap

Delegated-event keys are now empty arrays. They remain opaque identities in the component's WeakMap, with one distinct key per block. Event nodes still hold no render-block reference. Handler snapshots, forms/selects, cached Text nodes, reconciliation and synchronous insertion are unchanged. The maintained source changes one emitted allocation and adds its explanation.

The current null-prototype literal uses dictionary properties in Chromium 141; the array has fast properties. A separate V8 diagnostic confirms this representation difference. The benchmark's 1,000-row heap falls from 2.459 to 2.386 MiB, recovering 74.1 KiB. After clearing it is 2.129429 and 2.129070 MiB.

| Earlier creation confirmation, 121 mirrored rounds | Before | Candidate | Median change |
| :--- | ---: | ---: | ---: |
| Current 5149f4c | 362.537 ms | 362.087 ms | -0.124% |
| Before heap increase dbc7bb6 | 364.278 ms | 362.087 ms | -0.601% |

Each revision has 242 click-to-paint samples. Against current, the paired mean difference is +0.841 ms, with 95% interval [-3.142, +4.824] ms. This fails the initial mean-based 1% guard (3.625 ms). Against dbc7bb6 the interval is [-4.836, +2.656] ms; the older creation gap is not statistically re-established in this cohort. The paired bootstrap intervals for differences of pooled medians are [-2.754, +2.324] and [-5.527, +1.043] ms.

A subsequent independent holdout uses the unchanged benchmark's median as its primary statistic. Its criterion was recorded before collecting new data: the upper paired-bootstrap 95% bound must be below a 1% slowdown against current, and the paired mean must not establish a slowdown. It reverses the prior relative order to candidate/current/current-copy/candidate-copy. In 121 mirrored rounds (242 samples per revision), the current median is 350.188 ms and the candidate 349.497 ms (-0.197%). The median-difference interval is [-2.032, +0.445] ms, below the 3.502 ms margin. The paired mean interval is [-1.675, +3.224] ms; its upper bound also clears the original 1% margin against current. This supports preserving current creation performance within that bound; no new creation speedup is claimed. The failed earlier guard remains in the analysis.

The independent full run covers all nine operations, 15 samples per revision:

| Operation | Current 5149f4c | Candidate | Median change |
| :--- | ---: | ---: | ---: |
| Create 1,000 | 33.323 | 32.672 | -1.954% |
| Replace 1,000 | 37.863 | 37.819 | -0.116% |
| Update every tenth | 23.066 | 24.041 | +4.227% |
| Select | 4.791 | 4.738 | -1.106% |
| Swap | 20.655 | 21.667 | +4.900% |
| Remove | 16.475 | 16.320 | -0.941% |
| Create 10,000 | 350.668 | 351.176 | +0.145% |
| Append 1,000 | 89.423 | 88.026 | -1.562% |
| Clear | 15.466 | 15.480 | +0.091% |

Timings are milliseconds. Clearing retains its earlier gain: -7.41% relative to original 8096bbe (16.719 to 15.480 ms), with paired mean interval [-1.639, -0.609] ms. Full-run differences against current, including the higher partial-update and swap medians, do not establish a regression. No new speed gain is claimed for those operations. Startup script medians are 8.044 and 8.004 ms; first paint is 31.800 and 32.934 ms. No startup gain is claimed.

Separate forced-GC diagnostics recover 73.3 KiB with 1,000 live rows and 738.7 KiB with 10,000. Candidate keys are distinct for every row, shared by both handlers on that row, and have no enumerable fields. At 6, 30 and 90 create/clear cycles, both current and candidate return to 107 DOM nodes, 15 listeners and zero rows. At 90 cycles their heaps are 1,764,236 and 1,764,992 bytes. Deterministic tbody HTML is identical across current, dbc7bb6, 8096bbe and the candidate.

The app, CSS, build pipeline, runner, warmups, CPU throttles, operation order and click-to-paint boundary are unchanged. All 21 benchmark inputs match HEAD byte for byte. Six-app confirmation order is before-heap-increase/current/candidate/candidate-copy/current-copy/pre-regression-copy; paired means average the two samples per revision in each round. Bootstrap resampling uses whole paired rounds, 20,000 draws and seed 0x251026. Analysis order is screen against current, screen against pre-regression, full against current, full against original, confirmation against current, confirmation against pre-regression, holdout against current. These committed comparisons contain 1,735 timed clicks and 45 startup samples; rejected shared-prototype exploration is archived separately.

Measured with Chromium 141.0.7390.37 on Apple M2 Max / Darwin 25.3.0 arm64. Machine load varies across cohorts; comparisons use interleaved controls within each cohort. Raw metadata identifies HEAD 5149f4c; source and bundle hashes in the analysis identify the working-tree candidate. Its source-built bundle exactly matches the screened bundle:

- Candidate SHA-256: `551d10d171b9ec71a505031615bb421a0d1618795eafcffed0ee8d7376b079b6`
- Current SHA-256: `2049a840ce35fae5746571a6919419a1bb23b050781485e4eb96445aac539bb9`
- Minified: 13,717 to 13,689 bytes; gzip: 5,020 to 5,013 bytes; Brotli: 4,442 to 4,433 bytes.

Verification passed: lint, type checking, 381 Jest tests in 29 suites with coverage, build, 28 browser tests, Vite production/dev imports, reload, raw imports, error overlay and recovery, and strict CLI compilation:

```sh
node dist/cli.js compile demos/counter-component.html -o /tmp/htms-array-strict-demo.js --format esm --strict
```

The generated registration includes:

```js
const $$k = [];
this.__htmsEventBlocks.set($$k, $$b);
```

Evidence: [independent median holdout](block-key-array-holdout.json), [creation confirmation](block-key-array-confirmation.json), [full run](block-key-array-full.json), [screen](block-key-array-screen.json), [analysis](block-key-array-analysis.json), [retention and DOM identity](block-key-array-memory.json), [V8 representation diagnostic](block-key-array-shapes.json).
