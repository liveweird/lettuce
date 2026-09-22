
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(ktorLibs.plugins.ktor)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.kover)
    alias(libs.plugins.detekt)
}


application {
    mainClass = "io.ktor.server.netty.EngineMain"
    // Footprint tuning for this small, I/O-bound, low-traffic service. Baked into the installDist
    // launcher (bin/server → the Docker image) and `:server:run`; `test` is unaffected. Measured on
    // a 512 MiB Linux container (5 warm requests): baseline G1 drifts ~345→410 MiB RSS as it grows
    // its heap; this config sits at a steady ~270 MiB (deterministic across runs) — ~25% lower and
    // predictable. Startup is ~1.6 s either way; the win is memory, not startup.
    //   - UseSerialGC        : G1's concurrent threads + region metadata are pure overhead for a
    //                          small heap / few cores; SerialGC alone saved ~75 MiB here.
    //   - Xmx256m            : the app holds no large caches; 256 MiB is comfortable headroom for
    //                          light bursts (drop to 192m to trim ~25 MiB more if traffic stays low).
    //   - TieredStopAtLevel=1: C1-only JIT — trims code-cache + C2-compiler memory (~50 MiB here).
    //                          Peak CPU-bound throughput is lower, which is irrelevant for an
    //                          I/O-bound tool; REMOVE this flag if the service ever runs hot.
    // Override per-deployment with the JAVA_OPTS / SERVER_OPTS env vars (the launcher appends both).
    applicationDefaultJvmArgs = listOf(
        "-XX:+UseSerialGC",
        "-Xmx256m",
        "-XX:TieredStopAtLevel=1",
    )
}

kotlin {
    jvmToolchain(21)
}

kover {
    reports {
        verify {
            rule {
                // Line-coverage floor (actual ~98.1%, 2026-08-01).
                minBound(90)
                // Branch-coverage floor (actual ~72.0%, 2026-08-01; the gap to 100% is dominated by
                // kotlinx-serialization synthetic branches in @Serializable data classes). NOTE:
                // `check` runs only koverVerify — run `:server:koverXmlReport` for fresh actuals.
                minBound(69, coverageUnits = kotlinx.kover.gradle.plugin.dsl.CoverageUnit.BRANCH)
            }
        }
    }
}

tasks.named("check") {
    dependsOn(tasks.named("koverVerify"))
}

// Static analysis (plain rule sets only — no type resolution). Rule tuning lives in
// config/detekt/detekt.yml; the task rides `check`, so `build` gates on it.
detekt {
    buildUponDefaultConfig = true
    config.setFrom(rootProject.file("config/detekt/detekt.yml"))
}
dependencies {
    implementation(project(":core"))
    implementation(ktorLibs.serialization.kotlinx.json)
    implementation(ktorLibs.server.auth)
    implementation(ktorLibs.server.auth.jwt)
    implementation(ktorLibs.server.autoHeadResponse)
    implementation(ktorLibs.server.cachingHeaders)
    implementation(ktorLibs.server.callId)
    implementation(ktorLibs.server.callLogging)
    implementation(ktorLibs.server.compression)
    implementation(ktorLibs.server.config.yaml)
    implementation(ktorLibs.server.contentNegotiation)
    implementation(ktorLibs.server.core)
    implementation(ktorLibs.server.cors)
    implementation(ktorLibs.server.csrf)
    implementation(ktorLibs.server.defaultHeaders)
    implementation(ktorLibs.server.forwardedHeader)
    implementation(ktorLibs.server.hsts)
    implementation(ktorLibs.server.httpRedirect)
    implementation(ktorLibs.server.metrics)
    implementation(ktorLibs.server.netty)
    implementation(ktorLibs.server.rateLimit)
    implementation(ktorLibs.server.resources)
    implementation(ktorLibs.server.statusPages)
    implementation(ktorLibs.server.swagger)
    implementation(libs.angus.mail)
    implementation(libs.bcrypt)
    implementation(libs.exposed.core)
    implementation(libs.exposed.r2dbc)
    implementation(libs.r2dbc.pool)
    // Reactor alignment — see the `reactor-bom` comment in gradle/libs.versions.toml: the BOM pins
    // reactor-core/-pool/-netty to one release train (they carry different version numbers), so
    // these two declarations carry no version of their own. Guarded by checkDependencyAlignment.
    implementation(platform(libs.reactor.bom))
    implementation(libs.reactor.pool)
    implementation(libs.flyway.core)
    implementation(libs.flyway.database.postgresql)
    implementation(libs.graphql.java)
    implementation(libs.logback.classic)
    implementation(libs.opentelemetry.logbackAppender)
    implementation(libs.postgresql)
    implementation(libs.r2dbc.postgresql)
    // Netty alignment — see the `netty` comment in gradle/libs.versions.toml: the BOM pins every
    // io.netty module to one version, and reactor-netty (versioned by the Reactor BOM above) wins
    // over the driver's older transitive request (Gradle picks the highest). Guarded by
    // checkDependencyAlignment below.
    implementation(platform(libs.netty.bom))
    implementation(libs.reactor.netty.core)
    // kotlin-reflect rides in transitively (Ktor loads the config modules through it) at whatever
    // version Ktor/Exposed were built with; declaring it lets the Kotlin plugin align it with the
    // stdlib (2026-09-04: 2.3.21 under a 2.4.10 stdlib — readable only because metadata stays
    // compatible one minor ahead). Guarded by checkDependencyAlignment below.
    implementation(kotlin("reflect"))

    testImplementation(kotlin("test"))
    testImplementation(ktorLibs.client.contentNegotiation)
    testImplementation(ktorLibs.server.testHost)
    testImplementation(libs.swagger.request.validator.core)
    testImplementation(libs.testcontainers.postgresql)
}

// Every test-client interaction with /api/ is validated against the OpenAPI spec (see
// OpenApiConformance.kt). `-Dopenapi.conformance=warn|off` relaxes it for drift triage.
tasks.withType<Test> {
    systemProperty("openapi.conformance", System.getProperty("openapi.conformance", "fail"))
}

// Fails the build when a dependency FAMILY that must move as one resolves to several versions on
// the server runtime classpath — the mixed Netty 4.1/4.2 set Ktor + reactor-netty produced, the
// OpenTelemetry incubator drifting from the SDK, kotlin-reflect lagging the stdlib (all 2026-09-04;
// the catalog notes explain each pin). Docker-free, rides `check` like detekt.
val checkDependencyAlignment by tasks.registering {
    group = "verification"
    description = "Asserts one version per aligned dependency family (Reactor: the BOM's versions) on the server runtime classpath."
    val runtimeClasspath = configurations.runtimeClasspath
    doLast {
        val ids = runtimeClasspath.get().resolvedConfiguration.resolvedArtifacts.map { it.moduleVersion.id }
        // The Reactor modules are the exception to one-version-per-family (reactor-core 3.8.7 next
        // to reactor-pool 1.2.7 and reactor-netty 1.3.7 is ONE release train), so they are checked
        // against the Reactor BOM's own constraints instead — upstream's pairing table (checkup #37
        // C4). Read off the platform node of the resolution graph, so no extra artifact is fetched
        // and the documented `resolveAndLockAll --write-verification-metadata` records all it needs.
        val bomCoordinates = "io.projectreactor:reactor-bom"
        val bomNode = runtimeClasspath.get().incoming.resolutionResult.allComponents.singleOrNull {
            (it.id as? org.gradle.api.artifacts.component.ModuleComponentIdentifier)
                ?.let { id -> "${id.group}:${id.module}" == bomCoordinates } == true
        } ?: error("$bomCoordinates is not on the runtime classpath — is the Reactor check still needed?")
        val managed = bomNode.dependencies
            .filter { it.isConstraint }
            .mapNotNull { it.requested as? org.gradle.api.artifacts.component.ModuleComponentSelector }
            .associate { "${it.group}:${it.module}" to it.version }
        val reactorIds = ids.filter { it.group.startsWith("io.projectreactor") }
        check(reactorIds.isNotEmpty()) { "No io.projectreactor module on the runtime classpath — is the Reactor check still needed?" }
        val reactorDrift = reactorIds.mapNotNull { id ->
            when (val declared = managed["${id.group}:${id.name}"]) {
                null -> "${id.group}:${id.name}:${id.version} is not in reactor-bom"
                id.version -> null
                else -> "${id.group}:${id.name} resolved ${id.version}, reactor-bom declares $declared"
            }
        }
        if (reactorDrift.isEmpty()) {
            logger.lifecycle(
                "io.projectreactor aligned with reactor-bom ${libs.versions.reactor.bom.get()} (" +
                    reactorIds.joinToString { "${it.name} ${it.version}" } + ")",
            )
        }
        // family label -> (member predicate, version normalizer)
        val families = mapOf(
            "io.netty" to Pair({ g: String, _: String -> g == "io.netty" }, { v: String -> v }),
            // The alpha/incubator artifacts carry a "-alpha" suffix on the same version number.
            "io.opentelemetry" to Pair({ g: String, _: String -> g == "io.opentelemetry" }, { v: String -> v.removeSuffix("-alpha") }),
            // stdlib-jdk7/jdk8 are empty relocation jars since Kotlin 1.8 — only these two matter.
            "kotlin stdlib/reflect" to Pair(
                { g: String, n: String -> g == "org.jetbrains.kotlin" && (n == "kotlin-stdlib" || n == "kotlin-reflect") },
                { v: String -> v },
            ),
        )
        val drift = families.mapNotNull { (label, spec) ->
            val (member, normalize) = spec
            val versions = ids.filter { member(it.group, it.name) }.groupBy({ normalize(it.version) }, { it.name })
            if (versions.size == 1) {
                logger.lifecycle("$label aligned at ${versions.keys.single()} (${versions.values.single().size} modules)")
                null
            } else {
                "$label: " + versions.entries.joinToString("; ") { (v, names) -> "$v -> ${names.sorted()}" }
            }
        }
        check(drift.isEmpty() && reactorDrift.isEmpty()) {
            "Dependency families must resolve to ONE version each on the runtime classpath, and Reactor modules " +
                "to the reactor-bom's versions — " + (drift + reactorDrift).joinToString(" | ")
        }
    }
}
tasks.named("check") { dependsOn(checkDependencyAlignment) }
