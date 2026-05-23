
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}


kotlin {
    jvm()

    sourceSets {
        commonMain.dependencies {
            api(libs.opentelemetry.exporterOtlp)
            api(libs.opentelemetry.ktorInstrumentation)
            api(libs.opentelemetry.sdkAutoconfigure)
            api(libs.opentelemetry.semconv)
        }

        commonTest.dependencies {
            kotlin("test")
        }
    }
}
