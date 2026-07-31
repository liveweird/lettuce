package ch.nokillswit

import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.Date
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * `caller()` (authz/Principal.kt) parses the JWT claims into a [ch.nokillswit.authz.CallerPrincipal]
 * and throws [ch.nokillswit.authz.UnauthorizedException] -> 401 when a claim is missing or invalid.
 * The JWT `validate` block only checks audience + revocation, so a token with a valid
 * signature/issuer/audience but a missing/garbled claim still authenticates and reaches `caller()`.
 */
class PrincipalAuthTest {

    // Valid signature/audience/issuer; selectively omit/garble the custom claims caller() reads.
    private fun mintToken(
        email: String? = "user@test",
        userId: Long? = 1L,
        roles: Array<String>? = arrayOf(),
        legacyRole: String? = null,
    ): String {
        var builder = JWT.create()
            .withAudience("lettuce-api")
            .withIssuer("http://0.0.0.0:8080/")
            .withClaim("typ", "access")
            .withExpiresAt(Date(System.currentTimeMillis() + 60_000))
        if (email != null) builder = builder.withClaim("email", email)
        if (userId != null) builder = builder.withClaim("userId", userId)
        if (roles != null) builder = builder.withArrayClaim("roles", roles)
        if (legacyRole != null) builder = builder.withClaim("role", legacyRole)
        return builder.sign(Algorithm.HMAC256("secret"))
    }

    // Any authenticated endpoint runs caller(); /api/notifications needs no path param.
    private suspend fun ApplicationTestBuilder.assertRejected(token: String) {
        val response = jsonClient().get("/api/v1/notifications") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `token missing the email claim is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        assertRejected(mintToken(email = null))
    }

    @Test
    fun `token missing the userId claim is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        assertRejected(mintToken(userId = null))
    }

    @Test
    fun `token missing the roles claim is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        assertRejected(mintToken(roles = null))
    }

    @Test
    fun `pre-migration token carrying only the legacy role string claim is rejected with 401`() = testApplication {
        // A stale access token from before the roles-array change: the SPA recovers by
        // silently refreshing (the refresh flow re-reads roles from the DB).
        usePostgresTestcontainer()
        assertRejected(mintToken(roles = null, legacyRole = "ADMIN"))
    }

    @Test
    fun `token with an unknown role in the set is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        assertRejected(mintToken(roles = arrayOf("WIZARD")))
    }

    @Test
    fun `token with an empty roles set authenticates as a regular user`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().get("/api/v1/notifications") {
            header(HttpHeaders.Authorization, "Bearer ${mintToken(roles = arrayOf())}")
        }
        assertEquals(HttpStatusCode.OK, response.status)
    }
}
