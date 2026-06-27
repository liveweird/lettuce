package ch.nokillswit

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.feedbacks.feedbackCreationNotifications
import ch.nokillswit.feedbacks.feedbackTransitionNotifications
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pure unit tests for the transition → notification mapping (no DB / container). */
class FeedbackNotificationsTest {

    private val names = mapOf(1u to "Provider Pat", 2u to "Subject Sam", 3u to "Requester Rita")
    private val P = "Provider Pat"
    private val S = "Subject Sam"
    private val R = "Requester Rita"

    private fun feedback(
        status: FeedbackStatus,
        // Default carries a requester, so the default visibility must be requester-inclusive
        // (a requester + PROVIDER_SUBJECT is an illegal combination per the server invariant).
        visibility: FeedbackVisibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
        requesterId: UInt? = 3u,
    ) = Feedback(
        requesterId = requesterId,
        subjectId = 2u,
        providerId = 1u,
        visibility = visibility,
        status = status,
    )

    @Test
    fun `draft to sent notifies subject and requester, naming the parties`() {
        val next = feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT)
        val result = feedbackTransitionNotifications(42u, FeedbackStatus.DRAFT, next, names)

        assertEquals(2, result.size)
        val toSubject = result.single { it.recipientId == 2u }
        val toRequester = result.single { it.recipientId == 3u }

        assertTrue(toSubject.message.contains(P) && toSubject.message.contains(S))
        assertTrue(toSubject.message.contains("has been sent"))
        // PROVIDER_REQUESTER_SUBJECT is readable by both → both get links.
        assertEquals("/feedback/42/view", toSubject.link)

        assertTrue(toRequester.message.contains(R), "requester message must name the requester")
        assertTrue(toRequester.message.contains(P) && toRequester.message.contains(S))
        assertEquals("/feedback/42/view", toRequester.link)
    }

    @Test
    fun `draft to sent without a requester notifies only the subject`() {
        val next = feedback(FeedbackStatus.SENT, requesterId = null)
        val result = feedbackTransitionNotifications(7u, FeedbackStatus.DRAFT, next, names)
        assertEquals(listOf(2u), result.map { it.recipientId })
    }

    @Test
    fun `subject link is omitted when the visibility hides it from the subject`() {
        // PROVIDER_REQUESTER: subject cannot read → no subject link; requester can → link present.
        val next = feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_REQUESTER)
        val result = feedbackTransitionNotifications(9u, FeedbackStatus.DRAFT, next, names)
        assertNull(result.single { it.recipientId == 2u }.link)
        assertEquals("/feedback/9/view", result.single { it.recipientId == 3u }.link)
    }

    @Test
    fun `requested to rejected notifies the requester with no link`() {
        val next = feedback(FeedbackStatus.REJECTED)
        val result = feedbackTransitionNotifications(5u, FeedbackStatus.REQUESTED, next, names)
        val n = result.single()
        assertEquals(3u, n.recipientId)
        assertNull(n.link)
        assertTrue(n.message.contains("rejected"))
        assertTrue(n.message.contains(R) && n.message.contains(P) && n.message.contains(S))
    }

    @Test
    fun `requested to draft notifies the requester that it was picked up`() {
        val next = feedback(FeedbackStatus.DRAFT)
        val result = feedbackTransitionNotifications(5u, FeedbackStatus.REQUESTED, next, names)
        val n = result.single()
        assertEquals(3u, n.recipientId)
        assertNull(n.link)
        assertTrue(n.message.contains("picked up"))
        assertTrue(n.message.contains(R) && n.message.contains(P) && n.message.contains(S))
    }

    @Test
    fun `sent to withdrawn notifies both subject and requester with no link`() {
        val next = feedback(FeedbackStatus.WITHDRAWN)
        val result = feedbackTransitionNotifications(8u, FeedbackStatus.SENT, next, names)
        assertEquals(setOf(2u, 3u), result.map { it.recipientId }.toSet())
        assertTrue(result.all { it.link == null })
        assertTrue(result.all { it.message.contains("withdrawn") })
        assertTrue(result.single { it.recipientId == 3u }.message.contains(R))
    }

    @Test
    fun `sent to withdrawn without a requester notifies only the subject`() {
        val next = feedback(FeedbackStatus.WITHDRAWN, requesterId = null)
        val result = feedbackTransitionNotifications(8u, FeedbackStatus.SENT, next, names)
        assertEquals(listOf(2u), result.map { it.recipientId })
    }

    @Test
    fun `falls back to an id placeholder when a name is missing`() {
        val next = feedback(FeedbackStatus.REJECTED)
        val result = feedbackTransitionNotifications(5u, FeedbackStatus.REQUESTED, next, emptyMap())
        assertTrue(result.single().message.contains("#1") && result.single().message.contains("#2"))
    }

    @Test
    fun `creating a requested feedback notifies the provider with an edit link`() {
        val created = feedback(FeedbackStatus.REQUESTED)
        val result = feedbackCreationNotifications(11u, created, names)
        val n = result.single()
        assertEquals(1u, n.recipientId, "the provider is notified")
        assertEquals("/feedback/11/edit", n.link)
        assertTrue(n.message.contains(R), "message must name the requester")
        assertTrue(n.message.contains(S), "message must name the subject")
    }

    @Test
    fun `creating a non-requested feedback produces no notification`() {
        val created = feedback(FeedbackStatus.DRAFT)
        assertTrue(feedbackCreationNotifications(11u, created, names).isEmpty())
    }

    @Test
    fun `creation message falls back to an id placeholder when a name is missing`() {
        val created = feedback(FeedbackStatus.REQUESTED)
        val message = feedbackCreationNotifications(11u, created, emptyMap()).single().message
        assertTrue(message.contains("#3") && message.contains("#2"))
    }
}
