# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Gradle wrapper is at `./gradlew` (use `gradlew.bat` on Windows). JDK 21 toolchain is required (auto-provisioned via foojay-resolver).

- Build everything: `./gradlew build`
- Run the server (Ktor + Netty on port 8080): `./gradlew :server:run`
- Run all tests: `./gradlew test`
- Run server tests only: `./gradlew :server:test`
- Run a single test: `./gradlew :server:test --tests "ch.nokillswit.ServerTest.test root endpoint"`
- Produce a fat JAR / distribution: `./gradlew :server:buildFatJar` or `:server:installDist` (Ktor plugin tasks)

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
├── auth/               POST /login + password hashing
├── users/              /users/* CRUD + UserService + Users table
└── teams/              /teams/* CRUD + member sub-resource + TeamService + Teams/TeamMembers tables
```

Routing is feature-local: each feature package registers its own routes from its `configureXxx` module. `plugins/Routing.kt` is a catch-all for non-feature endpoints (`/`, `/ws`, `/json/kotlinx-serialization`, `/session/increment`).

Module load order in `application.yaml` matters for inter-module attribute reads: `configureSecurity` puts `JwtConfigKey` in `attributes`; `configureDatabase` puts `UserServiceKey`. `configureAuthRoutes` and `configureUserRoutes` read both, so they must run after both. Current order: plugins → `infra/db` (Flyway, then Database) → features (users, auth) → catch-all `configureRouting`.

### Persistence

PostgreSQL is the only database. Connection settings come from the `postgres:` block in `application.yaml` (env-overridable via `POSTGRES_JDBC_URL`, `POSTGRES_R2DBC_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`); defaults match the `docker compose up postgres` service. There is one persistence stack:

- **Flyway** (`infra/db/Flyway.kt`) — runs schema migrations from `server/src/main/resources/db/migration/` at startup via the Java API, opening a short-lived JDBC connection. Migrations are the single source of truth for schema; do not call `SchemaUtils.create` anywhere.
- **Exposed + R2DBC** (`infra/db/Database.kt` + `users/UserService.kt`) — runtime DB access. `Database.kt` connects the `R2dbcDatabase` and publishes `UserServiceKey`; the service itself lives next to the feature it serves. The Exposed table objects (e.g. `UserService.Users`) are used for queries only, not DDL.

The `org.postgresql:postgresql` JDBC driver is on the classpath solely for Flyway; runtime queries go through R2DBC.

### Security defaults are template placeholders

`plugins/Security.kt` uses a hard-coded HMAC256 secret (`"secret"`), audience, and issuer for JWT, and CORS in `plugins/Http.kt` calls `anyHost()`. CSRF install is gated behind `security.csrf.enabled` (default `true`); tests set it to `false` because the configured `originMatchesHost()` + `allowOrigin("http://localhost:8080")` combo is unsatisfiable from the Ktor test client. All of these are starter values and must be replaced before any non-development use.

### Observability

`plugins/OpenTelemetry.kt` installs `KtorServerTelemetry` and obtains the SDK via `getOpenTelemetry("ktor-sample")` from the `core` module. `plugins/Monitoring.kt` separately installs Dropwizard metrics (logged via SLF4J every 10s) and the `CallId` plugin using `X-Request-Id`. Metrics OTel exporter is explicitly disabled in `core/.../OpenTelemetry.kt` (`otel.metrics.exporter=none`); only traces are exported.

### Testing

`server/src/test/kotlin/ServerTest.kt` uses `io.ktor.server.testing.testApplication` and overrides the `postgres.*` config keys via `MapApplicationConfig` to point at a Testcontainers `PostgreSQLContainer` started lazily by `PostgresTestSupport`. Running tests requires a working Docker daemon (Docker Desktop, OrbStack, etc.). When adding tests, replicate the `environment { config = ApplicationConfig("application.yaml").mergeWith(MapApplicationConfig(...)) }` block so the app boots against the test container rather than a real database.

### Frontend (`web/`)

Vite + React 19 + TypeScript SPA. The Gradle and npm toolchains are disjoint — never invoke npm from Gradle or vice versa.

- Dev server: `cd web && npm run dev` (port 5173). Vite proxies `/login`, `/logout`, `/users`, `/teams`, `/feedbacks` → `http://localhost:8080` so the SPA can use relative paths.
- Production build: `cd web && npm run build` → static files in `web/dist`.
- Regenerate API types: `cd web && npm run gen:api`. Reads `server/src/main/resources/openapi/documentation.yaml` directly (no server needed) and writes `web/src/api/schema.ts`. Run this after editing the OpenAPI spec; commit the regenerated `schema.ts`.

The OpenAPI spec at `server/src/main/resources/openapi/documentation.yaml` is the contract between backend and frontend — it is hand-maintained, not auto-generated from routes. When adding/changing a route, update the spec in the same change. Swagger UI is mounted at `http://localhost:8080/openapi`.

The typed fetch wrapper lives in `web/src/api/client.ts` — token storage (localStorage), `login()`, `logout()`, and `authedFetch()` for arbitrary calls. The types come from the generated `schema.ts`; the client itself is hand-written and is the right place to extend when adding new endpoints. Avoid pulling in heavyweight client generators (Orval/Kiota) — the lightweight pairing of `openapi-typescript` (types only) + hand-written fetch is intentional.

`openapi-typescript` is installed with `--legacy-peer-deps` because its declared peer is TS `^5` while the scaffold uses TS 6; the generated output is compatible. If you re-`npm install` from scratch, use `npm install --legacy-peer-deps`.
