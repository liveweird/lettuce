package ch.nokillswit.reviews

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

val PerformanceReviewEventServiceKey =
    AttributeKey<PerformanceReviewEventService>("PerformanceReviewEventService")

class PerformanceReviewEventService(val database: R2dbcDatabase) {
    object ReviewEvents : UIntIdTable("performance_review_events") {
        val reviewId = reference("review_id", PerformanceReviewService.Reviews)
        val userId = reference("user_id", UserService.Users)
        val timestamp = long("created_at")
        // Structured event so the SPA can localize it: the kind plus a JSON params map.
        val eventType = varchar("event_type", 40)
        val params = text("params")
    }

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: PerformanceReviewEvent): UInt = suspendTransaction(database) {
        ReviewEvents.insert {
            it[reviewId] = event.reviewId
            it[userId] = event.userId
            it[timestamp] = System.currentTimeMillis()
            it[eventType] = event.type.name
            it[params] = encodeParams(event.params)
        }[ReviewEvents.id].value
    }

    /** The review's history, oldest first (id as a stable tiebreaker), with acting user names. */
    suspend fun listForReview(reviewId: UInt): List<PerformanceReviewEventResponse> =
        suspendTransaction(database) {
            (ReviewEvents innerJoin UserService.Users)
                .selectAll()
                .where { ReviewEvents.reviewId eq reviewId }
                .orderBy(ReviewEvents.timestamp to SortOrder.ASC, ReviewEvents.id to SortOrder.ASC)
                .map { it.toResponse() }
                .toList()
        }

    private fun ResultRow.toResponse() = PerformanceReviewEventResponse(
        id = this[ReviewEvents.id].value,
        reviewId = this[ReviewEvents.reviewId].value,
        userId = this[ReviewEvents.userId].value,
        userName = this[UserService.Users.name],
        timestamp = this[ReviewEvents.timestamp],
        type = PerformanceReviewEventType.valueOf(this[ReviewEvents.eventType]),
        params = decodeParams(this[ReviewEvents.params]),
    )
}
