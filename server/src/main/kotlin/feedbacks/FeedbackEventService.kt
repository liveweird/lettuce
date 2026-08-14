package ch.nokillswit.feedbacks

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val FeedbackEventServiceKey = AttributeKey<FeedbackEventService>("FeedbackEventService")

/**
 * The feedback audit trail — a thin wrapper over the shared [EventLog] mechanics (the five
 * `*_events` tables are V15 clones; see infra/db/EventLog.kt). Only the typed DTO mapping
 * lives here.
 */
class FeedbackEventService(val database: R2dbcDatabase) {
    object FeedbackEvents : EventLogTable("feedback_events", "feedback_id", FeedbackService.Feedbacks) {
        // Feature-named alias for direct DSL use (the same Column instance).
        val feedbackId get() = ownerId
    }

    private val log = EventLog(database, FeedbackEvents)

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: FeedbackEvent): UInt =
        log.create(event.feedbackId, event.userId, event.type.name, event.params)

    /** The feedback's history, newest first (id descending as the same-instant tiebreaker), with acting user names. */
    suspend fun listForFeedback(feedbackId: UInt): List<FeedbackEventResponse> =
        log.listFor(feedbackId).map {
            FeedbackEventResponse(
                id = it.id,
                feedbackId = it.ownerId,
                userId = it.userId,
                userName = it.userName,
                timestamp = it.timestamp,
                type = FeedbackEventType.valueOf(it.type),
                params = it.params,
            )
        }
}
