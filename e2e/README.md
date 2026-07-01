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
- `user-edit.spec.ts` — admin renames a user (`PUT /users/{id}`).

Specs log in with the seeded accounts (`admin@lettuce.local`, `manager-aaa@…`, `aaa-one/two@…`, all
password `changeme`), capture created ids from API responses so they act on their own rows, and use
unique content — so they don't depend on a clean database or absolute counts. The onboarding tour is
suppressed via an init script (see `tests/helpers.ts`).

Reports/artifacts land in `playwright-report/` and `test-results/` (git-ignored).
