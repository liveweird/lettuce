package ch.nokillswit

import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.delete
import io.ktor.server.routing.get
import io.ktor.server.routing.post
import io.ktor.server.routing.put
import io.ktor.server.routing.routing
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val UserServiceKey = AttributeKey<ExposedUserService>("ExposedUserService")

suspend fun Application.configureExposed() {
    val database = R2dbcDatabase.connect(
        url = environment.config.property("postgres.r2dbcUrl").getString(),
        user = environment.config.property("postgres.user").getString(),
        password = environment.config.property("postgres.password").getString(),
    )
    val userService = ExposedUserService(database)
    attributes.put(UserServiceKey, userService)

    routing {
        authenticate {
            // Create user
            post("/users") {
                val user = call.receive<ExposedUser>()
                val id = userService.create(user)
                call.respond(HttpStatusCode.Created, id)
            }

            // Read user
            get("/users/{id}") {
                val id = call.parameters["id"]?.toUInt() ?: throw IllegalArgumentException("Invalid ID")
                val user = userService.read(id)
                if (user != null) {
                    call.respond(HttpStatusCode.OK, user)
                } else {
                    call.respond(HttpStatusCode.NotFound)
                }
            }

            // Update user
            put("/users/{id}") {
                val id = call.parameters["id"]?.toUInt() ?: throw IllegalArgumentException("Invalid ID")
                val user = call.receive<ExposedUser>()
                userService.update(id, user)
                call.respond(HttpStatusCode.NoContent)
            }

            // Delete user
            delete("/users/{id}") {
                val id = call.parameters["id"]?.toUInt() ?: throw IllegalArgumentException("Invalid ID")
                userService.delete(id)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
