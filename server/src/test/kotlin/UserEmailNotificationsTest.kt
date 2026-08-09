package ch.nokillswit

import ch.nokillswit.users.UserEmailNotificationsUpdateRequest
import ch.nokillswit.users.UserResponse
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/** PUT /api/v1/users/{id}/email-notifications — the V51 email-mirror opt-out toggle. */
class UserEmailNotificationsTest {

    @Test
    fun `self-service opt-out round-trips and defaults to enabled`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("toggle-self")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val client = authedClient(email, "pw")

        // Default on: every account starts with the mirror enabled.
        assertTrue(client.get("/api/v1/users/$userId").body<UserResponse>().emailNotificationsEnabled)

        val response = client.put("/api/v1/users/$userId/email-notifications") {
            contentType(ContentType.Application.Json)
            setBody(UserEmailNotificationsUpdateRequest(enabled = false))
        }
        assertEquals(HttpStatusCode.NoContent, response.status)
        assertFalse(client.get("/api/v1/users/$userId").body<UserResponse>().emailNotificationsEnabled)

        // Idempotent: the same value again is 204, not 409.
        val again = client.put("/api/v1/users/$userId/email-notifications") {
            contentType(ContentType.Application.Json)
            setBody(UserEmailNotificationsUpdateRequest(enabled = false))
        }
        assertEquals(HttpStatusCode.NoContent, again.status)
    }

    @Test
    fun `admin may toggle another user, a regular user may not`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("toggle-admin")
        val strangerEmail = uniqueEmail("toggle-stranger")
        val targetEmail = uniqueEmail("toggle-target")
        TestUsers.seed(email = adminEmail, password = "pw")
        TestUsers.seed(email = strangerEmail, password = "pw", roles = emptySet())
        val targetId = TestUsers.seed(email = targetEmail, password = "pw", roles = emptySet())

        val denied = authedClient(strangerEmail, "pw").put("/api/v1/users/$targetId/email-notifications") {
            contentType(ContentType.Application.Json)
            setBody(UserEmailNotificationsUpdateRequest(enabled = false))
        }
        assertEquals(HttpStatusCode.Forbidden, denied.status)

        val allowed = authedClient(adminEmail, "pw").put("/api/v1/users/$targetId/email-notifications") {
            contentType(ContentType.Application.Json)
            setBody(UserEmailNotificationsUpdateRequest(enabled = false))
        }
        assertEquals(HttpStatusCode.NoContent, allowed.status)
        assertFalse(TestServices.users.read(targetId)!!.emailNotificationsEnabled)
    }

    @Test
    fun `unknown and soft-deleted targets are 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("toggle-404")
        TestUsers.seed(email = adminEmail, password = "pw")
        val deletedId = TestUsers.seed(email = uniqueEmail("toggle-deleted"), password = "pw")
        assertEquals(1, TestServices.users.delete(deletedId))
        val client = authedClient(adminEmail, "pw")

        for (id in listOf(999999u, deletedId)) {
            val response = client.put("/api/v1/users/$id/email-notifications") {
                contentType(ContentType.Application.Json)
                setBody(UserEmailNotificationsUpdateRequest(enabled = false))
            }
            assertEquals(HttpStatusCode.NotFound, response.status, "for id $id")
        }
    }

    @Test
    fun `audited only on an actual change`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("toggle-audit")
        val userId = TestUsers.seed(email = email, password = "pw", roles = emptySet())
        val client = authedClient(email, "pw")
        val auditEvents = LogCapture("ch.nokillswit.audit")
        try {
            suspend fun put(enabled: Boolean) = client.put("/api/v1/users/$userId/email-notifications") {
                contentType(ContentType.Application.Json)
                setBody(UserEmailNotificationsUpdateRequest(enabled))
            }
            assertEquals(HttpStatusCode.NoContent, put(false).status)
            val event = auditEvents.events.firstOrNull { it.message == "user.email_notifications_changed" }
            assertNotNull(event, "the flip must be audited")
            assertTrue(
                event.keyValuePairs.orEmpty().any { it.key == "from" && it.value.toString() == "true" } &&
                    event.keyValuePairs.orEmpty().any { it.key == "to" && it.value.toString() == "false" },
                "the audit event must carry the from/to delta",
            )

            assertEquals(HttpStatusCode.NoContent, put(false).status)
            assertEquals(
                1,
                auditEvents.events.count { it.message == "user.email_notifications_changed" },
                "a same-value re-PUT must not audit again",
            )
        } finally {
            auditEvents.detach()
        }
    }

    @Test
    fun `a deactivated target may still be toggled — the setting is inert until reactivation`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("toggle-deact-admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val targetId = TestUsers.seed(email = uniqueEmail("toggle-deact"), password = "pw", roles = emptySet())
        assertEquals(1, TestServices.users.setDeactivated(targetId, true))

        val response = authedClient(adminEmail, "pw").put("/api/v1/users/$targetId/email-notifications") {
            contentType(ContentType.Application.Json)
            setBody(UserEmailNotificationsUpdateRequest(enabled = false))
        }
        assertEquals(HttpStatusCode.NoContent, response.status)
        assertFalse(TestServices.users.read(targetId)!!.emailNotificationsEnabled)
    }

    @Test
    fun `unauthenticated is 401`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().put("/api/v1/users/1/email-notifications") {
            contentType(ContentType.Application.Json)
            setBody(UserEmailNotificationsUpdateRequest(enabled = false))
        }
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }
}
