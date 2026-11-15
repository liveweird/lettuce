# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Gradle wrapper is at `./gradlew` (use `gradlew.bat` on Windows). JDK 21 toolchain is required (auto-provisioned via foojay-resolver).

- Build everything: `./gradlew build`
- Run the server (Ktor + Netty on port 8080): `./gradlew :server:run`
- Run all tests: `./gradlew test`
- Run server tests only: `./gradlew :server:test`
- Run a single test: `./gradlew :server:test --tests "ch.nokillswit.ServerTest.security headers are set on responses"`
- Static analysis (detekt, both Kotlin modules): `./gradlew detekt` — rides `check`/`build`, zero-findings gate (no baseline file). Rule tuning lives in `config/detekt/detekt.yml` ONLY, one commented override per deliberate repo idiom; never add an uncommented `@Suppress`.
- Dependency-family alignment guard: `./gradlew :server:checkDependencyAlignment` — rides `check`; fails when a family that must move as one (`io.netty`, `io.opentelemetry` incl. `-alpha`, kotlin-stdlib/kotlin-reflect, Jackson) resolves to several versions, or an `io.projectreactor*` module differs from the Reactor BOM — the `netty`, `opentelemetry` and `reactor-bom` notes in `gradle/libs.versions.toml` explain the pins (the full family rules: `.claude/docs/architecture-details.md`).
- Database connections go through one bounded R2DBC pool (`postgres.pool.*` in `application.yaml`, every knob env-overridable and boot-validated, incl. the v4.7.1 hung-database bounds) — see "Connection pool" in `.claude/docs/persistence.md`.
- Package the server for deployment: `./gradlew :server:installDist`. **Never use `:server:buildFatJar`** — the fat JAR breaks Flyway's `ServiceLoader` discovery and NPEs at startup (details in the `run-stack` skill).
- JVM memory flags are pre-tuned in `server/build.gradle.kts` (`applicationDefaultJvmArgs`) — rationale and per-deploy overrides in the `run-stack` skill.
- Performance measurement (measure-only, never a fix): `perf/run.sh up|down|status|seed|restore|k6|pgss` (separate `lettuce-perf` compose project, ports 18080/15432); authenticated responses carry `Server-Timing` in development — see `.claude/docs/performance.md` (on demand, not imported).
- Telemetry (v4.20.0): the process samples its own vital signs every `TELEMETRY_SAMPLE_INTERVAL_SECONDS` (300) unless `TELEMETRY_ENABLED=false`; the other knobs and the `LETTUCE_BUILD_*` build args are in `.claude/docs/features/telemetry.md`.
- **Run the whole stack with one command: `docker compose up --build`** (only Docker required). See "Running the full stack" below.

## Running the full stack

`docker compose up --build` serves everything at `http://localhost:8080` (plus a Mailpit mail catcher at `http://localhost:8025` — password-reset emails land there); local dev is `docker compose up postgres` + `./gradlew :server:run` + `cd web && npm run dev`. Full detail — Kubernetes (OrbStack) deployment, secrets, teardown, the 3-stage `Dockerfile` — lives in the `run-stack` skill (`.claude/skills/run-stack/SKILL.md`).

## Architecture

Multi-module Gradle build (Kotlin DSL) defined in `settings.gradle.kts` with two Kotlin modules plus a separate JS frontend in `web/`:

- **`core`** — Kotlin Multiplatform (JVM target only currently). Shared code consumed by `server`. Holds the OpenTelemetry SDK bootstrap (`getOpenTelemetry(serviceName)`).
- **`server`** — Kotlin/JVM. The Ktor application. Depends on `core`.
- **`web/`** — Vite + React + TypeScript SPA that consumes the server's HTTP API. Standalone npm workspace; Gradle does not touch it.

Group is `ch.nokillswit`, version `1.0.0-SNAPSHOT` (set in root `build.gradle.kts`). Dependency versions are centralized in `gradle/libs.versions.toml`; Ktor itself comes from a separate version catalog (`ktorLibs`) loaded from `io.ktor:ktor-version-catalog` in `settings.gradle.kts`.

Resolved Gradle dependencies use strict locking and SHA-256 verification, including artifact
metadata. Normal builds enforce the committed state; intentional updates follow
`.claude/docs/dependency-reproducibility.md`. Docker packaging copies the same lock/checksum files.

### API guidelines (the authoritative API standard)

**`api-guidelines/API-GUIDELINES.md` is the single authoritative rulebook for API style** — document shape, URLs, versioning, list conventions, naming, data formats, status codes, errors, auth, caching, rate limiting, idempotency, security, and OpenAPI/conformance practice. Every rule has a stable ID (`API-LIST-002`); cite IDs when discussing API design. Consult it when designing or reviewing endpoints; the sections below keep only summaries plus lettuce-specific behavior. Validate spec changes with the `/api-review` skill (Spectral lint + LLM review checklist; `api-guidelines/README.md` documents both passes and the decision record behind the standard). Deliberate, registered non-conformances (correlation-id echo, `Retry-After`, `ETag`, `Idempotency-Key`, HTTP/2, SLA metadata, the unpaged `share-candidates` reads) live in the rulebook's **known-gaps register** — report them as "registered gap", not drift, and remove the entry when closing one. **The GraphQL integration API has its own sibling rulebook** — `api-guidelines/GRAPHQL-GUIDELINES.md` (stable `GQL-*-NNN` ids; its contract artifact is the committed SDL at `server/src/main/resources/graphql/schema.graphqls`, pinned by `IntegrationSchemaContractTest` instead of the REST conformance layer).

### Server bootstrap model

`server/src/main/kotlin/main.kt` just delegates to `io.ktor.server.netty.EngineMain`. The application is wired declaratively in `server/src/main/resources/application.yaml` under `ktor.application.modules` — each entry is a fully-qualified extension function on `Application` (e.g. `ch.nokillswit.plugins.HttpKt.configureHttp`). To add a new cross-cutting concern, create a new `configureXxx()` extension under `plugins/` and register it in `application.yaml`; do not call it from `main.kt`.

### Package layout

```
ch.nokillswit
├── main.kt
├── plugins/            cross-cutting Ktor wiring (configureXxx that only `install` plugins)
├── infra/db/           Flyway migrations, the bounded R2DBC pool, the shared EventLog behind the eleven `*_events` services
├── infra/paging/       list-endpoint paging/sort/filter helper (parsePaging, applyPaging)
├── infra/config/       boot-time numeric config validation (requireConfigInt/requireConfigLong)
├── infra/validation/   sanitizeSingleLine (see "Single-line identity fields" in `.claude/docs/security-details.md`)
├── infra/mail/         outbound email (see "Outbound email" in `.claude/docs/security-details.md`)
├── infra/teams/        outbound Microsoft Teams DMs (`.claude/docs/features/teams-notifications.md`)
├── infra/crypto/       FieldCipher (AES-256-GCM) + EncryptedAtRest (see "Encryption at rest" in `.claude/docs/security.md`)
├── audit/              `audit(event, fields…)` AUDIT-marked logs (`.claude/docs/observability.md`, catalog `audit-events.md`)
├── authz/              RBAC guards + CallerPrincipal (`.claude/docs/authorization.md`)
├── auth/               login (+ MFA), refresh, logout, password reset, tokens, DB-backed throttles (`.claude/docs/security-details.md`)
├── users/              /api/v1/users/* + career-positions + career pyramid + UserService (`authorization-resources.md`, `features/dictionaries.md`)
├── teams/              /api/v1/teams/* + members + dated structure/history (`features/teams.md`; writes ADMIN-only)
├── templates/          /api/v1/templates/* (read: any authenticated; write: ADMIN)
├── dictionaries/       /api/v1/dictionaries/{dictionary} (`features/dictionaries.md`)
├── feedbacks/          /api/v1/feedbacks/* (`features/feedbacks.md`)
├── oneonones/          /api/v1/one-on-ones/* (`features/one-on-ones.md`)
├── goals/              /api/v1/goals/* (`features/goals.md`)
├── impactlog/          /api/v1/impact-log/* (`features/impact-log.md`)
├── succession/         /api/v1/succession-plans/* (`features/succession-plans.md`)
├── sharing/            /api/v1/shares/* + the `*Shareable.kt` adapter registry (`features/sharing.md`)
├── activity/           /api/v1/users/{id}/activity (`features/activity-log.md`)
├── teamkpis/           /api/v1/team-kpis/* (`features/team-kpis.md`)
├── reviews/            /api/v1/performance-reviews/* + /api/v1/review-periods (`features/performance-reviews.md`)
├── daysoff/            /api/v1/days-off/* + public-holidays (`features/days-off.md`)
├── pulse/              /api/v1/pulse-surveys/* (`features/pulse-surveys.md`)
├── settings/           AppSettingsService — the runtime-settings K/V store over `app_settings` (V47)
├── notifications/      /api/v1/notifications/* + per-user preferences (`features/notifications.md`)
├── alerts/             /api/v1/alerts/* (`features/alerts.md`)
├── integration/        /api/v1/integration-clients + the GraphQL API at /integration/graphql (`features/integration-api.md`)
├── telemetry/          the TOP layer: in-app vital signs sampler + ADMIN read API (`features/telemetry.md`)
└── dashboard/          GET /api/v1/dashboard/summary, composed route-side from the feature services
```

The full annotated tree (routes, tables, version tags, authz one-liners per package) lives in `.claude/docs/architecture-details.md`.

Routing is feature-local: each feature package registers its own routes from its `configureXxx` module. `plugins/Routing.kt` owns only the SPA: when `WEB_STATIC_DIR` (config key `web.staticDir`) is set, `configureRouting` serves `web/dist` with `staticFiles` and an `index.html` fallback (hashed `/assets/*` immutable for a year, `index.html` + root files `no-cache` with ETag/Last-Modified → 304, API responses `no-store` — v4.14.0); when unset (local dev / tests, where Vite serves the SPA), it installs no routes at all (there is no `GET /` placeholder). The scaffolding demo endpoints (`/ws`, `/json/kotlinx-serialization`, `/session/increment`, the "Hello, World!" root) and their plugins (`Sessions`, `Websockets`, the `GreetingService` DI sample, the inert `RequestValidation` rule) have been removed.

Module load order in `application.yaml` matters (modules read each other's attribute keys): `configureSecurity` puts `JwtConfigKey`; `configureCrypto` puts `FieldCipherKey`; `configureDatabase` reads `FieldCipherKey` + `TeamsMessengerKey` (from `configureTeams`, right after `configureMail`) and puts `UserServiceKey` and the other service keys; `configureBootstrap` reads `UserServiceKey` plus the ten encrypted-at-rest service keys (the rotation-backfill list), so it runs right after Database; `configureTelemetry` reads `R2dbcDatabaseKey` + `ConnectionPoolKey` + `MetricRegistryKey`; the route modules need `configureSecurity` installed first (their `authenticate {}` blocks). Current order: plugins → infrastructure (Mail → Teams → Crypto → Flyway → Database → Bootstrap → **Telemetry**) → features (users, career-positions, activity, teams, team-history, feedbacks, oneonones, goals, teamkpis, review-periods, reviews, public-holidays, daysoff, pulse, impactlog, succession, dashboard, then templates, dictionaries, notifications, alerts, integration-clients, auth) → **sharing** and **telemetry** routes (both wrap per-caller `RateLimit` buckets that AuthRoutes' single `install(RateLimit)` registers, so they run after auth) → integration LAST among features (same rate-limit reason; registers nothing when `integration.enabled` is false) → catch-all `configureRouting`. Full reasoning per module: `.claude/docs/architecture-details.md`.

### Cross-cutting conventions (always loaded via imports)

The following convention docs are imported into this file — treat them exactly like sections of CLAUDE.md:

@.claude/docs/persistence.md
@.claude/docs/list-endpoints.md
@.claude/docs/security.md
@.claude/docs/authorization.md
@.claude/docs/observability.md
@.claude/docs/testing.md

(`persistence.md` = Persistence + the connection pool + the soft-delete convention; `list-endpoints.md` = the list endpoint conventions; `security.md` = the dev/prod security posture, the fail-closed startup checks, payload validation + encryption at rest; `authorization.md` = the layered RBAC model — roles, HR, guards, the chain rule, existence disclosure and the error/ProblemDetail mapping; `observability.md` = OTel wiring + the audit trail; `testing.md` = Testcontainers setup, coverage gates, OpenAPI conformance.)

### Feature deep-dives (on demand — MANDATORY reads)

Each feature's authoritative deep-dive lives in `.claude/docs/features/`. **Before designing, changing, or reviewing anything in a feature — its server package, SPA pages/components, spec paths, or tests — read that feature's doc first.** The summaries below only tell you which doc you need; the docs hold the invariants (status machines, authz nuances, list scopes, events, notifications, SPA structure, test maps). See "Migration catalog" in `.claude/docs/features/migrations.md` for the per-migration V1–V95 history.

- **Feedbacks** (`feedbacks/`) → `.claude/docs/features/feedbacks.md` — five-status lifecycle, create invariants, up to four recipients (V72), list views, `feedback_events`.
- **1:1 meetings** (`oneonones/`) → `.claude/docs/features/one-on-ones.md` — latest-only editing, chronological rule, action-item carry-over chains, event history.
- **Goals** (`goals/`) → `.claude/docs/features/goals.md` — DRAFT ↔ ACTIVE ↔ ARCHIVED, type-specific values, per-status edit rules, events + notifications.
- **Impact log** (`impactlog/`) → `.claude/docs/features/impact-log.md` — per-employee journal (v2.36.0), owner-only writes, chain+HR reads, IMPACT_LOG flag.
- **Succession plans** (`succession/`) → `.claude/docs/features/succession-plans.md` — critical-role records, nominations, primary auto-demote, complete-review stamp, owner-only writes.
- **Team KPIs** (`teamkpis/`) → `.claude/docs/features/team-kpis.md` — goals model per (manager, team), current-manager derivation, data-point series.
- **Performance reviews** (`reviews/`) → `.claude/docs/features/performance-reviews.md` — DRAFT ↔ CALIBRATION ↔ PUBLISHED, encrypted ratings, review-period registry, completeness gates.
- **Days off** (`daysoff/`) → `.claude/docs/features/days-off.md` — create/delete only (v3.9.0), paid pools (V74), carry-over budget + corrections, public holidays, calendar.
- **Pulse surveys** (`pulse/`) → `.claude/docs/features/pulse-surveys.md` — eNPS cycles, eligibility snapshot, encrypted responses, k≥3 anonymity, settings store.
- **Team structure & history** (`teams/`) → `.claude/docs/features/teams.md` — dated membership/manager periods (V93), `asOf`, rules, why rights stay today-only.
- **Dictionaries & career profile** (`dictionaries/`) → `.claude/docs/features/dictionaries.md` — the four global lists, whole-document PUT, the career-position timeline (V57).
- **Notifications** (`notifications/`) → `.claude/docs/features/notifications.md` — **the complete table of every situation that mints a notification**; read before ANY change that creates or renders notifications.
- **Microsoft Teams notifications** → `.claude/docs/features/teams-notifications.md` — the third channel (v4.5.0): `teams.transport`, per-user flag, identity cache, send-time skip order, runbook.
- **Document sharing** (`sharing/`, nine `*Shareable.kt` adapters; SPA: `web/docs/sharing.md`) → `.claude/docs/features/sharing.md` — read-only shares, the one-line lapse rule, non-transitive, `/api/v1/shares`, rate limit, 20 notifications.
- **Activity log** (`activity/`; SPA: `web/docs/activity-log.md`) → `.claude/docs/features/activity-log.md` — actor-only rows, `UNION ALL` over event trails, total order, visibility, retention.
- **Alerts** (`alerts/`) → `.claude/docs/features/alerts.md` — admin broadcast banners, server-side windowing.
- **Integration API** (`integration/`) → `.claude/docs/features/integration-api.md` — read-only GraphQL surface (v3.0.0), show-once keys (V71), SDL contract, DataLoader, audit events.
- **Telemetry** (`telemetry/`) → `.claude/docs/features/telemetry.md` — sampler, registry, retention, read API (ADMIN, 30/min), layering.
- **Per-resource authorization rules** → `.claude/docs/authorization-resources.md` — who may read/write every endpoint; read it before adding or changing any route guard, read preamble or capability flag.
- **Security details** → `.claude/docs/security-details.md` — login/session flows, rate limits, outbound email/Teams, Swagger gate, integration keys, CORS/CSRF + proxy contract, seeds, encrypted columns, config range checks. Read it before touching `auth/`, `infra/mail/`, `infra/teams/`, `plugins/Http.kt`/`Security.kt`, `infra/db/Bootstrap.kt`, rate limits, or proxy/probe/header policy.
- **Migration catalog** → `.claude/docs/features/migrations.md` — the per-migration V1–V95 history. Read it before adding a migration or reasoning about schema history.
- **Persistence & testing details** → `.claude/docs/persistence-details.md` (the pool's full rationale, the hung-database bounds, the soft-delete/hard-delete table lists, the per-feature consistency enumeration) and `.claude/docs/testing-details.md` (the Schemathesis fuzz recipe).
- **Audit event catalog** → `.claude/docs/audit-events.md` — every `audit(...)` event emitted today, by area. MANDATORY read before adding, renaming or removing an audit event.
- **List-endpoint details** → `.claude/docs/list-endpoints-details.md` — the per-endpoint row enrichments (teams/members, users, teams `asOf`, kudos, days-off, activity) and the project-state notes on filters. MANDATORY read before adding or changing a list endpoint's params or row fields.
- **Architecture details** → `.claude/docs/architecture-details.md` — the full annotated package tree, the full module load-order paragraph, the long Commands bullets and the full feature-summary lines. MANDATORY read before adding a package, a `configureXxx` module, or reordering `application.yaml`.

Users, templates, auth, and dashboard have no separate feature doc: their rules live in `.claude/docs/authorization-resources.md` (per-resource rules incl. `GET /api/v1/dashboard/summary`) and `.claude/docs/security-details.md` (login/lockout/password reset/MFA, bootstrap seeds; the refresh/session model stays in `.claude/docs/authorization.md`).

### Frontend (`web/`)

Vite + React 19 + TypeScript SPA. Frontend conventions live in **`web/CLAUDE.md`** (loads when working under `web/`; its shared list-page building blocks live in `web/docs/list-pages.md`, and `web/docs/{sharing,activity-log,tutorials,i18n}.md` — all read on demand): dev server & proxy, build, shared list-page building blocks, i18n rules (N-language architecture, EN default + PL shipped), build version stamp, the theme-owned design-language rules (v1.35.0 — brand green is the interactive accent, semantic success is teal; re-cut border-first with AA colour tokens, the grouped nav + icon rail, and the PageHeader/ListToolbar/RowActions/StatusPill page blocks in v3.3.0), the success-toast convention (v1.38.0 — `utils/toast.tsx`, errors stay inline), the per-user feature-flag gating rules (v1.53.0 — `hasFeature()`, nav filter, page guards, `FEATURE_OF`, tour tags), and the changelog/app-versioning convention (`web/src/changelog/version.ts` owns the displayed version; a release updates both `APP_VERSION` there and the newest English/Polish entry in `web/src/changelog/entries.ts`). Two facts that matter everywhere:

- The Gradle and npm toolchains are disjoint — never invoke npm from Gradle or vice versa.
- The OpenAPI spec at `server/src/main/resources/openapi/documentation.yaml` is the hand-maintained contract between backend and frontend — update it in the same change as any route change, then regenerate the SPA's types (`cd web && npm run gen:api`) and commit `web/src/api/schema.ts`.
