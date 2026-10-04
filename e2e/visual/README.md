# Desktop visual regression pilot

**Status: prepared, not activated.** Six tests request 12 screenshots; no baseline images are
approved or committed yet. Browser execution, container validation, repeated comparisons and
deliberate-regression checks are deferred while Claude works on performance measurements.
Passing source checks is not evidence that the screenshots pass.

This suite renders the real React/Mantine SPA with deterministic, generated-schema-typed API
fixtures. It is separate from the live-stack functional E2E suite. It verifies appearance, not
backend correctness or authorization. The user explicitly scoped this pilot to desktop web.

## Coverage

See the [natural-language scenarios](../scenarios/visual/lists.md).

| State | Desktop viewport | Images |
| --- | --- | --- |
| Member Received feedback, English/light | 1280×1000 and 1440×1000 | 2 |
| Member Provided feedback, English/light | 1280×1000 and 1440×1000 | 2 |
| All four dictionaries, member read-only, English/light | 1280×1000 | 4 |
| Career paths, administrator editor, English/light | 1280×1000 and 1440×1000 | 2 |
| Member Provided feedback, Polish/light | 1280×1000 | 1 |
| Career paths, member read-only, English/dark | 1280×1000 | 1 |

Long names, multiple recipients, varied feedback statuses, long dictionary values and missing
translations are intentional fixtures. Existing functional E2E and responsive geometry checks
remain unchanged; this pilot adds no mobile targets.

Images include the full page vertically, with a separate assertion against horizontal overflow.
Normal vertical scrolling is allowed: at a 1280px desktop viewport the expanded sidebar leaves
enough of a narrow content area that the existing wide-table container breakpoint stacks feedback
rows. All rows must remain reachable and appear in the image; fitting them on one screen is not
a new requirement.

## Isolation from performance work

- Only `e2e/visual/`, `e2e/scenarios/visual/` and the E2E README belong to this change.
- No production, backend, API, package/lockfile, shared Playwright, Compose or CI changes.
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

Use **Linux amd64 Chromium**, the Playwright version in `e2e/package-lock.json`, and the same
verified official Playwright image digest for both baseline generation and comparison. The
runner rejects mutable image references or a version different from the lockfile. Record the
chosen image reference, observed Node version, Git revision and comparison results in the initial
baseline review. The image build rejects Node versions below the workspaces' required Node 24.
Resolve/verify the real digest at that time; this change deliberately contains no guessed digest.

From the repository root, after measurements finish:

```sh
export VISUAL_QUIET_WINDOW=1
# Set VISUAL_PLAYWRIGHT_IMAGE to the verified version-and-digest-pinned image.
bash e2e/visual/run-container.sh capture
bash e2e/visual/run-container.sh compare
bash e2e/visual/run-container.sh compare
```

The build installs the existing lockfiles inside its own image. It does not install into host
`node_modules`. At runtime it publishes no ports and mounts only the visual snapshots/results.
Reports are in `playwright-report/`, differences/traces in `test-results/`. Comparisons mount
baselines read-only. Normal execution uses `updateSnapshots: 'none'`, so missing baselines fail.

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

1. Inspect all 12 candidate images: expected data and roles, typography, spacing, wrapping,
   action visibility, translation and theme. Initial images may reveal existing defects.
2. Run two unchanged comparisons in the canonical environment. Diagnose instability; do not
   increase tolerances or hide table content to obtain green results.
3. Temporarily inject a layout defect in a visual test (for example, excessive table spacing)
   and verify comparison fails. Revert that deliberate probe and compare again.
4. Obtain human approval before treating candidate images as accepted baselines. An agent must
   not update expected images merely to silence a failure. Include old/new/diff images for later
   intentional changes; keep baseline edits visible in review.
5. Commit accepted images and record the canonical image digest. Only then add a dedicated CI
   job and decide which check is required; CI integration is intentionally outside this pilot
   while parallel performance work is active.

Build identity is fixed for capture, but the real displayed app version is retained. A version
bump can legitimately change screenshots and still needs a reviewed update. No broad content
masking or screenshot-only stylesheet hides layout defects. Font loading and expected content
are awaited; no arbitrary sleep substitutes for readiness.
