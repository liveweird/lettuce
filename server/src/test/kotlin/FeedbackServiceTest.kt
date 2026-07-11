package ch.nokillswit

import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackListFilter
import ch.nokillswit.feedbacks.FeedbackListView
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Service-level contracts of [ch.nokillswit.feedbacks.FeedbackService] that the routes cannot
 * exercise: the routes read the row first (missing → 404 before editContent/transition run) and
 * strip blank filter params via optionalString before the service sees them. testApplication is
 * still booted so Flyway has migrated the shared test container.
 */
class FeedbackServiceTest {


    private val paging = PageRequest(page = 1, pageSize = 100, sort = listOf(SortField("id", descending = false)))

    @Test
    fun `editContent returns 0 for a missing feedback`() = testApplication {
        usePostgresTestcontainer()
        // 0 affected rows is the "missing or already soft-deleted" signal the route maps to 404.
        assertEquals(
            0,
            TestServices.feedbacks.editContent(999_999_999u, "new content", FeedbackVisibility.PUBLIC),
        )
    }

    @Test
    fun `delete returns 0 for a missing feedback`() = testApplication {
        usePostgresTestcontainer()
        // The route maps this to 404 and skips the deletion event/notifications (race window:
        // the row vanished between the route's read and the delete).
        assertEquals(0, TestServices.feedbacks.delete(999_999_999u))
    }

    @Test
    fun `transition returns null for a missing feedback`() = testApplication {
        usePostgresTestcontainer()
        // null (as opposed to a notification list) is the "missing row" signal → 404 in the route.
        assertNull(TestServices.feedbacks.transition(999_999_999u, FeedbackStatus.SENT))
    }

    @Test
    fun `blank name filters are treated as absent`() = testApplication {
        usePostgresTestcontainer()
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw")
        val created = TestServices.feedbacks.create(
            Feedback(
                subjectId = subjectId,
                providerId = providerId,
                visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                status = FeedbackStatus.DRAFT,
                content = "visible to provider",
            )
        )

        // The seeded names ("Test") contain no space, so if a blank filter were applied literally
        // (LIKE '% %') the row would be excluded — being present proves blank means "no filter".
        val blankFiltered = TestServices.feedbacks.list(
            view = FeedbackListView.PROVIDED,
            callerUserId = providerId,
            filter = FeedbackListFilter(requesterName = " ", subjectName = " ", providerName = " "),
            paging = paging,
        )
        assertTrue(blankFiltered.items.any { it.id == created.id })

        // Control: a non-blank, non-matching filter does exclude the row.
        val excluded = TestServices.feedbacks.list(
            view = FeedbackListView.PROVIDED,
            callerUserId = providerId,
            filter = FeedbackListFilter(subjectName = "no-such-subject-name"),
            paging = paging,
        )
        assertTrue(excluded.items.none { it.id == created.id })
    }
}
