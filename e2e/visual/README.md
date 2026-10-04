# Desktop visual regression pilot

**Status: 24 approved baselines; automatic PR comparisons.** The repository owner approved 18 images
for app version 4.15.3 on 2026-10-04: the prior 12 images plus six Dashboard/Users/Teams images.
The approval source is implementation revision `8bb36776`, artifact `05bcc4f3`, app version
4.15.3, with the exact reply **“Approved”**. Stage 1 includes 15 visual tests, including
three sidebar geometry/focus regression tests. The Desktop visual job compares the approved set on
PRs and master pushes. On 2026-10-05, the owner approved six additional forms/detail images for
app version 4.15.3, bringing the approved set to 24 images and 21 visual tests (the 18 screenshot
tests plus three sidebar geometry/focus tests). The approval source is implementation revision
`6118bee0`, artifact `5ad82149`, with the exact reply **“Approved. Commit, merge, push. Let's park
for now, when you do that.”**

Open the [review gallery](review.html) and [validation/approval record](expansion-review.md).
The current gallery shows the 24 approved v4.15.3 baselines. The historical v4.15.2 review is
preserved at [review-history/v4.15.2/review.html](review-history/v4.15.2/review.html), with its
[historical manifest](review-history/v4.15.2/baseline-manifest.json).

This suite renders the real React/Mantine SPA with deterministic, generated-schema-typed API
fixtures. It is separate from the live-stack functional E2E suite. It verifies appearance, not
backend correctness or authorization. The user explicitly scoped this pilot to desktop web.


## Current expansion review

The sidebar visibility fix and Dashboard/Users/Teams coverage are the approved stage 1 expansion
for v4.15.3; see [the staged expansion plan and review record](expansion-review.md). The sidebar
issue documented by the historical v4.15.2 review is resolved by the approved v4.15.3 fix.

`capture` writes **only** `candidates/`, and `compare-candidates` checks stability against that
set. Every mode mounts approved `snapshots/` read-only. `review-history/stage-1/candidate-review.html` retains the
old/new/diff evidence for the approved stage 1 promotion.

Stage 2 adds six approved forms/detail baselines; see [the forms review](forms-review.md). Stage 3
is parked at the owner's request.

## Coverage

See the [natural-language scenarios](../scenarios/visual/lists.md) and
[Dashboard/directory scenarios](../scenarios/visual/people.md), plus
[forms/detail scenarios](../scenarios/visual/forms.md).

| State | Desktop viewport | Images |
| --- | --- | --- |
| Member Received feedback, English/light | 1280×1000 and 1440×1000 | 2 |
| Member Provided feedback, English/light | 1280×1000 and 1440×1000 | 2 |
| All four dictionaries, member read-only, English/light | 1280×1000 | 4 |
| Career paths, administrator editor, English/light | 1280×1000 and 1440×1000 | 2 |
| Member Provided feedback, Polish/light | 1280×1000 | 1 |
| Career paths, member read-only, English/dark | 1280×1000 | 1 |
| Dashboard, Users and Teams stage 1 expansion | 1280×1000 and 1440×1000 | 6 |
| Forms and details stage 2 expansion | 1280×1000 and 1440×1000 | 6 |

Long names, multiple recipients, varied feedback statuses, long dictionary values and missing
translations are intentional fixtures. Existing functional E2E and responsive geometry checks
remain unchanged; this pilot adds no mobile targets.

Images include the full page vertically, with a separate assertion against horizontal overflow.
Normal vertical scrolling is allowed: at a 1280px desktop viewport the expanded sidebar leaves
enough of a narrow content area that the existing wide-table container breakpoint stacks feedback
rows. All rows must remain reachable and appear in the image; fitting them on one screen is not
a new requirement.

## Isolation from performance work

- The visual harness owns `e2e/visual/` and `e2e/scenarios/visual/`; CI calls its isolated runner.
- The harness itself does not alter backend/API, package/lockfile, shared Playwright or Compose
  behavior. The stage 1 sidebar fix was tested and merged separately.
- No imports of the ordinary E2E global setup/teardown or login helpers. `sessions.ts` is reused
  only for its pure storage-key mapping; the tokens here are synthetic and never sent to a server.
- Own static SPA build/cache/report paths, one worker, loopback port **5197** with strict
  occupancy checking. No existing service is reused, restarted, swept or cleaned up.
- Browser routes explicitly fulfill known reads and fail on every other API request, mutation
  or external request. The SPA server has no API proxy; the canonical container has no network.
- Filesystem/network isolation does **not** isolate CPU, memory or disk bandwidth. Do not build,
  capture or compare while someone is collecting performance measurements on this host.

## Lightweight checks (no build, browser, container or backend)

From `e2e/`:

```sh
npm run typecheck
npm run check:scenarios
node visual/check-scenarios.mjs
npx playwright test --config visual/playwright.config.ts --list
```

The existing typecheck includes this subtree. Visual companions are nested so the original
flat scenario checker does not treat them as orphans. The additional checker compares exact
literal titles, not the semantic completeness of assertions.

## Canonical capture and comparison — quiet window required

Use **Linux amd64 Chromium** and the verified official image in [runtime.json](runtime.json).
The runner requires that image, validates its tag against `e2e/package-lock.json`, and rejects a
conflicting environment override. A runtime upgrade is a reviewed edit to that pin, followed by
comparison and, when needed, review of new candidates. [baseline-manifest.json](baseline-manifest.json)
records the observed Node/Chromium versions, application revision, image dimensions and SHA-256
hashes. The Docker build rejects Node versions below the workspaces' required Node 24.

From the repository root, after measurements finish:

```sh
export VISUAL_QUIET_WINDOW=1
bash e2e/visual/run-container.sh compare
# Only for an intentional, reviewable baseline update:
# bash e2e/visual/run-container.sh capture
# bash e2e/visual/run-container.sh compare-candidates
```

The build installs the existing lockfiles inside its own image. It does not install into host
`node_modules`. At runtime it publishes no ports and mounts only the visual snapshots/results.
Reports are in `playwright-report/`, differences/traces in `test-results/`. All modes mount
approved baselines read-only; capture writes a separate candidate directory. Normal execution uses `updateSnapshots: 'none'`, so missing baselines fail.

For a local **diagnostic** run after measurements finish:

```sh
cd e2e
npx playwright test --config visual/playwright.config.ts --update-snapshots=all
```

Local captures go to ignored `diagnostic-snapshots/`, never the canonical baseline directory.
Only the Linux amd64 container sets `VISUAL_CANONICAL=1`. Local images cannot establish
acceptance for the canonical Linux environment. Local execution
also builds the SPA, so it is not safe during performance measurements.

## Baseline approval and activation

1. Inspect every candidate image: expected data and roles, typography, spacing, wrapping,
   action visibility, translation and theme. Initial images may reveal existing defects.
2. Run two unchanged comparisons in the canonical environment. Diagnose instability; do not
   increase tolerances or hide table content to obtain green results.
3. Temporarily inject a layout defect in a visual test (for example, excessive table spacing)
   and verify comparison fails. Revert that deliberate probe and compare again.
4. Obtain human approval before treating candidate images as accepted baselines. An agent must
   not update expected images merely to silence a failure. Include old/new/diff images for later
   intentional changes; keep baseline edits visible in review.
5. Mark the reviewed candidate set as accepted, with the approval reference in the validation
   record. Only then add a dedicated CI job and decide which check is required. Candidate images
   may be shared on a review branch before approval; that does not approve their appearance.
   The reviewed candidate set is approved before promotion and CI activation.

Build identity is fixed for capture, but the real displayed app version is retained. A version
bump can legitimately change screenshots and still needs a reviewed update. No broad content
masking or screenshot-only stylesheet hides layout defects. Font loading and expected content
are awaited; no arbitrary sleep substitutes for readiness.

## CI failures

Download the `desktop-visual-report` artifact from the **Desktop visual** job. It contains the
HTML report plus expected/actual/diff screenshots and failure traces. Run the same `compare`
command locally in a quiet window to reproduce. CI never captures or commits new expectations;
missing images and visual differences fail the job. A passing result covers the approved 24
screenshot states and three sidebar interaction regressions.
