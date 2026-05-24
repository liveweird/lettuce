package ch.nokillswit.plugins

import io.ktor.server.application.*
import io.ktor.server.plugins.di.*

fun Application.configureDependencyInjection() {
    dependencies {
        provide { GreetingService { "Hello, World!" } }
    }
}
