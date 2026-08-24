package ch.nokillswit.impactlog

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val ImpactLogEventServiceKey = AttributeKey<ImpactLogEventService>("ImpactLogEventService")

/**
 * The impact log audit trail — a thin wrapper over the shared [EventLog] mechanics (see
 * infra/db/EventLog.kt). Only the typed DTO mapping lives here; params are content-free by the
 * house invariant (dates and field names only — the sections are encrypted on the entry), so
 * unlike goal_events no encrypted comment column is needed and the service stays cipher-free.
 */
class ImpactLogEventService(val database: R2dbcDatabase) {

    object ImpactLogEvents : EventLogTable("impact_log_events", "entry_id", ImpactLogService.Entries) {
        // Feature-named alias for direct DSL use (the same Column instance).
        val entryId get() = ownerId
    }

    private val log = EventLog(database, ImpactLogEvents)

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: ImpactEntryEvent): UInt =
        log.create(event.entryId, event.userId, event.type.name, event.params)

    /** The entry's history, newest first (id descending as the same-instant tiebreaker), with acting user names. */
    suspend fun listForEntry(entryId: UInt): List<ImpactEntryEventResponse> =
        log.listFor(entryId).map {
            ImpactEntryEventResponse(
                id = it.id,
                entryId = it.ownerId,
                userId = it.userId,
                userName = it.userName,
                timestamp = it.timestamp,
                type = ImpactEntryEventType.valueOf(it.type),
                params = it.params,
            )
        }
}
