# Desktop visual pilot — historical v4.15.2 validation and baseline review

**Historical record: v4.15.2.** On 2026-10-04, the repository owner reviewed the linked gallery
and replied **“I accept”** in the Codex conversation. This record applies to the original 12-image
v4.15.2 set. The current 18-image v4.15.3 approval is recorded in
[expansion-review.md](expansion-review.md).

- [Browse the historical 12 images](review-history/v4.15.2/review.html)
- [Runtime pin](runtime.json)
- [Historical image dimensions, hashes and capture provenance](review-history/v4.15.2/baseline-manifest.json)

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

## Known behaviors retained in the accepted baseline

1. **1280px Feedback uses stacked rows.** With the expanded sidebar, the content width is below
   the existing wide-table container breakpoint. All rows/actions are reachable; the capture
   includes the full vertical page. At 1440px it uses conventional columns. This is current
   desktop behavior, not mobile emulation or a change introduced by the harness.
2. **The active dictionary leaf can be outside the sidebar scroll viewport.** On direct entry to
   Seniority levels, its highlight is partly clipped by the pinned footer; on Pulse questions,
   the active leaf is below the visible scroll area. Independent image/source review confirmed
   that the active group expands without scrolling its active child into view. The page content
   itself was correct in the historical capture. This issue was resolved by the approved v4.15.3
   sidebar fix.

All 12 images were visually inspected across the coordinator and independent reviewer. There
were no loading/error placeholders, missing content rows or missing row actions. The ordinary
dictionary tables remain compact and read-only; administrators have the editor and disabled
Save before edits. Long text inside single-line admin inputs is naturally horizontally clipped.

## CI activation

The first hosted **Desktop visual** job passed in [quality run 37229755537](https://github.com/liveweird/lettuce/actions/runs/37229755537)
on PR #110, using commit `d0442d4e` and the approved, unchanged image set.

## Future baseline changes

This historical approval established the initial comparison reference. The sidebar issue was
resolved by the approved v4.15.3 fix.
For intentional UI changes, capture affected candidates in the pinned environment, review their
old/new/diff images, obtain human approval and update the manifest and this record before merging.
Never regenerate baselines just to silence a CI failure. These tests complement the existing
functional E2E and performance suites.
