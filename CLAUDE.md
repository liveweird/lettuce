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
- Package the server for deployment: `./gradlew :server:installDist`. **Never use `:server:buildFatJar`** — the fat JAR breaks Flyway's `ServiceLoader` discovery and NPEs at startup (details in the `run-stack` skill).
- JVM memory flags are pre-tuned in `server/build.gradle.kts` (`applicationDefaultJvmArgs`) — rationale and per-deploy overrides in the `run-stack` skill.
- **Run the whole stack with one command: `docker compose up --build`** (only Docker required). See "Running the full stack" below.

## Running the full stack

`docker compose up --build` serves everything at `http://localhost:8080` (plus a Mailpit mail catcher at `http://localhost:8025` — password-reset emails land there); local dev is `docker compose up postgres` + `./gradlew :server:run` + `cd web && npm run dev`. Full detail — Kubernetes (OrbStack) deployment, secrets, teardown, the 3-stage `Dockerfile` — lives in the `run-stack` skill (`.claude/skills/run-stack/SKILL.md`).

## Architecture

Multi-module Gradle build (Kotlin DSL) defined in `settings.gradle.kts` with two Kotlin modules plus a separate JS frontend in `web/`:

- **`core`** — Kotlin Multiplatform (JVM target only currently). Shared code consumed by `server`. Holds the OpenTelemetry SDK bootstrap (`getOpenTelemetry(serviceName)`).
- **`server`** — Kotlin/JVM. The Ktor application. Depends on `core`.
- **`web/`** — Vite + React + TypeScript SPA that consumes the server's HTTP API. Standalone npm workspace; Gradle does not touch it.

Group is `ch.nokillswit`, version `1.0.0-SNAPSHOT` (set in root `build.gradle.kts`). Dependency versions are centralized in `gradle/libs.versions.toml`; Ktor itself comes from a separate version catalog (`ktorLibs`) loaded from `io.ktor:ktor-version-catalog` in `settings.gradle.kts`.

### API guidelines (the authoritative API standard)

**`api-guidelines/API-GUIDELINES.md` is the single authoritative rulebook for API style** — document shape, URLs, versioning, list conventions, naming, data formats, status codes, errors, auth, caching, rate limiting, idempotency, security, and OpenAPI/conformance practice. Every rule has a stable ID (`API-LIST-002`); cite IDs when discussing API design. Consult it when designing or reviewing endpoints; the sections below keep only summaries plus lettuce-specific behavior. Validate spec changes with the `/api-review` skill (Spectral lint + LLM review checklist; `api-guidelines/README.md` documents both passes and the decision record behind the standard). Deliberate, registered non-conformances (correlation-id echo, `Retry-After`, `ETag`, `Idempotency-Key`, HTTP/2, SLA metadata) live in the rulebook's **known-gaps register** — report them as "registered gap", not drift, and remove the entry when closing one.

### Server bootstrap model

`server/src/main/kotlin/main.kt` just delegates to `io.ktor.server.netty.EngineMain`. The application is wired declaratively in `server/src/main/resources/application.yaml` under `ktor.application.modules` — each entry is a fully-qualified extension function on `Application` (e.g. `ch.nokillswit.plugins.HttpKt.configureHttp`). To add a new cross-cutting concern, create a new `configureXxx()` extension under `plugins/` and register it in `application.yaml`; do not call it from `main.kt`.

### Package layout

```
ch.nokillswit
├── main.kt
├── plugins/            cross-cutting Ktor wiring (configureXxx that only `install` plugins)
├── infra/db/           Flyway migrations + R2DBC connection bootstrap + the shared EventLog base behind the five `*_events` services (v2.4.1)
├── infra/paging/       list-endpoint paging/sort/filter helper (parsePaging, applyPaging)
├── infra/mail/         outbound email: Mailer (smtp via Jakarta/Angus, log, disabled) + configureMail (see "Outbound email" in `.claude/docs/security.md`)
├── infra/crypto/       field-level encryption: FieldCipher (AES-256-GCM) + configureCrypto + the EncryptedAtRest interface the eight encrypted services implement (see "Encryption at rest" in `.claude/docs/security.md`)
├── audit/              security audit trail: `audit(event, fields…)` → AUDIT-marked structured logs (see "Audit trail" in `.claude/docs/observability.md`)
├── authz/              RBAC guards + CallerPrincipal (see "Authorization model" in `.claude/docs/authorization.md`)
├── auth/               POST /api/v1/login (+ /login/mfa — the v2.4.0 opt-in email second factor, MfaChallenges store), /api/v1/refresh, /api/v1/logout, /api/v1/password-reset + token minting + password hashing + LoginThrottle/PasswordResetThrottle
├── users/              /api/v1/users/* CRUD + list + mass CSV import + per-user feature flags (PUT {id}/features) + email-mirror opt-out (PUT {id}/email-notifications) + the per-user language (PUT {id}/language, v2.21.0) + the career-position timeline sub-resource ({id}/career-positions, v2.15.0) + the caller-relative GET /api/v1/career/pyramid (v2.16.0 — see "Career progression" in `.claude/docs/features/dictionaries.md`) + UserService/CareerPositionService + Users/CareerPositions tables
├── teams/              /api/v1/teams/* CRUD + list + member sub-resource + TeamService + Teams/TeamMembers tables
├── templates/          /api/v1/templates/* CRUD + list + TemplateService + Templates table (read: any authenticated; write: ADMIN)
├── dictionaries/       /api/v1/dictionaries/{dictionary} read + whole-document replace + DictionaryService + dictionary_entries table (read: any authenticated; write: ADMIN — see "Dictionaries" in `.claude/docs/features/dictionaries.md`)
├── feedbacks/          /api/v1/feedbacks/* CRUD + list + FeedbackService + Feedbacks table + FeedbackVisibility
├── oneonones/          /api/v1/one-on-ones/* CRUD + list + events + action-item history + OneOnOneService + Meetings/Notes/ActionItems tables (see "1:1 meetings" in `.claude/docs/features/one-on-ones.md`)
├── goals/              /api/v1/goals/* CRUD + list + events + progress/transition actions + GoalService + Goals table (see "Goals" in `.claude/docs/features/goals.md`)
├── teamkpis/           /api/v1/team-kpis/* CRUD + list + events + values sub-resource + transition actions + TeamKpiService + TeamKpis/TeamKpiValues tables (see "Team KPIs" in `.claude/docs/features/team-kpis.md`)
├── reviews/            /api/v1/performance-reviews/* CRUD + list + events + transition actions + /api/v1/review-periods registry + PerformanceReviewService/ReviewPeriodService (see "Performance reviews" in `.claude/docs/features/performance-reviews.md`)
├── daysoff/            /api/v1/days-off/* requests + accept/reject/cancel actions + calendar + budgets + corrections sub-resource + /api/v1/public-holidays registry + DaysOffService/PublicHolidayService (see "Days off" in `.claude/docs/features/days-off.md`)
├── pulse/              /api/v1/pulse-surveys/* — pulse cycles + surveys + team results + settings + PulseCycleService/PulseResponseService (see "Pulse surveys" in `.claude/docs/features/pulse-surveys.md`)
├── settings/           AppSettingsService — the generic runtime-settings K/V store over `app_settings` (V47; pulse is its first consumer)
├── notifications/      /api/v1/notifications/* list + read + seen/unseen + delete + NotificationService + Notifications table (recipient-scoped; list/total also exclude the recipient's disabled-feature types; every mint is also mirrored by email via NotificationEmailer — see "Email mirror" in `.claude/docs/features/notifications.md`)
├── alerts/             /api/v1/alerts/* CRUD + list (ADMIN-only) + /api/v1/alerts/visible (any authenticated) + AlertService + Alerts table (see "Alerts" in `.claude/docs/features/alerts.md`)
└── dashboard/          GET /api/v1/dashboard/summary — the Dashboard hero tiles' caller-scoped counts, composed route-side from the feature services (no dashboard-specific SQL; FeedbackService.receivedSentCount + ReviewPeriodService.currentPeriod + TeamService.directReportCount back it)
```

Routing is feature-local: each feature package registers its own routes from its `configureXxx` module. `plugins/Routing.kt` owns only the SPA: when `WEB_STATIC_DIR` (config key `web.staticDir`) is set, `configureRouting` installs `singlePageApplication` to serve `web/dist` with an `index.html` fallback; when unset (local dev / tests, where Vite serves the SPA), it installs no routes at all (there is no `GET /` placeholder). The scaffolding demo endpoints (`/ws`, `/json/kotlinx-serialization`, `/session/increment`, the "Hello, World!" root) and their plugins (`Sessions`, `Websockets`, the `GreetingService` DI sample, the inert `RequestValidation` rule) have been removed.

Module load order in `application.yaml` matters for inter-module attribute reads: `configureSecurity` puts `JwtConfigKey` in `attributes`; `configureCrypto` (`infra/crypto/Crypto.kt`) puts `FieldCipherKey`; `configureDatabase` reads `FieldCipherKey` (it hands the cipher to `FeedbackService`) and puts `UserServiceKey`; `configureBootstrap` reads `UserServiceKey` plus the eight encrypted-at-rest service keys (Feedback, OneOnOne, Goal, GoalEvent, TeamKpi, PerformanceReview, DaysOff, PulseResponse — the rotation-backfill list), so it runs right after Database; `configureAuthRoutes` reads `JwtConfigKey` + `UserServiceKey` (and the blocklist key), and `configureUserRoutes` reads `UserServiceKey` (its `authenticate {}` blocks also need `configureSecurity` installed first), so the feature modules must run after both. Current order: plugins → infrastructure (Mail → Crypto → Flyway → Database → Bootstrap) → features (users, career-positions, teams, feedbacks, oneonones, goals, teamkpis, review-periods, reviews, public-holidays, daysoff, pulse, dashboard — it reads seven service keys, so it stays after Database — then templates, dictionaries, notifications, alerts, auth) → catch-all `configureRouting`.

### Cross-cutting conventions (always loaded via imports)

The following convention docs are imported into this file — treat them exactly like sections of CLAUDE.md:

@.claude/docs/persistence.md
@.claude/docs/list-endpoints.md
@.claude/docs/security.md
@.claude/docs/authorization.md
@.claude/docs/observability.md
@.claude/docs/testing.md

(`persistence.md` = Persistence + the soft-delete convention; `list-endpoints.md` = the list endpoint conventions; `security.md` = the dev/prod security posture + encryption at rest; `authorization.md` = the layered RBAC model incl. every per-resource rule and the error/ProblemDetail mapping; `observability.md` = OTel wiring + the audit trail; `testing.md` = Testcontainers setup, coverage gates, OpenAPI conformance.)

### Feature deep-dives (on demand — MANDATORY reads)

Each feature's authoritative deep-dive lives in `.claude/docs/features/`. **Before designing, changing, or reviewing anything in a feature — its server package, SPA pages/components, spec paths, or tests — read that feature's doc first.** The summaries below only tell you which doc you need; the docs hold the invariants (status machines, authz nuances, list scopes, events, notifications, SPA structure, test maps).

- **Feedbacks** (`feedbacks/`, SPA feedback pages) → `.claude/docs/features/feedbacks.md` — the five-status lifecycle (REQUESTED/DRAFT/SENT/WITHDRAWN/REJECTED) + POST transition actions, create invariants (no-duplicate 409, self-reflection, requester message), the four list views, and the `feedback_events` audit trail.
- **1:1 meetings** (`oneonones/`, SPA `OneOnOne*`) → `.claude/docs/features/one-on-ones.md` — manager↔direct-report meeting documents: latest-only editing, chronological rule, full-document PUT, action-item carry-over chains, per-item event history.
- **Goals** (`goals/`, SPA `Goal*`) → `.claude/docs/features/goals.md` — DRAFT ↔ ACTIVE ↔ ARCHIVED machine, type-specific value fields, due-date rules, per-status edit rules, list views, events + subordinate notifications.
- **Team KPIs** (`teamkpis/`, SPA `TeamKpi*`) → `.claude/docs/features/team-kpis.md` — the goals model re-shaped to (manager, team) with the **current-manager derivation**, data-point series + recompute, member notifications, the chart tab.
- **Performance reviews** (`reviews/`, SPA `PerformanceReview*`/`Performance*`) → `.claude/docs/features/performance-reviews.md` — DRAFT ↔ CALIBRATION ↔ PUBLISHED, four rated categories (1–6 ratings + summaries — all eight encrypted at rest: summaries since V35, ratings since V45), the append-only/gapless review-period registry, one review per (subordinate, period), completeness gates.
- **Days off** (`daysoff/`, SPA `DaysOff*`) → `.claude/docs/features/days-off.md` — request machine, frozen half-day cost math, closed-form carry-over budget + corrections, public-holiday registry, calendar-parity reads.
- **Pulse surveys** (`pulse/`, SPA `Pulse*`) → `.claude/docs/features/pulse-surveys.md` — admin-managed eNPS cycles (SCHEDULED → OPEN → CLOSED, CANCELLED from anywhere, all manual, at most one non-terminal), the eligibility snapshot, encrypted responses, the per-cycle fill gate + k≥3 anonymity, team-tree scopes, rotating-question pool, the counts-only ADMIN view, and the first runtime settings store.
- **Dictionaries & career profile** (`dictionaries/`, SPA `Dictionary*`, the career-position timeline) → `.claude/docs/features/dictionaries.md` — the four global ordered lists (three career + the pulse rotating questions), whole-document PUT semantics, and the dictionary-backed career-position timeline (V57) whose latest row derives every user's current triple.
- **Notifications** (`notifications/`, SPA `NotificationsButton`) → `.claude/docs/features/notifications.md` — **the complete table of every situation that mints a notification** (typed structured rows, localized client-side) + the recipient-scoped routes. Read it before ANY change that creates or renders notifications.
- **Alerts** (`alerts/`, SPA `Alert*`) → `.claude/docs/features/alerts.md` — admin-managed broadcast banners, server-side visibility windowing, the banner/strip UI contract.
- **Migration catalog** → `.claude/docs/features/migrations.md` — the per-migration V1–V62 history. Read it before adding a migration or reasoning about schema history.

Users, teams, templates, auth, and dashboard have no separate feature doc: their rules live in `.claude/docs/authorization.md` (per-resource rules incl. `GET /api/v1/dashboard/summary`) and `.claude/docs/security.md` (login/lockout/refresh/password reset, bootstrap seeds).

### Frontend (`web/`)

Vite + React 19 + TypeScript SPA. Frontend conventions live in **`web/CLAUDE.md`** (loads when working under `web/`): dev server & proxy, build, shared list-page building blocks, i18n rules (N-language architecture, EN default + PL shipped), build version stamp, the theme-owned design-language rules (v1.35.0 — brand green is the interactive accent, semantic success is teal), the success-toast convention (v1.38.0 — `utils/toast.tsx`, errors stay inline), the per-user feature-flag gating rules (v1.53.0 — `hasFeature()`, nav filter, page guards, `FEATURE_OF`, tour tags), and the changelog/app-versioning convention (`web/src/changelog/entries.ts` is the single source of the user-facing version — adding an entry is the release bump). Two facts that matter everywhere:

- The Gradle and npm toolchains are disjoint — never invoke npm from Gradle or vice versa.
- The OpenAPI spec at `server/src/main/resources/openapi/documentation.yaml` is the hand-maintained contract between backend and frontend — update it in the same change as any route change, then regenerate the SPA's types (`cd web && npm run gen:api`) and commit `web/src/api/schema.ts`.
