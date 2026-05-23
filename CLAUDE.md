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

Modules currently registered (in load order): `configureHttp`, `configureMonitoring`, `configureSerialization`, `configureSecurity`, `configureWebsockets`, `configureDependencyInjection`, `configureOpenTelemetry`, `configureAutoHeadResponse`, `configurePostgres`, `configureExposed`, `configureResources`, `configureRequestValidation`, `configureRouting`. Several of these install routes directly (notably `configurePostgres` registers `/cities/*` and `configureExposed` registers `/users/*`), so routes are spread across multiple files rather than being centralized in `Routing.kt`.

### Two parallel persistence stacks (intentional, both wired)

- `Postgres.kt` + `CitySchema.kt` — raw JDBC against a `Connection`, exposing `/cities/*`. `connectToPostgres(embedded = true)` currently hard-codes the embedded H2 in-memory database; switching to real Postgres requires flipping that flag and supplying `postgres.url`, `postgres.user`, `postgres.password` in `application.yaml`.
- `Exposed.kt` + `UsersService.kt` — Exposed v1 with the **R2DBC** driver (`exposed-r2dbc`) over H2, exposing `/users/*`. URL is hard-coded to `r2dbc:h2:file:///./h2` and schema is created at startup via `SchemaUtils.create`.

These two stacks coexist as templates — they don't share a connection, transaction manager, or schema.

### Security defaults are template placeholders

`Security.kt` uses a hard-coded HMAC256 secret (`"secret"`), audience, and issuer for JWT, and CORS in `Http.kt` calls `anyHost()`. These are starter values and must be replaced before any non-development use.

### Observability

`ServerOpenTelemetry.kt` installs `KtorServerTelemetry` and obtains the SDK via `getOpenTelemetry("ktor-sample")` from the `core` module. `Monitoring.kt` separately installs Dropwizard metrics (logged via SLF4J every 10s) and the `CallId` plugin using `X-Request-Id`. Metrics OTel exporter is explicitly disabled in `core/.../OpenTelemetry.kt` (`otel.metrics.exporter=none`); only traces are exported.

### Testing

`server/src/test/kotlin/ServerTest.kt` uses `io.ktor.server.testing.testApplication` and calls a `configure()` helper which is not defined in the test file — it's expected to come from Ktor's test host loading `application.yaml`. When adding tests, follow the same pattern (`testApplication { configure(); ... }`) so the full module chain runs.
