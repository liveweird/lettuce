package ch.nokillswit.auth

import ch.nokillswit.authz.UnauthorizedException
import ch.nokillswit.plugins.JwtConfig
import ch.nokillswit.plugins.JwtConfigKey
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserServiceKey
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import com.auth0.jwt.exceptions.JWTVerificationException
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
import io.ktor.server.request.receiveNullable
import io.ktor.server.response.respond
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import kotlin.time.Duration.Companion.seconds

private const val LOGIN_RATE_LIMIT = "login"
private const val REFRESH_RATE_LIMIT = "refresh"

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class LogoutRequest(val refreshToken: String? = null)

@Serializable
data class LoginResponse(
    val token: String,
    val expiresAt: Long,
    val refreshToken: String,
    val refreshExpiresAt: Long,
    val userId: UInt,
    val role: UserRole,
)

private fun JwtConfig.authResponse(userId: UInt, email: String, role: UserRole): LoginResponse {
    val access = issueAccessToken(userId, email, role)
    val refresh = issueRefreshToken(userId, email, role)
    return LoginResponse(
        token = access.token,
        expiresAt = access.expiresAt,
        refreshToken = refresh.token,
        refreshExpiresAt = refresh.expiresAt,
        userId = userId,
        role = role,
    )
}

fun Application.configureAuthRoutes() {
    val jwtConfig = attributes[JwtConfigKey]
    val userService = attributes[UserServiceKey]
    val blocklist = attributes[TokenBlocklistServiceKey]

    // Verifies signature/issuer/audience/expiry of a presented refresh token. Same secret as the
    // access-token verifier in configureSecurity; the `typ` claim is checked separately below.
    val refreshVerifier = JWT.require(Algorithm.HMAC256(jwtConfig.secret))
        .withAudience(jwtConfig.audience)
        .withIssuer(jwtConfig.issuer)
        .build()

    // Throttle login to blunt password brute-forcing, and refresh to blunt token abuse: a token
    // bucket per client host.
    install(RateLimit) {
        register(RateLimitName(LOGIN_RATE_LIMIT)) {
            rateLimiter(limit = 10, refillPeriod = 60.seconds)
            requestKey { call -> call.request.origin.remoteHost }
        }
        register(RateLimitName(REFRESH_RATE_LIMIT)) {
            rateLimiter(limit = 30, refillPeriod = 60.seconds)
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
                call.respond(jwtConfig.authResponse(userId, user.email, user.role))
            }
        }
        rateLimit(RateLimitName(REFRESH_RATE_LIMIT)) {
            // Not behind `authenticate`: the access token may already be expired here. Pure-sliding —
            // a fresh pair is minted and the old tokens are left to expire on their own (not revoked).
            post("/api/v1/refresh") {
                val req = call.receive<RefreshRequest>()
                val decoded = try {
                    refreshVerifier.verify(req.refreshToken)
                } catch (_: JWTVerificationException) {
                    throw UnauthorizedException("Invalid or expired refresh token")
                }
                if (decoded.getClaim("typ").asString() != TOKEN_TYPE_REFRESH) {
                    throw UnauthorizedException("Not a refresh token")
                }
                val jti = decoded.id
                if (jti != null && blocklist.isRevoked(jti)) {
                    throw UnauthorizedException("Refresh token revoked")
                }
                val userId = decoded.getClaim("userId").asLong()?.toUInt()
                    ?: throw UnauthorizedException("Malformed refresh token")
                // One read: confirm the user still exists and isn't soft-deleted, and pick up their
                // current role/email so changes take effect on the next refresh.
                val user = userService.read(userId)
                    ?: throw UnauthorizedException("User no longer exists")
                // A password change invalidates all refresh tokens minted before it (tokens
                // without an iat claim predate this scheme and count as minted at epoch 0).
                // JWT iat has SECOND precision, so compare both sides truncated to seconds —
                // otherwise a token minted in the same second as the change is falsely rejected.
                val issuedAtSec = (decoded.issuedAt?.time ?: 0) / 1000
                if (issuedAtSec < user.passwordChangedAt / 1000) {
                    throw UnauthorizedException("Refresh token predates a password change")
                }
                call.respond(jwtConfig.authResponse(userId, user.email, user.role))
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
                // Also revoke the refresh token, if the client sent it, so an explicit logout kills it
                // too (rotation leaves superseded tokens alive, but logout is a deliberate revoke).
                val body = runCatching { call.receiveNullable<LogoutRequest>() }.getOrNull()
                body?.refreshToken?.let { rt ->
                    runCatching { refreshVerifier.verify(rt) }.getOrNull()?.let { decoded ->
                        val rjti = decoded.id
                        val rexp = decoded.expiresAt?.time ?: System.currentTimeMillis()
                        if (rjti != null) blocklist.revoke(rjti, rexp)
                    }
                }
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
