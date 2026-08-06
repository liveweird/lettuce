package ch.nokillswit.reviews

import kotlinx.serialization.Serializable

/**
 * Pure mapping from a performance-review create / update / transition / delete to the structured
 * audit events it should record. Side-effect-free (no DB) so it can be unit-tested directly; the
 * acting user is the caller and persistence happens in the route (see PerformanceReviewRoutes).
 *
 * Events are stored structurally ([PerformanceReviewEventType] +
 * [PerformanceReviewEventDescriptor.params]) so the SPA renders each one in the viewer's
 * language. Params carry category/status enum names ONLY — never summary text and, since
 * v1.49.0, never rating values either (all eight assessment columns are encrypted at rest;
 * performance_review_events.params is plaintext, so values there would defeat the
 * encryption — V45 scrubbed the historical from/to rating params).
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

/** Structured event recorded when a review is created (always as DRAFT). */
internal fun reviewCreationEvent(): PerformanceReviewEventDescriptor =
    PerformanceReviewEventDescriptor(PerformanceReviewEventType.CREATED)

/**
 * Structured events recorded on an assessment edit: one per changed aspect, in the canonical
 * category order, ratings before summaries per category. Both change kinds are recorded as the
 * bare fact (event type + the category) — never the summary text and never the rating values
 * (ratings are encrypted at rest since v1.49.0; the params column is plaintext). A no-op PUT
 * returns an empty list (no empty events).
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
                mapOf("category" to category.name),
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
