package ch.nokillswit

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.feedbacks.feedbackCreationNotifications
import ch.nokillswit.feedbacks.feedbackDeletionNotifications
import ch.nokillswit.feedbacks.feedbackTransitionNotifications
import ch.nokillswit.notifications.NotificationType
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
    fun `draft to sent notifies subject, provider and requester, naming the parties`() {
        val next = feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT)
        val result = feedbackTransitionNotifications(42u, FeedbackStatus.DRAFT, next, names)

        assertEquals(3, result.size)
        val toSubject = result.single { it.recipientId == 2u }
        val toProvider = result.single { it.recipientId == 1u }
        val toRequester = result.single { it.recipientId == 3u }

        assertEquals(NotificationType.FEEDBACK_SENT_TO_SUBJECT, toSubject.type)
        assertEquals(P, toSubject.params["provider"])
        assertEquals(S, toSubject.params["subject"])
        // PROVIDER_REQUESTER_SUBJECT is readable by both → both get links.
        assertEquals("/feedback/42/view", toSubject.link)

        // The provider (sender) gets a confirmation with an unconditional view link.
        assertEquals(NotificationType.FEEDBACK_SENT_TO_PROVIDER, toProvider.type)
        assertEquals(S, toProvider.params["subject"])
        assertEquals("/feedback/42/view", toProvider.link)

        assertEquals(NotificationType.FEEDBACK_SENT_TO_REQUESTER, toRequester.type)
        assertEquals(R, toRequester.params["requester"])
        assertEquals(P, toRequester.params["provider"])
        assertEquals(S, toRequester.params["subject"])
        assertEquals("/feedback/42/view", toRequester.link)
    }

    @Test
    fun `self-reflection transitions produce no notifications when there is no requester`() {
        // provider == subject, no requester: every recipient would be the acting user.
        val self = Feedback(
            requesterId = null,
            subjectId = 1u,
            providerId = 1u,
            visibility = FeedbackVisibility.PROVIDER_SUBJECT,
            status = FeedbackStatus.SENT,
        )
        assertTrue(feedbackTransitionNotifications(7u, FeedbackStatus.DRAFT, self, names).isEmpty())
        val withdrawn = self.copy(status = FeedbackStatus.WITHDRAWN)
        assertTrue(feedbackTransitionNotifications(7u, FeedbackStatus.SENT, withdrawn, names).isEmpty())
    }

    @Test
    fun `requested self-reflection transitions notify only the requester, self-worded`() {
        // provider == subject with a requester (the "request feedback from the subject" flow):
        // the acting provider/subject gets nothing, the requester hears about every step.
        val requestedSelf = Feedback(
            requesterId = 3u,
            subjectId = 1u,
            providerId = 1u,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.SENT,
        )
        val sent = feedbackTransitionNotifications(8u, FeedbackStatus.DRAFT, requestedSelf, names)
        assertEquals(listOf(3u), sent.map { it.recipientId })
        assertEquals(NotificationType.FEEDBACK_SENT_TO_REQUESTER, sent.single().type)
        assertEquals("self", sent.single().params["self"])

        val pickedUp = feedbackTransitionNotifications(
            8u, FeedbackStatus.REQUESTED, requestedSelf.copy(status = FeedbackStatus.DRAFT), names,
        )
        assertEquals(listOf(3u), pickedUp.map { it.recipientId })
        assertEquals("self", pickedUp.single().params["self"])
    }

    @Test
    fun `creating a requested self-reflection words both notifications via the self contexts`() {
        val created = Feedback(
            requesterId = 3u,
            subjectId = 1u,
            providerId = 1u,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.REQUESTED,
        )
        val result = feedbackCreationNotifications(11u, created, names)
        assertEquals(2, result.size)
        val toProvider = result.single { it.recipientId == 1u }
        val toRequester = result.single { it.recipientId == 3u }
        // The provider is asked for a self-reflection; the requester's confirmation uses the
        // distinct "reflection" context (its "self" context means subject == requester).
        assertEquals("self", toProvider.params["self"])
        assertEquals("reflection", toRequester.params["self"])
    }

    @Test
    fun `draft to sent without a requester notifies the subject and the provider`() {
        val next = feedback(FeedbackStatus.SENT, requesterId = null)
        val result = feedbackTransitionNotifications(7u, FeedbackStatus.DRAFT, next, names)
        assertEquals(setOf(2u, 1u), result.map { it.recipientId }.toSet())
        assertEquals("/feedback/7/view", result.single { it.recipientId == 1u }.link)
    }

    @Test
    fun `draft to sent notifies the provider with a view link`() {
        val next = feedback(FeedbackStatus.SENT)
        val toProvider = feedbackTransitionNotifications(42u, FeedbackStatus.DRAFT, next, names)
            .single { it.recipientId == 1u }
        assertEquals("/feedback/42/view", toProvider.link)
        assertEquals(NotificationType.FEEDBACK_SENT_TO_PROVIDER, toProvider.type)
        assertEquals(S, toProvider.params["subject"])
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
    fun `draft to sent with public visibility links both the subject and the requester`() {
        val next = feedback(FeedbackStatus.SENT, FeedbackVisibility.PUBLIC)
        val result = feedbackTransitionNotifications(13u, FeedbackStatus.DRAFT, next, names)
        assertEquals("/feedback/13/view", result.single { it.recipientId == 2u }.link)
        assertEquals("/feedback/13/view", result.single { it.recipientId == 3u }.link)
    }

    @Test
    fun `draft to sent with provider-subject visibility links the subject`() {
        // PROVIDER_SUBJECT implies no requester (the combination is contradictory otherwise).
        val next = feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_SUBJECT, requesterId = null)
        val result = feedbackTransitionNotifications(14u, FeedbackStatus.DRAFT, next, names)
        assertEquals(setOf(2u, 1u), result.map { it.recipientId }.toSet())
        assertEquals("/feedback/14/view", result.single { it.recipientId == 2u }.link)
    }

    @Test
    fun `requested to sent notifies only the requester`() {
        // Not a legal edge of the state machine, but the mapping supports it explicitly (see the
        // comment in feedbackTransitionNotifications): only the requester note fires.
        val next = feedback(FeedbackStatus.SENT)
        val result = feedbackTransitionNotifications(21u, FeedbackStatus.REQUESTED, next, names)
        val n = result.single()
        assertEquals(3u, n.recipientId)
        assertEquals("/feedback/21/view", n.link)
        assertEquals(NotificationType.FEEDBACK_SENT_TO_REQUESTER, n.type)
    }

    @Test
    fun `requested to rejected notifies the requester with no link`() {
        val next = feedback(FeedbackStatus.REJECTED)
        val result = feedbackTransitionNotifications(5u, FeedbackStatus.REQUESTED, next, names)
        val n = result.single()
        assertEquals(3u, n.recipientId)
        assertNull(n.link)
        assertEquals(NotificationType.FEEDBACK_REJECTED_TO_REQUESTER, n.type)
        assertEquals(R, n.params["requester"])
        assertEquals(P, n.params["provider"])
        assertEquals(S, n.params["subject"])
    }

    @Test
    fun `requested to draft notifies the requester that it was picked up`() {
        val next = feedback(FeedbackStatus.DRAFT)
        val result = feedbackTransitionNotifications(5u, FeedbackStatus.REQUESTED, next, names)
        val n = result.single()
        assertEquals(3u, n.recipientId)
        assertNull(n.link)
        assertEquals(NotificationType.FEEDBACK_PICKED_UP_TO_REQUESTER, n.type)
        assertEquals(R, n.params["requester"])
        assertEquals(P, n.params["provider"])
        assertEquals(S, n.params["subject"])
    }

    @Test
    fun `sent to withdrawn notifies both subject and requester with no link`() {
        val next = feedback(FeedbackStatus.WITHDRAWN)
        val result = feedbackTransitionNotifications(8u, FeedbackStatus.SENT, next, names)
        assertEquals(setOf(2u, 3u), result.map { it.recipientId }.toSet())
        assertTrue(result.all { it.link == null })
        assertEquals(NotificationType.FEEDBACK_WITHDRAWN_TO_SUBJECT, result.single { it.recipientId == 2u }.type)
        val toRequester = result.single { it.recipientId == 3u }
        assertEquals(NotificationType.FEEDBACK_WITHDRAWN_TO_REQUESTER, toRequester.type)
        assertEquals(R, toRequester.params["requester"])
    }

    @Test
    fun `sent to withdrawn without a requester notifies only the subject`() {
        val next = feedback(FeedbackStatus.WITHDRAWN, requesterId = null)
        val result = feedbackTransitionNotifications(8u, FeedbackStatus.SENT, next, names)
        assertEquals(listOf(2u), result.map { it.recipientId })
    }

    @Test
    fun `requested transitions without a requester notify no one`() {
        // Defensive: REQUESTED requires a requester (enforced in FeedbackService.validate), but
        // the pure mapping must stay total — with no requester there is nobody to notify.
        val rejected = feedback(FeedbackStatus.REJECTED, FeedbackVisibility.PROVIDER_SUBJECT, requesterId = null)
        assertTrue(feedbackTransitionNotifications(5u, FeedbackStatus.REQUESTED, rejected, names).isEmpty())
        val draft = feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_SUBJECT, requesterId = null)
        assertTrue(feedbackTransitionNotifications(5u, FeedbackStatus.REQUESTED, draft, names).isEmpty())
    }

    @Test
    fun `abandoning a draft produces no notifications`() {
        // DRAFT -> WITHDRAWN is a legal edge but nothing was ever delivered, so nobody is told.
        val next = feedback(FeedbackStatus.WITHDRAWN)
        assertTrue(feedbackTransitionNotifications(6u, FeedbackStatus.DRAFT, next, names).isEmpty())
    }

    @Test
    fun `an unmapped transition produces no notifications`() {
        // The mapping is total: a from/to pair outside the notification table yields nothing.
        val rejected = feedback(FeedbackStatus.REJECTED)
        assertTrue(feedbackTransitionNotifications(6u, FeedbackStatus.SENT, rejected, names).isEmpty())
        // Even landing on SENT only notifies when coming from DRAFT or REQUESTED — "resurrecting"
        // a terminal feedback (not an edge of the state machine) must not fan out notifications.
        val sent = feedback(FeedbackStatus.SENT)
        assertTrue(feedbackTransitionNotifications(6u, FeedbackStatus.WITHDRAWN, sent, names).isEmpty())
    }

    @Test
    fun `falls back to an id placeholder when a name is missing`() {
        val next = feedback(FeedbackStatus.REJECTED)
        val n = feedbackTransitionNotifications(5u, FeedbackStatus.REQUESTED, next, emptyMap()).single()
        assertEquals("#1", n.params["provider"])
        assertEquals("#2", n.params["subject"])
    }

    @Test
    fun `creating a requested feedback notifies the provider with an edit link and the requester without one`() {
        val created = feedback(FeedbackStatus.REQUESTED)
        val result = feedbackCreationNotifications(11u, created, names)
        assertEquals(2, result.size)

        val toProvider = result.single { it.recipientId == 1u }
        assertEquals("/feedback/11/edit", toProvider.link)
        assertEquals(NotificationType.FEEDBACK_REQUESTED_TO_PROVIDER, toProvider.type)
        assertEquals(R, toProvider.params["requester"])
        assertEquals(S, toProvider.params["subject"])

        // The requester gets a confirmation with no link, naming the provider and subject.
        val toRequester = result.single { it.recipientId == 3u }
        assertNull(toRequester.link, "the requester confirmation carries no link")
        assertEquals(NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER, toRequester.type)
        assertEquals(P, toRequester.params["provider"])
        assertEquals(S, toRequester.params["subject"])
        assertNull(toRequester.params["self"], "not a self-request")
    }

    @Test
    fun `asking for feedback about yourself notifies the requester with the self variant`() {
        // The "ask for feedback about myself" flow: subject == requester.
        val created = Feedback(
            requesterId = 3u,
            subjectId = 3u,
            providerId = 1u,
            visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
            status = FeedbackStatus.REQUESTED,
        )
        val toRequester = feedbackCreationNotifications(12u, created, names)
            .single { it.recipientId == 3u }
        assertNull(toRequester.link)
        assertEquals(NotificationType.FEEDBACK_REQUESTED_TO_REQUESTER, toRequester.type)
        assertEquals("self", toRequester.params["self"])
    }

    @Test
    fun `creating a requested feedback without a requester produces no notification`() {
        // Defensive: unreachable through the API (REQUESTED requires a requester), but the pure
        // mapping must not blow up or invent a recipient.
        val created = feedback(
            FeedbackStatus.REQUESTED,
            FeedbackVisibility.PROVIDER_SUBJECT,
            requesterId = null,
        )
        assertTrue(feedbackCreationNotifications(11u, created, names).isEmpty())
    }

    @Test
    fun `creating a non-requested feedback produces no notification`() {
        val created = feedback(FeedbackStatus.DRAFT)
        assertTrue(feedbackCreationNotifications(11u, created, names).isEmpty())
    }

    @Test
    fun `creation params fall back to an id placeholder when a name is missing`() {
        val created = feedback(FeedbackStatus.REQUESTED)
        val toProvider = feedbackCreationNotifications(11u, created, emptyMap())
            .single { it.recipientId == 1u }
        assertEquals("#3", toProvider.params["requester"])
        assertEquals("#2", toProvider.params["subject"])
    }

    @Test
    fun `deleting a feedback with a requester notifies them without a link`() {
        val deleted = feedback(FeedbackStatus.DRAFT) // requesterId = 3u by default
        val n = feedbackDeletionNotifications(deleted, names).single()
        assertEquals(3u, n.recipientId, "the requester is notified")
        assertNull(n.link)
        assertEquals(NotificationType.FEEDBACK_DELETED_TO_REQUESTER, n.type)
        assertEquals(P, n.params["provider"])
        assertEquals(S, n.params["subject"])
    }

    @Test
    fun `deleting a feedback without a requester produces no notification`() {
        val deleted = feedback(
            FeedbackStatus.DRAFT,
            FeedbackVisibility.PROVIDER_SUBJECT,
            requesterId = null,
        )
        assertTrue(feedbackDeletionNotifications(deleted, names).isEmpty())
    }
}
