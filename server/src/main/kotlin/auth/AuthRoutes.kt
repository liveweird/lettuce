package ch.nokillswit.auth

import ch.nokillswit.audit.audit
import ch.nokillswit.authz.UnauthorizedException
import ch.nokillswit.plugins.JwtConfig
import ch.nokillswit.plugins.JwtConfigKey
import ch.nokillswit.plugins.respondProblem
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

    // Per-account lockout, complementing the per-IP RateLimit below (which rotating hosts
    // sidestep): N consecutive failures for one email → locked for the configured window.
    val loginThrottle = LoginThrottle(
        threshold = environment.config.property("security.lockout.threshold").getString().toInt(),
        lockoutMillis = environment.config.property("security.lockout.durationSeconds").getString().toLong() * 1000,
    )

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
                if (loginThrottle.isLocked(req.email)) {
                    audit("login.rejected_locked", "email" to req.email)
                    call.respondProblem(
                        HttpStatusCode.TooManyRequests,
                        "Too many failed login attempts for this account — try again later",
                    )
                    return@post
                }
                val record = userService.findWithIdByEmail(req.email)
                if (record == null || !verifyPassword(req.password, record.second.passwordHash)) {
                    val tripped = loginThrottle.recordFailure(req.email)
                    audit(
                        "login.failure",
                        "email" to req.email,
                        "reason" to if (record == null) "unknown_email" else "wrong_password",
                    )
                    if (tripped) audit("login.lockout", "email" to req.email)
                    throw UnauthorizedException("Unknown email or wrong password")
                }
                loginThrottle.recordSuccess(req.email)
                val (userId, user) = record
                audit("login.success", "email" to user.email, "userId" to userId.toLong())
                call.respond(jwtConfig.authResponse(userId, user.email, user.role))
            }
        }
        rateLimit(RateLimitName(REFRESH_RATE_LIMIT)) {
            // Not behind `authenticate`: the access token may already be expired here. Pure-sliding —
            // a fresh pair is minted and the old tokens are left to expire on their own (not revoked).
            post("/api/v1/refresh") {
                val req = call.receive<RefreshRequest>()
                fun reject(reason: String, userId: Long? = null): Nothing {
                    audit("refresh.rejected", "reason" to reason, "userId" to userId)
                    throw UnauthorizedException(
                        when (reason) {
                            "invalid_or_expired" -> "Invalid or expired refresh token"
                            "wrong_token_type" -> "Not a refresh token"
                            "revoked" -> "Refresh token revoked"
                            "malformed" -> "Malformed refresh token"
                            "user_gone" -> "User no longer exists"
                            else -> "Refresh token predates a password change"
                        }
                    )
                }

                val decoded = try {
                    refreshVerifier.verify(req.refreshToken)
                } catch (_: JWTVerificationException) {
                    reject("invalid_or_expired")
                }
                if (decoded.getClaim("typ").asString() != TOKEN_TYPE_REFRESH) {
                    reject("wrong_token_type")
                }
                val rawUserId = decoded.getClaim("userId").asLong()
                val jti = decoded.id
                if (jti != null && blocklist.isRevoked(jti)) {
                    reject("revoked", rawUserId)
                }
                val userId = rawUserId?.toUInt() ?: reject("malformed")
                // One read: confirm the user still exists and isn't soft-deleted, and pick up their
                // current role/email so changes take effect on the next refresh.
                val user = userService.read(userId)
                    ?: reject("user_gone", rawUserId)
                // A password change invalidates all refresh tokens minted before it (tokens
                // without an iat claim predate this scheme and count as minted at epoch 0).
                // JWT iat has SECOND precision, so compare both sides truncated to seconds —
                // otherwise a token minted in the same second as the change is falsely rejected.
                val issuedAtSec = (decoded.issuedAt?.time ?: 0) / 1000
                if (issuedAtSec < user.passwordChangedAt / 1000) {
                    reject("predates_password_change", rawUserId)
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
                audit(
                    "logout",
                    "userId" to principal.payload.getClaim("userId").asLong(),
                    "email" to principal.payload.getClaim("email").asString(),
                )
                call.respond(HttpStatusCode.NoContent)
            }
        }
    }
}
