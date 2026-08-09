package ch.nokillswit.reviews

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure mapping from a performance-review status transition to the notifications it should
 * produce. The subordinate can only ever read a PUBLISHED review, so only the edges that cross
 * the publication boundary notify them: CALIBRATION→PUBLISHED carries a view link;
 * PUBLISHED→CALIBRATION (a retraction) carries none — the review is no longer readable to them
 * (the team-KPI deactivate precedent). DRAFT↔CALIBRATION transitions are invisible to the
 * subordinate and stay silent; creation, edits, and deletion notify nobody. Side-effect-free
 * (no DB); [PerformanceReviewService.transition] resolves the manager's name and the route
 * persists the result.
 *
 * The period months ride along raw (ISO YYYY-MM) — the SPA formats the period per locale.
 */
internal fun reviewTransitionNotifications(
    reviewId: UInt,
    from: PerformanceReviewStatus,
    to: PerformanceReviewStatus,
    subordinateId: UInt,
    managerName: String,
    periodStartMonth: String,
    periodEndMonth: String,
): List<Notification> {
    val (type, link) = when (from to to) {
        PerformanceReviewStatus.CALIBRATION to PerformanceReviewStatus.PUBLISHED ->
            NotificationType.PERFORMANCE_REVIEW_PUBLISHED_TO_SUBORDINATE to
                "/performance-reviews/$reviewId/view"
        PerformanceReviewStatus.PUBLISHED to PerformanceReviewStatus.CALIBRATION ->
            NotificationType.PERFORMANCE_REVIEW_UNPUBLISHED_TO_SUBORDINATE to null
        // DRAFT <-> CALIBRATION is DELIBERATELY silent — the subordinate cannot see either
        // status, so there is nothing to tell them. Named explicitly so the terminal else can
        // fail loud on a genuinely unknown edge (a future one forgetting its wording).
        PerformanceReviewStatus.DRAFT to PerformanceReviewStatus.CALIBRATION,
        PerformanceReviewStatus.CALIBRATION to PerformanceReviewStatus.DRAFT,
        -> return emptyList()
        else -> error("Not a performance-review transition edge: $from -> $to")
    }
    return listOf(
        Notification(
            recipientId = subordinateId,
            type = type,
            params = mapOf(
                "manager" to managerName,
                "startMonth" to periodStartMonth,
                "endMonth" to periodEndMonth,
            ),
            link = link,
        ),
    )
}
