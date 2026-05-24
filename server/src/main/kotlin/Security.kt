package ch.nokillswit

import io.ktor.server.application.*
import io.ktor.server.plugins.csrf.*
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import io.ktor.server.auth.*
import io.ktor.server.auth.jwt.*
import io.ktor.server.response.*
import io.ktor.server.sessions.*
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
    attributes.put(JwtConfigKey, jwtConfig)
    authentication {
        jwt {
            realm = jwtConfig.realm
            verifier(
                JWT
                    .require(Algorithm.HMAC256(jwtConfig.secret))
                    .withAudience(jwtConfig.audience)
                    .withIssuer(jwtConfig.issuer)
                    .build()
            )
            validate { credential ->
                if (credential.payload.audience.contains(jwtConfig.audience)) JWTPrincipal(credential.payload) else null
            }
        }
    }
    install(Sessions) {
        cookie<MySession>("MY_SESSION") {
            cookie.extensions["SameSite"] = "lax"
        }
    }
}
