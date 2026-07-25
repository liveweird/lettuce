package ch.nokillswit.goals

import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.db.encodeParams
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val GoalEventServiceKey = AttributeKey<GoalEventService>("GoalEventService")

class GoalEventService(val database: R2dbcDatabase) {
    object GoalEvents : UIntIdTable("goal_events") {
        val goalId = reference("goal_id", GoalService.Goals)
        val userId = reference("user_id", UserService.Users)
        val timestamp = long("created_at")
        // Structured event so the SPA can localize it: the kind plus a JSON params map.
        val eventType = varchar("event_type", 40)
        val params = text("params")
    }

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: GoalEvent): UInt = suspendTransaction(database) {
        GoalEvents.insert {
            it[goalId] = event.goalId
            it[userId] = event.userId
            it[timestamp] = System.currentTimeMillis()
            it[eventType] = event.type.name
            it[params] = encodeParams(event.params)
        }[GoalEvents.id].value
    }

    /** The goal's history, oldest first (id as a stable tiebreaker), with acting user names. */
    suspend fun listForGoal(goalId: UInt): List<GoalEventResponse> = suspendTransaction(database) {
        (GoalEvents innerJoin UserService.Users)
            .selectAll()
            .where { GoalEvents.goalId eq goalId }
            .orderBy(GoalEvents.timestamp to SortOrder.ASC, GoalEvents.id to SortOrder.ASC)
            .map { it.toResponse() }
            .toList()
    }

    private fun ResultRow.toResponse() = GoalEventResponse(
        id = this[GoalEvents.id].value,
        goalId = this[GoalEvents.goalId].value,
        userId = this[GoalEvents.userId].value,
        userName = this[UserService.Users.name],
        timestamp = this[GoalEvents.timestamp],
        type = GoalEventType.valueOf(this[GoalEvents.eventType]),
        params = decodeParams(this[GoalEvents.params]),
    )
}
