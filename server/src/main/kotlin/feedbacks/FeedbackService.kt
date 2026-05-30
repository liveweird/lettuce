package ch.nokillswit.feedbacks

import ch.nokillswit.users.UserService
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val FeedbackServiceKey = AttributeKey<FeedbackService>("FeedbackService")

class FeedbackService(val database: R2dbcDatabase) {
    object Feedbacks : UIntIdTable("feedbacks") {
        val requesterId = reference("requester_id", UserService.Users).nullable()
        val subjectId = reference("subject_id", UserService.Users)
        val providerId = reference("provider_id", UserService.Users)
        val visibility = enumerationByName("visibility", 40, FeedbackVisibility::class)
        val status = enumerationByName("status", 20, FeedbackStatus::class)
        val content = text("content")
    }

    suspend fun create(feedback: Feedback): UInt = suspendTransaction(database) {
        validate(current = null, next = feedback)
        val newRecord = Feedbacks.insert {
            it[requesterId] = feedback.requesterId
            it[subjectId] = feedback.subjectId
            it[providerId] = feedback.providerId
            it[visibility] = feedback.visibility
            it[status] = feedback.status
            it[content] = feedback.content
        }
        newRecord[Feedbacks.id].value
    }

    suspend fun read(id: UInt): Feedback? = suspendTransaction(database) {
        Feedbacks.selectAll()
            .where { Feedbacks.id eq id }
            .map { row ->
                Feedback(
                    requesterId = row[Feedbacks.requesterId]?.value,
                    subjectId = row[Feedbacks.subjectId].value,
                    providerId = row[Feedbacks.providerId].value,
                    visibility = row[Feedbacks.visibility],
                    status = row[Feedbacks.status],
                    content = row[Feedbacks.content],
                )
            }
            .singleOrNull()
    }

    suspend fun update(id: UInt, feedback: Feedback) {
        suspendTransaction(database) {
            val current = Feedbacks.selectAll()
                .where { Feedbacks.id eq id }
                .map { row ->
                    Feedback(
                        requesterId = row[Feedbacks.requesterId]?.value,
                        subjectId = row[Feedbacks.subjectId].value,
                        providerId = row[Feedbacks.providerId].value,
                        visibility = row[Feedbacks.visibility],
                        status = row[Feedbacks.status],
                        content = row[Feedbacks.content],
                    )
                }
                .singleOrNull()
                ?: return@suspendTransaction
            validate(current = current, next = feedback)
            Feedbacks.update({ Feedbacks.id eq id }) {
                it[requesterId] = feedback.requesterId
                it[subjectId] = feedback.subjectId
                it[providerId] = feedback.providerId
                it[visibility] = feedback.visibility
                it[status] = feedback.status
                it[content] = feedback.content
            }
        }
    }

    suspend fun delete(id: UInt) {
        suspendTransaction(database) { Feedbacks.deleteWhere { Feedbacks.id eq id } }
    }

    private fun validate(current: Feedback?, next: Feedback) {
        if (next.providerId == next.subjectId) {
            throw BadRequestException("Provider and subject must differ")
        }
        if (next.requesterId != null && next.requesterId == next.providerId) {
            throw BadRequestException("Requester cannot also be the provider")
        }
        if (next.status == FeedbackStatus.REQUESTED && next.requesterId == null) {
            throw BadRequestException("Requested status requires a requester")
        }
        if (current != null && current.status != next.status && !isAllowedTransition(current.status, next.status)) {
            throw BadRequestException("Invalid status transition: ${current.status} -> ${next.status}")
        }
    }

    private fun isAllowedTransition(from: FeedbackStatus, to: FeedbackStatus): Boolean = when (from to to) {
        FeedbackStatus.REQUESTED to FeedbackStatus.DRAFT,
        FeedbackStatus.DRAFT to FeedbackStatus.SENT,
        FeedbackStatus.DRAFT to FeedbackStatus.WITHDRAWN,
        FeedbackStatus.SENT to FeedbackStatus.WITHDRAWN -> true
        else -> false
    }
}
