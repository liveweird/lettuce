# E2E (Playwright, blackbox)

Browser end-to-end tests that treat the app as a **blackbox**: they drive a real Chromium against
the whole stack (SPA + server + Flyway + Postgres) served single-origin at `http://localhost:8080`
by `docker compose`. This package is fully isolated from `web/` — it imports none of the app source
and only speaks HTTP/DOM.

## Run

```bash
cd e2e
npm install
npm run install:browsers      # one-time: download Chromium
npm test                      # brings the stack up (docker compose), runs specs, tears it down
```

- `global-setup.ts` starts `docker compose up -d --build` and waits for `:8080` — **unless a stack
  is already running there**, which it reuses (fast local iteration: keep `docker compose up` or a
  local `WEB_STATIC_DIR=… ./gradlew :server:run` going and just run `npm test`). `global-teardown.ts`
  only runs `docker compose down -v` if setup started the stack.
- Requires Docker. Override the target with `E2E_BASE_URL`.

## Parallel execution

The suite runs on **4 workers by default** (`E2E_WORKERS` overrides; `E2E_WORKERS=1` restores the
old fully-serial behavior). The serial unit is the **spec file** (`fullyParallel: false` — some
files' tests are order-dependent, e.g. `users-import`); different files run concurrently. That is
only sound because **every spec file owns its server-side state exclusively** — the standing rule
for any new or edited spec:

- **Feedbacks**: each file owns its `(subject, provider, requester)` triples outright — the server
  409s a create while an *open* (DRAFT/REQUESTED) duplicate exists, and identically-worded bell
  cards collide. Current ownership: delivery = (AAA One ← AAA Two), provide = (AAA Two ← AAA One),
  lifecycle-rest = (AAA Two ← Manager AAA), hr = (AAA Three ← Manager AAA), manager-oversight =
  (AAA One ← Manager AAA, created directly as SENT — no open window), triage = the two
  self-requested (AAA One/Two ← Manager AAA) triples, third-party = (AAA One ← AAA Three, req.
  Manager AAA), self-reflection = (AAA Two ← AAA Two), kudos = (AAA Three ← AAA Two, created
  directly as SENT — no open window). Pick an unclaimed triple or a throwaway.
- **Bells**: presence asserts on a seed account's bell must be text-filtered
  (`notificationCard`); *count/badge/mark-all-as-seen* asserts belong only on a **throwaway**
  recipient (`notifications.spec` is the template) — seed bells receive concurrent traffic.
- **Global documents/registries have one writer file each**: dictionaries — `dictionaries.spec`
  edits `seniority-levels`, `user-career.spec` edits `career-paths`; review periods —
  `performance-reviews.spec`; public holidays + AAA Two's days-off/allowance/corrections —
  `days-off.spec`; templates — `templates.spec` (unique names).
- **`alerts.spec` and `pulse.spec` each run in their own project phase after everything else**
  (config `dependencies`, chained: chromium → alerts → pulse): an active alert overlays the
  header for every worker, and a pulse cycle sprays notifications at EVERY user's bell while the
  one-non-terminal-cycle registry is global. `pulse.spec` exclusively owns that registry — it
  sweeps stranded SCHEDULED/OPEN cycles at the start (admin API cancel) and leaves the registry
  terminal; every run accretes one CLOSED (+ one CANCELLED) cycle on the shared DB, so its
  results asserts pin the current cycle, never cycle #1. Any new spec minting globally-visible
  state joins a phase like these.
- Artifacts must be unique-named (`uniqueText`) and list asserts filter- or sort-anchored — never
  bare page-1 assumptions.

## What's covered

Real user journeys, prioritizing the feedback lifecycle (which validates the POST-action verb
endpoints through the UI). **Each spec's full design lives in its scenario file under
[`scenarios/`](scenarios/README.md)** — versioned natural-language test-design artifacts (actors,
owned state, numbered steps, expected outcomes). **A new or behaviorally changed test lands with
its scenario file and its line below in the same commit** — this list is the coverage map, the
scenario file is the design.

- [`accessibility.spec.ts`](scenarios/accessibility.md) — axe WCAG A/AA smoke: login + 17 authed read-only pages; `color-contrast` consciously waived.
- [`alerts.spec.ts`](scenarios/alerts.md) — admin broadcast alert: banner, hide/re-show, deactivate, delete (own serial phase).
- [`auth.spec.ts`](scenarios/auth.md) — login / logout / invalid credentials.
- [`changelog.spec.ts`](scenarios/changelog.md) — the bundled release history renders versioned entries in EN and PL (PL leg on a throwaway user — the switch persists server-side).
- [`dashboard-my-teams.spec.ts`](scenarios/dashboard-my-teams.md) — the My teams tab, team-details drill-down round-trip, non-manager empty state.
- [`days-off.spec.ts`](scenarios/days-off.md) — requests (paid/unpaid, half-days), manager accept/reject, calendar, budgets + corrections, cancel.
- [`dictionaries.spec.ts`](scenarios/dictionaries.md) — the whole-list dictionary editor (add/reorder/rename, multilingual — EN required, translations optional) + the read-only view with EN fallback.
- [`email-notifications.spec.ts`](scenarios/email-notifications.md) — the per-user email-mirror opt-out toggle.
- [`feature-flags.spec.ts`](scenarios/feature-flags.md) — per-user feature flags end to end + the per-feature screen's team bulk toggle.
- [`feedback-delivery.spec.ts`](scenarios/feedback-delivery.md) — the receiving side: draft invisibility, Received list, bell deep link.
- [`feedback-lifecycle-rest.spec.ts`](scenarios/feedback-lifecycle-rest.md) — create-as-SENT, provider draft delete, History/Lifecycle tabs.
- [`feedback-provide.spec.ts`](scenarios/feedback-provide.md) — provide → draft → send → withdraw.
- [`feedback-request-third-party.spec.ts`](scenarios/feedback-request-third-party.md) — manager requests feedback about a subordinate from a third party; requester message rides along.
- [`feedback-request-triage.spec.ts`](scenarios/feedback-request-triage.md) — ask → accept → send; and reject.
- [`goals.spec.ts`](scenarios/goals.md) — the goal lifecycle, PLAN milestones, chain-manager visibility, notifications.
- [`hr.spec.ts`](scenarios/hr.md) — the HR auditor reads a private draft via the Audit section; admin gets no audit surface.
- [`i18n.spec.ts`](scenarios/i18n.md) — language menu switch (native names) on a throwaway user, persisted across reload AND re-login (the v2.21.0 server-side sync).
- [`kudos.spec.ts`](scenarios/kudos.md) — a PUBLIC feedback lands on the Kudos wall for a non-party.
- [`lists.spec.ts`](scenarios/lists.md) — shared list plumbing: filters, sort toggle, page size.
- [`manager-oversight.spec.ts`](scenarios/manager-oversight.md) — the My team feedback tab and the per-user two-way screen.
- [`mfa.spec.ts`](scenarios/mfa.md) — opt-in email MFA at login (Mailpit-gated).
- [`notifications.spec.ts`](scenarios/notifications.md) — bell mechanics: badge, seen/unseen, mark all, delete.
- [`one-on-ones.spec.ts`](scenarios/one-on-ones.md) — documenting 1:1s, action-item carry-over, subordinate notification.
- [`org-chart.spec.ts`](scenarios/org-chart.md) — the org-chart canvas and its drill-downs.
- [`password-reset.spec.ts`](scenarios/password-reset.md) — the Forgot-password flow (neutral answers, working new password; Mailpit-gated).
- [`performance-reviews.spec.ts`](scenarios/performance-reviews.md) — review periods, the full review lifecycle, Distribution + Quadrants views.
- [`pulse.spec.ts`](scenarios/pulse.md) — the pulse cycle end to end: schedule/open/fill/monitor/close/results/trend/cancel (own serial phase).
- [`self-reflection.spec.ts`](scenarios/self-reflection.md) — feedback about oneself, delivered to the Provided tab.
- [`team-kpis.spec.ts`](scenarios/team-kpis.md) — the team-KPI lifecycle, data points + graph, member notifications.
- [`teams.spec.ts`](scenarios/teams.md) — team CRUD, roster edits, admin-only manager reassignment.
- [`templates.spec.ts`](scenarios/templates.md) — template CRUD + Insert into the feedback editor.
- [`tour.spec.ts`](scenarios/tour.md) — the guided tour's landmark order as manager and admin.
- [`user-career.spec.ts`](scenarios/user-career.md) — the career-position timeline, Career page + Team pyramid + time slider, dictionary rename propagation, the v2.25.0 self/chain/HR read privacy (no career link on manager cards; direct URL refused).
- [`user-details.spec.ts`](scenarios/user-details.md) — the read-only user-details card in every relationship flavor + the Teams membership view.
- [`user-edit.spec.ts`](scenarios/user-edit.md) — admin creates (password reveal) and renames a user.
- [`users-admin.spec.ts`](scenarios/users-admin.md) — roles, password reset vs self-change, deactivate/reactivate, delete.
- [`users-import.spec.ts`](scenarios/users-import.md) — mass CSV import; re-import yields duplicates.
- [`welcome-email.spec.ts`](scenarios/welcome-email.md) — create-with-email: the welcome mail's password signs in (Mailpit-gated).

Specs log in with the seeded accounts (`admin@lettuce.local`, `manager-aaa@…`, `aaa-one/two/three@…`,
all password `changeme`), capture created ids from API responses so they act on their own rows, and
use unique content — so they don't depend on a clean database or absolute counts. Mutating specs
(rename/role/password/delete) only ever touch throwaway users they create through the UI; seeded
accounts are never mutated. The onboarding tour is suppressed via an init script (see
`tests/helpers.ts`).

### Logging in

`helpers.login()` has two paths. For a **seeded account with the seed password** it mints a session
over the API and writes the five `lettuce.auth.*` localStorage keys the SPA itself persists
(`sessions.ts`) — equivalent to having driven the form, minus the typing, a navigation, and the
stored-language application (only the real form/refresh path runs `persistSession`, which applies
`LoginResponse.language` to the UI — v2.21.0; language-sensitive journeys must use
`loginWithPassword()`). A full run does ~90 logins. The session is minted **per call**, not cached: `logout()` revokes
both tokens server-side, so a session reused across specs would be a revoked one (the app then
shows "You've been signed out"). If an injected session doesn't authenticate, the helper falls back
to a real login — slow, never wrong.

Everything else takes `loginWithPassword()`, the real form driver: any throwaway user, and any call
passing an explicit password. That keeps the specs whose subject *is* a credential honest —
`users-import` (the imported one-time password), `password-reset` (the new password), `users-admin`
(reset / self-changed / deactivated / deleted accounts), `performance-reviews` and `hr` (generated
passwords), and `feature-flags` (the fresh login is what proves the flags took effect).
`auth.spec.ts`'s "log in and log out" calls `loginWithPassword` explicitly — it exists to exercise
the form. Development stacks also lift the per-IP login bucket
(`security.rateLimit.loginPerMinute`, 1000/min in development vs 10/min in production), so the
remaining real logins aren't throttled either.

## Deliberately not covered

- **Login lockout (429)** — five failed logins would lock a seeded account for 15 minutes in the
  shared database and poison the rest of the run. Covered by `LoginThrottleTest` /
  `LoginLockoutTest` (server).
- **Token refresh / expiry** — needs clock control; covered by server tests and the
  `web/src/api/api.test.ts` unit tests.
- **The authz / visibility matrix** — exhaustively covered by `AuthorizationTest` (server); E2E
  asserts only user-visible consequences (a draft hidden from its subject, notification links).
- **`DRAFT → WITHDRAWN` (abandon a draft)** — a valid backend transition with no UI affordance
  (the editor offers Delete instead), so it cannot be exercised through the browser.
- **Dark-mode rendering** — the theme toggle is unit-tested and the palette is theme-owned
  (`web/src/theme.ts`); no e2e asserts colors, and there is no visual-regression suite.
- **Responsive / cross-browser / visual automation** — the suite deliberately runs Desktop
  Chrome only, with no mobile project or screenshot comparison; layout relies on Mantine
  semantics plus the role/label-based locators every spec already uses. Accessibility gets
  the `accessibility.spec.ts` axe smoke (see above) — structural rules only, with
  `color-contrast` consciously waived.

Reports/artifacts land in `playwright-report/` and `test-results/` (git-ignored).
