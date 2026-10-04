# Container image pins

Use registry SHA-256 digests for external container images. The readable tag describes
the release family; the digest selects the content even if that tag later moves.
Pin the multi-platform index, not a host-specific child manifest or a local image ID.
The current indexes include both `linux/amd64` and `linux/arm64` images.

## Sources of truth

| Image | Committed references |
| --- | --- |
| Playwright 1.63.0 Noble (desktop visual pilot) | `e2e/visual/runtime.json` |
| Dockerfile frontend | `Dockerfile` syntax directive |
| Node 24 Alpine | `Dockerfile` web stage |
| Temurin 21 JDK and JRE | `Dockerfile` server and runtime stages |
| PostgreSQL 18.4 Alpine 3.24 | `docker-compose.yaml`, `k8s/postgres-deployment.yaml`, `server/src/test/kotlin/PostgresTestSupport.kt` |
| Mailpit 1.31.2 | `docker-compose.yaml` |
| WireMock 3.13.2 (the local Teams stub, v4.5.0) | `docker-compose.yaml` |
| Trivy 0.74.0 (the CI dependency scan, v4.5.2) | `.github/workflows/quality.yml` |
| k6 2.3.0 (the on-demand load generator, perf M1) | `perf/run.sh` (`K6_IMAGE`) |

Initial registry verification: 2026-09-06. PostgreSQL and Mailpit preserve the images
already running in the development stack. Their exact version tags were checked
against the registry indexes and the running versions. The PostgreSQL `18-alpine`
tag already points to a newer patch release; updating the database is a separate
reviewed operation. The Node, Temurin, and Dockerfile frontend pins were resolved
from their existing release-family tags on that date; both Temurin stages use
21.0.12+8. This is an identity record, not a vulnerability assessment.

Refresh record: 2026-09-20. Node moved to 24.21.0 (the `24-alpine` family tag), both
Temurin stages stayed on 21.0.12+8 but their Ubuntu base was rebuilt (2026-09-12
image), and Mailpit moved to 1.31.2 (a security release: single-frame thumbnail
decode, GHSA-2vgv-6hcp-mf43, plus the 1.31.x SMTP/SSRF hardening). The Dockerfile
frontend digest was unchanged. PostgreSQL was deliberately left on 18.4: its
`18.4-alpine3.24` digest is unchanged, the `18-alpine` tag has reached 18.6, and a
database release change is the separate reviewed operation described below (the
running development volume is 18.4).

Addition record: 2026-09-25. WireMock 3.13.2 (`wiremock/wiremock`, the official upstream
image; 3.13.2 is the newest stable — the 4.x line is still beta) joined as the
`teams-stub` service, the local stand-in for Microsoft Teams. Its index
`sha256:0d4ecb3e…61b3` carries linux/amd64, linux/arm64 and linux/arm/v7 images. It runs in
the local stack only; no deployed environment uses it.

Addition record: 2026-09-30. Trivy 0.74.0 (`ghcr.io/aquasecurity/trivy`, the official image,
`sha256:62b1e65e…1969` — the same pin Flow's CI uses) joined as the **Dependency scan** CI job's
scanner. It runs in CI only, over copies of the lockfiles; nothing it produces ships.

Addition record: 2026-10-04. k6 2.3.0 (`grafana/k6`, the official upstream image; 2.3.0 is
the newest GitHub release — the registry's `latest` tag points at a different index) joined as the
performance programme's load generator (`perf/run.sh k6`, `.claude/docs/performance.md`). Its index
`sha256:9c2dee7f…5aeb34` carries linux/amd64 and linux/arm64 images. It runs locally on demand
only (a throwaway `docker run` on the perf compose network); nothing in CI, compose or Kubernetes
uses it and nothing it produces ships.

Addition record: 2026-10-04. Jaeger 2.21.0 (`jaegertracing/jaeger`, the official upstream image, the v2
all-in-one binary; 2.21.0 is the newest GitHub release) joined as the performance programme's trace
store and UI (`perf/docker-compose.perf.yaml`, profile `traces`, `perf/run.sh traces`). Its index
`sha256:3d0ac795…18c3` carries linux/amd64 and linux/arm64 images (plus s390x/ppc64le). It runs in the
local perf project on demand only — the UI is published on `127.0.0.1:16686`, the OTLP receivers stay inside the
compose network, storage is in memory; nothing in CI, the dev compose file or Kubernetes uses it and nothing it
produces ships.

## Updating a pin

The desktop visual pilot uses the Playwright multi-platform index pinned in
`e2e/visual/runtime.json`, with execution fixed to **linux/amd64** for comparable screenshots.
Its inspected runtime is Node v24.20.0 / Chromium 153.0.8010.12. See
`e2e/visual/baseline-review.md` for validation and the 2026-10-04 human approval; this isolated
test image is used locally and by the Desktop visual CI job, not deployed as an application. Changing its runtime
pin requires reviewing the screenshot differences as well as keeping the Playwright version
aligned with the E2E lockfile.

Before first adopting these pins on an existing environment, inspect its running
PostgreSQL version and registry digest. Another environment may have pulled a newer
`18-alpine` image than the 18.4 release recorded here. Do not recreate its database
against this older pin on the same volume: keep that environment's verified current
digest in an operator-local override and review the intended version transition
with the backup/restore and PostgreSQL upgrade procedures first. The initial
18.4 pin preserves only the verified local baseline, not every existing installation.

1. Review the publisher's release notes and choose the intended release tag. Check
   for updates regularly and when relevant security fixes are announced: fixed
   digests do not receive the publisher's later patches automatically.
2. Read the registry index with `docker buildx imagetools inspect IMAGE:TAG`. Record
   its top-level `Digest`, inspect the actual Linux AMD64 and ARM64 entries, and
   verify the intended upstream repository. Entries with `unknown/unknown` platforms
   are attestations, not runnable platform images.
3. Inspect `IMAGE:TAG@sha256:DIGEST` again to verify that exact reference, then update
   the committed reference. Keep the digest in all three PostgreSQL references identical and keep
   the Temurin JDK/JRE release and Java 21 toolchain aligned. Review OS-base changes
   as well as the application's release number.

   Testcontainers uses `postgres@sha256:DIGEST` with the readable release in a
   comment. Its image-name parser cannot handle `postgres:TAG@sha256:DIGEST`;
   declaring compatibility does not fix that parsing limitation. Compose and
   Kubernetes retain the readable tag alongside the same digest.
4. Validate `docker compose config --quiet`, build with
   `docker compose build --pull app`, and run the required PR checks. The backend
   suite boots the pinned PostgreSQL image and applies every migration. For a base
   update requiring clean package resolution, add `--no-cache` to the build.
5. Recreate the authorized development services with `docker compose up -d --no-build`,
   preserving the existing override configuration, encryption keys, and database
   volume. Check `/healthz`, `/readyz`, the SPA, and Mailpit. Do not use `down -v` or
   remove volumes as part of an image update. A database version change also requires
   the backup/restore procedure and the publisher's upgrade instructions; a major
   upgrade is not an in-place container replacement.

Kubernetes updates remain a separate deployment action. Validate the reviewed
manifest against the target cluster before applying it. The app itself must use a
published release digest through `scripts/render-app-deployment.sh`; base-image
pins do not supply an app registry or authorize publication.

## Scope and limits

These pins stabilize container inputs across supported platforms. They do not make
the complete build byte-for-byte reproducible: the web stage still installs Git
from Alpine repositories, package managers and toolchain provisioning have their
own inputs, and output metadata includes the source commit. Updating a digest is a
deliberate dependency change that requires review and verification.

References: [Docker image pinning](https://docs.docker.com/build/building/best-practices/#pin-base-image-versions)
and [registry manifest inspection](https://docs.docker.com/reference/cli/docker/buildx/imagetools/inspect/).
