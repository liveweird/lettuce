package ch.nokillswit

import ch.nokillswit.reviews.CategoryAssessment
import ch.nokillswit.reviews.PerformanceReviewEventType
import ch.nokillswit.reviews.PerformanceReviewResponse
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.reviews.PerformanceReviewUpdateRequest
import ch.nokillswit.reviews.reviewCreationEvent
import ch.nokillswit.reviews.reviewDeletionEvent
import ch.nokillswit.reviews.reviewTransitionEvent
import ch.nokillswit.reviews.reviewUpdateEvents
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Pure unit tests of the review event builders — no server, no DB. */
class PerformanceReviewEventsTest {

    private fun response(
        attitude: CategoryAssessment = CategoryAssessment(),
        delivery: CategoryAssessment = CategoryAssessment(),
        skills: CategoryAssessment = CategoryAssessment(),
        overall: CategoryAssessment = CategoryAssessment(),
    ) = PerformanceReviewResponse(
        id = 1u, managerId = 2u, subordinateId = 3u, periodId = 4u,
        periodStartMonth = "2026-01", periodEndMonth = "2026-06",
        status = PerformanceReviewStatus.DRAFT,
        attitude = attitude, delivery = delivery, skills = skills, overall = overall,
        createdAt = 1L, lastModified = 1L, managerName = "M", subordinateName = "S",
    )

    private fun update(
        attitude: CategoryAssessment = CategoryAssessment(),
        delivery: CategoryAssessment = CategoryAssessment(),
        skills: CategoryAssessment = CategoryAssessment(),
        overall: CategoryAssessment = CategoryAssessment(),
    ) = PerformanceReviewUpdateRequest(attitude, delivery, skills, overall)

    @Test
    fun `creation, transition, and deletion events carry their structural params`() {
        assertEquals(PerformanceReviewEventType.CREATED, reviewCreationEvent().type)
        assertEquals(emptyMap(), reviewCreationEvent().params)

        val transition = reviewTransitionEvent(
            PerformanceReviewStatus.DRAFT, PerformanceReviewStatus.CALIBRATION,
        )
        assertEquals(PerformanceReviewEventType.STATUS_CHANGED, transition.type)
        assertEquals(mapOf("from" to "DRAFT", "to" to "CALIBRATION"), transition.params)

        assertEquals(PerformanceReviewEventType.DELETED, reviewDeletionEvent().type)
    }

    @Test
    fun `a no-op update mints nothing`() {
        val before = response(attitude = CategoryAssessment(3, "steady"))
        val after = update(attitude = CategoryAssessment(3, "steady"))
        assertEquals(emptyList(), reviewUpdateEvents(before, after))
    }

    @Test
    fun `one event per changed aspect, ratings numeric with empty string for unset`() {
        val before = response(
            attitude = CategoryAssessment(3, "old attitude text"),
            delivery = CategoryAssessment(null, null),
        )
        val after = update(
            attitude = CategoryAssessment(5, "old attitude text"), // rating only
            delivery = CategoryAssessment(2, "new delivery text"), // both, from unset
        )
        val events = reviewUpdateEvents(before, after)
        assertEquals(
            listOf(
                PerformanceReviewEventType.RATING_CHANGED, // attitude 3 -> 5
                PerformanceReviewEventType.RATING_CHANGED, // delivery "" -> 2
                PerformanceReviewEventType.SUMMARY_CHANGED, // delivery summary appeared
            ),
            events.map { it.type },
        )
        assertEquals(
            mapOf("category" to "ATTITUDE", "from" to "3", "to" to "5"),
            events[0].params,
        )
        assertEquals(
            mapOf("category" to "DELIVERY", "from" to "", "to" to "2"),
            events[1].params,
        )
        // The summary event names the category and NOTHING else — never the text.
        assertEquals(mapOf("category" to "DELIVERY"), events[2].params)
        events.forEach { event ->
            event.params.values.forEach { assertTrue("text" !in it) }
        }
    }

    @Test
    fun `null and empty summaries are the same non-value`() {
        val before = response(skills = CategoryAssessment(2, null))
        val after = update(skills = CategoryAssessment(2, ""))
        assertEquals(emptyList(), reviewUpdateEvents(before, after))
    }
}
