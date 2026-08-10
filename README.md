# lettuce

A people-management app for teams and their managers. What started as a small
peer-feedback tool now covers:

- **Feedback** — write, request, and receive feedback with visibility rules and a
  per-record audit trail, plus an org-wide public Kudos wall.
- **1:1 meetings** — manager↔report meeting documents with notes and action items
  that carry over between meetings.
- **Goals & team KPIs** — per-person goals and per-team KPI series with status
  lifecycles, progress tracking, and history.
- **Performance reviews** — rated, encrypted-at-rest reviews over an admin-managed
  review-period timeline, with a calibration phase before publishing.
- **Days off** — leave requests with manager approval, budgets with carry-over and
  corrections, a team calendar, and a public-holiday registry.
- **Pulse surveys** — anonymous eNPS cycles with k≥3 anonymity, team-tree results,
  and trends.
- **Around it all** — teams with a transitive management chain, layered RBAC
  (admin, read-only HR auditor), per-user feature flags, opt-in email MFA, in-app
  notifications mirrored by email, admin broadcast alerts, dictionary-backed
  career profiles, and a bilingual (English/Polish) UI with a guided tour.

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

## Running on Kubernetes (local)

The `k8s/` directory holds manifests for a local cluster (developed against
OrbStack, whose Kubernetes shares the Docker image store — no registry needed).

Build (or rebuild) and deploy:

```
docker build -t lettuce-app:latest .
kubectl apply -f k8s/                      # idempotent; only needed when manifests change
kubectl rollout restart deployment/app     # picks up a rebuilt image (tag stays :latest)
kubectl rollout status deployment/app
```

The `app` Service is a LoadBalancer (`kubectl get svc app` shows its address);
`kubectl port-forward svc/app 8081:8080` works on any cluster. The same admin
seed applies as above.

Tear down:

```
kubectl delete -f k8s/                              # everything, INCLUDING the database volume
kubectl scale deployment app postgres --replicas=0  # stop workloads, keep the data
```

Database only:

```
kubectl apply -f k8s/postgres-data-persistentvolumeclaim.yaml \
              -f k8s/postgres-deployment.yaml \
              -f k8s/postgres-service.yaml
kubectl port-forward svc/postgres 5432:5432   # the Service is ClusterIP-only
```

For hot-reload development, `docker compose up postgres` (below) remains the
simpler path — don't run both databases against host `:5432`; they are separate
instances with separate volumes.

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

## License

This project is licensed under the [MIT License](LICENSE).
