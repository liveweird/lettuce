package ch.nokillswit.daysoff

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val DaysOffEventServiceKey = AttributeKey<DaysOffEventService>("DaysOffEventService")

/**
 * The days-off action trail (v4.9.0, V88) — the eighth [EventLogTable] clone, keyed on the PERSON
 * the action concerns (`owner_id` → users) with the actor in `user_id`. Append-only and written by
 * the routes after each service commit; its only reader is the per-user activity log
 * (`activity/ActivityService.kt`), so there is no per-owner listing here.
 */
class DaysOffEventService(val database: R2dbcDatabase) {
    object DaysOffEvents : EventLogTable("days_off_events", "owner_id", UserService.Users)

    private val log = EventLog(database, DaysOffEvents)

    /** Inserts an event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: DaysOffEvent): UInt =
        log.create(event.ownerId, event.userId, event.type.name, event.params)
}
