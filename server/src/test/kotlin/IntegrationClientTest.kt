package ch.nokillswit

import ch.nokillswit.auth.API_KEY_PREFIX
import ch.nokillswit.integration.IntegrationClientCreateResponse
import ch.nokillswit.integration.IntegrationClientListResponse
import ch.nokillswit.integration.IntegrationClientRequest
import ch.nokillswit.integration.IntegrationClientResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The integration-client registry (v3.0.0): ADMIN-only CRUD including reads (the alerts
 * posture), the show-the-key-once create, and the terminal revoke. The GraphQL endpoint the
 * keys authenticate is covered by IntegrationGraphQlTest.
 */
class IntegrationClientTest {

    private fun uniqueName(prefix: String) = "$prefix-${UUID.randomUUID()}"

    // Audit ids are logged as Longs; the shared hasKeyValue helper compares Strings only.
    private fun ch.qos.logback.classic.spi.ILoggingEvent.hasLongValue(key: String, value: Long) =
        keyValuePairs?.any { it.key == key && it.value == value } == true

    private suspend fun HttpClient.createClient(name: String): HttpResponse =
        post("/api/v1/integration-clients") {
            contentType(ContentType.Application.Json)
            setBody(IntegrationClientRequest(name = name))
        }

    @Test
    fun `admin can create, read, list, and revoke an integration client`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("intc-admin")
        TestUsers.seed(adminEmail, "pw", name = "Int Admin")
        val admin = authedClient(adminEmail, "pw")
        val name = uniqueName("intc")

        val created = admin.createClient(name)
        assertEquals(HttpStatusCode.Created, created.status)
        val body = created.body<IntegrationClientCreateResponse>()
        assertTrue(body.apiKey.startsWith(API_KEY_PREFIX))
        assertEquals(name, body.client.name)
        assertEquals("Int Admin", body.client.createdByName)
        assertFalse(body.client.revoked)
        assertNull(body.client.lastUsedAt)
        assertEquals("/api/v1/integration-clients/${body.client.id}", created.headers[HttpHeaders.Location])

        // The single GET and the list never carry the key — it existed once, in the create body.
        val fetched = admin.get("/api/v1/integration-clients/${body.client.id}")
        assertEquals(HttpStatusCode.OK, fetched.status)
        assertEquals(name, fetched.body<IntegrationClientResponse>().name)
        val listed = admin.get("/api/v1/integration-clients").body<IntegrationClientListResponse>()
        assertNotNull(listed.items.find { it.id == body.client.id })

        // Revoke: terminal, idempotence-guarded (repeat → 409), row stays listed as revoked.
        assertEquals(
            HttpStatusCode.NoContent,
            admin.post("/api/v1/integration-clients/${body.client.id}/revoke").status,
        )
        assertEquals(
            HttpStatusCode.Conflict,
            admin.post("/api/v1/integration-clients/${body.client.id}/revoke").status,
        )
        val revoked = admin.get("/api/v1/integration-clients/${body.client.id}")
            .body<IntegrationClientResponse>()
        assertTrue(revoked.revoked)
        assertNotNull(revoked.revokedAt)
    }

    @Test
    fun `unknown client ids answer 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("intc-404")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        assertEquals(HttpStatusCode.NotFound, admin.get("/api/v1/integration-clients/999999999").status)
        assertEquals(HttpStatusCode.NotFound, admin.post("/api/v1/integration-clients/999999999/revoke").status)
    }

    @Test
    fun `unauthenticated requests return 401`() = testApplication {
        usePostgresTestcontainer()
        val plain = jsonClient()
        assertEquals(HttpStatusCode.Unauthorized, plain.get("/api/v1/integration-clients").status)
        assertEquals(HttpStatusCode.Unauthorized, plain.createClient("x").status)
        assertEquals(HttpStatusCode.Unauthorized, plain.post("/api/v1/integration-clients/1/revoke").status)
    }

    @Test
    fun `non-admins including HR get 403 on every route`() = testApplication {
        usePostgresTestcontainer()
        val userEmail = uniqueEmail("intc-user")
        val hrEmail = uniqueEmail("intc-hr")
        TestUsers.seed(userEmail, "pw", roles = emptySet())
        TestUsers.seed(hrEmail, "pw", roles = setOf(UserRole.HR))
        for (client in listOf(authedClient(userEmail, "pw"), authedClient(hrEmail, "pw"))) {
            assertEquals(HttpStatusCode.Forbidden, client.get("/api/v1/integration-clients").status)
            assertEquals(HttpStatusCode.Forbidden, client.createClient(uniqueName("intc-deny")).status)
            assertEquals(HttpStatusCode.Forbidden, client.get("/api/v1/integration-clients/1").status)
            assertEquals(HttpStatusCode.Forbidden, client.post("/api/v1/integration-clients/1/revoke").status)
        }
    }

    @Test
    fun `client names are validated up-front`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("intc-val")
        TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        assertEquals(HttpStatusCode.BadRequest, admin.createClient("   ").status)
        assertEquals(HttpStatusCode.BadRequest, admin.createClient("x".repeat(101)).status)
        assertEquals(HttpStatusCode.BadRequest, admin.createClient("badname").status)
    }

    @Test
    fun `create and revoke are audited`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("intc-audit")
        val adminId = TestUsers.seed(adminEmail, "pw")
        val admin = authedClient(adminEmail, "pw")
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            val name = uniqueName("intc-audit")
            val clientId = admin.createClient(name).body<IntegrationClientCreateResponse>().client.id
            admin.post("/api/v1/integration-clients/$clientId/revoke")

            val created = appender.events.find {
                it.message == "integration_client.created" && it.hasLongValue("clientId", clientId.toLong())
            }
            assertNotNull(created, "expected an integration_client.created audit event")
            assertTrue(created.hasLongValue("byUserId", adminId.toLong()))
            assertTrue(created.hasKeyValue("name", name))
            val revoked = appender.events.find {
                it.message == "integration_client.revoked" && it.hasLongValue("clientId", clientId.toLong())
            }
            assertNotNull(revoked, "expected an integration_client.revoked audit event")
        } finally {
            appender.detach()
        }
    }
}
