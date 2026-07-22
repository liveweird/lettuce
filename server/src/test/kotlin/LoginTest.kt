package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.users.UserResponse
import com.auth0.jwt.JWT
import com.auth0.jwt.algorithms.Algorithm
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
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class LoginTest {


    @Test
    fun `login returns 200 with token and future expiresAt`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("alice")
        TestUsers.seed(email = email, password = "correct-horse")

        val before = System.currentTimeMillis()
        val response = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "correct-horse"))
        }

        assertEquals(HttpStatusCode.OK, response.status)
        val body = response.body<LoginResponse>()
        assertTrue(body.token.isNotBlank())
        assertTrue(body.expiresAt > before, "expiresAt should be in the future, got ${body.expiresAt}")
    }

    @Test
    fun `token has expected claims and verifies with the configured secret`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("bob")
        TestUsers.seed(email = email, password = "pw")

        val token = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw"))
        }.body<LoginResponse>().token

        val decoded = JWT.require(Algorithm.HMAC256("secret"))
            .withAudience("lettuce-api")
            .withIssuer("http://0.0.0.0:8080/")
            .build()
            .verify(token)

        assertEquals(email, decoded.getClaim("email").asString())
        assertNotNull(decoded.id, "token should carry a jti claim for revocation support")
    }

    @Test
    fun `returned token grants access to GET users id`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("carol")
        val userId = TestUsers.seed(email = email, password = "pw")

        val client = jsonClient()
        val token = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw"))
        }.body<LoginResponse>().token

        val response = client.get("/api/v1/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(email, response.body<UserResponse>().email)
    }

    @Test
    fun `wrong password returns 401`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("dave")
        TestUsers.seed(email = email, password = "right-pw")

        val response = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "wrong-pw"))
        }

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `over-long password on an existing account returns 401 - not a 500 enumeration oracle`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("longpw")
        TestUsers.seed(email = email, password = "right-pw")

        // Over bcrypt's 72-byte limit the hasher throws; verifyPassword must treat it as
        // non-matching, or the 500 (existing account) vs 401 (unknown email) difference
        // would disclose account existence.
        val response = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "x".repeat(200)))
        }

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `repeated login attempts are rate limited with 429`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        // The login route allows 10 attempts/min per host; the 11th is throttled before the handler.
        val statuses = (1..11).map {
            client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(uniqueEmail("brute"), "nope"))
            }.status
        }
        assertTrue(
            statuses.take(10).all { it == HttpStatusCode.Unauthorized },
            "first 10 attempts should be processed (401), got $statuses",
        )
        assertEquals(HttpStatusCode.TooManyRequests, statuses.last())
    }

    @Test
    fun `unknown email returns 401`() = testApplication {
        usePostgresTestcontainer()

        val response = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(uniqueEmail("ghost"), "anything"))
        }

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    private fun mintToken(
        secret: String = "secret",
        audience: String = "lettuce-api",
        issuer: String = "http://0.0.0.0:8080/",
        expiresAt: Date = Date(System.currentTimeMillis() + 60_000),
    ): String = JWT.create()
        .withAudience(audience)
        .withIssuer(issuer)
        .withExpiresAt(expiresAt)
        .sign(Algorithm.HMAC256(secret))

    @Test
    fun `tampered signature is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("tamper")
        val userId = TestUsers.seed(email = email, password = "pw")

        val token = mintToken(secret = "wrong-secret")
        val response = jsonClient().get("/api/v1/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `expired token is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("expired")
        val userId = TestUsers.seed(email = email, password = "pw")

        val token = mintToken(expiresAt = Date(System.currentTimeMillis() - 60_000))
        val response = jsonClient().get("/api/v1/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `token with wrong audience is rejected with 401`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("aud")
        val userId = TestUsers.seed(email = email, password = "pw")

        val token = mintToken(audience = "not-lettuce-api")
        val response = jsonClient().get("/api/v1/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `missing Authorization header returns 401`() = testApplication {
        usePostgresTestcontainer()

        val response = jsonClient().get("/api/v1/users/1")

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }
}
