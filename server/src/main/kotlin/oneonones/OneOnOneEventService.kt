package ch.nokillswit.oneonones

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

val OneOnOneEventServiceKey = AttributeKey<OneOnOneEventService>("OneOnOneEventService")

class OneOnOneEventService(val database: R2dbcDatabase) {
    object OneOnOneEvents : UIntIdTable("one_on_one_events") {
        val meetingId = reference("meeting_id", OneOnOneService.Meetings)
        val userId = reference("user_id", UserService.Users)
        val timestamp = long("created_at")
        // Structured event so the SPA can localize it: the kind plus a JSON params map.
        val eventType = varchar("event_type", 40)
        val params = text("params")
    }

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: OneOnOneEvent): UInt = suspendTransaction(database) {
        OneOnOneEvents.insert {
            it[meetingId] = event.meetingId
            it[userId] = event.userId
            it[timestamp] = System.currentTimeMillis()
            it[eventType] = event.type.name
            it[params] = encodeParams(event.params)
        }[OneOnOneEvents.id].value
    }

    /** The meeting's history, oldest first (id as a stable tiebreaker), with acting user names. */
    suspend fun listForMeeting(meetingId: UInt): List<OneOnOneEventResponse> = suspendTransaction(database) {
        (OneOnOneEvents innerJoin UserService.Users)
            .selectAll()
            .where { OneOnOneEvents.meetingId eq meetingId }
            .orderBy(OneOnOneEvents.timestamp to SortOrder.ASC, OneOnOneEvents.id to SortOrder.ASC)
            .map { it.toResponse() }
            .toList()
    }

    private fun ResultRow.toResponse() = OneOnOneEventResponse(
        id = this[OneOnOneEvents.id].value,
        meetingId = this[OneOnOneEvents.meetingId].value,
        userId = this[OneOnOneEvents.userId].value,
        userName = this[UserService.Users.name],
        timestamp = this[OneOnOneEvents.timestamp],
        type = OneOnOneEventType.valueOf(this[OneOnOneEvents.eventType]),
        params = decodeParams(this[OneOnOneEvents.params]),
    )
}
