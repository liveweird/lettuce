# Backlog

Open work for lettuce, by status tag: `[next]`, `[todo]`, `[new]`, `[parked]`, `[blocked]`.
Items Claude adds start as `[new]`; only the owner promotes an item to `[todo]` or `[next]`.
A finished item is removed (the release history lives in `web/src/changelog/entries.ts`).

## Owner actions

- [new] Make "Dependency scan" a required check — add the `Dependency scan` context (GitHub Actions) to ruleset 22261631 ("Require PRs before merging"); today it requires Backend, Web, API contract, E2E source and Desktop visual only, so a red scan does not block a merge. The workflow side is ready (v4.5.2).
- [new] First real Microsoft Teams tenant check — a Microsoft 365 admin follows the runbook in `.claude/docs/features/teams-notifications.md`; step 8 (change your own password, the direct message must arrive) is the only proof of how Teams renders the message, that `User.ReadBasic.All` suffices and that the install policy works.

## UI (v4.21.0 follow-ups)

- [new] Success toasts stay up longer — `main.tsx` closes them after 2.5 s; the modern-web-guidance `persistent-toast-notifications` guide favours staying until dismissed, so a keyboard or screen-reader user can miss "Saved". About 5 s, and check that keyboard focus inside a toast pauses it the way hover does. This is a house-convention change, so it needs the owner's call.
- [new] Animated page transitions — React Router's `viewTransition` on the nav and row links plus one root cross-fade in `index.css`, gated on `prefers-reduced-motion: no-preference` (`same-document-transitions` guide). Optional polish; it changes motion across the whole app.
- [new] Faster render of the org-wide leave planner — `DaysOffMonthGrid` renders every person × day cell at once; try `content-visibility: auto` + `contain-intrinsic-size` on its rows (`defer-rendering-heavy-content` guide). Table rows need care, so measure first with the perf runner (`perf/run.sh web`).
- [new] Large text / 200 % zoom — the app header is a fixed 56 px `nowrap` row (`App.tsx` `HEADER_HEIGHT`), and a few hand-written widths are px (`DaysOffMonthGrid.module.css` name and day cells, `PersonCardStats.module.css` 170 px, the 96 px actions column). Move them to rem or content-based sizes and check at 200 % zoom (`respect-os-text-scale` guide).
- [new] Cap the pinned column width on phones — `scrollEdges.module.css` pins the person and actions columns with no `max-inline-size`, so a long pinned value (the pulse driver table's question text) can leave a narrow scrolling strip. Cap the pinned cell, or pin only above a container width.
- [new] Intent preload on the Dashboard tiles — `DashboardHero` tile links could spread `useIntentPreload()` like the nav does (`web/docs/page-structure.md`).

## Infrastructure

- [parked] PostgreSQL 18.4 → 18.6 — the `18-alpine` tag has moved. Parked by the owner on 2026-10-04 as "far more invasive than other changes": its own reviewed operation per `.claude/docs/container-images.md`, with a backup/restore rehearsal, never folded into another change.

## Watch

- [new] pgjdbc shades scram-client 3.2 (CVE-2026-53712) — `org.postgresql:postgresql` 42.7.13 bundles it under `org/postgresql/shaded/` (the Flyway boot connection), out of reach of the version floors and the Trivy lockfile scan. On every driver bump, check the jar's `META-INF/licenses/com.ongres.scram/` and drop the note in `gradle/libs.versions.toml` once it bundles 3.3+.
- [new] Flaky `PulseCycleRoutesTest` "admin cycle actions land in the audit trail" — failed once on 2026-10-03 (a missing `pulse_cycle.closed` audit event, during a run the Mac slept through), green in every run since. If it recurs, read the captured audit events `LogCapture.requireEvent` prints.

## Upstream

- [blocked] TypeScript 7 — typescript-eslint peers `<6.1.0` and rejects TS 7.0; retry at 7.1.
