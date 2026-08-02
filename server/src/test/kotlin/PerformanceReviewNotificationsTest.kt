package ch.nokillswit

import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.reviews.reviewTransitionNotifications
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Pure unit tests of the review notification builder — no server, no DB. */
class PerformanceReviewNotificationsTest {

    private fun build(from: PerformanceReviewStatus, to: PerformanceReviewStatus) =
        reviewTransitionNotifications(
            reviewId = 7u,
            from = from,
            to = to,
            subordinateId = 3u,
            managerName = "Mona Manager",
            periodStartMonth = "2026-01",
            periodEndMonth = "2026-06",
        )

    @Test
    fun `publishing notifies the subordinate with a view link and the period params`() {
        val notification = build(
            PerformanceReviewStatus.CALIBRATION, PerformanceReviewStatus.PUBLISHED,
        ).single()
        assertEquals(NotificationType.PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE, notification.type)
        assertEquals(3u, notification.recipientId)
        assertEquals("/performance-reviews/7/view", notification.link)
        assertEquals(
            mapOf("manager" to "Mona Manager", "startMonth" to "2026-01", "endMonth" to "2026-06"),
            notification.params,
        )
    }

    @Test
    fun `unpublishing notifies the subordinate WITHOUT a link - the review is unreadable again`() {
        val notification = build(
            PerformanceReviewStatus.PUBLISHED, PerformanceReviewStatus.CALIBRATION,
        ).single()
        assertEquals(NotificationType.PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE, notification.type)
        assertNull(notification.link)
    }

    @Test
    fun `draft-calibration transitions are silent - invisible to the subordinate`() {
        assertEquals(
            emptyList(),
            build(PerformanceReviewStatus.DRAFT, PerformanceReviewStatus.CALIBRATION),
        )
        assertEquals(
            emptyList(),
            build(PerformanceReviewStatus.CALIBRATION, PerformanceReviewStatus.DRAFT),
        )
    }
}
