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
- **Days off** — leave requests with manager approval, several paid pools per person
  (an admin-curated registry of pool kinds, each carrying over or resetting yearly) with
  budgets, carry-over and corrections, a team calendar, and a public-holiday registry.
- **Pulse surveys** — anonymous eNPS cycles with k≥3 anonymity, team-tree results,
  and trends.
- **Around it all** — teams with a transitive management chain, layered RBAC
  (admin, read-only HR auditor), per-user feature flags, opt-in email MFA, in-app
  notifications mirrored by email, admin broadcast alerts, dictionary-backed
  career profiles, and a bilingual (English/Polish) UI with a guided tour.
- **Integration API** — a read-only GraphQL endpoint for other systems (data
  warehouses, BI, HR tooling) with admin-issued API keys; see
  [Integration API](#integration-api-read-only-for-other-apps) below.

The stack:

- **Backend** — Kotlin / [Ktor](https://ktor.io) (Netty), JWT auth, PostgreSQL
  via Flyway migrations + Exposed over R2DBC, OpenTelemetry wiring, RFC 7807
  error bodies. OpenAPI spec served as Swagger UI at `/openapi`.
- **Frontend** — Vite + React 19 + TypeScript SPA (`web/`), Mantine UI,
  bilingual (English/Polish) via react-i18next.

Architecture, conventions, and the full endpoint/authorization model are
documented in [CLAUDE.md](CLAUDE.md). The REST API contract lives at
`server/src/main/resources/openapi/documentation.yaml`; the integration
GraphQL contract at `server/src/main/resources/graphql/schema.graphqls`.

Completed audit work, accepted decisions, and parked production topics are recorded
in [Audit status](.claude/docs/audit-status.md).


## Running the whole stack (one command)

Build images and supporting services use committed registry digests. See the
[container image update procedure](.claude/docs/container-images.md) before refreshing them.

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

For backup handling, isolated restoration, and the latest rehearsal evidence, see the
[backup and restore runbook](.claude/docs/backup-and-restore.md). Encryption keys must be
recoverable separately from the database archive.

## Running on Kubernetes (local)

The `k8s/` directory holds manifests developed against a local OrbStack cluster.
The app Deployment is rendered separately from `k8s/templates/app-deployment.yaml`
using a verified registry image digest. Use Compose above for a local build without
a registry.

The app runs in production mode behind a TLS-terminating **ingress-nginx** front door at
a real hostname (`k8s/templates/app-ingress.yaml`).

> ⚠ **Community ingress-nginx was retired in March 2026** ([Kubernetes statement](https://kubernetes.io/blog/2026/01/29/ingress-nginx-statement/))
> — no further security patches. These manifests are a **local-proof reference only**; a real
> production deployment must migrate to a maintained ingress controller or the Gateway API, which
> is a behavior migration (re-verify forwarded-header handling, the HTTP→HTTPS redirect, HSTS, and
> body-size limits against the replacement).

One-time setup: install the controller, then create the config the manifests reference — the two
Secrets `lettuce-secrets` (the command is in `k8s/templates/secret.yaml`) and the TLS certificate
`lettuce-tls` (self-signed recipe in `k8s/templates/tls-secret.yaml`; cert-manager for real
deployments), plus a `lettuce-config` ConfigMap holding the public URL
(`kubectl create configmap lettuce-config --from-literal=MAIL_APP_URL=https://$HOST`):

```
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/cloud/deploy.yaml
kubectl wait -n ingress-nginx --for=condition=ready pod -l app.kubernetes.io/component=controller --timeout=180s
kubectl get svc -n ingress-nginx ingress-nginx-controller   # its EXTERNAL-IP; e.g. HOST=lettuce.<ip>.nip.io
```

Publish the tested app image through your release process and set `LETTUCE_APP_IMAGE` to
its verified `registry/repository@sha256:<64 lowercase hex digits>` reference. This repository
does not select a registry or publish images automatically. A commit tag or a local Docker
image ID is not a registry manifest digest. Keep the previous release digest for rollback.

Render and review the app Deployment before applying it. The renderer rejects mutable tags
and missing or malformed digests. The app Deployment and host-specific Ingress both live in
`k8s/templates/`, so a non-recursive `kubectl apply -f k8s/` cannot overwrite the selected app
image or Ingress host. The Ingress host, ConfigMap `MAIL_APP_URL`, and certificate SAN must agree.

```sh
: "${LETTUCE_APP_IMAGE:?Set the verified registry image digest for this release}"
release_manifest=$(mktemp)
./scripts/render-app-deployment.sh "$LETTUCE_APP_IMAGE" > "$release_manifest"
# Review the rendered file and verify that the cluster can pull the selected image.
kubectl apply -f k8s/                      # Service/Postgres/PVC; excludes all templates
kubectl apply -f "$release_manifest"       # applies the exact app image digest
sed "s#lettuce.example.com#$HOST#g" k8s/templates/app-ingress.yaml | kubectl apply -f -
kubectl rollout status deployment/app
kubectl get ingress app                    # host + address; then browse https://$HOST/
rm "$release_manifest"
```

For an upgrade or rollback, render and apply the desired digest again; changing the image
reference triggers a rollout. Rebuilding or moving a tag does not change a deployed digest.

The `app` Service is ClusterIP (the Ingress fronts it); `kubectl port-forward svc/app 8081:8080`
reaches the pod directly on any cluster (production mode answers plain HTTP there with a
redirect — send `X-Forwarded-Proto: https` for API checks). The seed admin's password is the
`ADMIN_INITIAL_PASSWORD` you put in the Secret; the demo users are disabled in production mode.

To stop the workloads while preserving the database:

```sh
kubectl scale deployment app postgres --replicas=0
```

For a destructive teardown that also removes the database volume:

```sh
kubectl delete deployment app
kubectl delete -f k8s/  # includes the database PVC; templates and their resources stay out
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

## Integration API (read-only, for other apps)

Other systems can read lettuce data — users with career history, teams with
members and KPIs, days off with per-pool budgets and corrections, performance reviews,
review periods — through a single GraphQL endpoint. It is **read-only by
construction** (the schema declares no mutations), and reads are deliberately
**unscoped**: an integration client sees everything in scope, without the
per-user authorization rules of the product API (succession plans and personal
feedback are excluded from the schema by design).

**Enable it.** The endpoint is off by default. Set `INTEGRATION_ENABLED=true`
on the server (the bundled `docker-compose.yaml` already does, so the local
demo has it live).

**Get a key.** An administrator opens **Config → Integration clients** in the
app (or `POST /api/v1/integration-clients`), registers a client, and receives
its API key **exactly once** — only a SHA-256 digest is stored, so copy it into
a secret manager immediately. A key can be revoked at any time (terminal and
immediate); rotate by creating a new client.

**Call it.** Send the key as a bearer token:

```sh
curl -s http://localhost:8080/integration/graphql \
  -H "Authorization: Bearer lettuce_int_..." \
  -H "Content-Type: application/json" \
  -d '{"query":"{ users(pageSize: 50) { total items { id name email teams { name } daysOffBudget(year: 2026) { remaining } } } }"}'
```

**Discover the schema.** Introspection is enabled, and
`GET /integration/graphql/schema` (same auth) returns the SDL — every type,
field, argument, and enum value carries a description. The committed contract is
[`server/src/main/resources/graphql/schema.graphqls`](server/src/main/resources/graphql/schema.graphqls);
it evolves additively (deprecations before removals), governed by
[`api-guidelines/GRAPHQL-GUIDELINES.md`](api-guidelines/GRAPHQL-GUIDELINES.md).

Semantics worth knowing: paged collections mirror the REST lists
(`page`/`pageSize`, 1-based, default 20, max 100, `total` = row count after
filters); ids are 31-bit integers, dates ISO strings, timestamps epoch-millis
(`Long` scalar). Transport failures (bad key → `401`, malformed JSON → `400`)
are RFC 7807 problem bodies; anything after that — validation, query-shape
limits (max depth 15, pageSize-weighted complexity 1000), resolver errors — answers `200` with a
GraphQL `errors` array. Requests are rate-limited per key (default 120/min)
and recorded in the audit trail (client, operation name, root fields — never
query text).

## License

This project is licensed under the [MIT License](LICENSE).
