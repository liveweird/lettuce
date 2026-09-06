# Container image pins

Use registry SHA-256 digests for external container images. The readable tag describes
the release family; the digest selects the content even if that tag later moves.
Pin the multi-platform index, not a host-specific child manifest or a local image ID.
The current indexes include both `linux/amd64` and `linux/arm64` images.

## Sources of truth

| Image | Committed references |
| --- | --- |
| Dockerfile frontend | `Dockerfile` syntax directive |
| Node 24 Alpine | `Dockerfile` web stage |
| Temurin 21 JDK and JRE | `Dockerfile` server and runtime stages |
| PostgreSQL 18.4 Alpine 3.24 | `docker-compose.yaml`, `k8s/postgres-deployment.yaml`, `server/src/test/kotlin/PostgresTestSupport.kt` |
| Mailpit 1.30.6 | `docker-compose.yaml` |

Initial registry verification: 2026-09-06. PostgreSQL and Mailpit preserve the images
already running in the development stack. Their exact version tags were checked
against the registry indexes and the running versions. The PostgreSQL `18-alpine`
tag already points to a newer patch release; updating the database is a separate
reviewed operation. The Node, Temurin, and Dockerfile frontend pins were resolved
from their existing release-family tags on that date; both Temurin stages use
21.0.12+8. This is an identity record, not a vulnerability assessment.

## Updating a pin

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
