
plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(ktorLibs.plugins.ktor)
    alias(libs.plugins.kotlin.serialization)
}


application {
    mainClass = "io.ktor.server.netty.EngineMain"
}

kotlin {
    jvmToolchain(21)
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
    implementation(ktorLibs.server.di)
    implementation(ktorLibs.server.hsts)
    implementation(ktorLibs.server.httpRedirect)
    implementation(ktorLibs.server.metrics)
    implementation(ktorLibs.server.netty)
    implementation(ktorLibs.server.openapi)
    implementation(ktorLibs.server.requestValidation)
    implementation(ktorLibs.server.resources)
    implementation(ktorLibs.server.routingOpenapi)
    implementation(ktorLibs.server.sessions)
    implementation(ktorLibs.server.swagger)
    implementation(ktorLibs.server.websockets)
    implementation(libs.exposed.core)
    implementation(libs.exposed.r2dbc)
    implementation(libs.flyway.core)
    implementation(libs.flyway.database.postgresql)
    implementation(libs.h2database.h2)
    implementation(libs.h2database.r2dbc)
    implementation(libs.logback.classic)
    implementation(libs.postgresql)
    implementation(libs.r2dbc.postgresql)

    testImplementation(kotlin("test"))
    testImplementation(ktorLibs.server.testHost)
    testImplementation(libs.testcontainers.postgresql)
}
