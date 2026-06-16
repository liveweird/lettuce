# lettuce

This project was created using the [Ktor Project Generator](https://start.ktor.io).

Here are some useful links to get you started:
 * [Ktor Documentation](https://ktor.io/docs/home.html)
 * [Ktor GitHub page](https://github.com/ktorio/ktor)
 * [Ktor Slack chat](https://app.slack.com/client/T09229ZC6/C0A974TJ9). [Request an invite](https://surveys.jetbrains.com/s3/kotlin-slack-sign-up).


## Features
Here's a list of features included in this project:

| Name | Description |
|------|-------------|
| [WebSockets](https://start.ktor.io/p/io.ktor/server-websockets) | Adds WebSocket protocol support for bidirectional client connections |
| [Dependency Injection](https://start.ktor.io/p/io.ktor/server-di) | Enables dependency injection for your server |
| [OpenTelemetry](https://start.ktor.io/p/io.opentelemetry.instrumentation/server-open-telemetry) | Instruments applications with distributed tracing, metrics, and logging for comprehensive observability |
| [AutoHeadResponse](https://start.ktor.io/p/io.ktor/server-auto-head-response) | Provides automatic responses for HEAD requests |
| [HttpsRedirect](https://start.ktor.io/p/io.ktor/server-https-redirect) | Redirects insecure HTTP requests to the respective HTTPS endpoint |
| [HSTS](https://start.ktor.io/p/io.ktor/server-hsts) | Enables HTTP Strict Transport Security (HSTS) |
| [Default Headers](https://start.ktor.io/p/io.ktor/server-default-headers) | Adds a default set of headers to HTTP responses |
| [Compression](https://start.ktor.io/p/io.ktor/server-compression) | Compresses responses using encoding algorithms like GZIP |
| [Caching Headers](https://start.ktor.io/p/io.ktor/server-caching-headers) | Provides options for responding with standard cache-control headers |
| [CORS](https://start.ktor.io/p/io.ktor/server-cors) | Enables Cross-Origin Resource Sharing (CORS) |
| [kotlinx.serialization](https://start.ktor.io/p/io.ktor/server-kotlinx-serialization) | Handles JSON serialization using kotlinx.serialization library |
| [Content Negotiation](https://start.ktor.io/p/io.ktor/server-content-negotiation) | Provides automatic content conversion according to Content-Type and Accept headers |
| [PostgreSQL](https://start.ktor.io/p/org.jetbrains/server-postgres) | Adds Postgres database support |
| [Exposed](https://start.ktor.io/p/org.jetbrains/server-exposed) | Adds Exposed database to your application |
| [Metrics](https://start.ktor.io/p/io.ktor/server-metrics) | Adds supports for monitoring several metrics |
| [Call Logging](https://start.ktor.io/p/io.ktor/server-call-logging) | Logs client requests |
| [Call ID](https://start.ktor.io/p/io.ktor/server-callid) | Allows to identify a request/call. |
| [Resources](https://start.ktor.io/p/io.ktor/server-resources) | Provides type-safe routing |
| [Request Validation](https://start.ktor.io/p/io.ktor/server-request-validation) | Adds validation for incoming requests |
| [Authentication](https://start.ktor.io/p/io.ktor/server-auth) | Provides extension point for handling the Authorization header |
| [Authentication JWT](https://start.ktor.io/p/io.ktor/server-auth-jwt) | Handles JSON Web Token (JWT) bearer authentication scheme |
| [Sessions](https://start.ktor.io/p/io.ktor/server-sessions) | Adds support for persistent sessions through cookies or headers |
| [CSRF](https://start.ktor.io/p/io.ktor/server-csrf) | Cross-site request forgery mitigation |
| [Swagger](https://start.ktor.io/p/io.ktor/server-swagger) | Serves Swagger UI for your project |
| [OpenAPI](https://start.ktor.io/p/io.ktor/server-openapi) | Serves OpenAPI documentation |


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
| `./gradlew :server:buildFatJar` | Produce the server fat JAR |

If the server starts successfully, you'll see the following output:
```
2024-12-04 14:32:45.584 [main] INFO  Application - Application started in 0.303 seconds.
2024-12-04 14:32:45.682 [main] INFO  Application - Responding at http://0.0.0.0:8080
```
