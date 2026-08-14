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
  edits `seniority-levels`, `user-edit.spec` edits `career-paths`; review periods —
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
endpoints through the UI). **A new spec file must land with its bullet below in the same
commit** — this list is the suite's coverage map, and it has drifted three times.

- `auth.spec.ts` — login / logout / invalid credentials.
- `feedback-provide.spec.ts` — provide → save draft → **send** → **withdraw** (create, `PUT` content,
  `POST /send`, `POST /withdraw`).
- `feedback-request-triage.spec.ts` — ask → **accept** (`POST /pick-up`) → send; and **reject**
  (`POST /reject`).
- `feedback-lifecycle-rest.spec.ts` — direct create-as-**SENT** ("Save & send" on the create form),
  the provider-only **draft delete** (soft-delete → 404 + gone from lists), and the **History** /
  **Lifecycle** tabs on the view screen.
- `feedback-delivery.spec.ts` — the receiving side: a draft is invisible to its subject; once sent
  it appears in their **Received** list and the **bell notification**'s "Go to" opens it (and
  marks the notification as seen).
- `feedback-request-third-party.spec.ts` — a manager **requests feedback about a subordinate from a
  third party** with a **requester message**; the message rides read-only through triage and the
  draft editor; the requester is notified on pick-up and send.
- `kudos.spec.ts` — the Kudos wall (v2.2.0): a provider sends a **PUBLIC** feedback, then a
  caller who is **no party to it** finds it on `/kudos` and expands the card to the full content.
- `notifications.spec.ts` — bell mechanics: unread badge, mark seen / unseen, mark all as seen,
  and per-row **delete** (gone for good, the sibling card stays).
- `email-notifications.spec.ts` — the email-mirror opt-out (v2.3.0): a throwaway user reaches
  the screen via the header **account menu**, opts out (the switch survives save + reopen) and
  back in.
- `user-edit.spec.ts` — admin creates (generated-password reveal) and renames a user; career profile: set a career path, dictionary rename propagates, retired entry keeps resolving
  (`PUT /users/{id}`).
- `users-admin.spec.ts` — role change; admin password reset vs. self-change (current password
  required, wrong one rejected); deactivate/reactivate (Inactive badge, the distinct
  "account has been deactivated" sign-in rejection, reactivation restores access); delete
  (deleted account can no longer sign in).
- `feature-flags.spec.ts` — per-user feature flags: admin disables Goals for a fresh user via
  the per-user editor (Modify ▾ → Features), the user loses the feature end to end (nav link
  gone, direct URL bounces home), then re-enables it from the per-feature `/feature-flags`
  screen and the user gets it back; plus the v2.1.0 team bulk toggle — a fresh team of two
  fresh users, the Team filter narrows the table, bulk disable/enable flips both rows behind
  the count-stating confirm (the fresh team is deleted at the end).
- `users-import.spec.ts` — mass CSV import: a mixed file imports row-by-row (an imported
  password signs in); re-importing the same rows yields duplicates, not new accounts.
- `password-reset.spec.ts` — the "Forgot password?" flow: neutral answer for unknown emails;
  a reset email delivers a working new password and kills the old one.
- `mfa.spec.ts` — email MFA at login (v2.4.0): admin enables the inverted-default MFA flag for a
  throwaway user; their next sign-in demands the 6-digit code fetched from Mailpit (wrong code
  rejected inline first). Skips itself when Mailpit is unreachable; seed accounts stay MFA-off,
  so no other spec's login path is touched.
- `teams.spec.ts` — team create / rename / member add + remove / **manager reassignment**
  (admin-only) / delete.
- `templates.spec.ts` — template CRUD + **Insert** into the feedback editor.
- `dictionaries.spec.ts` — the global dictionaries: an admin **adds**, **reorders**, and
  **renames** entries in the whole-list editor (one Save per round; bilingual since v2.6.0 —
  two inputs per row, `Entry N (English)`/`(Polish)`, both values asserted in the read-only
  view), a regular user sees the read-only numbered view, and the throwaway entries are
  removed at the end.
- `manager-oversight.spec.ts` — the **My team** feedback tab and the per-user two-way
  feedbacks screen.
- `lists.spec.ts` — shared list plumbing on the Users page: filters (+ clear), sort toggle,
  page size.
- `one-on-ones.spec.ts` — a manager documents a 1:1 (points / decisions / action items) with a
  direct report, views and deletes it; open action items **carry over** to the next meeting
  ("Carried over" badge) and the subordinate is **notified** and reads the meeting read-only.
- `goals.spec.ts` — a manager walks a goal around the whole lifecycle (draft via the
  activate-prompt's **No**, Save & activate, progress update, archive-with-summary, reopen,
  DRAFT-only delete); a **PLAN goal** (v2.9.0) defines milestones in the draft, ticks one on
  the Update screen, and shows it **struck through** with the "done / total" tally; creating
  with **Yes** activates on the spot, **notifies** the subordinate, and shows read-only in
  their **My goals**.
- `dashboard-my-teams.spec.ts` — the Dashboard **My teams** tab: a manager's teams (and only
  theirs), the name link into the adaptive team-details page where a manager lands on the
  per-team subordinates grid (same cards/stats/actions as My subordinates, v2.5.5), a
  drill-down round-trip back to it, and a non-manager's empty state.
- `team-kpis.spec.ts` — a manager walks a team KPI around the whole lifecycle from the My-teams
  **Team KPIs** drill-down (a DRAFT row's action is **Edit** straight into the editor, every
  other row **View**; Save & activate, then the **KPI data** tab's inline editing — add a
  backdated and a later point, correct one, remove one, the list's Current following the
  max-dated point — the **Graph** tab, archive-with-summary, reopen, DRAFT-only delete);
  creating with **Yes** activates on the spot and **notifies the members** — as does the
  manager recording a data point (the bell shows both; "Go to" opens the document) — and the
  KPI shows read-only — no lifecycle/Edit/Add-value affordances — in their **My teams' KPIs**.
- `org-chart.spec.ts` — the org-chart canvas: seed org nodes render, teamless people (the seed
  Administrator) appear under the "Not in any team" section; a person node opens the
  user-details view (and returns), a team node opens the roster.
- `performance-reviews.spec.ts` — the performance-review journey: the admin **appends a review
  period** (Config → Review periods, the adjacent start pre-locked — the fresh period is
  **future**, so since v1.34.2 no review can target it; the spec reads the **current** period
  off the timeline's Current badge instead) and mints a **throwaway subordinate + team** under
  Manager AAA (a fresh person per run keeps the (subordinate, current period) slot new); the
  manager scopes the Performance page's **Team's performance** tab (v1.45.0 — formerly the
  Dashboard's reviews tab) to the current period + throwaway
  team ("No review yet" → New review → the editor, which defaults to the newest **started**
  period and greys the future one out), fills all four categories, **Save & submit**, then
  **publishes** from the view screen (a CALIBRATION row's action is View — the lifecycle lives
  there); the subordinate is **notified** and reads it on the Performance page's **My
  performance** tab with zero write
  affordances; an **Unpublish** takes it back to calibration, **Return to draft** takes it back
  to DRAFT, and the editor's **Delete** removes the draft — the slot reads "No review yet"
  again. The manager leg also flips the Team's-performance tab to the **Distribution** view
  (v1.40.0 toggle) and the **Quadrants** view (v2.7.0 — the reviewee's avatar at the (4, 4)
  cell, then an axis swap re-plots it) and back. Only the throwaway subordinate + team persist in the dev volume
  (a fresh one each run).
- `days-off.spec.ts` — the days-off journey: a user files two **PAID requests** on run-varying
  future Mondays (half-day edge, live cost preview), the direct manager **accepts** one and
  **rejects** the other from the team tab (both outcomes **notified**, the Rejected row found
  via its status filter), the accepted one lands on the shared **calendar** and the per-user
  drill-down card stats; an **UNPAID** single-day request shows the same cost preview while
  leaving the paid budget untouched; a manager records a **budget correction** (v1.43.0) the
  subordinate sees read-only on their budget card; the owner **cancels** the counting requests
  at the end so none persist on seed accounts (seeded Polish holidays are blocklisted when
  picking the Monday).
- `tour.spec.ts` — replays the guided tour twice, pinning the landmark order (whole left menu —
  Changelog included — and every tab of the views it opens, before the header icons): as a
  manager (50 of the 53 steps — the three admin-only Config leaves are correctly absent) and as
  the admin (45 steps — the manager-gated tabs drop out, the admin-only leaves join).
- `alerts.spec.ts` — admin creates an alert; a regular user sees the **banner**, hides it to the
  strip and re-shows it (and has no alert management); deactivation and delete remove it.
- `user-details.spec.ts` — the read-only user-details view: the name links (v2.5.2 — the
  person's name, carrying the "User details for …" aria) on the users list and a team roster
  open the person's dashboard card in every relationship flavor (their-manager /
  my-direct-report / unrelated fallback), with origin-aware back links. Team names are links
  too (v2.5.4 — "Team details for …" aria → /teams/:id/details); the Members buttons are gone.
- `hr.spec.ts` — the HR auditor role: an admin grants HR to a throwaway user; the auditor
  browses another pair's **private draft** read-only via the user-details **Audit** section
  (feedbacks / 1:1s / goals drill-downs), with zero write affordances and no admin surface —
  while the seed **admin gets no Audit section at all** (management-only ADMIN, v1.26.0).
- `self-reflection.spec.ts` — a user writes feedback about themselves (both parties "You",
  the no-requester visibility pair) and finds it delivered in their Provided tab.
- `i18n.spec.ts` — PL/EN switch, persisted across reload.
- `pulse.spec.ts` — the pulse-survey lifecycle (v2.0.0): admin schedules (prefilled dates) and
  **opens** a cycle; a participant is notified, **fills** the 7-question survey and **edits** it
  while open; the manager watches per-person **participation** live; two teammates respond over
  the API (k≥3), the admin **closes**; the respondent reads the team's aggregated **results** (since v2.6.2 asserting HAND-COMPUTED aggregates — eNPS 0 with 33.3-thirds, per-row means/favorables/n)
  from the bell deep link while the non-responding manager still reads the anonymized
  **comments** (the fill-gate/monitoring split); Manager CCC (a respondent in no team scope)
  exercises the **two-view Results layout** (v2.12.0) — the member view's empty state (no
  comments there), then "Teams I manage" with CCC/AAA/BBB cards: CCC withheld on the direct
  calculation ("0 of 2"), AAA's hand-computed numbers, comments visible (the monitoring
  right), and "Including everyone below" widening CCC to "3 of N responded" with eNPS 0
  (N deliberately unpinned — reviews.spec's Manager-AAA-managed team joins CCC's subtree
  scope and accumulates on a shared DB); the same session
  opens the **Trend** tab (team pills since v2.14.0) — the member empty state first, then
  "Teams I manage": one pill per monitored team (AAA/BBB/CCC, all on — one line each), the
  calc switch to "Including everyone below", and the metric switch to Q2, asserting
  chart-or-pending either-or locators only (chart presence is run-dependent: CI has one
  closed cycle, reruns accumulate); and a scheduled cycle is **cancelled** with the audit-honest confirmation.
  Runs in its own serial phase — see "Parallel execution".

Specs log in with the seeded accounts (`admin@lettuce.local`, `manager-aaa@…`, `aaa-one/two/three@…`,
all password `changeme`), capture created ids from API responses so they act on their own rows, and
use unique content — so they don't depend on a clean database or absolute counts. Mutating specs
(rename/role/password/delete) only ever touch throwaway users they create through the UI; seeded
accounts are never mutated. The onboarding tour is suppressed via an init script (see
`tests/helpers.ts`).

### Logging in

`helpers.login()` has two paths. For a **seeded account with the seed password** it mints a session
over the API and writes the five `lettuce.auth.*` localStorage keys the SPA itself persists
(`sessions.ts`) — equivalent to having driven the form, minus the typing and a navigation, and a
full run does ~90 logins. The session is minted **per call**, not cached: `logout()` revokes
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
  `web/src/api/client.ts` unit tests.
- **The authz / visibility matrix** — exhaustively covered by `AuthorizationTest` (server); E2E
  asserts only user-visible consequences (a draft hidden from its subject, notification links).
- **`DRAFT → WITHDRAWN` (abandon a draft)** — a valid backend transition with no UI affordance
  (the editor offers Delete instead), so it cannot be exercised through the browser.
- **Dark-mode rendering** — the theme toggle is unit-tested and the palette is theme-owned
  (`web/src/theme.ts`); no e2e asserts colors, and there is no visual-regression suite.
- **Responsive / cross-browser / accessibility automation** — the suite deliberately runs
  Desktop Chrome only, with no mobile project, screenshot comparison, or axe scan; layout and
  a11y rely on Mantine semantics plus the role/label-based locators every spec already uses.

Reports/artifacts land in `playwright-report/` and `test-results/` (git-ignored).
