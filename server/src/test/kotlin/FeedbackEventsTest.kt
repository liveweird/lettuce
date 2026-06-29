package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackEventListResponse
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.feedbacks.feedbackCreationEventContent
import ch.nokillswit.feedbacks.feedbackUpdateEventContent
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class FeedbackEventsTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private suspend fun ApplicationTestBuilder.authedClient(email: String, password: String): HttpClient {
        val token = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body<LoginResponse>().token
        return createClient {
            install(ContentNegotiation) { json(); json(contentType = ContentType.parse("application/problem+json")) }
            install(DefaultRequest) { header(HttpHeaders.Authorization, "Bearer $token") }
        }
    }

    // ---- pure description helpers (no DB) ----

    @Test
    fun `creation content reflects the initial status`() {
        fun fb(status: FeedbackStatus) = Feedback(
            subjectId = 1u, providerId = 2u, visibility = FeedbackVisibility.PROVIDER_SUBJECT, status = status,
        )
        assertEquals("Feedback created as a draft.", feedbackCreationEventContent(fb(FeedbackStatus.DRAFT)))
        assertEquals("Feedback created and sent.", feedbackCreationEventContent(fb(FeedbackStatus.SENT)))
        assertEquals("Feedback requested.", feedbackCreationEventContent(fb(FeedbackStatus.REQUESTED)))
        assertEquals("Feedback created as withdrawn.", feedbackCreationEventContent(fb(FeedbackStatus.WITHDRAWN)))
        assertEquals("Feedback created as rejected.", feedbackCreationEventContent(fb(FeedbackStatus.REJECTED)))
    }

    @Test
    fun `update content reports transitions, edits, or nothing`() {
        val base = Feedback(
            subjectId = 1u, providerId = 2u, visibility = FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.DRAFT, content = "a",
        )
        assertEquals(
            "Status changed from DRAFT to SENT.",
            feedbackUpdateEventContent(base, base.copy(status = FeedbackStatus.SENT)),
        )
        assertEquals("Content updated.", feedbackUpdateEventContent(base, base.copy(content = "b")))
        assertEquals(
            "Visibility changed to PUBLIC.",
            feedbackUpdateEventContent(base, base.copy(visibility = FeedbackVisibility.PUBLIC)),
        )
        assertNull(feedbackUpdateEventContent(base, base.copy()))
    }

    // ---- integration ----

    @Test
    fun `creating and transitioning a feedback records audit events against the actor`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", name = "Paula", role = UserRole.USER)
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw", role = UserRole.USER)
        val provider = authedClient(providerEmail, "pw")

        val created = provider.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = subjectId, providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT, content = "draft",
                ),
            )
        }.body<FeedbackResponse>()

        // One event after creation, attributed to the provider with their resolved name.
        val afterCreate = provider.get("/api/v1/feedbacks/${created.id}/events").body<FeedbackEventListResponse>()
        assertEquals(1, afterCreate.items.size)
        val ev = afterCreate.items.single()
        assertEquals("Feedback created as a draft.", ev.content)
        assertEquals(providerId, ev.userId)
        assertEquals("Paula", ev.userName)

        // Sending it adds a status-change event.
        assertEquals(
            HttpStatusCode.NoContent,
            provider.put("/api/v1/feedbacks/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(
                    Feedback(
                        subjectId = subjectId, providerId = providerId,
                        visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                        status = FeedbackStatus.SENT, content = "draft",
                    ),
                )
            }.status,
        )
        val afterSend = provider.get("/api/v1/feedbacks/${created.id}/events").body<FeedbackEventListResponse>()
        assertEquals(2, afterSend.items.size)
        assertEquals("Status changed from DRAFT to SENT.", afterSend.items.last().content)
    }

    @Test
    fun `editing content (same status) records a content event`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", role = UserRole.USER)
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw", role = UserRole.USER)
        val provider = authedClient(providerEmail, "pw")

        val created = provider.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = subjectId, providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT, content = "first",
                ),
            )
        }.body<FeedbackResponse>()

        provider.put("/api/v1/feedbacks/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = subjectId, providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT, content = "revised",
                ),
            )
        }

        val events = provider.get("/api/v1/feedbacks/${created.id}/events").body<FeedbackEventListResponse>()
        assertEquals(listOf("Feedback created as a draft.", "Content updated."), events.items.map { it.content })
    }

    @Test
    fun `events are readable only by those who may read the feedback`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", role = UserRole.USER)
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw", role = UserRole.USER)
        val strangerEmail = uniqueEmail("stranger")
        TestUsers.seed(email = strangerEmail, password = "pw", role = UserRole.USER)
        val provider = authedClient(providerEmail, "pw")

        // A PROVIDER_SUBJECT draft: only provider/subject (and admins) may read it.
        val created = provider.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = subjectId, providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT, content = "secret",
                ),
            )
        }.body<FeedbackResponse>()

        assertEquals(
            HttpStatusCode.OK,
            provider.get("/api/v1/feedbacks/${created.id}/events").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            authedClient(strangerEmail, "pw").get("/api/v1/feedbacks/${created.id}/events").status,
        )
    }

    @Test
    fun `the events endpoint returns 404 for a missing feedback`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("user")
        TestUsers.seed(email = email, password = "pw", role = UserRole.USER)

        assertEquals(
            HttpStatusCode.NotFound,
            authedClient(email, "pw").get("/api/v1/feedbacks/999999/events").status,
        )
    }

    @Test
    fun `soft-deleting a feedback preserves its events and records a deletion event`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", role = UserRole.USER)
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw", role = UserRole.USER)
        val provider = authedClient(providerEmail, "pw")

        val created = provider.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                Feedback(
                    subjectId = subjectId, providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT, content = "draft",
                ),
            )
        }.body<FeedbackResponse>()

        // The creation event exists…
        assertEquals(1, TestFeedbackEvents.service.listForFeedback(created.id).size)

        // …and the feedback is soft-deleted: the row (and its audit trail) survive, and a deletion
        // event is appended against the acting provider.
        assertEquals(HttpStatusCode.NoContent, provider.delete("/api/v1/feedbacks/${created.id}").status)
        val events = TestFeedbackEvents.service.listForFeedback(created.id)
        assertEquals(2, events.size)
        val deletion = events.last()
        assertEquals("Feedback deleted.", deletion.content)
        assertEquals(providerId, deletion.userId)
    }
}
