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
import java.util.UUID
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
        // Omitted by default, so EVERY test here doubles as the missing-claim case: a
        // pre-feature-flags token must keep authenticating (the permissive V46 choice).
        disabledFeatures: Array<String>? = null,
        // Present by default — every token Lettuce mints carries one, and the verifier rejects a
        // token without it (v4.5.2), so the claim-shape cases below must not fail for that reason.
        jti: String? = UUID.randomUUID().toString(),
        expiresAt: Date? = Date(System.currentTimeMillis() + 60_000),
    ): String {
        var builder = JWT.create()
            .withAudience("lettuce-api")
            .withIssuer("http://0.0.0.0:8080/")
            .withClaim("typ", "access")
        if (email != null) builder = builder.withClaim("email", email)
        if (userId != null) builder = builder.withClaim("userId", userId)
        if (roles != null) builder = builder.withArrayClaim("roles", roles)
        if (legacyRole != null) builder = builder.withClaim("role", legacyRole)
        if (disabledFeatures != null) builder = builder.withArrayClaim("disabledFeatures", disabledFeatures)
        if (jti != null) builder = builder.withJWTId(jti)
        if (expiresAt != null) builder = builder.withExpiresAt(expiresAt)
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
    fun `token minted before feature flags - no disabledFeatures claim - still authenticates`() = testApplication {
        // The permissive mirror of the roles cases: outstanding tokens must survive the V46
        // deploy, so a missing claim means "all features enabled", never a 401.
        usePostgresTestcontainer()
        val response = jsonClient().get("/api/v1/notifications") {
            header(HttpHeaders.Authorization, "Bearer ${mintToken()}")
        }
        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `token with an unknown feature in the disabled set is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        assertRejected(mintToken(disabledFeatures = arrayOf("WIZARDRY")))
    }

    @Test
    fun `token with an empty roles set authenticates as a regular user`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().get("/api/v1/notifications") {
            header(HttpHeaders.Authorization, "Bearer ${mintToken(roles = arrayOf())}")
        }
        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `a correctly signed access token without a jti is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        // Could never be blocklisted, so logout/revocation could not end it (v4.5.2).
        assertRejected(mintToken(jti = null))
    }

    @Test
    fun `a correctly signed access token without an exp is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        // java-jwt checks expiry only when the claim is present: without the rule it never expires.
        assertRejected(mintToken(expiresAt = null))
    }
}
