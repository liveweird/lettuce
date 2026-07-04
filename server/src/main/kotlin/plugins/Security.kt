package ch.nokillswit.plugins

import ch.nokillswit.auth.TOKEN_TYPE_ACCESS
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
    val accessExpiresInSeconds: Long,
    val refreshExpiresInSeconds: Long,
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
        accessExpiresInSeconds = environment.config.property("jwt.accessExpiresInSeconds").getString().toLong(),
        refreshExpiresInSeconds = environment.config.property("jwt.refreshExpiresInSeconds").getString().toLong(),
    )
    // Fail closed: a blank secret, the placeholder "secret", or the repo-committed demo key lets
    // anyone forge tokens for any user/role. Allowed (with a loud warning) only in development;
    // rejected at startup in production.
    val burnedSecrets = setOf(
        "secret",
        // Committed to docker-compose.yaml for the local clone-&-run demo — public, thus burned.
        "dev-only-9f3c1a7b2e8d4655b0c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f60718293a4b5c6d",
        // The k8s/secret.yaml template placeholder — applying the template verbatim must not boot.
        "CHANGE-ME-openssl-rand-hex-32",
    )
    if (jwtConfig.secret.isBlank() || jwtConfig.secret in burnedSecrets) {
        val message = "JWT secret is unset or a publicly known value — set a strong, private JWT_SECRET."
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
                // Only access tokens authenticate API calls; a refresh token used as a bearer is rejected.
                val typOk = credential.payload.getClaim("typ").asString() == TOKEN_TYPE_ACCESS
                val jti = credential.payload.id
                val revoked = jti != null && application.attributes[TokenBlocklistServiceKey].isRevoked(jti)
                if (audOk && typOk && !revoked) JWTPrincipal(credential.payload) else null
            }
            // The challenge runs outside StatusPages, so emit the RFC 7807 body here too.
            challenge { _, _ ->
                call.respondProblem(HttpStatusCode.Unauthorized, "Missing or invalid bearer token")
            }
        }
    }
}
