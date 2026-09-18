package ch.nokillswit

import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackEvent
import ch.nokillswit.feedbacks.FeedbackEventType
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import io.ktor.client.call.body
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * The shared [ch.nokillswit.infra.db.EventLog] mechanics' system-actor support (v3.11.0/V80):
 * a null acting user is a genuine, listable row — `listFor` must LEFT JOIN (never drop it) and
 * resolve its `userName` to null. Exercised via the feedback area's `FeedbackEventService`
 * (`TestFeedbackEvents`), the same shared plumbing every `*_events` table rides.
 */
class EventLogTest {

    @Test
    fun `listFor returns both a user-attributed and a null-actor event, newest first, with a null userName`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw", roles = emptySet())
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw", roles = emptySet())
        val provider = authedClient(providerEmail, "pw")

        val created = provider.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId, providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT, content = "draft",
                ),
            )
        }.body<FeedbackResponse>()
        // The route's own CREATED event is a user-attributed row already; add a second,
        // system-originated one directly (mirrors the REQUEST_EXPIRED sweep's persistOutcome).
        TestFeedbackEvents.service.create(
            FeedbackEvent(feedbackId = created.id, userId = null, type = FeedbackEventType.REQUEST_EXPIRED),
        )

        val events = TestFeedbackEvents.service.listForFeedback(created.id)
        assertEquals(2, events.size)
        // Newest first: the system-originated row was minted second.
        val (systemRow, userRow) = events
        assertEquals(FeedbackEventType.REQUEST_EXPIRED, systemRow.type)
        assertNull(systemRow.userId)
        assertNull(systemRow.userName)
        assertEquals(FeedbackEventType.CREATED, userRow.type)
        assertEquals(providerId, userRow.userId)
        assertEquals("Test", userRow.userName)
    }
}
