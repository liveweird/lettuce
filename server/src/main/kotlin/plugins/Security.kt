package ch.nokillswit.plugins

import ch.nokillswit.auth.TokenBlocklistServiceKey
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import io.ktor.http.HttpStatusCode
import io.ktor.server.application.*
import io.ktor.server.auth.*
import io.ktor.server.auth.jwt.*
import io.ktor.server.plugins.csrf.*
import io.ktor.util.AttributeKey

data class JwtConfig(
    val secret: String,
    val issuer: String,
    val audience: String,
    val realm: String,
    val expiresInSeconds: Long,
)

val JwtConfigKey = AttributeKey<JwtConfig>("JwtConfig")

fun Application.configureSecurity() {
    if (environment.config.propertyOrNull("security.csrf.enabled")?.getString()?.toBoolean() != false) {
        install(CSRF) {
            allowOrigin("http://localhost:8080")
            originMatchesHost()
            checkHeader("X-CSRF-Token")
        }
    }
    val jwtConfig = JwtConfig(
        secret = environment.config.property("jwt.secret").getString(),
        issuer = environment.config.property("jwt.issuer").getString(),
        audience = environment.config.property("jwt.audience").getString(),
        realm = environment.config.property("jwt.realm").getString(),
        expiresInSeconds = environment.config.property("jwt.expiresInSeconds").getString().toLong(),
    )
    // Fail closed: a blank or the placeholder "secret" lets anyone forge tokens for any user/role.
    // Allowed (with a loud warning) only in development; rejected at startup in production.
    if (jwtConfig.secret.isBlank() || jwtConfig.secret == "secret") {
        val message = "JWT secret is unset or the insecure default — set a strong JWT_SECRET."
        if (developmentMode) log.warn("$message (permitted in development only)")
        else error(message)
    }
    attributes.put(JwtConfigKey, jwtConfig)
    authentication {
        jwt {
            realm = jwtConfig.realm
            verifier(
                JWT.require(Algorithm.HMAC256(jwtConfig.secret))
                    .withAudience(jwtConfig.audience)
                    .withIssuer(jwtConfig.issuer)
                    .build()
            )
            validate { credential ->
                val audOk = credential.payload.audience.contains(jwtConfig.audience)
                val jti = credential.payload.id
                val revoked = jti != null && application.attributes[TokenBlocklistServiceKey].isRevoked(jti)
                if (audOk && !revoked) JWTPrincipal(credential.payload) else null
            }
            // The challenge runs outside StatusPages, so emit the RFC 7807 body here too.
            challenge { _, _ ->
                call.respondProblem(HttpStatusCode.Unauthorized, "Missing or invalid bearer token")
            }
        }
    }
}
