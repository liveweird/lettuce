package ch.nokillswit

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.post
import io.ktor.server.routing.routing
import kotlinx.serialization.Serializable
import java.util.Date

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class LoginResponse(val token: String, val expiresAt: Long)

// Plug your hashing library (e.g. BCrypt/Argon2) in here.
private fun verifyPassword(plain: String, hash: String): Boolean =
    TODO("Implement password verification against the stored hash")

fun Application.configureAuth() {
    val jwtConfig = attributes[JwtConfigKey]
    val userService = attributes[UserServiceKey]

    routing {
        post("/login") {
            val req = call.receive<LoginRequest>()
            val user = userService.findByEmail(req.email)
            if (user == null || !verifyPassword(req.password, user.passwordHash)) {
                call.respond(HttpStatusCode.Unauthorized)
                return@post
            }
            val expiresAt = System.currentTimeMillis() + jwtConfig.expiresInSeconds * 1000
            val token = JWT.create()
                .withAudience(jwtConfig.audience)
                .withIssuer(jwtConfig.issuer)
                .withClaim("email", user.email)
                .withExpiresAt(Date(expiresAt))
                .sign(Algorithm.HMAC256(jwtConfig.secret))
            call.respond(LoginResponse(token = token, expiresAt = expiresAt))
        }
    }
}
