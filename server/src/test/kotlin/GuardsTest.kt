package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.authz.canReadFeedback
import ch.nokillswit.authz.canReadFeedbackContent
import ch.nokillswit.authz.requireCanAssignRole
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.users.UserRole
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pure unit tests for the authorization predicates in authz/Guards.kt (no DB / container).
 * The HTTP-level read matrix lives in AuthorizationTest; these pin down the rule edges that
 * are awkward to stage over HTTP (terminal statuses, non-party callers, PUBLIC visibility).
 */
class GuardsTest {

    private val provider = CallerPrincipal(userId = 1u, email = "provider@test", role = UserRole.USER)
    private val subject = CallerPrincipal(userId = 2u, email = "subject@test", role = UserRole.USER)
    private val requester = CallerPrincipal(userId = 3u, email = "requester@test", role = UserRole.USER)
    private val stranger = CallerPrincipal(userId = 9u, email = "stranger@test", role = UserRole.USER)
    private val admin = CallerPrincipal(userId = 10u, email = "admin@test", role = UserRole.ADMIN)

    private fun feedback(
        status: FeedbackStatus,
        visibility: FeedbackVisibility,
        requesterId: UInt? = null,
    ) = Feedback(
        requesterId = requesterId,
        subjectId = subject.userId,
        providerId = provider.userId,
        visibility = visibility,
        status = status,
    )

    // ── canReadFeedback ────────────────────────────────────────────────────────

    @Test
    fun `the subject may read a withdrawn feedback under a subject-inclusive visibility`() {
        // WITHDRAWN is terminal but stays readable, exactly like SENT.
        assertTrue(canReadFeedback(subject, feedback(FeedbackStatus.WITHDRAWN, FeedbackVisibility.PROVIDER_SUBJECT)))
        assertTrue(
            canReadFeedback(
                subject,
                feedback(FeedbackStatus.WITHDRAWN, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = 3u),
            )
        )
    }

    @Test
    fun `the subject may not read an unfinished or requester-only feedback`() {
        // Unfinished: DRAFT content is the provider's private work in progress.
        assertFalse(canReadFeedback(subject, feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_SUBJECT)))
        // PROVIDER_REQUESTER excludes the subject even once delivered.
        assertFalse(
            canReadFeedback(
                subject,
                feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = 3u),
            )
        )
    }

    @Test
    fun `anyone may read a public feedback once sent`() {
        assertTrue(canReadFeedback(stranger, feedback(FeedbackStatus.SENT, FeedbackVisibility.PUBLIC)))
    }

    @Test
    fun `a public feedback is hidden from non-parties until sent and after withdrawal`() {
        assertFalse(canReadFeedback(stranger, feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PUBLIC)))
        assertFalse(canReadFeedback(stranger, feedback(FeedbackStatus.WITHDRAWN, FeedbackVisibility.PUBLIC)))
    }

    @Test
    fun `a non-public sent feedback is not readable by a non-party`() {
        assertFalse(
            canReadFeedback(
                stranger,
                feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT, requesterId = 3u),
            )
        )
    }

    @Test
    fun `the requester may watch any status under a requester-inclusive visibility but not under public`() {
        // Requester-inclusive visibilities grant the requester read at any status.
        assertTrue(
            canReadFeedback(
                requester,
                feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requester.userId),
            )
        )
        // PUBLIC is not in the requester's visibility set: before it is sent, a requester
        // watching a PUBLIC feedback is denied like anyone else (default deny).
        assertFalse(
            canReadFeedback(
                requester,
                feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PUBLIC, requesterId = requester.userId),
            )
        )
    }

    @Test
    fun `admin and provider read everything regardless of status and visibility`() {
        val hidden = feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_SUBJECT)
        assertTrue(canReadFeedback(admin, hidden))
        assertTrue(canReadFeedback(provider, hidden))
    }

    // ── canReadFeedbackContent ─────────────────────────────────────────────────

    @Test
    fun `content of an unfinished feedback is hidden from its requester but not from other readers`() {
        val draft = feedback(FeedbackStatus.DRAFT, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requester.userId)
        val requested = feedback(
            FeedbackStatus.REQUESTED,
            FeedbackVisibility.PROVIDER_REQUESTER,
            requesterId = requester.userId,
        )
        assertFalse(canReadFeedbackContent(requester, draft))
        assertFalse(canReadFeedbackContent(requester, requested))
        // A reader who is not the requester (e.g. a managing caller) still sees the content.
        assertTrue(canReadFeedbackContent(stranger, draft))
        assertTrue(canReadFeedbackContent(admin, draft))
        assertTrue(canReadFeedbackContent(provider, draft))
    }

    @Test
    fun `content of a delivered feedback is visible to its requester`() {
        val sent = feedback(FeedbackStatus.SENT, FeedbackVisibility.PROVIDER_REQUESTER, requesterId = requester.userId)
        assertTrue(canReadFeedbackContent(requester, sent))
    }

    // ── requireCanAssignRole ───────────────────────────────────────────────────

    @Test
    fun `keeping or omitting the current role is not a role change`() {
        // A non-admin resubmitting their unchanged role must not trip the guard.
        requireCanAssignRole(subject, current = UserRole.USER, requested = UserRole.USER)
        requireCanAssignRole(subject, current = UserRole.USER, requested = null)
    }

    @Test
    fun `only an admin may change a role`() {
        assertFailsWith<ForbiddenException> {
            requireCanAssignRole(subject, current = UserRole.USER, requested = UserRole.ADMIN)
        }
        requireCanAssignRole(admin, current = UserRole.USER, requested = UserRole.ADMIN)
    }
}
