package ch.nokillswit.users

import ch.nokillswit.auth.hashPassword
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.authz.requireSelfOrAdmin
import ch.nokillswit.infra.paging.parsePaging
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.resources.Resource
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.plugins.BadRequestException
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
            get<Users> {
                call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name", "email", "role"))
                val params = call.request.queryParameters
                val roleFilter = params["role"]?.takeIf { it.isNotBlank() }?.let { raw ->
                    runCatching { UserRole.valueOf(raw) }.getOrElse {
                        throw BadRequestException("Unknown role: $raw (allowed: ${UserRole.entries.joinToString { it.name }})")
                    }
                }
                val filter = UserListFilter(
                    name = params["name"]?.takeIf { it.isNotBlank() },
                    email = params["email"]?.takeIf { it.isNotBlank() },
                    role = roleFilter,
                )
                val result = userService.list(filter, paging)
                call.respond(
                    HttpStatusCode.OK,
                    UserPageResponse(
                        items = result.items,
                        page = paging.page,
                        pageSize = paging.pageSize,
                        total = result.total,
                    ),
                )
            }
            post<Users> {
                requireAdmin(call.caller())
                val req = call.receive<UserRequest>()
                val user = User(
                    name = req.name,
                    email = req.email,
                    passwordHash = hashPassword(req.password),
                    role = req.role ?: UserRole.USER,
                )
                val id = userService.create(user)
                call.response.header(HttpHeaders.Location, call.application.href(Users.Id(id = id)))
                call.respond(HttpStatusCode.Created, user.toResponse(id))
            }
            get<Users.Id> { route ->
                requireSelfOrAdmin(call.caller(), route.id)
                val user = userService.read(route.id)
                if (user != null) {
                    call.respond(HttpStatusCode.OK, user.toResponse(route.id))
                } else {
                    call.respond(HttpStatusCode.NotFound)
                }
            }
            put<Users.Id> { route ->
                val caller = call.caller()
                requireSelfOrAdmin(caller, route.id)
                val req = call.receive<UserRequest>()
                val existing = userService.read(route.id)
                if (existing == null) {
                    call.respond(HttpStatusCode.NotFound)
                    return@put
                }
                val nextRole = when {
                    req.role == null -> existing.role
                    caller.role == UserRole.ADMIN -> req.role
                    req.role == existing.role -> existing.role
                    else -> throw ch.nokillswit.authz.ForbiddenException("Only admins may change a user's role")
                }
                val user = User(
                    name = req.name,
                    email = req.email,
                    passwordHash = hashPassword(req.password),
                    role = nextRole,
                )
                val updated = userService.update(route.id, user)
                if (updated == 0) {
                    call.respond(HttpStatusCode.NotFound)
                } else {
                    call.respond(HttpStatusCode.NoContent)
                }
            }
            delete<Users.Id> { route ->
                requireAdmin(call.caller())
                userService.delete(route.id)
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
