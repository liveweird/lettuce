package ch.nokillswit.auth

import ch.nokillswit.authz.UnauthorizedException
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
import io.ktor.server.plugins.origin
import io.ktor.server.plugins.ratelimit.RateLimit
import io.ktor.server.plugins.ratelimit.RateLimitName
import io.ktor.server.plugins.ratelimit.rateLimit
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import java.util.Date
import java.util.UUID
import kotlin.time.Duration.Companion.seconds

private const val LOGIN_RATE_LIMIT = "login"

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

    // Throttle login to blunt password brute-forcing: a token bucket per client host.
    install(RateLimit) {
        register(RateLimitName(LOGIN_RATE_LIMIT)) {
            rateLimiter(limit = 10, refillPeriod = 60.seconds)
            requestKey { call -> call.request.origin.remoteHost }
        }
    }

    routing {
        rateLimit(RateLimitName(LOGIN_RATE_LIMIT)) {
            post("/api/v1/login") {
                val req = call.receive<LoginRequest>()
                val record = userService.findWithIdByEmail(req.email)
                if (record == null || !verifyPassword(req.password, record.second.passwordHash)) {
                    throw UnauthorizedException("Unknown email or wrong password")
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
        }
        authenticate {
            post("/api/v1/logout") {
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
