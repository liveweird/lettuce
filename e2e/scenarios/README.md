# E2E scenarios — versioned test-design artifacts

One markdown file per spec file: `scenarios/goals.md` describes `tests/goals.spec.ts`. These are
**design artifacts, not executable tests** — deliberately NOT Gherkin/Cucumber (no step-definition
glue to rot). They exist so a test's *intent* is reviewable, diffable, and writable by anyone —
including someone (or some agent) who will later compile a new scenario into spec code.

**The same-commit rule** (extends the one that used to govern the README bullet list): a new or
behaviorally changed `test()` lands with its scenario file updated **in the same commit**. The
coverage map in `../README.md` links here; a spec without a scenario file is a review failure.

## Format

```md
# <Journey name — short, human>

- **Spec**: [tests/<name>.spec.ts](../tests/<name>.spec.ts)
- **Actors**: <seed accounts and/or throwaway users involved>
- **Owns** (exclusive server-side state): <what this file may mutate, per ../README.md's
  Parallel execution rulebook; "nothing — read-only" when applicable>
- **Since**: <app version(s) the covered behaviors landed in, when known>

## Scenario: <the test() title, VERBATIM>

1. <numbered prose steps: actor → action, in user terms>
   - *Expected*: <the observable consequence asserted at that step>

## Not covered here (and why)

<per-journey deliberate exclusions — only when there are any>
```

Rules:

- **The `## Scenario:` heading must equal the `test()` title verbatim** — that is the
  traceability link, greppable in both directions. One `## Scenario` section per test in the file.
  The ONE registered exception: a spec that generates tests from a list (today only
  `accessibility.spec.ts`, one `test(`\`${path} has no WCAG A/AA violations\``)` per page) keeps a
  single scenario section whose heading uses the template placeholder (`<path>`), since there is
  no literal title to mirror.
- **Steps are user-level prose**: actors, screens, buttons by their visible names, observable
  outcomes. Never locators, CSS, roles, or waits — the *how* belongs to the spec and to the
  compiler contract below.
- Keep the *why* lines that make a step's shape meaningful ("newest-first sort so the fresh row
  is on page 1 of the shared database") — they are design decisions, not implementation detail.

## Compiler contract — turning a scenario into a spec

Any human, agent, or codegen tool (a live-exploration tool like Browser-Use / the Playwright MCP
may *draft* the code) producing spec code from a scenario must conform to the following before it
lands. Generated code that merely passes once does not qualify.

1. **State ownership** (`../README.md`, "Parallel execution" — the authoritative rulebook): every
   spec file owns its server-side state exclusively. New scenarios must declare their `Owns` line
   and must not touch another file's feedback pair, global document, or registry. Alerts and pulse
   journeys go to their own chained projects (`playwright.config.ts`).
2. **Naming**: every created artifact goes through `uniqueText()` — the shared DB is long-lived
   and never reset between runs.
3. **List asserts are filter- or sort-anchored, never bare page-1 assumptions** (`gotoUserRow`,
   `openFilters`, `sortNewestFirst`).
4. **Sessions**: `login()` for seed accounts (API-minted); the real form (`loginWithPassword`) only
   when the scenario is *about* the form (throwaway credentials, MFA, reset). Never mutate seeded
   accounts — throwaways come from `createUserViaUi`.
5. **Header interactions collapse the alert banner first** — use `openUserMenu`/`openBell`/
   `logout`; never re-spell the "User menu" locator (`userMenu()` owns it).
6. **Locator style**: role/label-based (`getByRole`, exact accessible names) — the suite has no
   page objects by design; the a11y contract is the abstraction. House traps to respect:
   - Mantine keeps a closed Select's listbox mounted → target the `combobox` role, scope text
     asserts (e.g. to `#main-content`), and use `pickSelectOption` for searchable Selects only
     (it hangs on non-searchable ones — click + option there).
   - `getByLabel("Password")` also matches the visibility toggle → use the `textbox` role.
   - Slider thumbs are named via `thumbLabel`; SegmentedControls are clicked by visible label text.
   - Contenteditable editors need `typeContent` (no `fill`).
7. **Mutations wrap the click in `Promise.all` with a `waitForResponse` on the exact API call** —
   asserting the UI alone races refetches.
8. **API shortcuts** (setup/sweeps only, never the journey under test) use `apiToken`/`authHeader`
   from `tests/api.ts` — it owns the per-IP-429 retry ladder.
9. **Cleanup**: what a scenario creates in shared/global surfaces it removes (even on failure —
   `afterEach` + API), or its residue must be provably inert for every other file, rerun included.
10. **Paperwork**: the scenario file, its one-line entry in `../README.md`, and (for a new spec
    file) the ownership note land in the same commit as the spec.
