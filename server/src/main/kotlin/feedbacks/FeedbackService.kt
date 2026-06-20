package ch.nokillswit.feedbacks

import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.teams.TeamService
import ch.nokillswit.users.UserService
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val FeedbackServiceKey = AttributeKey<FeedbackService>("FeedbackService")

enum class FeedbackListView { RECEIVED, PROVIDED, TEAM }

data class FeedbackListFilter(
    val requesterName: String? = null,
    val subjectName: String? = null,
    val providerName: String? = null,
    val visibility: FeedbackVisibility? = null,
    val status: FeedbackStatus? = null,
)

data class FeedbackListResult(
    val items: List<FeedbackListItem>,
    val total: Long,
)

private val requesterUsers = UserService.Users.alias("requester_users")
private val subjectUsers = UserService.Users.alias("subject_users")
private val providerUsers = UserService.Users.alias("provider_users")

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to FeedbackService.Feedbacks.id,
    "requesterName" to requesterUsers[UserService.Users.name],
    "subjectName" to subjectUsers[UserService.Users.name],
    "providerName" to providerUsers[UserService.Users.name],
    "visibility" to FeedbackService.Feedbacks.visibility,
    "status" to FeedbackService.Feedbacks.status,
)

private val RECEIVED_VISIBILITIES = listOf(
    FeedbackVisibility.PROVIDER_SUBJECT,
    FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
    FeedbackVisibility.PUBLIC,
)

const val CONTENT_PREVIEW_LENGTH = 200

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

    suspend fun list(
        view: FeedbackListView,
        callerUserId: UInt,
        filter: FeedbackListFilter,
        paging: PageRequest,
    ): FeedbackListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            FeedbackListView.RECEIVED -> (Feedbacks.subjectId eq callerUserId) and
                (Feedbacks.visibility inList RECEIVED_VISIBILITIES)
            FeedbackListView.PROVIDED -> Feedbacks.providerId eq callerUserId
            FeedbackListView.TEAM -> {
                // Subjects that are members of a team the caller manages (their subordinates).
                val subordinateIds = TeamService.TeamMembers
                    .join(
                        TeamService.Teams,
                        JoinType.INNER,
                        onColumn = TeamService.TeamMembers.teamId,
                        otherColumn = TeamService.Teams.id,
                    )
                    .select(TeamService.TeamMembers.userId)
                    .where {
                        (TeamService.Teams.managerId eq callerUserId) and
                            (TeamService.Teams.markedAsDeleted eq false)
                    }
                Feedbacks.subjectId inSubQuery subordinateIds
            }
        }
        val predicate: Op<Boolean> = scope and buildPredicate(filter)
        val join = Feedbacks
            .join(
                subjectUsers,
                JoinType.INNER,
                onColumn = Feedbacks.subjectId,
                otherColumn = subjectUsers[UserService.Users.id],
            )
            .join(
                providerUsers,
                JoinType.INNER,
                onColumn = Feedbacks.providerId,
                otherColumn = providerUsers[UserService.Users.id],
            )
            .join(
                requesterUsers,
                JoinType.LEFT,
                onColumn = Feedbacks.requesterId,
                otherColumn = requesterUsers[UserService.Users.id],
            )
        val total = join.selectAll().where { predicate }.count()
        val rows = join
            .select(
                Feedbacks.id,
                Feedbacks.requesterId,
                Feedbacks.subjectId,
                Feedbacks.providerId,
                Feedbacks.visibility,
                Feedbacks.status,
                Feedbacks.content,
                requesterUsers[UserService.Users.name],
                requesterUsers[UserService.Users.markedAsDeleted],
                subjectUsers[UserService.Users.name],
                subjectUsers[UserService.Users.markedAsDeleted],
                providerUsers[UserService.Users.name],
                providerUsers[UserService.Users.markedAsDeleted],
            )
            .where { predicate }
            .applyPaging(paging, SORTABLE_COLUMNS)
            .map { row ->
                FeedbackListItem(
                    id = row[Feedbacks.id].value,
                    requesterId = row[Feedbacks.requesterId]?.value,
                    requesterName = row.getOrNull(requesterUsers[UserService.Users.name]),
                    requesterDeleted = row.getOrNull(requesterUsers[UserService.Users.markedAsDeleted]) ?: false,
                    subjectId = row[Feedbacks.subjectId].value,
                    subjectName = row[subjectUsers[UserService.Users.name]],
                    subjectDeleted = row[subjectUsers[UserService.Users.markedAsDeleted]],
                    providerId = row[Feedbacks.providerId].value,
                    providerName = row[providerUsers[UserService.Users.name]],
                    providerDeleted = row[providerUsers[UserService.Users.markedAsDeleted]],
                    visibility = row[Feedbacks.visibility],
                    status = row[Feedbacks.status],
                    contentPreview = row[Feedbacks.content].take(CONTENT_PREVIEW_LENGTH),
                )
            }
            .toList()
        FeedbackListResult(items = rows, total = total)
    }

    /**
     * True iff [subjectId] is a member of a non-deleted team managed by [managerId].
     * Mirrors the scope of [FeedbackListView.TEAM] so a manager who can list a
     * subordinate's feedback can also read the individual record.
     */
    suspend fun managesSubject(managerId: UInt, subjectId: UInt): Boolean =
        suspendTransaction(database) {
            TeamService.TeamMembers
                .join(
                    TeamService.Teams,
                    JoinType.INNER,
                    onColumn = TeamService.TeamMembers.teamId,
                    otherColumn = TeamService.Teams.id,
                )
                .selectAll()
                .where {
                    (TeamService.Teams.managerId eq managerId) and
                        (TeamService.Teams.markedAsDeleted eq false) and
                        (TeamService.TeamMembers.userId eq subjectId)
                }
                .limit(1)
                .count() > 0
        }

    private fun buildPredicate(filter: FeedbackListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.requesterName?.takeIf { it.isNotBlank() }?.let {
            op = op and (requesterUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.subjectName?.takeIf { it.isNotBlank() }?.let {
            op = op and (subjectUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.providerName?.takeIf { it.isNotBlank() }?.let {
            op = op and (providerUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.visibility?.let { op = op and (Feedbacks.visibility eq it) }
        filter.status?.let { op = op and (Feedbacks.status eq it) }
        return op
    }

    private fun containsPattern(raw: String): LikePattern {
        val escaped = raw.lowercase()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        return LikePattern("%$escaped%", escapeChar = '\\')
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
        FeedbackStatus.REQUESTED to FeedbackStatus.REJECTED,
        FeedbackStatus.DRAFT to FeedbackStatus.SENT,
        FeedbackStatus.DRAFT to FeedbackStatus.WITHDRAWN,
        FeedbackStatus.SENT to FeedbackStatus.WITHDRAWN -> true
        else -> false
    }
}
