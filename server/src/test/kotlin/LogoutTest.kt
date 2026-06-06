package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.auth.TokenBlocklistService.RevokedTokens
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
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertNotNull
import kotlinx.coroutines.flow.firstOrNull
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

class LogoutTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private suspend fun login(client: io.ktor.client.HttpClient, email: String, password: String): String =
        client.post("/api/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body<LoginResponse>().token

    @Test
    fun `logout with valid token returns 204`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("logout-ok")
        TestUsers.seed(email = email, password = "pw")

        val client = jsonClient()
        val token = login(client, email, "pw")

        val response = client.post("/api/logout") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }

        assertEquals(HttpStatusCode.NoContent, response.status)
    }

    @Test
    fun `revoked token is rejected on protected route`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("logout-revoke")
        val userId = TestUsers.seed(email = email, password = "pw")

        val client = jsonClient()
        val token = login(client, email, "pw")

        val before = client.get("/api/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.OK, before.status)

        val logout = client.post("/api/logout") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.NoContent, logout.status)

        val after = client.get("/api/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
        assertEquals(HttpStatusCode.Unauthorized, after.status)
    }

    @Test
    fun `logout without auth returns 401`() = testApplication {
        usePostgresTestcontainer()

        val response = jsonClient().post("/api/logout")

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `revoking one token does not affect a parallel token for the same user`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("multi-session")
        val userId = TestUsers.seed(email = email, password = "pw")

        val client = jsonClient()
        val tokenA = login(client, email, "pw")
        val tokenB = login(client, email, "pw")

        val logout = client.post("/api/logout") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.NoContent, logout.status)

        val afterA = client.get("/api/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer $tokenA")
        }
        assertEquals(HttpStatusCode.Unauthorized, afterA.status)

        val afterB = client.get("/api/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer $tokenB")
        }
        assertEquals(HttpStatusCode.OK, afterB.status)
    }

    @Test
    fun `re-login after logout produces a working token`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("relogin")
        val userId = TestUsers.seed(email = email, password = "pw")

        val client = jsonClient()
        val first = login(client, email, "pw")
        client.post("/api/logout") { header(HttpHeaders.Authorization, "Bearer $first") }

        val second = login(client, email, "pw")
        assertNotNull(second)

        val response = client.get("/api/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer $second")
        }
        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `revoke purges entries past their expiry`() = testApplication {
        usePostgresTestcontainer()

        val staleJti = UUID.randomUUID().toString()
        val freshJti = UUID.randomUUID().toString()
        val pastExpiry = System.currentTimeMillis() - 60_000
        val futureExpiry = System.currentTimeMillis() + 60_000

        TestBlocklist.service.revoke(staleJti, pastExpiry)
        assertEquals(true, TestBlocklist.service.isRevoked(staleJti))

        TestBlocklist.service.revoke(freshJti, futureExpiry)

        val staleRow = suspendTransaction(TestBlocklist.service.database) {
            RevokedTokens.selectAll().where { RevokedTokens.jti eq staleJti }.firstOrNull()
        }
        assertNull(staleRow, "stale entry should have been purged on the next revoke() call")
        assertEquals(true, TestBlocklist.service.isRevoked(freshJti))
    }
}
