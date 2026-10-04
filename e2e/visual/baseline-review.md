# Desktop visual pilot — validation and baseline review

**Status: candidate images, awaiting human approval.** Runtime validation establishes that the
comparison mechanism works; it does not establish that every current visual choice is desirable.
No required CI check or master merge has been activated.

- [Browse all 12 images](review.html)
- [Runtime pin](runtime.json)
- [Image dimensions, hashes and capture provenance](baseline-manifest.json)

## Source and environment

Claude's work through `origin/master` **7cb4b20a** (v4.15.2, PR #109) was merged into
`test/desktop-visual-pilot` as **9166b0ef** before capture. This includes the performance programme,
route preloading, lazy Polish resources, theme import changes and layout-shift fixes. No
application, API or performance-test source was changed for these captures. The isolated build
renders the same frontend source but omits production chunk grouping; it is not a performance test.

The registry's Playwright 1.63.0 Noble multi-platform index was inspected, verified again by
digest and then used for capture/comparison. Canonical execution uses its **Linux amd64** image,
**Node v24.20.0**, **Playwright 1.63.0**, **Chromium 153.0.8010.12 / revision 1243**.

The independent compatibility review found no API-fixture or locator changes necessary.
Readiness assertions cover the loaded user name, expected rows, per-row names/status/action,
active language, bundled font and dark theme. Normal vertical scrolling is allowed.

## Verification

| Check | Result |
| --- | --- |
| E2E TypeScript check | Passed |
| Ordinary scenario pairing | Passed, 59 specs |
| Visual scenario pairing | Passed, six tests |
| Canonical candidate capture | 6/6 passed, 12 images, 31.1 s |
| Unchanged comparison 1 | 6/6 passed, 29.4 s |
| Unchanged comparison 2 | 6/6 passed, 29.2 s |
| Intentional color defect | Expected failure at `toHaveScreenshot`, 279,044 changed pixels |
| Clean comparison after color probe | 6/6 passed, 29.1 s; all 12 candidate file hashes unchanged |
| Intentional spacing defect | Expected failure at `toHaveScreenshot`, height 1147 → 1507 px, 22,332 changed pixels; all 12 candidate file hashes unchanged |

The defect was `#main-content { background: rgb(255, 0, 255) !important; }`, injected in a temporary
copy of the test and mounted over that one container file. No production/repository source was
altered for the probe. Baselines were mounted read-only. The test reached the screenshot
comparison, proving that functional/geometry assertions alone did not detect this color change.
The temporary override is not part of the normal runner.

- [Deliberately defective image](review-evidence/intentional-color-regression-actual.png)
- [Detected difference](review-evidence/intentional-color-regression-diff.png)

A second temporary override injected `#main-content tbody td { padding-bottom: 24px !important; }`.
The functional and horizontal-overflow assertions still passed, but the screenshot comparison
rejected the changed row spacing and page height. This fulfills the scenario's layout-defect
probe requirement. It used the same read-only baselines and temporary container-file mount;
the normal test and application source remain unchanged.

- [Deliberately enlarged row spacing](review-evidence/intentional-spacing-regression-actual.png)
- [Detected spacing difference](review-evidence/intentional-spacing-regression-diff.png)

## Findings requiring a baseline decision

1. **1280px Feedback uses stacked rows.** With the expanded sidebar, the content width is below
   the existing wide-table container breakpoint. All rows/actions are reachable; the capture
   includes the full vertical page. At 1440px it uses conventional columns. This is current
   desktop behavior, not mobile emulation or a change introduced by the harness.
2. **The active dictionary leaf can be outside the sidebar scroll viewport.** On direct entry to
   Seniority levels, its highlight is partly clipped by the pinned footer; on Pulse questions,
   the active leaf is below the visible scroll area. Independent image/source review confirmed
   that the active group expands without scrolling its active child into view. The page content
   itself is correct. Consider fixing this separately before accepting those two images; the
   pilot deliberately preserves and documents the observed behavior instead of masking it.

All 12 images were visually inspected across the coordinator and independent reviewer. There
were no loading/error placeholders, missing content rows or missing row actions. The ordinary
dictionary tables remain compact and read-only; administrators have the editor and disabled
Save before edits. Long text inside single-line admin inputs is naturally horizontally clipped.

## Remaining acceptance

Review the gallery, decide how to handle the two findings, and record human baseline approval
here. If the UI changes before approval, regenerate only the affected candidates in the pinned
environment, re-review them and rerun comparisons. Once accepted, a separate change can add the
visual job to PR CI. These tests complement the existing functional E2E and performance suites.
