package ch.nokillswit.goals

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val GoalEventServiceKey = AttributeKey<GoalEventService>("GoalEventService")

/**
 * The goal audit trail — a thin wrapper over the shared [EventLog] mechanics (the five
 * `*_events` tables are V15 clones; see infra/db/EventLog.kt). Only the typed DTO mapping
 * lives here.
 */
class GoalEventService(val database: R2dbcDatabase) {
    object GoalEvents : EventLogTable("goal_events", "goal_id", GoalService.Goals) {
        // Feature-named alias for direct DSL use (the same Column instance).
        val goalId get() = ownerId
    }

    private val log = EventLog(database, GoalEvents)

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: GoalEvent): UInt =
        log.create(event.goalId, event.userId, event.type.name, event.params)

    /** The goal's history, oldest first (id as a stable tiebreaker), with acting user names. */
    suspend fun listForGoal(goalId: UInt): List<GoalEventResponse> =
        log.listFor(goalId).map {
            GoalEventResponse(
                id = it.id,
                goalId = it.ownerId,
                userId = it.userId,
                userName = it.userName,
                timestamp = it.timestamp,
                type = GoalEventType.valueOf(it.type),
                params = it.params,
            )
        }
}
