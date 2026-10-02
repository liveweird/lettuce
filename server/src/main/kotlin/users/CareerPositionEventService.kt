package ch.nokillswit.users

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val CareerPositionEventServiceKey = AttributeKey<CareerPositionEventService>("CareerPositionEventService")

/**
 * The career-position action trail (v4.9.0, V89) — the ninth [EventLogTable] clone, person-keyed
 * like the days-off one (`owner_id` = the person whose timeline was touched, `user_id` = the
 * actor). Append-only and written by the routes after each service commit; its only reader is the
 * per-user activity log (`activity/ActivityService.kt`).
 */
class CareerPositionEventService(val database: R2dbcDatabase) {
    object CareerPositionEvents : EventLogTable("career_position_events", "owner_id", UserService.Users)

    private val log = EventLog(database, CareerPositionEvents)

    /** Inserts an event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: CareerPositionEvent): UInt =
        log.create(event.ownerId, event.userId, event.type.name, event.params)
}
