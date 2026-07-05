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
endpoints through the UI):

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
- `user-edit.spec.ts` — admin creates (generated-password reveal) and renames a user
  (`PUT /users/{id}`).
- `users-admin.spec.ts` — role change; admin password reset vs. self-change (current password
  required, wrong one rejected); delete (deleted account can no longer sign in).
- `teams.spec.ts` — team create / rename / member add + remove / **manager reassignment**
  (admin-only) / delete.
- `templates.spec.ts` — template CRUD + **Insert** into the feedback editor.
- `manager-oversight.spec.ts` — the **My team** feedback tab and the per-user two-way
  feedbacks screen.
- `lists.spec.ts` — shared list plumbing on the Users page: filters (+ clear), sort toggle,
  page size.
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
