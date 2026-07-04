package ch.nokillswit.users

import ch.nokillswit.audit.audit
import ch.nokillswit.auth.hashPassword
import ch.nokillswit.auth.verifyPassword
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.caller
import ch.nokillswit.authz.requireAdmin
import ch.nokillswit.authz.requireCanAssignRole
import ch.nokillswit.authz.requireSelfOrAdmin
import ch.nokillswit.infra.paging.parsePaging
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUInt
import ch.nokillswit.infra.paging.toPage
import ch.nokillswit.plugins.respondProblem
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

/** Minimum accepted password length for create and change. */
const val MIN_PASSWORD_LENGTH = 10

/** Column limits (see Users table / migrations) enforced up-front so oversized or blank
 *  payloads are a clean 400 instead of a DB-level 500. */
private const val MAX_NAME_LENGTH = 50
private const val MAX_EMAIL_LENGTH = 254

private fun validateNameAndEmail(name: String, email: String) {
    if (name.isBlank()) throw BadRequestException("Name must not be blank")
    if (name.length > MAX_NAME_LENGTH) throw BadRequestException("Name must be at most $MAX_NAME_LENGTH characters")
    if (email.isBlank()) throw BadRequestException("Email must not be blank")
    if (email.length > MAX_EMAIL_LENGTH) throw BadRequestException("Email must be at most $MAX_EMAIL_LENGTH characters")
    if ('@' !in email) throw BadRequestException("Email must contain '@'")
}

@Serializable
@Resource("/api/v1/users")
class Users {
    @Serializable
    @Resource("{id}")
    class Id(val parent: Users = Users(), val id: UInt) {
        @Serializable
        @Resource("password")
        class Password(val parent: Id)
    }
}

fun Application.configureUserRoutes() {
    val userService = attributes[UserServiceKey]

    routing {
        authenticate {
            get<Users> {
                call.caller()
                val paging = call.parsePaging(sortable = setOf("id", "name", "email", "role"))
                val params = call.request.queryParameters
                val roleFilter = params.optionalString("role")?.let { raw ->
                    runCatching { UserRole.valueOf(raw) }.getOrElse {
                        throw BadRequestException("Unknown role: $raw (allowed: ${UserRole.entries.joinToString { it.name }})")
                    }
                }
                val filter = UserListFilter(
                    name = params.optionalString("name"),
                    email = params.optionalString("email"),
                    role = roleFilter,
                    teamId = params.optionalUInt("teamId"),
                )
                val result = userService.list(filter, paging)
                call.respond(HttpStatusCode.OK, paging.toPage(result.items, result.total))
            }
            post<Users> {
                val caller = call.caller()
                requireAdmin(caller)
                val req = call.receive<UserRequest>()
                validateNameAndEmail(req.name, req.email)
                if (req.password.length < MIN_PASSWORD_LENGTH) {
                    throw BadRequestException("Password must be at least $MIN_PASSWORD_LENGTH characters")
                }
                val user = User(
                    name = req.name,
                    email = req.email,
                    passwordHash = hashPassword(req.password),
                    role = req.role ?: UserRole.USER,
                )
                val id = userService.create(user)
                audit(
                    "user.created",
                    "byUserId" to caller.userId.toLong(),
                    "newUserId" to id.toLong(),
                    "email" to user.email,
                    "role" to user.role.name,
                )
                call.response.header(HttpHeaders.Location, call.application.href(Users.Id(id = id)))
                call.respond(HttpStatusCode.Created, user.toResponse(id))
            }
            get<Users.Id> { route ->
                requireSelfOrAdmin(call.caller(), route.id)
                val user = userService.read(route.id)
                if (user != null) {
                    call.respond(HttpStatusCode.OK, user.toResponse(route.id))
                } else {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                }
            }
            put<Users.Id> { route ->
                val caller = call.caller()
                requireSelfOrAdmin(caller, route.id)
                val req = call.receive<UserUpdateRequest>()
                validateNameAndEmail(req.name, req.email)
                val existing = userService.read(route.id)
                if (existing == null) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                    return@put
                }
                requireCanAssignRole(caller, existing.role, req.role)
                val user = User(
                    name = req.name,
                    email = req.email,
                    passwordHash = existing.passwordHash,
                    role = req.role,
                )
                val updated = userService.update(route.id, user)
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                } else {
                    if (req.role != existing.role) {
                        audit(
                            "user.role_changed",
                            "byUserId" to caller.userId.toLong(),
                            "targetUserId" to route.id.toLong(),
                            "from" to existing.role.name,
                            "to" to req.role.name,
                        )
                    }
                    call.respond(HttpStatusCode.NoContent)
                }
            }
            put<Users.Id.Password> { route ->
                val caller = call.caller()
                requireSelfOrAdmin(caller, route.parent.id)
                val req = call.receive<PasswordUpdateRequest>()
                if (req.password.length < MIN_PASSWORD_LENGTH) {
                    throw BadRequestException("Password must be at least $MIN_PASSWORD_LENGTH characters")
                }
                // Changing one's OWN password always requires the current one (even for an admin);
                // an admin resetting somebody else's does not. Read before update so a wrong
                // current password never mutates anything.
                if (caller.userId == route.parent.id) {
                    val existing = userService.read(route.parent.id)
                    if (existing == null) {
                        call.respondProblem(HttpStatusCode.NotFound, "User not found")
                        return@put
                    }
                    if (req.currentPassword == null || !verifyPassword(req.currentPassword, existing.passwordHash)) {
                        audit(
                            "password.change_denied",
                            "targetUserId" to route.parent.id.toLong(),
                            "byUserId" to caller.userId.toLong(),
                            "reason" to "wrong_current_password",
                        )
                        throw ForbiddenException("Current password is missing or incorrect")
                    }
                }
                val updated = userService.updatePassword(route.parent.id, hashPassword(req.password))
                if (updated == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                } else {
                    audit(
                        "password.changed",
                        "targetUserId" to route.parent.id.toLong(),
                        "byUserId" to caller.userId.toLong(),
                        "selfChange" to (caller.userId == route.parent.id),
                    )
                    call.respond(HttpStatusCode.NoContent)
                }
            }
            delete<Users.Id> { route ->
                val caller = call.caller()
                requireAdmin(caller)
                if (userService.delete(route.id) == 0) {
                    call.respondProblem(HttpStatusCode.NotFound, "User not found")
                } else {
                    audit(
                        "user.deleted",
                        "byUserId" to caller.userId.toLong(),
                        "targetUserId" to route.id.toLong(),
                    )
                    call.respond(HttpStatusCode.NoContent)
                }
            }
        }
    }
}
