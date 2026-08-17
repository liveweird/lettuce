package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.auth.LogoutRequest
import ch.nokillswit.auth.RefreshRequest
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.Date
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * The refresh-token flow: POST /api/v1/refresh exchanges a valid refresh token for a fresh access +
 * refresh pair (pure-sliding), rejects anything that is not a live refresh token, and honours the
 * logout revocation. The `typ` claim keeps access and refresh tokens from being used interchangeably.
 */
class RefreshTest {


    private suspend fun loginBody(client: HttpClient, email: String, password: String): LoginResponse =
        client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body()

    private suspend fun postRefresh(client: HttpClient, refreshToken: String) =
        client.post("/api/v1/refresh") {
            contentType(ContentType.Application.Json)
            setBody(RefreshRequest(refreshToken))
        }

    // A refresh token minted directly (valid signature/audience/issuer) so expiry can be controlled.
    private fun mintRefresh(userId: Long, expiresAt: Date, typ: String = "refresh"): String =
        JWT.create()
            .withAudience("lettuce-api")
            .withIssuer("http://0.0.0.0:8080/")
            .withJWTId(UUID.randomUUID().toString())
            .withClaim("email", "x@test")
            .withClaim("userId", userId)
            .withArrayClaim("roles", arrayOf<String>())
            .withClaim("typ", typ)
            .withExpiresAt(expiresAt)
            .sign(Algorithm.HMAC256("secret"))

    @Test
    fun `login returns an access plus refresh pair with the refresh outliving the access`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("pair")
        TestUsers.seed(email = email, password = "pw")

        val before = System.currentTimeMillis()
        val body = loginBody(jsonClient(), email, "pw")

        assertTrue(body.token.isNotBlank())
        assertTrue(body.refreshToken.isNotBlank())
        assertNotEquals(body.token, body.refreshToken)
        assertTrue(body.expiresAt > before)
        assertTrue(body.refreshExpiresAt > body.expiresAt, "refresh token should outlive the access token")
    }

    @Test
    fun `refresh issues a new working pair and leaves the presented refresh token valid`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("refresh-ok")
        val userId = TestUsers.seed(email = email, password = "pw")
        val client = jsonClient()
        val first = loginBody(client, email, "pw")

        val refreshed = postRefresh(client, first.refreshToken)
        assertEquals(HttpStatusCode.OK, refreshed.status)
        val body = refreshed.body<LoginResponse>()
        assertNotEquals(first.refreshToken, body.refreshToken, "a fresh refresh token is minted")
        // Roles are re-read from the DB on every refresh (the seed helper defaults to ADMIN).
        assertEquals(listOf(ch.nokillswit.users.UserRole.ADMIN), body.roles)
        // The language is re-read too (V61) — an admin change propagates at the next refresh.
        assertEquals(1, TestServices.users.setLanguage(userId, "pl"))
        assertEquals("pl", postRefresh(client, body.refreshToken).body<LoginResponse>().language)

        // The new access token authenticates a protected route.
        val authed = client.get("/api/v1/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer ${body.token}")
        }
        assertEquals(HttpStatusCode.OK, authed.status)

        // Pure-sliding without rotation: the old refresh token is still usable until its own expiry.
        assertEquals(HttpStatusCode.OK, postRefresh(client, first.refreshToken).status)
    }

    @Test
    fun `refresh rejects an access token presented as the refresh token`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("refresh-typ")
        TestUsers.seed(email = email, password = "pw")
        val client = jsonClient()
        val first = loginBody(client, email, "pw")

        // The access token has a valid signature but typ=access, so /refresh must reject it.
        assertEquals(HttpStatusCode.Unauthorized, postRefresh(client, first.token).status)
    }

    @Test
    fun `a refresh token is rejected as an API bearer`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("bearer-typ")
        val userId = TestUsers.seed(email = email, password = "pw")
        val client = jsonClient()
        val first = loginBody(client, email, "pw")

        val res = client.get("/api/v1/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer ${first.refreshToken}")
        }
        assertEquals(HttpStatusCode.Unauthorized, res.status)
    }

    @Test
    fun `refresh rejects an expired refresh token`() = testApplication {
        usePostgresTestcontainer()
        val userId = TestUsers.seed(email = uniqueEmail("refresh-exp"), password = "pw")
        val expired = mintRefresh(userId.toLong(), Date(System.currentTimeMillis() - 60_000))

        assertEquals(HttpStatusCode.Unauthorized, postRefresh(jsonClient(), expired).status)
    }

    @Test
    fun `logout revokes the refresh token so it cannot be refreshed`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("refresh-logout")
        TestUsers.seed(email = email, password = "pw")
        val client = jsonClient()
        val first = loginBody(client, email, "pw")

        val logout = client.post("/api/v1/logout") {
            header(HttpHeaders.Authorization, "Bearer ${first.token}")
            contentType(ContentType.Application.Json)
            setBody(LogoutRequest(first.refreshToken))
        }
        assertEquals(HttpStatusCode.NoContent, logout.status)

        assertEquals(HttpStatusCode.Unauthorized, postRefresh(client, first.refreshToken).status)
    }

    @Test
    fun `refresh rejects a soft-deleted user's token`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("refresh-deleted")
        val userId = TestUsers.seed(email = email, password = "pw")
        val client = jsonClient()
        val first = loginBody(client, email, "pw")

        TestServices.users.delete(userId)

        assertEquals(HttpStatusCode.Unauthorized, postRefresh(client, first.refreshToken).status)
    }

    @Test
    fun `refresh rejects a deactivated user's token, and reactivation restores it`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("refresh-deactivated")
        val userId = TestUsers.seed(email = email, password = "pw")
        val client = jsonClient()
        val first = loginBody(client, email, "pw")

        TestServices.users.setDeactivated(userId, true)
        assertEquals(HttpStatusCode.Unauthorized, postRefresh(client, first.refreshToken).status)

        // Reversibility: the same (still unexpired) refresh token works again after reactivation.
        TestServices.users.setDeactivated(userId, false)
        assertEquals(HttpStatusCode.OK, postRefresh(client, first.refreshToken).status)
    }
}
