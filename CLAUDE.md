# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Gradle wrapper is at `./gradlew` (use `gradlew.bat` on Windows). JDK 21 toolchain is required (auto-provisioned via foojay-resolver).

- Build everything: `./gradlew build`
- Run the server (Ktor + Netty on port 8080): `./gradlew :server:run`
- Run all tests: `./gradlew test`
- Run server tests only: `./gradlew :server:test`
- Run a single test: `./gradlew :server:test --tests "ch.nokillswit.ServerTest.security headers are set on responses"`
- Package the server for deployment: `./gradlew :server:installDist` (output under `server/build/install/server/`, launcher `bin/server`). **Do not use `:server:buildFatJar`** — the shadow plugin collapses the duplicate `META-INF/services/org.flywaydb.core.extensibility.Plugin` descriptors and the fat JAR NPEs at startup inside Flyway's plugin registry. `installDist` keeps each dependency JAR separate, so Flyway's `ServiceLoader` discovery works exactly as under `:server:run`.
- **Run the whole stack with one command: `docker compose up --build`** (only Docker required). See "Running the full stack" below.

## Running the full stack

Two ways to run, sharing the same `docker-compose.yaml`:

- **One command (clone & run / demo):** `docker compose up --build` builds the SPA, builds the server, starts PostgreSQL, runs Flyway on boot, and serves everything at `http://localhost:8080` (Swagger at `/openapi`). Tear down with `docker compose down` (add `-v` to drop the DB volume).
- **Local development (hot reload, unchanged):** `docker compose up postgres` + `./gradlew :server:run` + `cd web && npm run dev` (Vite on `:5173`, proxying `/api` → `:8080`).
- **Local Kubernetes (OrbStack):** `docker build -t lettuce-app:latest .` then `kubectl apply -f k8s/`. The `k8s/` manifests are kompose-derived from `docker-compose.yaml` with three fixes baked in: the app image is the locally built `lettuce-app:latest` with `imagePullPolicy: IfNotPresent` (OrbStack's cluster shares the Docker image store — no push needed), the postgres healthcheck is a proper argv-list exec probe (kompose emits it as one unrunnable string) doubling as the readiness gate, and the app service is `type: LoadBalancer` (or `kubectl port-forward svc/app 8081:8080`). After rebuilding the image, `kubectl rollout restart deployment/app` picks it up. Secrets are intentionally not used — the env values are the same in-repo dev placeholders as in compose; replace both before any real deployment.

The root `Dockerfile` is a 3-stage build: (1) `node` builds `web/dist`, (2) `eclipse-temurin:21-jdk` runs `:server:installDist`, (3) `eclipse-temurin:21-jre` runtime bundles the install image **and** the built SPA, sets `WEB_STATIC_DIR=/app/web`, and runs `bin/server`. The `app` Compose service points the `POSTGRES_*` env vars at the `postgres` service host and waits on its healthcheck. `.dockerignore` keeps build outputs / `node_modules` out of the build context; `.git` is **included** on purpose — the SPA build stage reads the commit sha/timestamp from it for the version stamp (see "Build version stamp" under "Frontend").

## Architecture

Multi-module Gradle build (Kotlin DSL) defined in `settings.gradle.kts` with three Kotlin modules plus a separate JS frontend in `web/`:

- **`core`** — Kotlin Multiplatform (JVM target only currently). Shared code consumed by `server`. Holds the OpenTelemetry SDK bootstrap (`getOpenTelemetry(serviceName)`).
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
├── auth/               POST /api/v1/login + password hashing
├── users/              /api/v1/users/* CRUD + list + UserService + Users table
├── teams/              /api/v1/teams/* CRUD + list + member sub-resource + TeamService + Teams/TeamMembers tables
├── templates/          /api/v1/templates/* CRUD + list + TemplateService + Templates table (read: any authenticated; write: ADMIN)
├── feedbacks/          /api/v1/feedbacks/* CRUD + list + FeedbackService + Feedbacks table + FeedbackVisibility
└── notifications/      /api/v1/notifications/* list + read + seen/unseen + delete + NotificationService + Notifications table (recipient-scoped)
```

Routing is feature-local: each feature package registers its own routes from its `configureXxx` module. `plugins/Routing.kt` owns only the SPA: when `WEB_STATIC_DIR` (config key `web.staticDir`) is set, `configureRouting` installs `singlePageApplication` to serve `web/dist` with an `index.html` fallback; when unset (local dev / tests, where Vite serves the SPA), it installs no routes at all (there is no `GET /` placeholder). The scaffolding demo endpoints (`/ws`, `/json/kotlinx-serialization`, `/session/increment`, the "Hello, World!" root) and their plugins (`Sessions`, `Websockets`, the `GreetingService` DI sample, the inert `RequestValidation` rule) have been removed.

Module load order in `application.yaml` matters for inter-module attribute reads: `configureSecurity` puts `JwtConfigKey` in `attributes`; `configureDatabase` puts `UserServiceKey`. `configureAuthRoutes` and `configureUserRoutes` read both, so they must run after both. Current order: plugins → `infra/db` (Flyway, then Database) → features (users, auth) → catch-all `configureRouting`.

### Persistence

PostgreSQL is the only database. Connection settings come from the `postgres:` block in `application.yaml` (env-overridable via `POSTGRES_JDBC_URL`, `POSTGRES_R2DBC_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`); defaults match the `docker compose up postgres` service. There is one persistence stack:

- **Flyway** (`infra/db/Flyway.kt`) — runs schema migrations from `server/src/main/resources/db/migration/` at startup via the Java API, opening a short-lived JDBC connection. Migrations are the single source of truth for schema; do not call `SchemaUtils.create` anywhere.
- **Exposed + R2DBC** (`infra/db/Database.kt` + `users/UserService.kt`) — runtime DB access. `Database.kt` connects the `R2dbcDatabase` and publishes `UserServiceKey`; the service itself lives next to the feature it serves. The Exposed table objects (e.g. `UserService.Users`) are used for queries only, not DDL.

The `org.postgresql:postgresql` JDBC driver is on the classpath solely for Flyway; runtime queries go through R2DBC.

Current migrations are `V1`–`V20`: schema for users/teams/feedbacks/revoked-tokens; the `users.role` column (`V5`); the `admin@lettuce.local` seed (`V6`); soft-delete `marked_as_deleted` columns (with index) on `users` (`V7`), `teams` (`V8`), `templates` (`V16`), `notifications` (`V17`), and `feedbacks` (`V19`); a demo-org seed (`V9`); a feedback templates table (`V10`); the `REJECTED` feedback status (`V11`); a feedback `last_modified` column (`V12`); the `notifications` table (`V13`); a seed of four default feedback templates (`V14`, idempotent via `ON CONFLICT (name)`); the `feedback_events` audit table (`V15`, `ON DELETE CASCADE` from `feedbacks`); partial unique indexes that free `templates.name` (`V16`) and `users.email` (`V18`) on soft-delete (see "Soft delete" below); and the nullable `feedbacks.requester_message` column (`V20`, see "Requester message" under "Feedback lifecycle").

### Soft delete (convention)

`users`, `teams`, `templates`, `notifications`, and `feedbacks` are **soft-deleted** — rows are flagged, never physically removed. Only the join/audit tables (`team_members`, `feedback_events`, `revoked_tokens`) hard-delete. (`feedback_events` keeps its `ON DELETE CASCADE` FK to `feedbacks`, but it never fires now — events outlive a soft-deleted feedback.) To add soft-delete to a new entity, follow the established pattern (reference implementation: `users/UserService.kt`):

1. **Migration** — `ALTER TABLE <t> ADD COLUMN marked_as_deleted BOOLEAN NOT NULL DEFAULT FALSE;` plus `CREATE INDEX idx_<t>_marked_as_deleted ON <t>(marked_as_deleted);` (see `V7`/`V8`/`V16`/`V17`).
2. **Exposed table** — add `val markedAsDeleted = bool("marked_as_deleted").default(false)` and a private helper `fun active(): Op<Boolean> = <T>.markedAsDeleted eq false`.
3. **Filter every read** — `read`, `list`, `count`, and any lookup (e.g. `findByEmail`) get `… and active()`. Apply it in the shared list predicate so the `count()` (total) and the row select stay consistent.
4. **`delete` flips the flag** — `update({ (id eq id) and (markedAsDeleted eq false) }) { it[markedAsDeleted] = true }`, returning the affected-row `Int`; guard `update` mutations the same way. The route maps `0 → 404`, so a missing-or-already-deleted row is `404` (not `204`) and delete stays idempotent in effect.
5. **Routes need no special-casing** — they already key `404`/`204`/`NoContent` off the row-count and the `active()`-filtered `read`.

**Freeing a unique business field on delete.** To let a value be reused once its holder is soft-deleted, replace the global `UNIQUE` with a **partial unique index** over active rows: drop the original `<t>_<col>_key` constraint, then `CREATE UNIQUE INDEX uq_<t>_<col>_active ON <t>(<col>) WHERE marked_as_deleted = false;`. Drop the Exposed `.uniqueIndex()` on that column (Exposed defs are query-only — the DB enforces it). A clash with an **active** row still raises `23505 → 409`. In place today: `users.email` (`uq_users_email_active`, `V18`) and `templates.name` (`uq_templates_name_active`, `V16`). Seeds using `ON CONFLICT (<col>)` keep working because they run on earlier migrations, while the global constraint still exists.

### List endpoint conventions

`GET /api/v1/users`, `GET /api/v1/teams`, `GET /api/v1/feedbacks`, `GET /api/v1/templates`, and `GET /api/v1/notifications` are list endpoints; every list endpoint follows the rules below. The OpenAPI spec is the contract; document the query params for each list endpoint there.

**Pagination — offset, in the body envelope.**

- Query params: `page` (1-based, default `1`, must be ≥ 1) and `pageSize` (default `20`, max `100`). Out-of-range values → `400` + `ProblemDetail`.
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
- Per-column substring search is also allowed when a UI genuinely needs per-column matching that `q` cannot express. The filter param uses the column name directly (e.g. `?name=ali`), is case-insensitive `contains`, and must be documented per-endpoint. First example: `GET /api/v1/users` uses `name` and `email` this way. Reach for `q` first; promote to per-column only when the UI requires it.
- Booleans are `true`/`false`. Enums use their string name. Malformed values → `400`.

**Naming and OpenAPI plumbing.**

- Param names are `camelCase` to match existing JSON bodies (`pageSize`, not `page_size`).
- Add reusable parameters `Page`, `PageSize`, `Sort`, `Q` to `#/components/parameters` in `documentation.yaml`, then `$ref` them from each list path. Per-endpoint sortable/filterable fields go in that path's `parameters` list with a `description` listing the whitelist.
- Pagination envelopes are one schema per resource (`UserPage`, `TeamPage`, …) wrapping the existing `*Response[]` — keep them next to the resource's other schemas.

**Implementation.**

- The shared helper lives at `infra/paging/Paging.kt`: `ApplicationCall.parsePaging(...)` parses `page`/`pageSize`/`sort` from the query string and validates against per-endpoint whitelists into a `PageRequest`; `Query.applyPaging(req, columns)` applies `.limit(...).offset(...)` + `.orderBy(...)` to an Exposed `Query`. Validation failures throw a typed exception that `StatusPages` maps to `400` + `ProblemDetail`. New list endpoints reuse these rather than re-parsing params.

### Security defaults are template placeholders

`plugins/Security.kt` uses an HMAC256 secret for JWT defaulting to `"secret"` (via `$JWT_SECRET:secret`), plus a template audience and issuer, and CORS in `plugins/Http.kt` calls `anyHost()`. The JWT secret is now **fail-closed**: if it is blank or the placeholder `"secret"`, the app logs a warning in development but **refuses to start** outside development (`ktor.development=false`) — set a strong `JWT_SECRET` (the bundled `docker-compose.yaml` injects one). Tests/local dev run with `ktor.development=true`, so the default is tolerated there. CSRF install is gated behind `security.csrf.enabled` (default **`false`** in `application.yaml`, env-overridable via `SECURITY_CSRF_ENABLED`); the configured `originMatchesHost()` + `allowOrigin("http://localhost:8080")` + `checkHeader("X-CSRF-Token")` combo is unsatisfiable from both the Ktor test client and the dev SPA on `:5173`, and CSRF protection is anyway moot for this app's bearer-JWT auth model — browsers do not auto-attach `Authorization` headers, so cross-site forms cannot forge an authenticated request. Re-enable only if you move to cookie-based session auth and fix the allow-list accordingly. All of these are starter values and must be replaced before any non-development use.

**Default admin & demo seed.** Migration `V6__seed_admin.sql` inserts a single bootstrap administrator on first boot: `admin@lettuce.local` / `changeme` (role `ADMIN`), idempotent via `ON CONFLICT (email) DO NOTHING`. `V9__seed_demo_users_and_teams.sql` additionally seeds a demo org (teams AAA/BBB/CCC with `aaa-one@…`, `manager-aaa@…`, etc.) so the dashboard lists have data — every demo user is role `USER` and logs in with `changeme` (reusing V6's bcrypt hash). All of these are template placeholders; replace or delete before any non-development use.

### Authorization model

Layered RBAC. Implemented in the `server/src/main/kotlin/authz/` package.

- **Global roles** live on `users.role` (`ADMIN` / `USER`, added by `V5__add_user_role.sql`). `ADMIN` bypasses every per-resource check **except feedback writes** — admins may read every feedback but may not edit, delete, or transition existing ones (see `canWriteFeedback`); an admin who is the feedback's provider keeps write access via the ordinary provider rule. New users default to `USER`; only an `ADMIN` may set or change the field via the API.
- **Login** issues a JWT carrying `email`, `userId`, and `role` claims; `LoginResponse` exposes `userId` and `role` to the frontend.
- **Guards** in `authz/Guards.kt` are plain `suspend fun` calls used at the top of each route handler — there is no Ktor plugin or DSL. Each route reads `call.caller()` (which parses the JWT claims into a `CallerPrincipal`) and then invokes the relevant guard.
- **Resource rules**:
  - `POST /api/v1/users`, `DELETE /api/v1/users/{id}` → ADMIN only.
  - `GET /api/v1/users/{id}`, `PUT /api/v1/users/{id}` → caller must be the target user or ADMIN; only ADMIN may change `role`.
  - `POST /api/v1/teams` → caller must designate themselves as `managerId` (ADMIN may designate anyone).
  - `GET /api/v1/teams/{id}` → any authenticated user.
  - `PUT /api/v1/teams/{id}`, `DELETE /api/v1/teams/{id}`, member sub-resource mutations → the team's current `manager_id` or ADMIN. **Reassigning the manager** (changing `manager_id` to a different user on `PUT`) is **ADMIN-only** (`requireCanReassignManager`); a current manager may edit their team but not hand it off.
  - `POST /api/v1/feedbacks` → the caller must be a **party** to what they create: their `userId` must equal the `providerId` (they author it) or the `requesterId` (they ask for it); ADMIN may create on behalf of anyone. This blocks authoring feedback as someone else / forging a request from someone else. The create-time invariants also apply (see "Feedback lifecycle").
  - `GET /api/v1/feedbacks/{id}` → `canReadFeedback` (`authz/Guards.kt`), evaluated in order: **ADMIN** and the **provider** see everything; the **requester** sees it at any status, but only when visibility is `PROVIDER_REQUESTER`/`PROVIDER_REQUESTER_SUBJECT`; the **subject** sees it only when visibility is `PROVIDER_SUBJECT`/`PROVIDER_REQUESTER_SUBJECT` **and** status is `SENT`/`WITHDRAWN`; a **manager of the subject** is handled outside `canReadFeedback` — the route uses `requireFeedbackReadAllowingManager`, which grants a managing caller read **unconditionally** (any status), so a manager can open any subordinate's feedback (a known list-vs-detail asymmetry); finally `PUBLIC` + `SENT` is readable by anyone. Anything else is **default-deny**, which also logs a `SHOULD_NEVER_HAPPEN`-marked WARN (the branch is meant to be unreachable). Whether the **content** (vs. mere existence) is shown is a separate gate, `canReadFeedbackContent`: a requester watching an unfinished (`DRAFT`/`REQUESTED`) feedback sees that it exists but not its content.
  - `PUT/DELETE /api/v1/feedbacks/{id}` → the row's `provider_id` **only** (`canWriteFeedback`); ADMIN can read but **not** modify feedbacks (unless the admin is themselves the provider). This guard gates **every** status transition (send, withdraw, pick-up, reject); on `PUT` the requested transition must additionally be valid for the current status (see "Feedback lifecycle") or it is `400`.
  - `GET /api/v1/templates`, `GET /api/v1/templates/{id}` → any authenticated user; `POST`/`PUT`/`DELETE /api/v1/templates/*` → ADMIN only (`requireAdmin`). Routes in `templates/TemplateRoutes.kt`; list is sortable by `id`,`name` with a `name` substring filter.
  - `GET/POST/DELETE /api/v1/notifications/*` → the notification's `recipient_id` only (via `requireNotificationRecipient`); ADMIN bypasses. Notifications are never created through the API — see "Notifications" below.
- **Exceptions**: `UnauthorizedException` (→ 401) and `ForbiddenException` (→ 403) are mapped in `plugins/ErrorHandling.kt`. **All error bodies are RFC 7807 `application/problem+json`** (`ProblemDetail{type,title,status,detail,instance}`) — emit them via the `ApplicationCall.respondProblem(status, detail)` helper (it uses an explicit `TextContent` so ContentNegotiation does not relabel the media type as `application/json`). `StatusPages` routes `BadRequestException`→400, `UnauthorizedException`→401, `ForbiddenException`→403, unique-violation→409, and a catch-all `Throwable`→500 (logged) through that helper; the JWT `challenge` in `plugins/Security.kt` also calls `respondProblem` (it runs outside `StatusPages`), and inline `404`s in routes use `respondProblem(NotFound, …)`. Test HTTP clients must register the `application/problem+json` content type (`json(contentType = ContentType.parse("application/problem+json"))`) to decode error bodies with `body<ProblemDetail>()`.
- **Tests**: `server/src/test/kotlin/AuthorizationTest.kt` covers the 401/403 paths and the full `FeedbackVisibility` matrix. The shared `TestUsers.seed` helper defaults to `role = ADMIN` so older tests keep working without modification; pass `role = UserRole.USER` when you need a non-privileged caller.

### Feedback lifecycle (statuses & transitions)

A feedback moves through a small state machine. The authoritative rules live in `feedbacks/FeedbackService.kt` — `isAllowedTransition` (the edges) and `validate` (the invariants); read/write authorization is in `authz/Guards.kt`. `FeedbackStatus` (`feedbacks/Feedback.kt`) has five values:

- **`REQUESTED`** — feedback has been requested of a provider (e.g. via "Ask for feedback"); awaits the provider picking it up or declining. **Requires a non-null requester.**
- **`DRAFT`** — the provider's private work in progress; **hidden from the subject** until it leaves `DRAFT`.
- **`SENT`** — delivered; visible to the subject / requester per `FeedbackVisibility`.
- **`WITHDRAWN`** — terminal; the provider retracted the feedback.
- **`REJECTED`** — terminal; the provider declined a request.

```mermaid
stateDiagram-v2
    direction LR

    [*] --> REQUESTED: POST · ask for feedback
    [*] --> DRAFT: POST · save draft
    [*] --> SENT: POST · save & send

    REQUESTED --> DRAFT: pick up
    REQUESTED --> REJECTED: decline
    DRAFT --> SENT: send
    DRAFT --> WITHDRAWN: withdraw (abandon)
    SENT --> WITHDRAWN: withdraw (retract)
    DRAFT --> [*]: delete · soft-delete (removed)

    note right of REJECTED
        terminal — record retained
    end note
    note right of WITHDRAWN
        terminal — record retained
    end note
```

Create (`POST`) permits any status (no transition gate); the realistic entry points are
`REQUESTED`/`DRAFT`/`SENT`. `WITHDRAWN`/`REJECTED` are terminal records that are **retained**;
the `DRAFT → [*]` edge is the provider-only **soft-delete** (the row is flagged and drops out of
reads/lists, distinct from the retained terminal states). Details below.

**Allowed transitions** (anything not listed → `400`; `WITHDRAWN` and `REJECTED` are terminal with no outgoing edges):

| From → To | Who | Meaning |
|---|---|---|
| `REQUESTED → DRAFT` | provider / ADMIN | provider picks up the request |
| `REQUESTED → REJECTED` | provider / ADMIN | provider declines the request (terminal) |
| `DRAFT → SENT` | provider / ADMIN | deliver the feedback |
| `DRAFT → WITHDRAWN` | provider / ADMIN | abandon a draft (terminal) |
| `SENT → WITHDRAWN` | provider / ADMIN | retract a sent feedback (terminal) |

Every transition is performed via `PUT /api/v1/feedbacks/{id}` and is gated by `canWriteFeedback` (provider only — ADMIN does not get feedback write access) — so only the provider can send, withdraw, pick up, or reject.

**Delete (separate from the transitions).** `DELETE /api/v1/feedbacks/{id}` **soft-deletes** a feedback (it disappears from reads/lists; the row and its audit trail are retained). It is **provider-only** (`canWriteFeedback`) and **DRAFT-only** — deleting a non-`DRAFT` feedback is `400` (other statuses use the terminal `WITHDRAWN`/`REJECTED` transitions instead). On delete the route records a deletion **audit event** (`feedbackDeletionEventContent`) and, if the feedback has a requester, sends them a **notification with no link** that the provider deleted it (`feedbackDeletionNotifications`). Distinct from `DRAFT → WITHDRAWN`, which keeps the feedback visible as a terminal record.

**Creation vs. update.** On **create** (`POST`) any status is permitted — there is no transition gate, so the UI can create a feedback directly as `SENT` ("save & send") or as `REQUESTED` ("ask for feedback"). The transition check above applies only on **update**. The following invariants are enforced on **both** create and update: provider ≠ subject; requester ≠ provider; `REQUESTED` requires a requester; **a feedback with a requester may not use `PROVIDER_SUBJECT` visibility** (that visibility excludes the requester, so the combination is contradictory). Transition and invariant behavior is covered by `FeedbackRoutesTest` (transitions + the invariant) and `AuthorizationTest` (the `FeedbackVisibility` read matrix).

**Requester message.** A feedback carries an optional `requesterMessage` (`feedbacks.requester_message`, `V20`) — the requester's clarification note to the provider, captured by the "Ask for feedback" / "Request feedback" forms (`AskFeedback.tsx` / `RequestFeedback.tsx`). It is **set once at creation and never updated**: `FeedbackService.update` simply omits the column, so `PUT` cannot change it (no validation error — the field is ignored). The SPA displays it read-only via `web/src/components/RequesterMessage.tsx` (renders nothing when null/empty) on the view screen, the `REQUESTED` triage screen, and the `DRAFT` editor.

**Frontend: the `REQUESTED` decision screen.** Because `REQUESTED → SENT` is not a valid edge, the editor must not offer "Save & send" for a pending request. So `web/src/pages/EditFeedback.tsx`, when the loaded feedback is `REQUESTED` and the caller is its provider, renders a read-only **triage screen** (subject + requester names, no editor) instead of the `FeedbackForm` editor, with exactly three actions:

- **Close** — navigate back, change nothing.
- **Reject** — confirmation modal → `REQUESTED → REJECTED`, returns to the originating tab.
- **Accept** — `REQUESTED → DRAFT`, then **reloads in place** (invalidates the `["feedback", id]` query rather than navigating) so the same route re-renders as the normal `DRAFT` editor (Cancel / Save draft / Save & send). `handleSave` distinguishes this case via `accepted = data.status === "REQUESTED" && status === "DRAFT"` and skips the post-save navigate.

**Frontend: the DRAFT editor's Delete action.** The `DRAFT` editor (`FeedbackForm` via `EditFeedback.tsx`) shows a fourth action — a red **Delete** — alongside Cancel / Save draft / Save & send, but only when the caller is the draft's provider (`data.status === "DRAFT" && getUserId() === data.providerId`). It opens a confirmation `Modal` (mirroring the Reject modal) whose confirm calls `deleteFeedback(id)` → on success invalidates `["feedbacks"]`/`["feedback", id]` and navigates to the originating tab. `FeedbackForm` takes optional `onDelete`/`deleting` props and renders the button only when `onDelete` is set.

`FeedbackForm` is therefore only ever the editor for `DRAFT` and the create flows; it carries no reject affordance. This mirrors the backend state machine in the UI (defense-in-depth, not a relaxation of the server check). Covered by `web/src/pages/EditFeedback.test.tsx`.

**Frontend: the simplified requester view.** On the read-only view (`web/src/pages/ViewFeedback.tsx`), when the caller is the **requester** and the feedback is `REQUESTED` or `REJECTED`, the **Content** section is hidden — a never-drafted or declined request has no content to read. The gate is `isRequester && (status === "REQUESTED" || status === "REJECTED")` (`isRequester = getUserId() === data.requesterId`); every other viewer and status still renders Content. Covered by `web/src/pages/ViewFeedback.test.tsx`.

### Feedback list views (`GET /api/v1/feedbacks?view=…`)

`FeedbackService.list` (`feedbacks/FeedbackService.kt`) scopes rows by `view` + the caller; the shared paging/filter helpers then apply on top. The three view scopes:

- **`received`** (the subject's inbox): `subjectId == caller` AND one of — *no requester* and status ∈ {`SENT`,`WITHDRAWN`}; OR *caller is the requester* (any status/visibility); OR *another requester* and visibility ∈ {`PROVIDER_SUBJECT`,`PROVIDER_REQUESTER_SUBJECT`,`PUBLIC`} and status ∈ {`SENT`,`WITHDRAWN`}.
- **`provided`**: `providerId == caller` (every status/visibility).
- **`team`** (manager oversight): subject is a member of a non-soft-deleted team the caller manages, AND (`providerId == caller` OR `requesterId == caller` OR status ∈ {`SENT`,`WITHDRAWN`}) — i.e. a party to it at any status, otherwise only once delivered.

Content **previews** are blanked when the feedback is unfinished (`DRAFT`/`REQUESTED`) and the caller is its requester (mirrors `canReadFeedbackContent`). The `/users/:id/feedbacks` page composes two of these: top = `received&providerId=:id` ("from them to you"), bottom = `provided&subjectId=:id` ("from you to them"). These list scopes and `canReadFeedback` (the single-GET gate) are maintained separately and can intentionally differ at the edges (e.g. a manager's unconditional single-GET grant vs. the delivered-only team list).

### Feedback events (audit history)

`feedback_events` (`feedbacks/FeedbackEvent.kt` + `FeedbackEventService.kt`, table `V15`) is an **immutable audit trail** of feedback changes: `feedbackId`, `userId` (the acting caller), server-set `timestamp` (epoch millis), and a generated `content` string. Rows are minted as a side-effect — there is **no create/update/delete API**. The descriptions come from side-effect-free helpers in `feedbacks/FeedbackEvents.kt` (`feedbackCreationEventContent` / `feedbackUpdateEventContent`, unit-tested in `FeedbackEventsTest`), and `feedbacks/FeedbackRoutes.kt` persists them: one event on `POST` (create) and one on `PUT` when something changed (status transition, or content/visibility edit). Read via **`GET /api/v1/feedbacks/{id}/events`** → `FeedbackEventList` (`{ items: [...] }`, oldest first, with resolved `userName`); authorized exactly like the single-GET (`requireFeedbackReadAllowingManager`). The SPA shows it as a `Timeline` ("History") on `web/src/pages/ViewFeedback.tsx` (`listFeedbackEvents` in `api/client.ts`).

**Feedback bottom-section tabs.** Both the view (`web/src/pages/ViewFeedback.tsx`) and edit (`web/src/components/FeedbackForm.tsx`, when `feedbackId` is set) screens render a three-tab bottom section: **Content**, **History** (the audit `Timeline` above), and **Lifecycle**. The Lifecycle tab renders `web/src/components/FeedbackLifecycle.tsx` — a hand-authored inline-SVG, theme-aware (Mantine CSS vars), end-user-facing state diagram (Requested → Draft → Sent, with terminal Rejected/Withdrawn; the delete path is omitted as it's not a viewable state). It takes an optional `currentStatus` (the live `data.status`, threaded through `FeedbackForm` on edit) to highlight the current node. Labels reuse `common.status.*`; tab/caption strings are `feedback.lifecycle*`.

### Notifications

In-app notifications are **generic rows** (`recipientId`, `message`, optional `link`, `wasSeen`, `timestamp`) — there is **no notification type enum** and no API to create one. They are produced by **three** feedback-driven sources, all side-effect-free (DB-free, so directly unit-testable) functions in `feedbacks/FeedbackNotifications.kt`; `FeedbackService` resolves party display names and the route persists what they return:

- **`feedbackCreationNotifications()`** — on feedback **creation** in `REQUESTED` status: the **provider** is told (edit link) **and** the **requester** gets a no-link confirmation (worded "about yourself" when requester == subject). Persisted from `POST /api/v1/feedbacks` in `feedbacks/FeedbackRoutes.kt` (`result.notifications.forEach { notificationService.create(it) }`).
- **`feedbackTransitionNotifications()`** — on a feedback **status transition**. Persisted from `PUT /api/v1/feedbacks/{id}` (`toNotify.forEach { notificationService.create(it) }`).
- **`feedbackDeletionNotifications()`** — on a (DRAFT) feedback **deletion** that has a requester. Persisted from `DELETE /api/v1/feedbacks/{id}`; the notification has no link.

**The complete list of situations that generate a notification**:

| Event | Recipient(s) | Link? |
|---|---|---|
| Created in `REQUESTED` | provider; **and** the requester (always — `REQUESTED` requires one) | provider → `/feedback/{id}/edit` (always); requester → **no link** |
| `DRAFT → SENT` | subject (always); the **provider** (the sender, always); **and** the requester if `requesterId != null` (separately-worded notifications) | subject/requester → `/feedback/{id}/view` only if that recipient may read the feedback; provider → `/feedback/{id}/view` (always — owns it) |
| `REQUESTED → REJECTED` (requester present) | requester | no |
| `REQUESTED → DRAFT` ("picked up" by provider) | requester | no |
| `SENT → WITHDRAWN` | subject (always); **and** the requester if `requesterId != null` | no |
| `DRAFT` deleted (requester present) | requester | no |

That is the whole set — any other create/transition/delete produces nothing. A `REQUESTED` creation yields **two** notifications (provider + requester); a `DRAFT → SENT` of *requested* feedback yields **three** (subject + provider + requester). For the subject/requester `view` links the recipient must be permitted to read the feedback under its `FeedbackVisibility` (`subjectCanRead`/`requesterCanRead` in the same file) — otherwise `link` is null; the provider always owns the feedback, so its links are unconditional.

Reading/managing notifications goes through `notifications/NotificationRoutes.kt`, all under `authenticate` and scoped to the recipient via `requireNotificationRecipient` (ADMIN bypasses): `GET /api/v1/notifications` (list; sortable `id`,`timestamp`, default `-timestamp`; optional `wasSeen` filter), `GET /api/v1/notifications/{id}`, `POST /api/v1/notifications/{id}/seen`, `POST /api/v1/notifications/{id}/unseen`, `POST /api/v1/notifications/seen-all` (marks all the caller's unseen as seen; caller-scoped via `markAllSeen(recipientId)`, no ADMIN cross-user bypass), `DELETE /api/v1/notifications/{id}`. The endpoints are documented in `documentation.yaml`; the `notifications` table is created by `V13__create_notifications.sql`.

### Observability

`plugins/OpenTelemetry.kt` installs `KtorServerTelemetry` and obtains the SDK via `getOpenTelemetry("lettuce")` from the `core` module. `plugins/Monitoring.kt` separately installs Dropwizard metrics (logged via SLF4J every 10s) and the `CallId` plugin using `X-Request-Id`. The SDK is also wired for **logs**: a Logback `OpenTelemetryAppender` (`server/src/main/resources/logback.xml`, the sole root appender) bridges every SLF4J log into the OTel logs SDK, and `getOpenTelemetry` (`core/.../OpenTelemetry.kt`) installs the appender (in `plugins/OpenTelemetry.kt`) and sets the interim exporter to `console`. Defaults are set via `addPropertiesSupplier` (the lowest-precedence config tier) **on purpose**, so the sink can be redirected to a collector by env alone with no code change — set `OTEL_LOGS_EXPORTER=otlp` + `OTEL_EXPORTER_OTLP_ENDPOINT` (the `opentelemetry-exporter-otlp` dep is already on the classpath); `OTEL_TRACES_EXPORTER` likewise. Metrics and traces exporters default to `none` (`otel.metrics.exporter`/`otel.traces.exporter`). **Convention for non-fatal "this should never happen" events:** emit a WARN with the `SHOULD_NEVER_HAPPEN` marker (see `authz/Guards.kt` `canReadFeedback`'s default branch) — the marker + key/value attributes flow through the appender to OTel.

### Testing

`server/src/test/kotlin/ServerTest.kt` uses `io.ktor.server.testing.testApplication` and overrides the `postgres.*` config keys via `MapApplicationConfig` to point at a Testcontainers `PostgreSQLContainer` started lazily by `PostgresTestSupport`. Running tests requires a working Docker daemon (Docker Desktop, OrbStack, etc.). When adding tests, replicate the `environment { config = ApplicationConfig("application.yaml").mergeWith(MapApplicationConfig(...)) }` block so the app boots against the test container rather than a real database. The container runs **all** Flyway migrations, so the V6/V9/V14 seeds (admin, demo org, default templates) are present — tests scope their assertions with unique prefixes/filters rather than asserting absolute counts.

**Coverage gates.** Backend Kover enforces line- and branch-coverage floors in `server/build.gradle.kts` (`minBound(90)` line, `minBound(68)` branch, wired into `check` via `koverVerify`). Frontend vitest enforces thresholds in `web/vite.config.ts` (`test.coverage.thresholds`); run `cd web && npm run test:coverage`. All are floors below current actuals — keep new code covered or they fail.

### Frontend (`web/`)

Vite + React 19 + TypeScript SPA. The Gradle and npm toolchains are disjoint — never invoke npm from Gradle or vice versa.

- Dev server: `cd web && npm run dev` (port 5173). All backend routes live under the `/api/` namespace (`/api/v1/login`, `/api/v1/logout`, `/api/v1/users`, `/api/v1/teams`, `/api/v1/feedbacks`, …) and Vite proxies the single `/api` subtree → `http://localhost:8080`. Any other path is served as `index.html` so React Router owns the SPA URL space and browser reloads don't collide with API routes.
- Production build: `cd web && npm run build` → static files in `web/dist`. In the Docker image these are baked in and served by the Ktor server itself (via `WEB_STATIC_DIR`; see "Server bootstrap model" / `plugins/Routing.kt`), so production is single-origin and there is no Vite proxy — the SPA and `/api` share `http://localhost:8080`.
- Regenerate API types: `cd web && npm run gen:api`. Reads `server/src/main/resources/openapi/documentation.yaml` directly (no server needed) and writes `web/src/api/schema.ts`. Run this after editing the OpenAPI spec; commit the regenerated `schema.ts`.
- **Build version stamp**: `vite.config.ts` injects `__APP_COMMIT__` (short sha, `+dirty` when the worktree has uncommitted changes) and `__APP_COMMIT_TIME__` (commit ISO timestamp) via `define`, declared in `src/vite-env.d.ts`. Env vars `GIT_SHA`/`GIT_COMMIT_TIME` override the local-git lookup — the Dockerfile's SPA stage sets them explicitly (its worktree never matches the index, so the dirty check would false-positive), and CI can do the same when building without `.git`. `src/components/VersionStamp.tsx` renders the stamp (`7caf94e · 2026-07-03 14:22`) at the bottom of the navbar (`App.tsx`) and under the login card (`Login.tsx`); tooltip label is `common.buildInfo`.

The OpenAPI spec at `server/src/main/resources/openapi/documentation.yaml` is the contract between backend and frontend — it is hand-maintained, not auto-generated from routes. When adding/changing a route, update the spec in the same change. Swagger UI is mounted at `http://localhost:8080/openapi`.

The typed fetch wrapper lives in `web/src/api/client.ts` — token storage (localStorage), `login()`, `logout()`, and `authedFetch()` for arbitrary calls. The types come from the generated `schema.ts`; the client itself is hand-written and is the right place to extend when adding new endpoints. Avoid pulling in heavyweight client generators (Orval/Kiota) — the lightweight pairing of `openapi-typescript` (types only) + hand-written fetch is intentional.

`openapi-typescript` is installed with `--legacy-peer-deps` because its declared peer is TS `^5` while the scaffold uses TS 6; the generated output is compatible. If you re-`npm install` from scratch, use `npm install --legacy-peer-deps`.

#### Shared list-page building blocks

The list pages (Users, Teams, Templates, FeedbackTable, TeamMembersTable) are built from shared pieces — a new list page should reuse them rather than re-declaring the scaffolding:

- **`hooks/usePagedSort.ts`** — the page/pageSize/sortField/sortDir state for a list table, exporting `sortParam` (the API's `-field` string), `toggleSort`, and `PAGE_SIZE_OPTIONS`/`DEFAULT_PAGE_SIZE` (20/40/60, default 20). Pass it the table's (debounced) filter values as `filterDeps`; any filter or sort change resets `page` to 1, as does changing `pageSize`, so the user is never stranded past the last page.
- **`components/PaginationBar.tsx`** — the table footer (total count, page-size select, `Pagination`); renders from `usePagedSort`'s state. **`components/SortHeader.tsx`** — the clickable sortable column header, driven by `sortField`/`sortDir`/`toggleSort`.
- **`components/ClearableTextInput.tsx`** — the filter `TextInput` with a `CloseButton` in `rightSection` used by the list filter rows. Form-page clear buttons are a different, `@mantine/form`-bound pattern and stay local to the form.
- **`hooks/useDeleteConfirm.ts` + `components/ConfirmDeleteModal.tsx`** — the delete-confirmation flow (target state, open/close, mutation wiring). The modal body is a render prop because each page's confirmation text interpolates differently; page-specific behavior (Users' self-delete logout, per-page cache invalidation) stays at the call site.
- **`pages/FeedbackTable.tsx` is the single feedback table for all three views** (`received`/`provided`/`team`) — there is no separate team table. A per-view `VIEW_CONFIG` (its `personColumns` array drives the filter inputs, sortable headers, and row cells; a per-view `renderAction` supplies the action button) is where view differences go; don't fork the component. The team view's tests live in `FeedbackTable.team.test.tsx`.

#### Internationalization (i18n)

The SPA is bilingual (English default + Polish) via **react-i18next** (`web/src/i18n.ts`). All user-facing strings go through `const { t } = useTranslation()` / `<Trans>` — **no hardcoded UI text**. Conventions:

- **Resources** live in `web/src/locales/{en,pl}/<area>.json`, one file per area (`common`, `appShell`, `auth`, `dashboard`, `feedback`, `users`, `teams`, `templates`, `notifications`); `i18n.ts` merges them into a single `translation` namespace, so keys read `area.key` (e.g. `t("feedback.editTitle")`). Keys are currently **untyped** (no `react-i18next.d.ts` augmentation) — a possible future improvement.
- **`common.*` is the shared source**: actions, field labels, table/pagination, filters, and the enum labels `common.status.*` / `common.visibility.*` / `common.role.*`. Reuse it instead of duplicating; build Mantine `Select` option labels from `t()` at render so they translate.
- **Keep EN/PL key parity** — every English key must exist in Polish (Polish-only plural variants like `_few`/`_many` are expected). Use i18next interpolation (`{{name}}`) and plural keys (`_one/_few/_many/_other`) rather than string concatenation.
- **Polish term for "feedback" is the loanword `feedback`, declined** (feedback / feedbacku / feedbacki / feedbacków), *not* "opinia". `teams.json` is the style reference.
- **Tests** render English: `web/src/test/setup.ts` imports `../i18n` and forces `en`, and English keys resolve byte-identically to the old literals, so text-based assertions keep working. The language switcher is `web/src/components/LanguageSwitcher.tsx` (header); choice persists in `localStorage` (`lettuce.lang`) and updates `<html lang>`.
- **Scope:** only frontend chrome is translated. Server-generated text (notification message bodies from `FeedbackNotifications.kt`) stays English.
