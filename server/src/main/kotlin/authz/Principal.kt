package ch.nokillswit.authz

import ch.nokillswit.users.UserRole
import io.ktor.server.application.ApplicationCall
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal

data class CallerPrincipal(
    val userId: UInt,
    val email: String,
    val role: UserRole,
)

fun ApplicationCall.caller(): CallerPrincipal {
    val principal = principal<JWTPrincipal>()
        ?: throw UnauthorizedException()
    val email = principal.payload.getClaim("email").asString()
        ?: throw UnauthorizedException("Missing email claim")
    val userIdLong = principal.payload.getClaim("userId").asLong()
        ?: throw UnauthorizedException("Missing userId claim")
    val roleName = principal.payload.getClaim("role").asString()
        ?: throw UnauthorizedException("Missing role claim")
    val role = runCatching { UserRole.valueOf(roleName) }
        .getOrElse { throw UnauthorizedException("Unknown role $roleName") }
    return CallerPrincipal(userId = userIdLong.toUInt(), email = email, role = role)
}
