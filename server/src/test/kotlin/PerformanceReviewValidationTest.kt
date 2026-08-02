package ch.nokillswit

import ch.nokillswit.reviews.CategoryAssessment
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.reviews.PerformanceReviewUpdateRequest
import ch.nokillswit.reviews.ReviewCategory
import ch.nokillswit.reviews.ReviewPeriodCreateRequest
import ch.nokillswit.reviews.assessmentsOf
import ch.nokillswit.reviews.monthAfter
import ch.nokillswit.reviews.parseReviewMonth
import ch.nokillswit.reviews.requireCompleteAssessments
import ch.nokillswit.reviews.validateAssessments
import ch.nokillswit.reviews.validateReviewPeriod
import io.ktor.server.plugins.BadRequestException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** Pure unit tests of the review validators — no server, no DB. */
class PerformanceReviewValidationTest {

    // ---- months ----

    @Test
    fun `parseReviewMonth accepts only strict zero-padded ISO months`() {
        assertEquals(java.time.YearMonth.of(2026, 1), parseReviewMonth("2026-01", "startMonth"))
        listOf("2026-1", "2026/01", "202601", "2026-13", "2026-00", "garbage", "", "2026-01-01").forEach {
            assertFailsWith<BadRequestException>("should reject '$it'") { parseReviewMonth(it, "startMonth") }
        }
    }

    @Test
    fun `validateReviewPeriod rejects a start after the end but allows a single-month period`() {
        validateReviewPeriod(ReviewPeriodCreateRequest("2026-01", "2026-06"))
        validateReviewPeriod(ReviewPeriodCreateRequest("2026-03", "2026-03")) // one month is fine
        assertFailsWith<BadRequestException> {
            validateReviewPeriod(ReviewPeriodCreateRequest("2026-07", "2026-06"))
        }
    }

    @Test
    fun `monthAfter rolls over a year boundary`() {
        assertEquals("2026-07", monthAfter("2026-06"))
        assertEquals("2027-01", monthAfter("2026-12"))
    }

    // ---- assessments ----

    private fun update(
        attitude: CategoryAssessment = CategoryAssessment(),
        delivery: CategoryAssessment = CategoryAssessment(),
        skills: CategoryAssessment = CategoryAssessment(),
        overall: CategoryAssessment = CategoryAssessment(),
    ) = PerformanceReviewUpdateRequest(attitude, delivery, skills, overall)

    @Test
    fun `validateAssessments accepts empty and complete payloads and enforces the 1-6 scale`() {
        validateAssessments(assessmentsOf(update())) // fully unset is a legal draft
        validateAssessments(assessmentsOf(update(attitude = CategoryAssessment(1, "min"))))
        validateAssessments(assessmentsOf(update(overall = CategoryAssessment(6, "max"))))
        assertFailsWith<BadRequestException> {
            validateAssessments(assessmentsOf(update(skills = CategoryAssessment(rating = 0))))
        }
        assertFailsWith<BadRequestException> {
            validateAssessments(assessmentsOf(update(delivery = CategoryAssessment(rating = 7))))
        }
        assertFailsWith<BadRequestException> {
            validateAssessments(
                assessmentsOf(update(attitude = CategoryAssessment(3, "x".repeat(4001)))),
            )
        }
    }

    @Test
    fun `requireCompleteAssessments demands all four ratings and non-blank summaries`() {
        val complete = update(
            attitude = CategoryAssessment(3, "a"),
            delivery = CategoryAssessment(4, "b"),
            skills = CategoryAssessment(5, "c"),
            overall = CategoryAssessment(4, "d"),
        )
        requireCompleteAssessments(assessmentsOf(complete))
        // A missing rating fails.
        assertFailsWith<BadRequestException> {
            requireCompleteAssessments(
                assessmentsOf(complete.copy(skills = CategoryAssessment(null, "c"))),
            )
        }
        // A blank (whitespace) summary fails just like a missing one.
        assertFailsWith<BadRequestException> {
            requireCompleteAssessments(
                assessmentsOf(complete.copy(overall = CategoryAssessment(4, "   "))),
            )
        }
    }

    @Test
    fun `assessmentsOf maps every category exactly once for both request shapes`() {
        val create = PerformanceReviewCreateRequest(
            subordinateId = 1u,
            periodId = 2u,
            attitude = CategoryAssessment(1, "a"),
            delivery = CategoryAssessment(2, "b"),
            skills = CategoryAssessment(3, "c"),
            overall = CategoryAssessment(4, "d"),
        )
        val mapped = assessmentsOf(create)
        assertEquals(ReviewCategory.entries.toSet(), mapped.keys)
        assertEquals(CategoryAssessment(3, "c"), mapped.getValue(ReviewCategory.SKILLS))
    }
}
