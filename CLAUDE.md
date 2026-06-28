# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Gradle wrapper is at `./gradlew` (use `gradlew.bat` on Windows). JDK 21 toolchain is required (auto-provisioned via foojay-resolver).

- Build everything: `./gradlew build`
- Run the server (Ktor + Netty on port 8080): `./gradlew :server:run`
- Run all tests: `./gradlew test`
- Run server tests only: `./gradlew :server:test`
- Run a single test: `./gradlew :server:test --tests "ch.nokillswit.ServerTest.test root endpoint"`
- Package the server for deployment: `./gradlew :server:installDist` (output under `server/build/install/server/`, launcher `bin/server`). **Do not use `:server:buildFatJar`** — the shadow plugin collapses the duplicate `META-INF/services/org.flywaydb.core.extensibility.Plugin` descriptors and the fat JAR NPEs at startup inside Flyway's plugin registry. `installDist` keeps each dependency JAR separate, so Flyway's `ServiceLoader` discovery works exactly as under `:server:run`.
- **Run the whole stack with one command: `docker compose up --build`** (only Docker required). See "Running the full stack" below.

## Running the full stack

Two ways to run, sharing the same `docker-compose.yaml`:

- **One command (clone & run / demo):** `docker compose up --build` builds the SPA, builds the server, starts PostgreSQL, runs Flyway on boot, and serves everything at `http://localhost:8080` (Swagger at `/openapi`). Tear down with `docker compose down` (add `-v` to drop the DB volume).
- **Local development (hot reload, unchanged):** `docker compose up postgres` + `./gradlew :server:run` + `cd web && npm run dev` (Vite on `:5173`, proxying `/api` → `:8080`).

The root `Dockerfile` is a 3-stage build: (1) `node` builds `web/dist`, (2) `eclipse-temurin:21-jdk` runs `:server:installDist`, (3) `eclipse-temurin:21-jre` runtime bundles the install image **and** the built SPA, sets `WEB_STATIC_DIR=/app/web`, and runs `bin/server`. The `app` Compose service points the `POSTGRES_*` env vars at the `postgres` service host and waits on its healthcheck. `.dockerignore` keeps build outputs / `node_modules` / `.git` out of the build context.

## Architecture

Multi-module Gradle build (Kotlin DSL) defined in `settings.gradle.kts` with three Kotlin modules plus a separate JS frontend in `web/`:

- **`core`** — Kotlin Multiplatform (JVM target only currently). Shared code consumed by both `server` and `client`. Holds the OpenTelemetry SDK bootstrap (`getOpenTelemetry(serviceName)`) used on both sides so server and client share the same tracing setup.
- **`client`** — Kotlin Multiplatform. A Ktor `HttpClient` pre-wired with `KtorClientTelemetry`. Depends on `core`.
- **`server`** — Kotlin/JVM. The Ktor application. Depends on `core`.
- **`web/`** — Vite + React + TypeScript SPA that consumes the server's HTTP API. Standalone npm workspace; Gradle does not touch it.

Group is `ch.nokillswit`, version `1.0.0-SNAPSHOT` (set in root `build.gradle.kts`). Dependency versions are centralized in `gradle/libs.versions.toml`; Ktor itself comes from a separate version catalog (`ktorLibs`) loaded from `io.ktor:ktor-version-catalog` in `settings.gradle.kts`.

### Server bootstrap model

`server/src/main/kotlin/main.kt` just delegates to `io.ktor.server.netty.EngineMain`. The application is wired declaratively in `server/src/main/resources/application.yaml` under `ktor.application.modules` — each entry is a fully-qualified extension function on `Application` (e.g. `ch.nokillswit.plugins.HttpKt.configureHttp`). To add a new cross-cutting concern, create a new `configureXxx()` extension under `plugins/` and register it in `application.yaml`; do not call it from `main.kt`.

### Package layout

```
ch.nokillswit
├── main.kt
├── plugins/            cross-cutting Ktor wiring (configureXxx that only `install` plugins)
├── infra/db/           Flyway migrations + R2DBC connection bootstrap
├── infra/paging/       list-endpoint paging/sort/filter helper (parsePaging, applyPaging)
├── authz/              RBAC guards + CallerPrincipal (see "Authorization model")
├── auth/               POST /api/login + password hashing
├── users/              /api/users/* CRUD + list + UserService + Users table
├── teams/              /api/teams/* CRUD + list + member sub-resource + TeamService + Teams/TeamMembers tables
├── feedbacks/          /api/feedbacks/* CRUD + list + FeedbackService + Feedbacks table + FeedbackVisibility
└── notifications/      /api/notifications/* list + read + seen/unseen + delete + NotificationService + Notifications table (recipient-scoped)
```

Routing is feature-local: each feature package registers its own routes from its `configureXxx` module. `plugins/Routing.kt` is a catch-all for non-feature endpoints (`/ws`, `/json/kotlinx-serialization`, `/session/increment`). It also owns the SPA: when `WEB_STATIC_DIR` (config key `web.staticDir`) is set, `configureRouting` installs `singlePageApplication` to serve `web/dist` with an `index.html` fallback; when unset (local dev, where Vite serves the SPA), it falls back to a plain `GET /` → "Hello, World!".

Module load order in `application.yaml` matters for inter-module attribute reads: `configureSecurity` puts `JwtConfigKey` in `attributes`; `configureDatabase` puts `UserServiceKey`. `configureAuthRoutes` and `configureUserRoutes` read both, so they must run after both. Current order: plugins → `infra/db` (Flyway, then Database) → features (users, auth) → catch-all `configureRouting`.

### Persistence

PostgreSQL is the only database. Connection settings come from the `postgres:` block in `application.yaml` (env-overridable via `POSTGRES_JDBC_URL`, `POSTGRES_R2DBC_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`); defaults match the `docker compose up postgres` service. There is one persistence stack:

- **Flyway** (`infra/db/Flyway.kt`) — runs schema migrations from `server/src/main/resources/db/migration/` at startup via the Java API, opening a short-lived JDBC connection. Migrations are the single source of truth for schema; do not call `SchemaUtils.create` anywhere.
- **Exposed + R2DBC** (`infra/db/Database.kt` + `users/UserService.kt`) — runtime DB access. `Database.kt` connects the `R2dbcDatabase` and publishes `UserServiceKey`; the service itself lives next to the feature it serves. The Exposed table objects (e.g. `UserService.Users`) are used for queries only, not DDL.

The `org.postgresql:postgresql` JDBC driver is on the classpath solely for Flyway; runtime queries go through R2DBC.

Current migrations are `V1`–`V14`: schema for users/teams/feedbacks/revoked-tokens, the `users.role` column (`V5`), the `admin@lettuce.local` seed (`V6`), a soft-delete `marked_as_deleted BOOLEAN` column (with index) on `users` (`V7`) and `teams` (`V8`), a demo-org seed (`V9`), a feedback templates table (`V10`), the `REJECTED` feedback status (`V11`), a feedback `last_modified` column (`V12`), the `notifications` table (`V13`), and a seed of four default feedback templates (`V14`, idempotent via `ON CONFLICT (name)`). Soft delete is the pattern for users and teams — rows are flagged `marked_as_deleted`, not physically removed; queries filter on it.

### List endpoint conventions

`GET /api/users`, `GET /api/teams`, and `GET /api/feedbacks` are list endpoints; every list endpoint follows the rules below. The OpenAPI spec is the contract; document the query params for each list endpoint there.

**Pagination — offset, in the body envelope.**

- Query params: `page` (1-based, default `1`, must be ≥ 1) and `pageSize` (default `20`, max `100`). Out-of-range values → `400` + `ApiError`.
- Response is always an envelope, never a bare array:
  ```json
  { "items": [ ... ], "page": 1, "pageSize": 20, "total": 137 }
  ```
- `total` is the row count after filters but before pagination. Count and page rows run in the same `suspendTransaction { ... }` so they stay consistent.
- Cursor pagination is not the default; add it only per-endpoint when stable ordering under heavy concurrent writes is actually needed, and document the cursor format in that endpoint's OpenAPI definition.

**Sorting — `sort` with leading `-` for descending.**

- `sort=field` (asc) or `sort=-field` (desc). Multi-field is comma-separated, leftmost wins: `sort=-createdAt,id`.
- Each endpoint declares an explicit whitelist of sortable fields in its `*Routes.kt`; unknown field → `400`.
- Always append `id` ascending as a deterministic tiebreaker so paging is stable.
- Default sort, if the client sends none, is `id` ascending — state it in the OpenAPI description.

**Filtering — whitelisted equality, plus a few operators where needed.**

- Equality on whitelisted fields: `?status=DRAFT&providerId=42`. Unknown fields → `400`.
- Repeating a key means `IN`: `?status=DRAFT&status=SENT` → `status IN ('DRAFT', 'SENT')`.
- Range/operator filters use bracket suffixes — only the ones a given endpoint actually needs:
  - `field[gte]`, `field[gt]`, `field[lte]`, `field[lt]` for ordered types (timestamps, numbers).
  - No `[like]`, no `[ne]`, no `[in]` (use repetition for `IN`). Keep the operator surface tiny.
- Free-text search uses a single `q` param. The endpoint decides which columns `q` searches (e.g. users: `name`, `email`); document the searched columns in OpenAPI.
- Per-column substring search is also allowed when a UI genuinely needs per-column matching that `q` cannot express. The filter param uses the column name directly (e.g. `?name=ali`), is case-insensitive `contains`, and must be documented per-endpoint. First example: `GET /api/users` uses `name` and `email` this way. Reach for `q` first; promote to per-column only when the UI requires it.
- Booleans are `true`/`false`. Enums use their string name. Malformed values → `400`.

**Naming and OpenAPI plumbing.**

- Param names are `camelCase` to match existing JSON bodies (`pageSize`, not `page_size`).
- Add reusable parameters `Page`, `PageSize`, `Sort`, `Q` to `#/components/parameters` in `documentation.yaml`, then `$ref` them from each list path. Per-endpoint sortable/filterable fields go in that path's `parameters` list with a `description` listing the whitelist.
- Pagination envelopes are one schema per resource (`UserPage`, `TeamPage`, …) wrapping the existing `*Response[]` — keep them next to the resource's other schemas.

**Implementation.**

- The shared helper lives at `infra/paging/Paging.kt`: `ApplicationCall.parsePaging(...)` parses `page`/`pageSize`/`sort` from the query string and validates against per-endpoint whitelists into a `PageRequest`; `Query.applyPaging(req, columns)` applies `.limit(...).offset(...)` + `.orderBy(...)` to an Exposed `Query`. Validation failures throw a typed exception that `StatusPages` maps to `400` + `ApiError`. New list endpoints reuse these rather than re-parsing params.

### Security defaults are template placeholders

`plugins/Security.kt` uses a hard-coded HMAC256 secret (`"secret"`), audience, and issuer for JWT, and CORS in `plugins/Http.kt` calls `anyHost()`. CSRF install is gated behind `security.csrf.enabled` (default **`false`** in `application.yaml`, env-overridable via `SECURITY_CSRF_ENABLED`); the configured `originMatchesHost()` + `allowOrigin("http://localhost:8080")` + `checkHeader("X-CSRF-Token")` combo is unsatisfiable from both the Ktor test client and the dev SPA on `:5173`, and CSRF protection is anyway moot for this app's bearer-JWT auth model — browsers do not auto-attach `Authorization` headers, so cross-site forms cannot forge an authenticated request. Re-enable only if you move to cookie-based session auth and fix the allow-list accordingly. All of these are starter values and must be replaced before any non-development use.

**Default admin & demo seed.** Migration `V6__seed_admin.sql` inserts a single bootstrap administrator on first boot: `admin@lettuce.local` / `changeme` (role `ADMIN`), idempotent via `ON CONFLICT (email) DO NOTHING`. `V9__seed_demo_users_and_teams.sql` additionally seeds a demo org (teams AAA/BBB/CCC with `aaa-one@…`, `manager-aaa@…`, etc.) so the dashboard lists have data — every demo user is role `USER` and logs in with `changeme` (reusing V6's bcrypt hash). All of these are template placeholders; replace or delete before any non-development use.

### Authorization model

Layered RBAC. Implemented in the `server/src/main/kotlin/authz/` package.

- **Global roles** live on `users.role` (`ADMIN` / `USER`, added by `V5__add_user_role.sql`). `ADMIN` bypasses every per-resource check **except feedback writes** — admins may read every feedback but may not edit, delete, or transition existing ones (see `canWriteFeedback`); an admin who is the feedback's provider keeps write access via the ordinary provider rule. New users default to `USER`; only an `ADMIN` may set or change the field via the API.
- **Login** issues a JWT carrying `email`, `userId`, and `role` claims; `LoginResponse` exposes `userId` and `role` to the frontend.
- **Guards** in `authz/Guards.kt` are plain `suspend fun` calls used at the top of each route handler — there is no Ktor plugin or DSL. Each route reads `call.caller()` (which parses the JWT claims into a `CallerPrincipal`) and then invokes the relevant guard.
- **Resource rules**:
  - `POST /api/users`, `DELETE /api/users/{id}` → ADMIN only.
  - `GET /api/users/{id}`, `PUT /api/users/{id}` → caller must be the target user or ADMIN; only ADMIN may change `role`.
  - `POST /api/teams` → caller must designate themselves as `managerId` (ADMIN may designate anyone).
  - `GET /api/teams/{id}` → any authenticated user.
  - `PUT /api/teams/{id}`, `DELETE /api/teams/{id}`, member sub-resource mutations → the team's current `manager_id` or ADMIN.
  - `POST /api/feedbacks` → any authenticated user (the caller need not be one of the parties); the create-time invariants apply (see "Feedback lifecycle").
  - `GET /api/feedbacks/{id}` → `canReadFeedback` (`authz/Guards.kt`), evaluated in order: **ADMIN** and the **provider** see everything; the **requester** sees it at any status, but only when visibility is `PROVIDER_REQUESTER`/`PROVIDER_REQUESTER_SUBJECT`; the **subject** sees it only when visibility is `PROVIDER_SUBJECT`/`PROVIDER_REQUESTER_SUBJECT` **and** status is `SENT`/`WITHDRAWN`; a **manager of the subject** sees it when status is `SENT`/`WITHDRAWN` (the `managesSubject` arg) — **but** the route uses `requireFeedbackReadAllowingManager`, which grants a managing caller read **unconditionally** (any status), so in practice a manager can open any subordinate's feedback (a known list-vs-detail asymmetry); finally `PUBLIC` + `SENT` is readable by anyone. Anything else is **default-deny**, which also logs a `SHOULD_NEVER_HAPPEN`-marked WARN (the branch is meant to be unreachable). Whether the **content** (vs. mere existence) is shown is a separate gate, `canReadFeedbackContent`: a requester watching an unfinished (`DRAFT`/`REQUESTED`) feedback sees that it exists but not its content.
  - `PUT/DELETE /api/feedbacks/{id}` → the row's `provider_id` **only** (`canWriteFeedback`); ADMIN can read but **not** modify feedbacks (unless the admin is themselves the provider). This guard gates **every** status transition (send, withdraw, pick-up, reject); on `PUT` the requested transition must additionally be valid for the current status (see "Feedback lifecycle") or it is `400`.
  - `GET/POST/DELETE /api/notifications/*` → the notification's `recipient_id` only (via `requireNotificationRecipient`); ADMIN bypasses. Notifications are never created through the API — see "Notifications" below.
- **Exceptions**: `UnauthorizedException` (→ 401) and `ForbiddenException` (→ 403) are mapped to `ApiError` in `plugins/ErrorHandling.kt`.
- **Tests**: `server/src/test/kotlin/AuthorizationTest.kt` covers the 401/403 paths and the full `FeedbackVisibility` matrix. The shared `TestUsers.seed` helper defaults to `role = ADMIN` so older tests keep working without modification; pass `role = UserRole.USER` when you need a non-privileged caller.

### Feedback lifecycle (statuses & transitions)

A feedback moves through a small state machine. The authoritative rules live in `feedbacks/FeedbackService.kt` — `isAllowedTransition` (the edges) and `validate` (the invariants); read/write authorization is in `authz/Guards.kt`. `FeedbackStatus` (`feedbacks/Feedback.kt`) has five values:

- **`REQUESTED`** — feedback has been requested of a provider (e.g. via "Ask for feedback"); awaits the provider picking it up or declining. **Requires a non-null requester.**
- **`DRAFT`** — the provider's private work in progress; **hidden from the subject** until it leaves `DRAFT`.
- **`SENT`** — delivered; visible to the subject / requester per `FeedbackVisibility`.
- **`WITHDRAWN`** — terminal; the provider retracted the feedback.
- **`REJECTED`** — terminal; the provider declined a request.

**Allowed transitions** (anything not listed → `400`; `WITHDRAWN` and `REJECTED` are terminal with no outgoing edges):

| From → To | Who | Meaning |
|---|---|---|
| `REQUESTED → DRAFT` | provider / ADMIN | provider picks up the request |
| `REQUESTED → REJECTED` | provider / ADMIN | provider declines the request (terminal) |
| `DRAFT → SENT` | provider / ADMIN | deliver the feedback |
| `DRAFT → WITHDRAWN` | provider / ADMIN | abandon a draft (terminal) |
| `SENT → WITHDRAWN` | provider / ADMIN | retract a sent feedback (terminal) |

Every transition is performed via `PUT /api/feedbacks/{id}` and is gated by `canWriteFeedback` (provider only — ADMIN does not get feedback write access) — so only the provider can send, withdraw, pick up, or reject.

**Creation vs. update.** On **create** (`POST`) any status is permitted — there is no transition gate, so the UI can create a feedback directly as `SENT` ("save & send") or as `REQUESTED` ("ask for feedback"). The transition check above applies only on **update**. The following invariants are enforced on **both** create and update: provider ≠ subject; requester ≠ provider; `REQUESTED` requires a requester; **a feedback with a requester may not use `PROVIDER_SUBJECT` visibility** (that visibility excludes the requester, so the combination is contradictory). Transition and invariant behavior is covered by `FeedbackRoutesTest` (transitions + the invariant) and `AuthorizationTest` (the `FeedbackVisibility` read matrix).

**Frontend: the `REQUESTED` decision screen.** Because `REQUESTED → SENT` is not a valid edge, the editor must not offer "Save & send" for a pending request. So `web/src/pages/EditFeedback.tsx`, when the loaded feedback is `REQUESTED` and the caller is its provider, renders a read-only **triage screen** (subject + requester names, no editor) instead of the `FeedbackForm` editor, with exactly three actions:

- **Close** — navigate back, change nothing.
- **Reject** — confirmation modal → `REQUESTED → REJECTED`, returns to the originating tab.
- **Accept** — `REQUESTED → DRAFT`, then **reloads in place** (invalidates the `["feedback", id]` query rather than navigating) so the same route re-renders as the normal `DRAFT` editor (Cancel / Save draft / Save & send). `handleSave` distinguishes this case via `accepted = data.status === "REQUESTED" && status === "DRAFT"` and skips the post-save navigate.

`FeedbackForm` is therefore only ever the editor for `DRAFT` and the create flows; it carries no reject affordance. This mirrors the backend state machine in the UI (defense-in-depth, not a relaxation of the server check). Covered by `web/src/pages/EditFeedback.test.tsx`.

**Frontend: the simplified requester view.** On the read-only view (`web/src/pages/ViewFeedback.tsx`), when the caller is the **requester** and the feedback is `REQUESTED` or `REJECTED`, the **Content** section is hidden — a never-drafted or declined request has no content to read. The gate is `isRequester && (status === "REQUESTED" || status === "REJECTED")` (`isRequester = getUserId() === data.requesterId`); every other viewer and status still renders Content. Covered by `web/src/pages/ViewFeedback.test.tsx`.

### Feedback list views (`GET /api/feedbacks?view=…`)

`FeedbackService.list` (`feedbacks/FeedbackService.kt`) scopes rows by `view` + the caller; the shared paging/filter helpers then apply on top. The three view scopes:

- **`received`** (the subject's inbox): `subjectId == caller` AND one of — *no requester* and status ∈ {`SENT`,`WITHDRAWN`}; OR *caller is the requester* (any status/visibility); OR *another requester* and visibility ∈ {`PROVIDER_SUBJECT`,`PROVIDER_REQUESTER_SUBJECT`,`PUBLIC`} and status ∈ {`SENT`,`WITHDRAWN`}.
- **`provided`**: `providerId == caller` (every status/visibility).
- **`team`** (manager oversight): subject is a member of a non-soft-deleted team the caller manages, AND (`providerId == caller` OR `requesterId == caller` OR status ∈ {`SENT`,`WITHDRAWN`}) — i.e. a party to it at any status, otherwise only once delivered.

Content **previews** are blanked when the feedback is unfinished (`DRAFT`/`REQUESTED`) and the caller is its requester (mirrors `canReadFeedbackContent`). The `/users/:id/feedbacks` page composes two of these: top = `received&providerId=:id` ("from them to you"), bottom = `provided&subjectId=:id` ("from you to them"). These list scopes and `canReadFeedback` (the single-GET gate) are maintained separately and can intentionally differ at the edges (e.g. a manager's unconditional single-GET grant vs. the delivered-only team list).

### Notifications

In-app notifications are **generic rows** (`recipientId`, `message`, optional `link`, `wasSeen`, `timestamp`) — there is **no notification type enum** and no API to create one. They are produced by **two** feedback-driven sources, both side-effect-free (DB-free, so directly unit-testable) functions in `feedbacks/FeedbackNotifications.kt`; `FeedbackService` resolves party display names and the route persists what they return:

- **`feedbackCreationNotifications()`** — on feedback **creation** in `REQUESTED` status. Persisted from `POST /api/feedbacks` in `feedbacks/FeedbackRoutes.kt` (`result.notifications.forEach { notificationService.create(it) }`).
- **`feedbackTransitionNotifications()`** — on a feedback **status transition**. Persisted from `PUT /api/feedbacks/{id}` (`toNotify.forEach { notificationService.create(it) }`).

**The complete list of situations that generate a notification**:

| Event | Recipient(s) | Link? |
|---|---|---|
| Created in `REQUESTED` | provider | `/feedback/{id}/edit` (always — the provider owns the edit) |
| `DRAFT → SENT` | subject (always); **and** the requester if `requesterId != null` (a second, separately-worded notification) | `/feedback/{id}/view`, per-recipient, only if that recipient may read the feedback |
| `REQUESTED → REJECTED` (requester present) | requester | no |
| `REQUESTED → DRAFT` ("picked up" by provider) | requester | no |
| `SENT → WITHDRAWN` | subject (always); **and** the requester if `requesterId != null` | no |

That is the whole set — any other create/transition produces nothing. Note that a `→ SENT` of *requested* feedback yields **two** notifications (subject + requester). For transitions, the `view` link is only attached when the recipient is permitted to read the feedback under its `FeedbackVisibility` (`subjectCanRead`/`requesterCanRead` in the same file) — otherwise `link` is null.

Reading/managing notifications goes through `notifications/NotificationRoutes.kt`, all under `authenticate` and scoped to the recipient via `requireNotificationRecipient` (ADMIN bypasses): `GET /api/notifications` (list; sortable `id`,`timestamp`, default `-timestamp`; optional `wasSeen` filter), `GET /api/notifications/{id}`, `POST /api/notifications/{id}/seen`, `POST /api/notifications/{id}/unseen`, `DELETE /api/notifications/{id}`. The endpoints are documented in `documentation.yaml`; the `notifications` table is created by `V13__create_notifications.sql`.

### Observability

`plugins/OpenTelemetry.kt` installs `KtorServerTelemetry` and obtains the SDK via `getOpenTelemetry("ktor-sample")` from the `core` module. `plugins/Monitoring.kt` separately installs Dropwizard metrics (logged via SLF4J every 10s) and the `CallId` plugin using `X-Request-Id`. The SDK is also wired for **logs**: a Logback `OpenTelemetryAppender` (`server/src/main/resources/logback.xml`, the sole root appender) bridges every SLF4J log into the OTel logs SDK, and `getOpenTelemetry` (`core/.../OpenTelemetry.kt`) installs the appender (in `plugins/OpenTelemetry.kt`) and sets the interim exporter to `console`. Defaults are set via `addPropertiesSupplier` (the lowest-precedence config tier) **on purpose**, so the sink can be redirected to a collector by env alone with no code change — set `OTEL_LOGS_EXPORTER=otlp` + `OTEL_EXPORTER_OTLP_ENDPOINT` (the `opentelemetry-exporter-otlp` dep is already on the classpath); `OTEL_TRACES_EXPORTER` likewise. Metrics and traces exporters default to `none` (`otel.metrics.exporter`/`otel.traces.exporter`). **Convention for non-fatal "this should never happen" events:** emit a WARN with the `SHOULD_NEVER_HAPPEN` marker (see `authz/Guards.kt` `canReadFeedback`'s default branch) — the marker + key/value attributes flow through the appender to OTel.

### Testing

`server/src/test/kotlin/ServerTest.kt` uses `io.ktor.server.testing.testApplication` and overrides the `postgres.*` config keys via `MapApplicationConfig` to point at a Testcontainers `PostgreSQLContainer` started lazily by `PostgresTestSupport`. Running tests requires a working Docker daemon (Docker Desktop, OrbStack, etc.). When adding tests, replicate the `environment { config = ApplicationConfig("application.yaml").mergeWith(MapApplicationConfig(...)) }` block so the app boots against the test container rather than a real database. The container runs **all** Flyway migrations, so the V6/V9/V14 seeds (admin, demo org, default templates) are present — tests scope their assertions with unique prefixes/filters rather than asserting absolute counts.

**Coverage gates.** Backend Kover enforces a line-coverage floor in `server/build.gradle.kts` (`minBound(90)`, wired into `check` via `koverVerify`). Frontend vitest enforces thresholds in `web/vite.config.ts` (`test.coverage.thresholds`); run `cd web && npm run test:coverage`. Both are floors below current actuals — keep new code covered or they fail.

### Frontend (`web/`)

Vite + React 19 + TypeScript SPA. The Gradle and npm toolchains are disjoint — never invoke npm from Gradle or vice versa.

- Dev server: `cd web && npm run dev` (port 5173). All backend routes live under the `/api/` namespace (`/api/login`, `/api/logout`, `/api/users`, `/api/teams`, `/api/feedbacks`, …) and Vite proxies the single `/api` subtree → `http://localhost:8080`. Any other path is served as `index.html` so React Router owns the SPA URL space and browser reloads don't collide with API routes.
- Production build: `cd web && npm run build` → static files in `web/dist`. In the Docker image these are baked in and served by the Ktor server itself (via `WEB_STATIC_DIR`; see "Server bootstrap model" / `plugins/Routing.kt`), so production is single-origin and there is no Vite proxy — the SPA and `/api` share `http://localhost:8080`.
- Regenerate API types: `cd web && npm run gen:api`. Reads `server/src/main/resources/openapi/documentation.yaml` directly (no server needed) and writes `web/src/api/schema.ts`. Run this after editing the OpenAPI spec; commit the regenerated `schema.ts`.

The OpenAPI spec at `server/src/main/resources/openapi/documentation.yaml` is the contract between backend and frontend — it is hand-maintained, not auto-generated from routes. When adding/changing a route, update the spec in the same change. Swagger UI is mounted at `http://localhost:8080/openapi`.

The typed fetch wrapper lives in `web/src/api/client.ts` — token storage (localStorage), `login()`, `logout()`, and `authedFetch()` for arbitrary calls. The types come from the generated `schema.ts`; the client itself is hand-written and is the right place to extend when adding new endpoints. Avoid pulling in heavyweight client generators (Orval/Kiota) — the lightweight pairing of `openapi-typescript` (types only) + hand-written fetch is intentional.

`openapi-typescript` is installed with `--legacy-peer-deps` because its declared peer is TS `^5` while the scaffold uses TS 6; the generated output is compatible. If you re-`npm install` from scratch, use `npm install --legacy-peer-deps`.

#### Internationalization (i18n)

The SPA is bilingual (English default + Polish) via **react-i18next** (`web/src/i18n.ts`). All user-facing strings go through `const { t } = useTranslation()` / `<Trans>` — **no hardcoded UI text**. Conventions:

- **Resources** live in `web/src/locales/{en,pl}/<area>.json`, one file per area (`common`, `appShell`, `auth`, `dashboard`, `feedback`, `users`, `teams`, `templates`, `notifications`); `i18n.ts` merges them into a single `translation` namespace, so keys read `area.key` (e.g. `t("feedback.editTitle")`). Keys are currently **untyped** (no `react-i18next.d.ts` augmentation) — a possible future improvement.
- **`common.*` is the shared source**: actions, field labels, table/pagination, filters, and the enum labels `common.status.*` / `common.visibility.*` / `common.role.*`. Reuse it instead of duplicating; build Mantine `Select` option labels from `t()` at render so they translate.
- **Keep EN/PL key parity** — every English key must exist in Polish (Polish-only plural variants like `_few`/`_many` are expected). Use i18next interpolation (`{{name}}`) and plural keys (`_one/_few/_many/_other`) rather than string concatenation.
- **Polish term for "feedback" is the loanword `feedback`, declined** (feedback / feedbacku / feedbacki / feedbacków), *not* "opinia". `teams.json` is the style reference.
- **Tests** render English: `web/src/test/setup.ts` imports `../i18n` and forces `en`, and English keys resolve byte-identically to the old literals, so text-based assertions keep working. The language switcher is `web/src/components/LanguageSwitcher.tsx` (header); choice persists in `localStorage` (`lettuce.lang`) and updates `<html lang>`.
- **Scope:** only frontend chrome is translated. Server-generated text (notification message bodies from `FeedbackNotifications.kt`) stays English.
