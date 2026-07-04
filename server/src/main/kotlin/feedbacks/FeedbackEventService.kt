package ch.nokillswit.feedbacks

import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.Json
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val FeedbackEventServiceKey = AttributeKey<FeedbackEventService>("FeedbackEventService")

private val paramsSerializer = MapSerializer(String.serializer(), String.serializer())

class FeedbackEventService(val database: R2dbcDatabase) {
    object FeedbackEvents : UIntIdTable("feedback_events") {
        val feedbackId = reference("feedback_id", FeedbackService.Feedbacks)
        val userId = reference("user_id", UserService.Users)
        val timestamp = long("created_at")
        // Structured event so the SPA can localize it: the kind plus a JSON params map.
        val eventType = varchar("event_type", 40)
        val params = text("params")
    }

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: FeedbackEvent): UInt = suspendTransaction(database) {
        FeedbackEvents.insert {
            it[feedbackId] = event.feedbackId
            it[userId] = event.userId
            it[timestamp] = System.currentTimeMillis()
            it[eventType] = event.type.name
            it[params] = Json.encodeToString(paramsSerializer, event.params)
        }[FeedbackEvents.id].value
    }

    /** The feedback's history, oldest first (id as a stable tiebreaker), with acting user names. */
    suspend fun listForFeedback(feedbackId: UInt): List<FeedbackEventResponse> = suspendTransaction(database) {
        (FeedbackEvents innerJoin UserService.Users)
            .selectAll()
            .where { FeedbackEvents.feedbackId eq feedbackId }
            .orderBy(FeedbackEvents.timestamp to SortOrder.ASC, FeedbackEvents.id to SortOrder.ASC)
            .map { it.toResponse() }
            .toList()
    }

    private fun ResultRow.toResponse() = FeedbackEventResponse(
        id = this[FeedbackEvents.id].value,
        feedbackId = this[FeedbackEvents.feedbackId].value,
        userId = this[FeedbackEvents.userId].value,
        userName = this[UserService.Users.name],
        timestamp = this[FeedbackEvents.timestamp],
        type = FeedbackEventType.valueOf(this[FeedbackEvents.eventType]),
        params = Json.decodeFromString(paramsSerializer, this[FeedbackEvents.params]),
    )
}
