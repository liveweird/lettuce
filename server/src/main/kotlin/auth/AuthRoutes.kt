package ch.nokillswit.auth

import ch.nokillswit.plugins.JwtConfigKey
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserServiceKey
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.auth.authenticate
import io.ktor.server.auth.jwt.JWTPrincipal
import io.ktor.server.auth.principal
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import java.util.Date
import java.util.UUID

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class LoginResponse(
    val token: String,
    val expiresAt: Long,
    val userId: UInt,
    val role: UserRole,
)

fun Application.configureAuthRoutes() {
    val jwtConfig = attributes[JwtConfigKey]
    val userService = attributes[UserServiceKey]
    val blocklist = attributes[TokenBlocklistServiceKey]

    routing {
        post("/login") {
            val req = call.receive<LoginRequest>()
            val record = userService.findWithIdByEmail(req.email)
            if (record == null || !verifyPassword(req.password, record.second.passwordHash)) {
                call.respond(HttpStatusCode.Unauthorized)
                return@post
            }
            val (userId, user) = record
            val expiresAt = System.currentTimeMillis() + jwtConfig.expiresInSeconds * 1000
            val token = JWT.create()
                .withAudience(jwtConfig.audience)
                .withIssuer(jwtConfig.issuer)
                .withJWTId(UUID.randomUUID().toString())
                .withClaim("email", user.email)
                .withClaim("userId", userId.toLong())
                .withClaim("role", user.role.name)
                .withExpiresAt(Date(expiresAt))
                .sign(Algorithm.HMAC256(jwtConfig.secret))
            call.respond(LoginResponse(token = token, expiresAt = expiresAt, userId = userId, role = user.role))
        }
        authenticate {
            post("/logout") {
                val principal = call.principal<JWTPrincipal>()!!
                val jti = principal.payload.id
                val exp = principal.payload.expiresAt?.time ?: System.currentTimeMillis()
                if (jti != null) {
                    blocklist.revoke(jti, exp)
                }
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
