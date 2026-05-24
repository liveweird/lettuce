package ch.nokillswit.users

import ch.nokillswit.auth.hashPassword
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.request.receive
import io.ktor.server.resources.delete
import io.ktor.server.resources.get
import io.ktor.server.resources.href
import io.ktor.server.resources.post
import io.ktor.server.resources.put
import io.ktor.server.response.header
import io.ktor.server.response.respond
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable

@Serializable
@Resource("/users")
class Users {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Users = Users(), val id: UInt)
}

fun Application.configureUserRoutes() {
    val userService = attributes[UserServiceKey]

    routing {
        authenticate {
            post<Users> {
                val req = call.receive<UserRequest>()
                val user = ExposedUser(req.name, req.age, req.email, hashPassword(req.password))
                val id = userService.create(user)
                call.response.header(HttpHeaders.Location, call.application.href(Users.Id(id = id)))
                call.respond(HttpStatusCode.Created, user.toResponse(id))
            }
            get<Users.Id> { route ->
                val user = userService.read(route.id)
                if (user != null) {
                    call.respond(HttpStatusCode.OK, user.toResponse(route.id))
                } else {
                    call.respond(HttpStatusCode.NotFound)
                }
            }
            put<Users.Id> { route ->
                val req = call.receive<UserRequest>()
                val user = ExposedUser(req.name, req.age, req.email, hashPassword(req.password))
                userService.update(route.id, user)
                call.respond(HttpStatusCode.NoContent)
            }
            delete<Users.Id> { route ->
                userService.delete(route.id)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
