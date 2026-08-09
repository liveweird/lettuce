package ch.nokillswit.reviews

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val PerformanceReviewEventServiceKey = AttributeKey<PerformanceReviewEventService>("PerformanceReviewEventService")

/**
 * The performance review audit trail — a thin wrapper over the shared [EventLog] mechanics (the five
 * `*_events` tables are V15 clones; see infra/db/EventLog.kt). Only the typed DTO mapping
 * lives here.
 */
class PerformanceReviewEventService(val database: R2dbcDatabase) {
    object ReviewEvents : EventLogTable("performance_review_events", "review_id", PerformanceReviewService.Reviews) {
        // Feature-named alias for direct DSL use (the same Column instance).
        val reviewId get() = ownerId
    }

    private val log = EventLog(database, ReviewEvents)

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: PerformanceReviewEvent): UInt =
        log.create(event.reviewId, event.userId, event.type.name, event.params)

    /** The performance review's history, oldest first (id as a stable tiebreaker), with acting user names. */
    suspend fun listForReview(reviewId: UInt): List<PerformanceReviewEventResponse> =
        log.listFor(reviewId).map {
            PerformanceReviewEventResponse(
                id = it.id,
                reviewId = it.ownerId,
                userId = it.userId,
                userName = it.userName,
                timestamp = it.timestamp,
                type = PerformanceReviewEventType.valueOf(it.type),
                params = it.params,
            )
        }
}
