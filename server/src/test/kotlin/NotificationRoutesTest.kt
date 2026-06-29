package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.serialization.kotlinx.json.json
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.delay
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class NotificationRoutesTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private suspend fun ApplicationTestBuilder.authedClient(email: String, password: String): HttpClient {
        val client = jsonClient()
        val token = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body<LoginResponse>().token
        return createClient {
            install(ContentNegotiation) { json(); json(contentType = ContentType.parse("application/problem+json")) }
            install(DefaultRequest) {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
        }
    }

    @Test
    fun `list returns only the caller's notifications, newest first`() = testApplication {
        usePostgresTestcontainer()
        val recipientEmail = uniqueEmail("recipient")
        val recipientId = TestUsers.seed(email = recipientEmail, password = "pw", role = UserRole.USER)
        val otherId = TestUsers.seed(email = uniqueEmail("other"), password = "pw", role = UserRole.USER)
        val client = authedClient(recipientEmail, "pw")

        val older = TestNotifications.seed(recipientId, message = "older")
        delay(10)
        val newer = TestNotifications.seed(recipientId, message = "newer")
        TestNotifications.seed(otherId, message = "not yours")

        val page = client.get("/api/v1/notifications")
        assertEquals(HttpStatusCode.OK, page.status)
        val body = page.body<NotificationPageResponse>()
        assertEquals(2, body.total)
        // Default sort is timestamp descending.
        assertEquals(listOf(newer, older), body.items.map { it.id })
        assertTrue(body.items.all { it.recipientId == recipientId })
    }

    @Test
    fun `list filters by wasSeen and rejects a malformed value`() = testApplication {
        usePostgresTestcontainer()
        val recipientEmail = uniqueEmail("recipient")
        val recipientId = TestUsers.seed(email = recipientEmail, password = "pw", role = UserRole.USER)
        val client = authedClient(recipientEmail, "pw")

        val seen = TestNotifications.seed(recipientId, message = "seen one")
        val unseen = TestNotifications.seed(recipientId, message = "unseen one")
        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/notifications/$seen/seen").status)

        val onlySeen = client.get("/api/v1/notifications?wasSeen=true").body<NotificationPageResponse>()
        assertEquals(listOf(seen), onlySeen.items.map { it.id })

        val onlyUnseen = client.get("/api/v1/notifications?wasSeen=false").body<NotificationPageResponse>()
        assertEquals(listOf(unseen), onlyUnseen.items.map { it.id })

        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/notifications?wasSeen=maybe").status)
    }

    @Test
    fun `read is allowed for the recipient and ADMIN but forbidden for others`() = testApplication {
        usePostgresTestcontainer()
        val recipientEmail = uniqueEmail("recipient")
        val recipientId = TestUsers.seed(email = recipientEmail, password = "pw", role = UserRole.USER)
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(email = strangerEmail, password = "pw", role = UserRole.USER)
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)

        val id = TestNotifications.seed(recipientId, message = "hi", link = "/x")

        val recipientClient = authedClient(recipientEmail, "pw")
        val read = recipientClient.get("/api/v1/notifications/$id")
        assertEquals(HttpStatusCode.OK, read.status)
        val body = read.body<NotificationResponse>()
        assertEquals(recipientId, body.recipientId)
        assertEquals("hi", body.message)
        assertEquals("/x", body.link)
        assertFalse(body.wasSeen)
        assertTrue(body.timestamp > 0)

        val strangerClient = authedClient(strangerEmail, "pw")
        assertEquals(HttpStatusCode.Forbidden, strangerClient.get("/api/v1/notifications/$id").status)

        val adminClient = authedClient(adminEmail, "pw")
        assertEquals(HttpStatusCode.OK, adminClient.get("/api/v1/notifications/$id").status)

        assertEquals(HttpStatusCode.NotFound, recipientClient.get("/api/v1/notifications/999999").status)
    }

    @Test
    fun `mark seen flips the flag, is idempotent, and is recipient-scoped`() = testApplication {
        usePostgresTestcontainer()
        val recipientEmail = uniqueEmail("recipient")
        val recipientId = TestUsers.seed(email = recipientEmail, password = "pw", role = UserRole.USER)
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(email = strangerEmail, password = "pw", role = UserRole.USER)

        val id = TestNotifications.seed(recipientId)
        val client = authedClient(recipientEmail, "pw")

        assertFalse(client.get("/api/v1/notifications/$id").body<NotificationResponse>().wasSeen)

        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/notifications/$id/seen").status)
        assertTrue(client.get("/api/v1/notifications/$id").body<NotificationResponse>().wasSeen)

        // Idempotent.
        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/notifications/$id/seen").status)

        val strangerClient = authedClient(strangerEmail, "pw")
        assertEquals(HttpStatusCode.Forbidden, strangerClient.post("/api/v1/notifications/$id/seen").status)

        assertEquals(HttpStatusCode.NotFound, client.post("/api/v1/notifications/999999/seen").status)
    }

    @Test
    fun `mark unseen flips the flag back, is idempotent, and is recipient-scoped`() = testApplication {
        usePostgresTestcontainer()
        val recipientEmail = uniqueEmail("recipient")
        val recipientId = TestUsers.seed(email = recipientEmail, password = "pw", role = UserRole.USER)
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(email = strangerEmail, password = "pw", role = UserRole.USER)

        val id = TestNotifications.seed(recipientId)
        val client = authedClient(recipientEmail, "pw")

        // Seen first, then back to unseen.
        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/notifications/$id/seen").status)
        assertTrue(client.get("/api/v1/notifications/$id").body<NotificationResponse>().wasSeen)

        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/notifications/$id/unseen").status)
        assertFalse(client.get("/api/v1/notifications/$id").body<NotificationResponse>().wasSeen)

        // Idempotent.
        assertEquals(HttpStatusCode.NoContent, client.post("/api/v1/notifications/$id/unseen").status)

        val strangerClient = authedClient(strangerEmail, "pw")
        assertEquals(HttpStatusCode.Forbidden, strangerClient.post("/api/v1/notifications/$id/unseen").status)

        assertEquals(HttpStatusCode.NotFound, client.post("/api/v1/notifications/999999/unseen").status)
    }

    @Test
    fun `delete removes the notification and is recipient-scoped`() = testApplication {
        usePostgresTestcontainer()
        val recipientEmail = uniqueEmail("recipient")
        val recipientId = TestUsers.seed(email = recipientEmail, password = "pw", role = UserRole.USER)
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(email = strangerEmail, password = "pw", role = UserRole.USER)
        val client = authedClient(recipientEmail, "pw")
        val strangerClient = authedClient(strangerEmail, "pw")

        val protectedId = TestNotifications.seed(recipientId, message = "keep")
        assertEquals(HttpStatusCode.Forbidden, strangerClient.delete("/api/v1/notifications/$protectedId").status)
        // Still there after the forbidden attempt.
        assertEquals(HttpStatusCode.OK, client.get("/api/v1/notifications/$protectedId").status)

        val doomedId = TestNotifications.seed(recipientId, message = "drop")
        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/notifications/$doomedId").status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/notifications/$doomedId").status)
    }

    @Test
    fun `delete of a non-existent notification returns 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw") // ADMIN bypasses the recipient guard
        val client = authedClient(adminEmail, "pw")

        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/notifications/999999").status)
    }

    @Test
    fun `notification endpoints require authentication`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val endpoints = listOf(
            HttpMethod.Get to "/api/v1/notifications",
            HttpMethod.Get to "/api/v1/notifications/1",
            HttpMethod.Post to "/api/v1/notifications/1/seen",
            HttpMethod.Post to "/api/v1/notifications/1/unseen",
            HttpMethod.Delete to "/api/v1/notifications/1",
        )
        for ((verb, path) in endpoints) {
            assertEquals(
                HttpStatusCode.Unauthorized,
                client.request(path) { method = verb }.status,
                "$verb $path expected 401",
            )
        }
    }
}
