
import org.gradle.api.artifacts.dsl.LockMode

// The plugin classpath is locked too (buildscript-gradle.lockfile per project, v4.5.1): project
// dependency locking never reaches it, and a plugin that declares an open version range then
// floats onto whatever was published last — the Ktor Gradle plugin's `commons-lang3:[3.18.0,)`
// jumped to a day-old 3.21.0 on 2026-09-30 and failed dependency verification on every clean
// build. Locked, the plugin graph is reproducible and visible to the CI advisory scan.
buildscript {
    configurations.classpath {
        resolutionStrategy.activateDependencyLocking()
    }
    dependencies {
        constraints {
            // Kover's HTML reporter brings FreeMarker; 2.3.35 fixes CVE-2026-84939 (path traversal
            // via a malformed locale, 2.2.0-2.3.34). Build-time only, never in the image.
            classpath("org.freemarker:freemarker:2.3.35")
        }
    }
}

plugins {
    alias(libs.plugins.kotlin.multiplatform) apply false
    alias(libs.plugins.kotlin.jvm) apply false
    alias(libs.plugins.kotlin.serialization) apply false
    alias(libs.plugins.kover)
}

allprojects {
    dependencyLocking {
        lockAllConfigurations()
        lockMode.set(LockMode.STRICT)
    }

    tasks.register("resolveAndLockAll") {
        group = "build setup"
        description = "Resolves every supported configuration and writes complete dependency locks."
        notCompatibleWithConfigurationCache("Dependency lock generation resolves configurations imperatively.")

        doFirst {
            require(gradle.startParameter.isWriteDependencyLocks) {
                "resolveAndLockAll must be run with --write-locks"
            }
        }
        doLast {
            configurations.filter { it.isCanBeResolved }.forEach { it.resolve() }
        }
    }
}

subprojects {
    group = "ch.nokillswit"
    version = "1.0.0-SNAPSHOT"
}

dependencies {
    kover(project(":server"))
}
