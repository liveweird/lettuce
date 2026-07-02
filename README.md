# lettuce

A small peer-feedback app: users write, request, and receive feedback, organized
into teams with manager oversight, with visibility rules, an audit history, and
in-app notifications.

The stack:

- **Backend** — Kotlin / [Ktor](https://ktor.io) (Netty), JWT auth, PostgreSQL
  via Flyway migrations + Exposed over R2DBC, OpenTelemetry wiring, RFC 7807
  error bodies. OpenAPI spec served as Swagger UI at `/openapi`.
- **Frontend** — Vite + React 19 + TypeScript SPA (`web/`), Mantine UI,
  bilingual (English/Polish) via react-i18next.

Architecture, conventions, and the full endpoint/authorization model are
documented in [CLAUDE.md](CLAUDE.md). The API contract lives at
`server/src/main/resources/openapi/documentation.yaml`.


## Running the whole stack (one command)

The only prerequisite is Docker. From the repo root:

```
docker compose up --build
```

This builds the React SPA, builds the Ktor server into a single image (which then
serves both the API and the SPA), starts PostgreSQL, runs the Flyway migrations on
boot, and wires everything together. When it's up, open:

- App: http://localhost:8080
- Swagger UI: http://localhost:8080/openapi

A bootstrap admin is seeded on first boot: `admin@lettuce.local` / `changeme`
(replace before any non-development use).

Tear down with `docker compose down`, or `docker compose down -v` to also drop the
database volume.

## Local development

For hot-reload development, run the three pieces separately:

```
docker compose up postgres                 # database only, on :5432
./gradlew :server:run                       # Ktor API on :8080
cd web && npm run dev                        # Vite dev server on :5173 (proxies /api → :8080)
```

In this mode the server does not serve the SPA (the `WEB_STATIC_DIR` env var is unset),
so Vite owns the frontend on :5173 and the API answers on :8080.

### Useful Gradle tasks

| Task | Description |
|------|-------------|
| `./gradlew build` | Build everything |
| `./gradlew :server:run` | Run the Ktor server on :8080 |
| `./gradlew test` | Run all tests (requires a running Docker daemon) |
| `./gradlew :server:installDist` | Package the server for deployment (`server/build/install/server/bin/server`) |

Do **not** package with `:server:buildFatJar` — merging the dependency JARs
collapses Flyway's duplicate `META-INF/services` plugin descriptors and the fat
JAR crashes at startup. Use `installDist` (this is what the Docker image uses).

If the server starts successfully, you'll see the following output:
```
2024-12-04 14:32:45.584 [main] INFO  Application - Application started in 0.303 seconds.
2024-12-04 14:32:45.682 [main] INFO  Application - Responding at http://0.0.0.0:8080
```
