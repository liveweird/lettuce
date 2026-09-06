# Gradle dependency reproducibility

The Gradle build uses two complementary, fail-closed controls:

- dependency locking pins the selected module versions in `gradle.lockfile`,
  `core/gradle.lockfile`, and `server/gradle.lockfile`; the imported Ktor version catalog is pinned
  in `settings-gradle.lockfile`; and
- dependency verification checks the SHA-256 digest of every resolved external artifact and its
  metadata against `gradle/verification-metadata.xml`.

Gradle enables dependency verification automatically when the verification metadata file exists.
Do not run builds with `--dependency-verification lenient` or `off`, and do not add trusted-artifact
patterns or configuration exclusions. A missing checksum or a checksum mismatch is a build failure
that must be investigated.

## What is covered

Strict locking applies to every resolvable project configuration in the root, `core`, and `server`
projects. This includes the JVM compile, runtime, test, Detekt, Kover, Kotlin compiler, and
distribution inputs currently created by the JVM and Kotlin Multiplatform plugins. `core` currently
has only the JVM target; adding another target requires regenerating locks on every supported host
and reviewing whether host-specific lock state is needed.

Gradle consumes `settings-gradle.lockfile` for the published Ktor version catalog, but its public
strict-lock API is project-scoped. `settings.gradle.kts` therefore adds a fail-closed presence and
non-empty check for this settings lock, bypassed only while `--write-locks` is regenerating it.

Project dependency locking does not apply to the plugins DSL or buildscript classpaths. This build
has no declared `buildscript` dependencies, and direct project and settings plugin versions are
fixed in the version catalogs or `settings.gradle.kts`. Global dependency verification does cover
project plugins, settings plugins, their transitive artifacts, and any future buildscript artifacts.
If a buildscript dependency is introduced, explicitly activate locking for its `classpath`
configuration and commit its separate `buildscript-gradle.lockfile`.

Verification also covers POM and Gradle module metadata because `verify-metadata` is enabled. It
does not cover locally produced project artifacts, changing modules such as snapshots, the Gradle
distribution, or downloaded Java toolchains. The wrapper distribution has its own SHA-256 pin in
`gradle/wrapper/gradle-wrapper.properties`; CI supplies JDK 21 separately.

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
[dependency locking](https://docs.gradle.org/9.7.0/userguide/dependency_locking.html) and
[dependency verification](https://docs.gradle.org/9.7.0/userguide/dependency_verification.html).
