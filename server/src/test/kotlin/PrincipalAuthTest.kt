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
        role: String? = "USER",
    ): String {
        var builder = JWT.create()
            .withAudience("lettuce-api")
            .withIssuer("http://0.0.0.0:8080/")
            .withExpiresAt(Date(System.currentTimeMillis() + 60_000))
        if (email != null) builder = builder.withClaim("email", email)
        if (userId != null) builder = builder.withClaim("userId", userId)
        if (role != null) builder = builder.withClaim("role", role)
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
    fun `token missing the role claim is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        assertRejected(mintToken(role = null))
    }

    @Test
    fun `token with an unknown role is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        assertRejected(mintToken(role = "WIZARD"))
    }
}
