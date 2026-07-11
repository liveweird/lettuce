package ch.nokillswit.feedbacks

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.db.containsPattern
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.directSubordinateIds
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.teams.transitiveSubordinateIds
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
    val providerId: UInt? = null,
    val subjectId: UInt? = null,
    val visibility: FeedbackVisibility? = null,
    val status: FeedbackStatus? = null,
    val lastModifiedGte: Long? = null,
)

data class FeedbackListResult(
    val items: List<FeedbackListItem>,
    val total: Long,
)

data class FeedbackCreateResult(
    val id: UInt,
    val notifications: List<Notification>,
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
    "lastModified" to FeedbackService.Feedbacks.lastModified,
)

// The Received scope mirrors canReadFeedback's subject/requester branches (authz/Guards.kt) so
// the list never shows a row the single GET would 403 on.
private val SUBJECT_VISIBILITIES = listOf(
    FeedbackVisibility.PROVIDER_SUBJECT,
    FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
)
private val REQUESTER_VISIBILITIES = listOf(
    FeedbackVisibility.PROVIDER_REQUESTER,
    FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
)

// A feedback the caller is not a party to (Received / My team lists) is only shown once delivered.
private val DELIVERED_STATUSES = FeedbackStatus.entries.filter { it.isDelivered }

const val CONTENT_PREVIEW_LENGTH = 200

// content/requester_message are encrypted at rest (see infra/crypto/FieldCipher.kt): the cipher
// wraps every write and unwraps every read, so nothing above this service ever sees ciphertext.
// Neither column is filtered/sorted/searched in SQL, so queries are unaffected.
class FeedbackService(val database: R2dbcDatabase, private val cipher: FieldCipher) {
    object Feedbacks : UIntIdTable("feedbacks") {
        val requesterId = reference("requester_id", UserService.Users).nullable()
        val subjectId = reference("subject_id", UserService.Users)
        val providerId = reference("provider_id", UserService.Users)
        val visibility = enumerationByName("visibility", 40, FeedbackVisibility::class)
        val status = enumerationByName("status", 20, FeedbackStatus::class)
        val content = text("content")
        val requesterMessage = text("requester_message").nullable()
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Feedbacks.markedAsDeleted eq false

    /**
     * Inserts the feedback and returns its id together with any notifications its creation should
     * produce (currently only a brand-new REQUESTED feedback notifies the provider). The caller
     * persists them, mirroring [update].
     */
    suspend fun create(feedback: Feedback): FeedbackCreateResult = suspendTransaction(database) {
        validate(current = null, next = feedback)
        val newRecord = Feedbacks.insert {
            it[requesterId] = feedback.requesterId
            it[subjectId] = feedback.subjectId
            it[providerId] = feedback.providerId
            it[visibility] = feedback.visibility
            it[status] = feedback.status
            it[content] = cipher.encrypt(feedback.content)
            it[requesterMessage] = feedback.requesterMessage?.let(cipher::encrypt)
            it[lastModified] = System.currentTimeMillis()
        }
        val id = newRecord[Feedbacks.id].value
        val notifications = if (feedback.status == FeedbackStatus.REQUESTED) {
            feedbackCreationNotifications(id, feedback, resolvePartyNames(feedback))
        } else {
            emptyList()
        }
        FeedbackCreateResult(id, notifications)
    }

    // Single source for row → Feedback; shared by read() and the current-state read in update().
    private fun ResultRow.toFeedback(): Feedback = Feedback(
        requesterId = this[Feedbacks.requesterId]?.value,
        subjectId = this[Feedbacks.subjectId].value,
        providerId = this[Feedbacks.providerId].value,
        visibility = this[Feedbacks.visibility],
        status = this[Feedbacks.status],
        content = cipher.decrypt(this[Feedbacks.content]),
        requesterMessage = this[Feedbacks.requesterMessage]?.let(cipher::decrypt),
        lastModified = this[Feedbacks.lastModified],
    )

    suspend fun read(id: UInt): Feedback? = suspendTransaction(database) {
        Feedbacks.selectAll()
            .where { (Feedbacks.id eq id) and active() }
            .map { it.toFeedback() }
            .singleOrNull()
    }

    /**
     * Edits a feedback's content/visibility (never its status, parties, or requester message).
     * Returns the affected-row count (0 → missing/deleted, mapped to 404 by the route).
     */
    suspend fun editContent(id: UInt, content: String, visibility: FeedbackVisibility): Int {
        return suspendTransaction(database) {
            val current = Feedbacks.selectAll()
                .where { (Feedbacks.id eq id) and active() }
                .map { it.toFeedback() }
                .singleOrNull()
                ?: return@suspendTransaction 0
            // A feedback with a requester must not use PROVIDER_SUBJECT (which would exclude them).
            if (current.requesterId != null && visibility == FeedbackVisibility.PROVIDER_SUBJECT) {
                throw BadRequestException(
                    "A feedback with a requester must not use PROVIDER_SUBJECT visibility",
                )
            }
            // And without a requester, PROVIDER_REQUESTER is contradictory (see validate()).
            if (current.requesterId == null && visibility == FeedbackVisibility.PROVIDER_REQUESTER) {
                throw BadRequestException("PROVIDER_REQUESTER visibility requires a requester")
            }
            Feedbacks.update({ (Feedbacks.id eq id) and (Feedbacks.markedAsDeleted eq false) }) {
                it[this.content] = cipher.encrypt(content)
                it[this.visibility] = visibility
                it[lastModified] = System.currentTimeMillis()
            }
        }
    }

    /**
     * Moves a feedback to [target] via the status state machine and returns the notifications the
     * transition should produce (the caller persists them). Returns null when the row is missing
     * (→ 404); throws [ConflictException] (→ 409) when the transition is not allowed from the
     * current status.
     */
    suspend fun transition(id: UInt, target: FeedbackStatus): List<Notification>? {
        return suspendTransaction(database) {
            val current = Feedbacks.selectAll()
                .where { (Feedbacks.id eq id) and active() }
                .map { it.toFeedback() }
                .singleOrNull()
                ?: return@suspendTransaction null
            if (!isAllowedTransition(current.status, target)) {
                throw ConflictException("Invalid status transition: ${current.status} -> $target")
            }
            Feedbacks.update({ (Feedbacks.id eq id) and (Feedbacks.markedAsDeleted eq false) }) {
                it[status] = target
                it[lastModified] = System.currentTimeMillis()
            }
            val next = current.copy(status = target)
            feedbackTransitionNotifications(id, current.status, next, resolvePartyNames(next))
        }
    }

    /** Transaction-wrapped variant for callers outside an open transaction (e.g. routes). */
    suspend fun partyNames(feedback: Feedback): Map<UInt, String> =
        suspendTransaction(database) { resolvePartyNames(feedback) }

    private suspend fun resolvePartyNames(feedback: Feedback): Map<UInt, String> {
        val ids = listOfNotNull(feedback.subjectId, feedback.providerId, feedback.requesterId)
        return UserService.Users
            .select(UserService.Users.id, UserService.Users.name)
            .where { UserService.Users.id inList ids }
            .map { it[UserService.Users.id].value to it[UserService.Users.name] }
            .toList()
            .toMap()
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Feedbacks.update({ (Feedbacks.id eq id) and (Feedbacks.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    /**
     * Startup backfill (see infra/db/Bootstrap.kt): encrypts rows still holding legacy plaintext
     * — including soft-deleted ones, which retain their content. With [reencryptAll] (set during
     * key rotation, i.e. while a previous key is configured) every row is decrypted (current or
     * previous key) and rewritten under the current key. Idempotent; returns the rewritten count.
     */
    suspend fun encryptLegacyRows(reencryptAll: Boolean = false): Int = suspendTransaction(database) {
        val enveloped = "${FieldCipher.PREFIX}%"
        val legacyOnly = (Feedbacks.content notLike enveloped) or
            (Feedbacks.requesterMessage.isNotNull() and (Feedbacks.requesterMessage notLike enveloped))
        val rows = Feedbacks
            .select(Feedbacks.id, Feedbacks.content, Feedbacks.requesterMessage)
            .where { if (reencryptAll) Op.TRUE else legacyOnly }
            .toList()
        rows.forEach { row ->
            Feedbacks.update({ Feedbacks.id eq row[Feedbacks.id] }) {
                it[content] = cipher.encrypt(cipher.decrypt(row[Feedbacks.content]))
                it[requesterMessage] =
                    row[Feedbacks.requesterMessage]?.let { m -> cipher.encrypt(cipher.decrypt(m)) }
            }
        }
        rows.size
    }

    suspend fun list(
        view: FeedbackListView,
        callerUserId: UInt,
        filter: FeedbackListFilter,
        paging: PageRequest,
        includeIndirect: Boolean = false,
    ): FeedbackListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            FeedbackListView.RECEIVED -> {
                // The caller's inbox (subjectId == caller), scoped exactly like canReadFeedback
                // (authz/Guards.kt) so every listed row is also openable:
                // - as the requester of their own feedback: any status under a requester-readable
                //   visibility (an unfinished one has its content preview redacted below);
                // - as a plain subject (no requester, or someone else's request): only once
                //   delivered (SENT/WITHDRAWN) under a subject-readable visibility;
                // - PUBLIC rows in either role: only once SENT (the "anyone" rule).
                val publicSent = (Feedbacks.visibility eq FeedbackVisibility.PUBLIC) and
                    (Feedbacks.status eq FeedbackStatus.SENT)
                val iAmRequester = (Feedbacks.requesterId eq callerUserId) and
                    ((Feedbacks.visibility inList REQUESTER_VISIBILITIES) or publicSent)
                val asSubjectOnly =
                    (Feedbacks.requesterId.isNull() or (Feedbacks.requesterId neq callerUserId)) and
                        (
                            ((Feedbacks.visibility inList SUBJECT_VISIBILITIES) and
                                (Feedbacks.status inList DELIVERED_STATUSES)) or publicSent
                        )
                (Feedbacks.subjectId eq callerUserId) and (iAmRequester or asSubjectOnly)
            }
            FeedbackListView.PROVIDED -> Feedbacks.providerId eq callerUserId
            FeedbackListView.TEAM -> {
                // Direct reports by default; with includeIndirect the whole transitive
                // management chain (members of teams the caller manages, plus recursively
                // the members of teams those members manage).
                val subordinateIds =
                    if (includeIndirect) transitiveSubordinateIds(callerUserId)
                    else directSubordinateIds(callerUserId)
                // I see a subordinate's feedback if I'm a party (provider or requester) for any
                // status; otherwise only once it's delivered (SENT/WITHDRAWN).
                val iAmParty = (Feedbacks.providerId eq callerUserId) or
                    (Feedbacks.requesterId eq callerUserId)
                if (subordinateIds.isEmpty()) {
                    Op.FALSE
                } else {
                    (Feedbacks.subjectId inList subordinateIds) and
                        (iAmParty or (Feedbacks.status inList DELIVERED_STATUSES))
                }
            }
        }
        val predicate: Op<Boolean> = scope and buildPredicate(filter) and active()
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
                Feedbacks.lastModified,
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
                // Mirror canReadFeedbackContent: a requester watching an unfinished feedback sees
                // that it exists but not its content.
                val unfinished = row[Feedbacks.status] == FeedbackStatus.DRAFT ||
                    row[Feedbacks.status] == FeedbackStatus.REQUESTED
                val redactContent = unfinished && row[Feedbacks.requesterId]?.value == callerUserId
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
                    contentPreview = if (redactContent) "" else cipher.decrypt(row[Feedbacks.content]).take(CONTENT_PREVIEW_LENGTH),
                    lastModified = row[Feedbacks.lastModified],
                )
            }
            .toList()
        FeedbackListResult(items = rows, total = total)
    }

    /**
     * True iff [managerId] is in [subjectId]'s management chain — the manager of a non-deleted
     * team the subject belongs to, or, transitively, the manager of such a manager, and so on.
     * Mirrors the widest ([FeedbackListView.TEAM] with includeIndirect=true) list scope so a
     * manager who can list a subordinate's feedback can also read the individual record
     * (the list's direct-only default is a narrower slice of the same right, not a separate
     * authorization). The walk itself lives in teams/ManagementChain.kt ([isInManagementChain])
     * and is shared with the 1:1 meetings feature.
     */
    suspend fun managesSubject(managerId: UInt, subjectId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(managerId, subjectId) }

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
        filter.providerId?.let { op = op and (Feedbacks.providerId eq it) }
        filter.subjectId?.let { op = op and (Feedbacks.subjectId eq it) }
        filter.visibility?.let { op = op and (Feedbacks.visibility eq it) }
        filter.status?.let { op = op and (Feedbacks.status eq it) }
        filter.lastModifiedGte?.let { op = op and (Feedbacks.lastModified greaterEq it) }
        return op
    }

    private fun validate(current: Feedback?, next: Feedback) {
        // provider == subject is the SELF-REFLECTION case: feedback about yourself. It may exist
        // on its own (the SPA's Self-reflection screen, no requester) or with a requester — a
        // manager's "Request feedback" may include the subject among the providers, asking them
        // for a self-reflection. requester ≠ provider (below) still prevents requesting one from
        // yourself.
        if (next.requesterId != null && next.requesterId == next.providerId) {
            throw BadRequestException("Requester cannot also be the provider")
        }
        if (next.requesterId != null && next.visibility == FeedbackVisibility.PROVIDER_SUBJECT) {
            throw BadRequestException("A feedback with a requester must not use PROVIDER_SUBJECT visibility")
        }
        // The mirror image: PROVIDER_REQUESTER visibility excludes the subject, so without a
        // requester nobody but the provider could ever read it — and the subject's Received
        // list would leak its preview (no-requester rows skip the visibility filter there).
        if (next.requesterId == null && next.visibility == FeedbackVisibility.PROVIDER_REQUESTER) {
            throw BadRequestException("PROVIDER_REQUESTER visibility requires a requester")
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
