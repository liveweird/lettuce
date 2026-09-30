# Gradle dependency reproducibility

The Gradle build uses two complementary, fail-closed controls:

- dependency locking pins the selected module versions in `gradle.lockfile`,
  `core/gradle.lockfile`, and `server/gradle.lockfile`; the plugin classpaths are pinned in the
  three `buildscript-gradle.lockfile`s (root, `core`, `server` — since v4.5.1); the imported Ktor
  version catalog is pinned in `settings-gradle.lockfile`; and
- dependency verification checks the SHA-256 digest of every resolved external artifact and its
  metadata against `gradle/verification-metadata.xml`.

Gradle enables dependency verification automatically when the verification metadata file exists.
Do not run builds with `--dependency-verification lenient` or `off`, and do not add trusted-artifact
patterns or configuration exclusions. A missing checksum or a checksum mismatch is a build failure
that must be investigated.

This process deliberately does not cover GitHub Actions dependencies — those are SHA-pinned in the
workflow files and bumped via `.github/dependabot.yml`; see "Automatic CI gates" in
`.claude/docs/testing.md`.

## What is covered

Strict locking applies to every resolvable project configuration in the root, `core`, and `server`
projects. This includes the JVM compile, runtime, test, Detekt, Kover, Kotlin compiler, and
distribution inputs currently created by the JVM and Kotlin Multiplatform plugins. `core` currently
has only the JVM target; adding another target requires regenerating locks on every supported host
and reviewing whether host-specific lock state is needed.

Gradle consumes `settings-gradle.lockfile` for the published Ktor version catalog, but its public
strict-lock API is project-scoped. `settings.gradle.kts` therefore adds a fail-closed presence and
non-empty check for this settings lock, bypassed only while `--write-locks` is regenerating it.

Project dependency locking does not reach the plugin classpath, so each project's `buildscript`
block activates locking for its `classpath` configuration explicitly (v4.5.1) — the plugins-DSL
resolution runs through that configuration, so the lock pins every plugin and its transitive
artifacts. Direct plugin versions are fixed in the version catalogs, but a plugin's own
dependencies may carry open ranges: the Ktor Gradle plugin 3.6.0 constrains `commons-lang3` to
`[3.18.0,)`, and on 2026-09-30 an unlocked classpath floated onto the day-old 3.21.0 and failed
verification on every clean build. Two `buildscript` constraints hold the plugin classpath where
it was reviewed: `commons-lang3` strictly 3.20.0 (`server/build.gradle.kts`) and FreeMarker 2.3.35
(root — Kover's reporter, CVE-2026-84939). `resolveAndLockAll --write-locks` rewrites the three
buildscript lockfiles along with the project ones, since the classpath resolves during
configuration. Settings plugins (`settings.gradle.kts`) stay outside locking; global dependency
verification covers them and every plugin artifact.

Verification also covers POM and Gradle module metadata because `verify-metadata` is enabled. It
does not cover locally produced project artifacts, changing modules such as snapshots, the Gradle
distribution, or downloaded Java toolchains. The wrapper distribution has its own SHA-256 pin in
`gradle/wrapper/gradle-wrapper.properties`; CI supplies JDK 21 separately.

## Advisory floors and the dependency scan

The **Dependency scan** CI job (v4.5.2, see "Automatic CI gates" in `.claude/docs/testing.md`)
runs Trivy over every lockfile and fails on HIGH/CRITICAL advisories. A flagged module that the
build only reaches transitively gets a **version floor**, never a gate exception: a platform or
`constraints` entry in `server/build.gradle.kts` for the runtime/test classpaths (the
`jackson-bom`/`scram` catalog lines, with their comment naming the advisory), or a literal
`buildscript` constraint for the plugin classpath (the Ktor plugin's Jackson, plexus-utils and
log4j). Then regenerate as below.

**Known gap — shaded copies.** The scan reads lockfile coordinates, so a library a jar SHADES is
invisible to it and to every version floor. Today: the PostgreSQL JDBC driver 42.7.13 (Flyway's
boot connection) bundles scram-client 3.2 under `org/postgresql/shaded/` (CVE-2026-53712 is
fixed only on the R2DBC path) — no pgjdbc release bundles 3.3 yet; the exposure needs TLS to
PostgreSQL. On every driver bump, look in the jar's `META-INF/licenses/` folder and update the
note in `gradle/libs.versions.toml`.

Two traps the first round (2026-09-30) hit:

- **Write verification metadata from an EMPTY `GRADLE_USER_HOME`, not the warm cache.** The warm
  run missed four parent POMs (`jackson-base`, `jackson-modules-java8`, `log4j`, `log4j-bom`) that
  a clean resolution needs — CI and the Docker build would have failed. Run
  `GRADLE_USER_HOME=$(mktemp -d) ./gradlew --dependency-verification strict resolveAndLockAll --write-locks buildEnvironment :core:buildEnvironment :server:buildEnvironment`
  (pass `-Porg.gradle.java.installations.paths=<local JDK 21>` to skip the toolchain download)
  and fix what it reports. Gradle's writer does not record the two log4j parent POMs of the
  plugin classpath at all, so those entries are hand-added (their `origin` says how they were
  verified).
- **Derive a prune from that clean run too**: remove only entries a clean resolution never
  downloads, then re-run the same strict command in that home. Parent and imported-BOM POMs never
  appear in lockfiles, so "not in any lockfile" is not a prune criterion.

**Provenance of new checksums** (step 3 below): the publisher's PGP signature is the independent
check. Without a local gpg, `uv run --python 3.12` with `pgpy` works: download the artifact and
its `.asc` from Maven Central, fetch the signing key BY FINGERPRINT from keys.openpgp.org (not
from Maven Central), verify, and compare the file's SHA-256 with the metadata. For keys without a
published user id, cross-check the key id against the project's own `KEYS` file (Apache) or
signing continuity with the previously trusted release.

## Routine builds

Normal commands enforce both controls without extra flags:

```bash
./gradlew check
./gradlew :server:installDist
```

Strict lock mode fails when a resolvable configuration has no lock state, has unexpected modules,
or resolves a version that differs from its lock. Dependency verification fails before an
unapproved or modified external artifact can be used.

## Intentional dependency changes

First change the dependency or plugin declaration. Then regenerate the complete project lock state
and add SHA-256 metadata for newly resolved artifacts:

```bash
./gradlew resolveAndLockAll --write-locks --write-verification-metadata sha256
./gradlew check :server:installDist
```

`resolveAndLockAll` refuses to run without `--write-locks`. It resolves every configuration that
the current supported host can resolve, including configurations that ordinary lifecycle tasks may
not visit.

Review every generated change before committing it:

1. Confirm lockfile additions, removals, and version changes match the requested update.
2. Confirm checksum entries are limited to the expected new artifacts and metadata.
3. Establish new checksums from an independently authenticated publisher checksum, signature, or
   release source. Metadata generation records the artifacts Gradle resolved; it does not prove
   that the repository or publisher was honest. A fresh cache can detect local-cache corruption,
   but a second download from the same repository is not independent provenance.
4. Keep old checksum entries only while their coordinates remain intentionally supported. Remove
   obsolete component entries in a focused review rather than recreating the entire verification
   file from an unreviewed cache.

Never accept a changed checksum for an unchanged coordinate as routine maintenance. Treat it as a
possible repository or cache integrity incident and verify the publisher's artifact independently.

The initial checksum baseline was generated from the configured Maven Central and Gradle Plugin
Portal repositories, checked for trust exceptions, and resolved again through fresh local caches.
This establishes a consistent integrity baseline and rules out reliance on one pre-existing local
cache; it does not authenticate publisher identity. Signature verification is not enabled.

The control behavior and commands follow Gradle's official documentation for
[dependency locking](https://docs.gradle.org/9.7.1/userguide/dependency_locking.html) and
[dependency verification](https://docs.gradle.org/9.7.1/userguide/dependency_verification.html).
