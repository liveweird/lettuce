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

Multi-module Gradle build (Kotlin DSL) defined in `settings.gradle.kts` with three modules:

- **`core`** — Kotlin Multiplatform (JVM target only currently). Shared code consumed by both `server` and `client`. Holds the OpenTelemetry SDK bootstrap (`getOpenTelemetry(serviceName)`) used on both sides so server and client share the same tracing setup.
- **`client`** — Kotlin Multiplatform. A Ktor `HttpClient` pre-wired with `KtorClientTelemetry`. Depends on `core`.
- **`server`** — Kotlin/JVM. The Ktor application. Depends on `core`.

Group is `ch.nokillswit`, version `1.0.0-SNAPSHOT` (set in root `build.gradle.kts`). Dependency versions are centralized in `gradle/libs.versions.toml`; Ktor itself comes from a separate version catalog (`ktorLibs`) loaded from `io.ktor:ktor-version-catalog` in `settings.gradle.kts`.

### Server bootstrap model

`server/src/main/kotlin/main.kt` just delegates to `io.ktor.server.netty.EngineMain`. The application is wired declaratively in `server/src/main/resources/application.yaml` under `ktor.application.modules` — each entry is a fully-qualified extension function on `Application` (e.g. `ch.nokillswit.HttpKt.configureHttp`). To add a new cross-cutting concern, create a new `configureXxx()` extension and register it in `application.yaml`; do not call it from `main.kt`.

Modules currently registered (in load order): `configureHttp`, `configureMonitoring`, `configureSerialization`, `configureSecurity`, `configureWebsockets`, `configureDependencyInjection`, `configureOpenTelemetry`, `configureAutoHeadResponse`, `configureFlyway`, `configureExposed`, `configureAuth`, `configureResources`, `configureRequestValidation`, `configureRouting`. `configureExposed` installs the `/users/*` routes directly, so routes are spread across multiple files rather than being centralized in `Routing.kt`.

### Persistence

PostgreSQL is the only database. Connection settings come from the `postgres:` block in `application.yaml` (env-overridable via `POSTGRES_JDBC_URL`, `POSTGRES_R2DBC_URL`, `POSTGRES_USER`, `POSTGRES_PASSWORD`); defaults match the `docker compose up postgres` service. There is one persistence stack:

- **Flyway** (`Flyway.kt`) — runs schema migrations from `server/src/main/resources/db/migration/` at startup via the Java API, opening a short-lived JDBC connection. Migrations are the single source of truth for schema; do not call `SchemaUtils.create` anywhere.
- **Exposed + R2DBC** (`Exposed.kt`, `UsersService.kt`) — runtime DB access. Exposed v1 with `exposed-r2dbc` over the Postgres R2DBC driver, exposing `/users/*`. The Exposed table objects (e.g. `ExposedUserService.Users`) are used for queries only, not DDL.

The `org.postgresql:postgresql` JDBC driver is on the classpath solely for Flyway; runtime queries go through R2DBC.

### Security defaults are template placeholders

`Security.kt` uses a hard-coded HMAC256 secret (`"secret"`), audience, and issuer for JWT, and CORS in `Http.kt` calls `anyHost()`. These are starter values and must be replaced before any non-development use.

### Observability

`ServerOpenTelemetry.kt` installs `KtorServerTelemetry` and obtains the SDK via `getOpenTelemetry("ktor-sample")` from the `core` module. `Monitoring.kt` separately installs Dropwizard metrics (logged via SLF4J every 10s) and the `CallId` plugin using `X-Request-Id`. Metrics OTel exporter is explicitly disabled in `core/.../OpenTelemetry.kt` (`otel.metrics.exporter=none`); only traces are exported.

### Testing

`server/src/test/kotlin/ServerTest.kt` uses `io.ktor.server.testing.testApplication` and overrides the `postgres.*` config keys via `MapApplicationConfig` to point at a Testcontainers `PostgreSQLContainer` started lazily by `PostgresTestSupport`. Running tests requires a working Docker daemon (Docker Desktop, OrbStack, etc.). When adding tests, replicate the `environment { config = ApplicationConfig("application.yaml").mergeWith(MapApplicationConfig(...)) }` block so the app boots against the test container rather than a real database.
