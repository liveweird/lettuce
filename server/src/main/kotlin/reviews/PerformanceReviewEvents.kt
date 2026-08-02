package ch.nokillswit.reviews

import kotlinx.serialization.Serializable

/**
 * Pure mapping from a performance-review create / update / transition / delete to the structured
 * audit events it should record. Side-effect-free (no DB) so it can be unit-tested directly; the
 * acting user is the caller and persistence happens in the route (see PerformanceReviewRoutes).
 *
 * Events are stored structurally ([PerformanceReviewEventType] +
 * [PerformanceReviewEventDescriptor.params]) so the SPA renders each one in the viewer's
 * language. Params carry category/status enum names and numeric rating values only — NEVER
 * summary text (the summaries are encrypted at rest; performance_review_events.params is
 * plaintext).
 */

@Serializable
enum class PerformanceReviewEventType {
    CREATED,
    RATING_CHANGED,
    SUMMARY_CHANGED,
    STATUS_CHANGED,
    DELETED,
}

/** A structured audit event: its [type] plus string params for interpolation. */
data class PerformanceReviewEventDescriptor(
    val type: PerformanceReviewEventType,
    val params: Map<String, String> = emptyMap(),
)

// Ratings render as e.g. "3"; "" = no value (the unset side of a DRAFT-time change).
private fun ratingParam(rating: Int?): String = rating?.toString() ?: ""

/** Structured event recorded when a review is created (always as DRAFT). */
internal fun reviewCreationEvent(): PerformanceReviewEventDescriptor =
    PerformanceReviewEventDescriptor(PerformanceReviewEventType.CREATED)

/**
 * Structured events recorded on an assessment edit: one per changed aspect, in the canonical
 * category order, ratings before summaries per category. A summary change is recorded as the
 * bare fact ([PerformanceReviewEventType.SUMMARY_CHANGED] + the category) — never the text. A
 * no-op PUT returns an empty list (no empty events).
 */
internal fun reviewUpdateEvents(
    before: PerformanceReviewResponse,
    after: PerformanceReviewUpdateRequest,
): List<PerformanceReviewEventDescriptor> {
    val beforeAssessments = assessmentsOf(before)
    val events = mutableListOf<PerformanceReviewEventDescriptor>()
    assessmentsOf(after).forEach { (category, afterAssessment) ->
        val beforeAssessment = beforeAssessments.getValue(category)
        if (beforeAssessment.rating != afterAssessment.rating) {
            events += PerformanceReviewEventDescriptor(
                PerformanceReviewEventType.RATING_CHANGED,
                mapOf(
                    "category" to category.name,
                    "from" to ratingParam(beforeAssessment.rating),
                    "to" to ratingParam(afterAssessment.rating),
                ),
            )
        }
        // Normalize null vs "" — both mean "no summary", so flipping between them is a no-op.
        if ((beforeAssessment.summary ?: "") != (afterAssessment.summary ?: "")) {
            events += PerformanceReviewEventDescriptor(
                PerformanceReviewEventType.SUMMARY_CHANGED,
                mapOf("category" to category.name),
            )
        }
    }
    return events
}

/** Structured event recorded on every status transition (submit/revert/publish/unpublish). */
internal fun reviewTransitionEvent(
    from: PerformanceReviewStatus,
    to: PerformanceReviewStatus,
): PerformanceReviewEventDescriptor =
    PerformanceReviewEventDescriptor(
        PerformanceReviewEventType.STATUS_CHANGED,
        mapOf("from" to from.name, "to" to to.name),
    )

/** Structured event recorded when a draft review is deleted (soft-deleted) by its manager. */
internal fun reviewDeletionEvent(): PerformanceReviewEventDescriptor =
    PerformanceReviewEventDescriptor(PerformanceReviewEventType.DELETED)
