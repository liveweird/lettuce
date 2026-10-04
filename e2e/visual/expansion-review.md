# Desktop visual coverage expansion

Status: stage 1 approved on 2026-10-04, promoted and merged to master in PR #111 (`4c1e30ab`). The
repository owner replied **“Approved”** for implementation revision `8bb36776`, artifact
`05bcc4f3`, app version 4.15.3. Approval covers 18 images: the prior 12 plus six
Dashboard/Users/Teams images, and 15 visual tests including three sidebar geometry/focus tests.
The v4.15.2 review remains historical; stage 2 is being prepared on `test/desktop-visual-forms`.

## Staged plan

| Stage | Scope | Status |
| --- | --- | --- |
| 1 | Sidebar active-link visibility; Dashboard member/manager; Users and Teams member/admin | Merged; all six CI jobs passed |
| 2 | Representative forms/detail pages, including validation, editor and footer states | [Implementation in progress; separate review](forms-review.md) |
| 3 | Remaining frequently used feature lists; add states by risk and reuse shared fixtures | Planned after stage 2 review |

Each stage captures candidates, presents them for human review, then promotes approved images
into CI. Approval of the initial twelve images does not approve later changes automatically.
This batch does not claim whole-app visual coverage or change backend APIs.

## Stage 1 behavior and coverage

The v4.15.3 sidebar fix reveals the active destination in its own scroll viewport on direct
entry, route changes, group expansion and rail/expanded switches. It preserves manual collapse,
keyboard focus and the main document's scroll position. Three browser regressions exercise a
1280×720 desktop with normal and reduced motion, independently of screenshot assertions.

Six newly approved views use fixed synthetic, generated-schema-typed data:

- Member Dashboard / My managers, 1440×1000: personal tiles and manager cards.
- Manager Dashboard / My subordinates, 1280×1000: management tiles and three cards with varied stats.
- Member Users, 1280×1000, and administrator Users, 1440×1000: long names/emails, mixed roles,
  a missing unique ID and one inactive account, with the appropriate row controls.
- Member Teams, 1280×1000, and administrator Teams, 1440×1000: long team/manager names,
  read-only links versus editing controls.

The existing twelve screenshots also change their displayed version to 4.15.3; dictionary
screens may additionally scroll the sidebar to reveal the active item. No content masks or
pixel-tolerance relaxation are introduced.

## Review and verification

- [Open the candidate gallery](review-history/stage-1/candidate-review.html): the two sidebar before/after/diff views,
  six new screens and the ten remaining version-only changes.
- [Candidate image hashes and source provenance](review-history/stage-1/candidate-manifest.json).
- Source implementation: `8bb36776`; app version **4.15.3** (English/Polish changelog included).
- Independent review's reduced-motion finding was fixed and re-reviewed; no actionable findings remain.
- All six new views and both changed dictionary views were visually inspected. Existing intentional
  name/profile truncation in cards and email wrapping in Users remain visible for human review.
- Pixel analysis of all twelve existing views found ten changes confined to the footer version
  digit (8×10px bounding box), plus the two intended sidebar scroll changes. The twelve historical
  baseline images are archived unchanged under `review-history/v4.15.2/`. Difference overlays use raw RGB changes, not Playwright's
  perceptual pixel threshold.

| Check | Result |
| --- | --- |
| Frontend build / lint / knip | Passed |
| Frontend suite and coverage | 2,257 tests passed; 96.07% lines, 90.17% branches |
| Initial bundle budget | Passed: 333,955 / 360,000 gzip bytes; 8 / 12 files |
| E2E typecheck and scenario pairing | Passed: 59 ordinary specs, 15 visual tests |
| Canonical candidate capture | 15/15 passed; 18 candidate images; 54.3 s |
| Unchanged candidate comparison 1 | 15/15 passed; 50.2 s |
| Unchanged candidate comparison 2 | 15/15 passed; 50.6 s |
| Ordinary approved-reference comparison probe | Expected screenshot failure: version digit, 11 pixels |
| Gallery links and image hashes | Passed |
| Canonical comparison after promotion | 15/15 passed; 18 approved images; 50.2 s |
| Sidebar repetition after assertion correction | 30/30 passed (each of three journeys repeated ten times); 1.4 min |
| Full functional E2E on updated source frontend | 144/144 passed; 4.3 min; v4.15.3 source frontend with development backend |

The owner approved the concrete stage 1 result with the exact reply **“Approved”**. The current
review gallery shows 18 approved v4.15.3 baselines; `review-history/stage-1/candidate-review.html` remains the old/new/diff
evidence for the stage 1 change. Promotion copies the reviewed PNGs byte-for-byte into `snapshots/`; all 18 hashes match the
accepted candidates. All six hosted jobs passed in [quality run 37236533748](https://github.com/liveweird/lettuce/actions/runs/37236533748)
before [PR #111](https://github.com/liveweird/lettuce/pull/111) merged. The
sidebar issue from the v4.15.2 historical review is resolved by this approved fix. Forms/details
and remaining lists follow in subsequent reviews. Backend/API behavior was not changed in this batch.

The first promotion check passed all screenshot assertions but exposed an intermittent sidebar
test-oracle error: Mantine keeps collapsed links mounted, so their own boxes can satisfy
Playwright visibility while an ancestor clips them. The corrected regression asserts collapsed
group state and zero viewport intersection, then full visibility after reopening. Independent
review found no weakened behavior checks. No application code, screenshot pixels or tolerances
changed; the complete canonical rerun passed.
