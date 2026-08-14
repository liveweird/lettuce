package ch.nokillswit.oneonones

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val OneOnOneEventServiceKey = AttributeKey<OneOnOneEventService>("OneOnOneEventService")

/**
 * The 1:1 meeting audit trail — a thin wrapper over the shared [EventLog] mechanics (the five
 * `*_events` tables are V15 clones; see infra/db/EventLog.kt). Only the typed DTO mapping
 * lives here.
 */
class OneOnOneEventService(val database: R2dbcDatabase) {
    object OneOnOneEvents : EventLogTable("one_on_one_events", "meeting_id", OneOnOneService.Meetings) {
        // Feature-named alias for direct DSL use (the same Column instance).
        val meetingId get() = ownerId
    }

    private val log = EventLog(database, OneOnOneEvents)

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: OneOnOneEvent): UInt =
        log.create(event.meetingId, event.userId, event.type.name, event.params)

    /** The 1:1 meeting's history, newest first (id descending as the same-instant tiebreaker), with acting user names. */
    suspend fun listForMeeting(meetingId: UInt): List<OneOnOneEventResponse> =
        log.listFor(meetingId).map {
            OneOnOneEventResponse(
                id = it.id,
                meetingId = it.ownerId,
                userId = it.userId,
                userName = it.userName,
                timestamp = it.timestamp,
                type = OneOnOneEventType.valueOf(it.type),
                params = it.params,
            )
        }
}
