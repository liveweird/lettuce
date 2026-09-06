rootProject.name = "lettuce"

val settingsLockFile = file("settings-gradle.lockfile")
check(gradle.startParameter.isWriteDependencyLocks || (settingsLockFile.isFile && settingsLockFile.length() > 0L)) {
    "settings-gradle.lockfile is missing or empty; regenerate it with ./gradlew resolveAndLockAll --write-locks"
}

pluginManagement {
    repositories {
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
    versionCatalogs {
        create("ktorLibs").from("io.ktor:ktor-version-catalog:3.5.2")
    }
}

plugins {
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}
include(":core")
include(":server")
