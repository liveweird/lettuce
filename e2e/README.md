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
- `notifications.spec.ts` — bell mechanics: unread badge, mark seen / unseen, mark all as seen.
- `user-edit.spec.ts` — admin creates (generated-password reveal) and renames a user; career profile: set a career path, dictionary rename propagates, retired entry keeps resolving
  (`PUT /users/{id}`).
- `users-admin.spec.ts` — role change; admin password reset vs. self-change (current password
  required, wrong one rejected); deactivate/reactivate (Inactive badge, the distinct
  "account has been deactivated" sign-in rejection, reactivation restores access); delete
  (deleted account can no longer sign in).
- `feature-flags.spec.ts` — per-user feature flags: admin disables Goals for a fresh user via
  the per-user editor (Modify ▾ → Features), the user loses the feature end to end (nav link
  gone, direct URL bounces home), then re-enables it from the per-feature `/feature-flags`
  screen and the user gets it back.
- `users-import.spec.ts` — mass CSV import: a mixed file imports row-by-row (an imported
  password signs in); re-importing the same rows yields duplicates, not new accounts.
- `password-reset.spec.ts` — the "Forgot password?" flow: neutral answer for unknown emails;
  a reset email delivers a working new password and kills the old one.
- `teams.spec.ts` — team create / rename / member add + remove / **manager reassignment**
  (admin-only) / delete.
- `templates.spec.ts` — template CRUD + **Insert** into the feedback editor.
- `dictionaries.spec.ts` — the global dictionaries: an admin **adds**, **reorders**, and
  **renames** entries in the whole-list editor (one Save per round), a regular user sees the
  read-only numbered view, and the throwaway entries are removed at the end.
- `manager-oversight.spec.ts` — the **My team** feedback tab and the per-user two-way
  feedbacks screen.
- `lists.spec.ts` — shared list plumbing on the Users page: filters (+ clear), sort toggle,
  page size.
- `one-on-ones.spec.ts` — a manager documents a 1:1 (points / decisions / action items) with a
  direct report, views and deletes it; open action items **carry over** to the next meeting
  ("Carried over" badge) and the subordinate is **notified** and reads the meeting read-only.
- `goals.spec.ts` — a manager walks a goal around the whole lifecycle (draft via the
  activate-prompt's **No**, Save & activate, progress update, archive-with-summary, reopen,
  DRAFT-only delete); creating with **Yes** activates on the spot, **notifies** the
  subordinate, and shows read-only in their **My goals**.
- `dashboard-my-teams.spec.ts` — the Dashboard **My teams** tab: a manager's teams (and only
  theirs), the per-team subordinates view with the same cards/stats/actions as My subordinates,
  a drill-down round-trip back to it, and a non-manager's empty state.
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
  affordances; an **Unpublish** takes it back to calibration. The manager leg also flips the
  Team's-performance tab to the **Distribution** view (v1.40.0 toggle) and back. The
  calibration leftover persists in the dev volume by design (a fresh subordinate each run).
- `days-off.spec.ts` — the days-off journey: a user files a **PAID request** on a
  run-varying future Monday (half-day edge, live cost preview), the direct manager
  **accepts** it from the team tab (and the owner is **notified**), it lands on the shared
  **calendar** and the per-user drill-down card stats; a manager records a **budget
  correction** (v1.43.0) the subordinate sees read-only on their budget card; the owner
  **cancels** the accepted request at the end so no counting rows persist on seed accounts
  (seeded Polish holidays are blocklisted when picking the Monday).
- `tour.spec.ts` — replays the guided tour as a manager and walks all 36 steps, pinning the
  landmark order (whole left menu — Changelog included — before the header icons).
- `alerts.spec.ts` — admin creates an alert; a regular user sees the **banner**, hides it to the
  strip and re-shows it (and has no alert management); deactivation and delete remove it.
- `user-details.spec.ts` — the read-only user-details view: the "User details" buttons on the
  users list and a team roster open the person's dashboard card in every relationship flavor
  (their-manager / my-direct-report / unrelated fallback), with origin-aware back links.
- `hr.spec.ts` — the HR auditor role: an admin grants HR to a throwaway user; the auditor
  browses another pair's **private draft** read-only via the user-details **Audit** section
  (feedbacks / 1:1s / goals drill-downs), with zero write affordances and no admin surface —
  while the seed **admin gets no Audit section at all** (management-only ADMIN, v1.26.0).
- `self-reflection.spec.ts` — a user writes feedback about themselves (both parties "You",
  the no-requester visibility pair) and finds it delivered in their Provided tab.
- `i18n.spec.ts` — PL/EN switch, persisted across reload.

Specs log in with the seeded accounts (`admin@lettuce.local`, `manager-aaa@…`, `aaa-one/two/three@…`,
all password `changeme`), capture created ids from API responses so they act on their own rows, and
use unique content — so they don't depend on a clean database or absolute counts. Mutating specs
(rename/role/password/delete) only ever touch throwaway users they create through the UI; seeded
accounts are never mutated. The onboarding tour is suppressed via an init script (see
`tests/helpers.ts`).

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

Reports/artifacts land in `playwright-report/` and `test-results/` (git-ignored).
