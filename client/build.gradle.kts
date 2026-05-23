
plugins {
    alias(libs.plugins.kotlin.multiplatform)
}


kotlin {
    jvm()

    sourceSets {
        commonMain.dependencies {
            implementation(project(":core"))
            implementation(ktorLibs.client.core)
        }

        commonTest.dependencies {
            kotlin("test")
        }
    }
}
