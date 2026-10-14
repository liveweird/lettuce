# Backlog

Open work for lettuce, by status tag: `[next]`, `[todo]`, `[new]`, `[parked]`, `[blocked]`.
Items Claude adds start as `[new]`; only the owner promotes an item to `[todo]` or `[next]`.
A finished item is removed (the release history lives in `web/src/changelog/entries.ts`).

## Owner actions

- [new] Make "Dependency scan" a required check — add the `Dependency scan` context (GitHub Actions) to ruleset 22261631 ("Require PRs before merging"); today it requires Backend, Web, API contract, E2E source and Desktop visual only, so a red scan does not block a merge. The workflow side is ready (v4.5.2).
- [new] First real Microsoft Teams tenant check — a Microsoft 365 admin follows the runbook in `.claude/docs/features/teams-notifications.md`; step 8 (change your own password, the direct message must arrive) is the only proof of how Teams renders the message, that `User.ReadBasic.All` suffices and that the install policy works.

## Infrastructure

- [parked] PostgreSQL 18.4 → 18.6 — the `18-alpine` tag has moved. Parked by the owner on 2026-10-04 as "far more invasive than other changes": its own reviewed operation per `.claude/docs/container-images.md`, with a backup/restore rehearsal, never folded into another change.

## Watch

- [new] pgjdbc shades scram-client 3.2 (CVE-2026-53712) — `org.postgresql:postgresql` 42.7.13 bundles it under `org/postgresql/shaded/` (the Flyway boot connection), out of reach of the version floors and the Trivy lockfile scan. On every driver bump, check the jar's `META-INF/licenses/com.ongres.scram/` and drop the note in `gradle/libs.versions.toml` once it bundles 3.3+.
- [new] Flaky `PulseCycleRoutesTest` "admin cycle actions land in the audit trail" — failed once on 2026-10-03 (a missing `pulse_cycle.closed` audit event, during a run the Mac slept through), green in every run since. If it recurs, read the captured audit events `LogCapture.requireEvent` prints.

## Known minor issues

- [new] MassShareDialog retry across midnight — a retry validates a hidden "until" date field, so after local midnight it can silently do nothing (LOW, pre-existing).
- [new] Visual users-list fixture ignores the account Status filter — `e2e/visual/fixtures.ts` returns all three people regardless of `deactivated`, so the admin users-list baseline shows an Inactive row under the default Active filter (kept so the screenshot covers both account states).

## UI cosmetics

- [parked] Tutorials submenu overlaps the main menu on phones — cosmetic; parked by the owner.
- [parked] Feedback list stacks into cards at 1280 px — by design; parked by the owner.

## Upstream

- [blocked] TypeScript 7 — typescript-eslint peers `<6.1.0` and rejects TS 7.0; retry at 7.1.
