package ch.nokillswit.feedbacks

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.db.containsPattern
import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.directManagerIds
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
import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val FeedbackServiceKey = AttributeKey<FeedbackService>("FeedbackService")

enum class FeedbackListView { RECEIVED, PROVIDED, TEAM, USER }

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

// "In progress" for the no-duplicate invariant: a second feedback with the same
// (subject, provider, requester) triple may not be created while one of these exists.
private val OPEN_STATUSES = listOf(FeedbackStatus.DRAFT, FeedbackStatus.REQUESTED)

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
        // No-duplicate invariant: while a feedback with the same (subject, provider, requester)
        // triple is still in progress (DRAFT or REQUESTED), a second one may not be created —
        // finish or discard the existing one instead (the 409's instance points at it).
        findOpenDuplicateInTx(feedback.subjectId, feedback.providerId, feedback.requesterId)?.let { (dupId, _) ->
            throw ConflictException(
                "A feedback for this subject, provider and requester is already in progress",
                instance = "/api/v1/feedbacks/$dupId",
            )
        }
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
        // The pure mapping decides per status (REQUESTED and direct-SENT notify; DRAFT doesn't).
        val notifications = feedbackCreationNotifications(
            id,
            feedback,
            resolvePartyNames(feedback),
            subjectManagerNames = resolveSubjectManagerNames(feedback),
        )
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
            if (target == FeedbackStatus.DRAFT) {
                // Pick-up guard: a request may not become a second draft when a matching one
                // already exists (reachable only with duplicates predating the create-time
                // no-duplicate invariant).
                findOpenDuplicateInTx(
                    current.subjectId,
                    current.providerId,
                    current.requesterId,
                    statuses = listOf(FeedbackStatus.DRAFT),
                )?.let { (dupId, _) ->
                    throw ConflictException(
                        "A draft for this subject, provider and requester already exists",
                        instance = "/api/v1/feedbacks/$dupId",
                    )
                }
            }
            Feedbacks.update({ (Feedbacks.id eq id) and (Feedbacks.markedAsDeleted eq false) }) {
                it[status] = target
                it[lastModified] = System.currentTimeMillis()
            }
            val next = current.copy(status = target)
            feedbackTransitionNotifications(
                id,
                current.status,
                next,
                resolvePartyNames(next),
                subjectManagerNames = resolveSubjectManagerNames(next),
            )
        }
    }

    /**
     * id → name of the subject's direct managers, resolved only when the feedback lands in SENT
     * (the moment they gain read access — see feedbackTransitionNotifications); empty otherwise,
     * so non-SENT paths pay no extra queries. Soft-deleted managers are skipped.
     */
    private suspend fun resolveSubjectManagerNames(feedback: Feedback): Map<UInt, String> {
        if (feedback.status != FeedbackStatus.SENT) return emptyMap()
        val managerIds = directManagerIds(feedback.subjectId)
        if (managerIds.isEmpty()) return emptyMap()
        return UserService.Users
            .select(UserService.Users.id, UserService.Users.name)
            .where {
                (UserService.Users.id inList managerIds) and
                    (UserService.Users.markedAsDeleted eq false)
            }
            .map { it[UserService.Users.id].value to it[UserService.Users.name] }
            .toList()
            .toMap()
    }

    /**
     * The in-progress duplicate of a prospective feedback, if any: the oldest active row in
     * DRAFT or REQUESTED status with the same (subject, provider, requester) triple — a null
     * requester matches only null. Backs the create/pick-up no-duplicate invariant and the
     * `duplicate-check` endpoint's early warning. Returns id + status, or null.
     */
    suspend fun findOpenDuplicate(
        subjectId: UInt,
        providerId: UInt,
        requesterId: UInt?,
    ): Pair<UInt, FeedbackStatus>? =
        suspendTransaction(database) { findOpenDuplicateInTx(subjectId, providerId, requesterId) }

    private suspend fun findOpenDuplicateInTx(
        subjectId: UInt,
        providerId: UInt,
        requesterId: UInt?,
        statuses: List<FeedbackStatus> = OPEN_STATUSES,
    ): Pair<UInt, FeedbackStatus>? =
        Feedbacks
            .select(Feedbacks.id, Feedbacks.status)
            .where {
                (Feedbacks.subjectId eq subjectId) and
                    (Feedbacks.providerId eq providerId) and
                    (
                        if (requesterId == null) Feedbacks.requesterId.isNull()
                        else Feedbacks.requesterId eq requesterId
                    ) and
                    (Feedbacks.status inList statuses) and
                    active()
            }
            .orderBy(Feedbacks.id to SortOrder.ASC)
            .limit(1)
            .map { it[Feedbacks.id].value to it[Feedbacks.status] }
            .singleOrNull()

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

    /**
     * The Received-list visibility scope for [callerUserId] — the caller's inbox (subjectId ==
     * caller), scoped exactly like canReadFeedback (authz/Guards.kt) so every listed row is also
     * openable:
     * - as the requester of their own feedback: any status under a requester-readable visibility
     *   (an unfinished one has its content preview redacted in list());
     * - as a plain subject (no requester, or someone else's request): only once delivered
     *   (SENT/WITHDRAWN) under a subject-readable visibility;
     * - PUBLIC rows in either role: only once SENT (the "anyone" rule).
     * Shared by [list] and [lastProvidedAt] so the two can never drift apart.
     */
    private fun receivedScope(callerUserId: UInt): Op<Boolean> {
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
        return (Feedbacks.subjectId eq callerUserId) and (iAmRequester or asSubjectOnly)
    }

    /**
     * For each provider in [providerIds], the epoch-ms moment they last provided [subjectId]
     * feedback: the newest SENT transition among their currently-SENT, non-deleted feedbacks about
     * the subject that the subject can see under the Received scoping (never leaks an invisible
     * feedback). Providers with no qualifying feedback are absent from the map.
     */
    suspend fun lastProvidedAt(providerIds: Set<UInt>, subjectId: UInt): Map<UInt, Long> =
        if (providerIds.isEmpty()) emptyMap()
        else lastSentAtBy(
            Feedbacks.providerId,
            (Feedbacks.providerId inList providerIds) and receivedScope(subjectId),
        )

    /**
     * The provider-side mirror of [lastProvidedAt]: for each subject in [subjectIds], the epoch-ms
     * moment [providerId] last provided them feedback, keyed by subject. No Received scoping — the
     * caller is the provider and always sees their own feedback, so a row whose visibility hides
     * it from the subject (e.g. PROVIDER_REQUESTER) still counts. Self-reflections (provider ==
     * subject) would qualify, but neither consumer (the managed and member team views) ever
     * lists the caller themselves. Subjects with no qualifying feedback are absent from the map.
     */
    suspend fun lastProvidedTo(providerId: UInt, subjectIds: Set<UInt>): Map<UInt, Long> =
        if (subjectIds.isEmpty()) emptyMap()
        else lastSentAtBy(
            Feedbacks.subjectId,
            (Feedbacks.providerId eq providerId) and (Feedbacks.subjectId inList subjectIds),
        )

    /**
     * Per [keyColumn] value, the newest SENT moment among the currently-SENT, non-deleted
     * feedbacks matching [scope]. SENT is reachable at most once per feedback (SENT → WITHDRAWN
     * is terminal), so "the" SENT event is well-defined. Feedbacks predating the events table
     * (pre-V15) have no SENT event and fall back to lastModified — an upper bound of the true
     * sent moment (content edits bump it), better than a false "never".
     */
    private suspend fun lastSentAtBy(
        keyColumn: Column<EntityID<UInt>>,
        scope: Op<Boolean>,
    ): Map<UInt, Long> =
        suspendTransaction(database) {
            val candidates = Feedbacks
                .select(Feedbacks.id, keyColumn, Feedbacks.lastModified)
                .where { scope and (Feedbacks.status eq FeedbackStatus.SENT) and active() }
                .map { Triple(it[Feedbacks.id].value, it[keyColumn].value, it[Feedbacks.lastModified]) }
                .toList()
            if (candidates.isEmpty()) return@suspendTransaction emptyMap()

            // The SENT moment lives in the audit trail: STATUS_CHANGED{to=SENT} or a feedback
            // CREATED directly as SENT. Params are opaque JSON text decoded Kotlin-side (the
            // repo has no SQL JSON operators); the per-feedback event volume is tiny.
            val events = FeedbackEventService.FeedbackEvents
            val sentAt = mutableMapOf<UInt, Long>()
            events.select(events.feedbackId, events.timestamp, events.eventType, events.params)
                .where {
                    (events.feedbackId inList candidates.map { it.first }) and
                        (
                            events.eventType inList listOf(
                                FeedbackEventType.STATUS_CHANGED.name,
                                FeedbackEventType.CREATED.name,
                            )
                        )
                }
                .toList()
                .forEach { row ->
                    val params = decodeParams(row[events.params])
                    val isSent = when (row[events.eventType]) {
                        FeedbackEventType.STATUS_CHANGED.name -> params["to"] == FeedbackStatus.SENT.name
                        else -> params["status"] == FeedbackStatus.SENT.name
                    }
                    if (isSent) sentAt.merge(row[events.feedbackId].value, row[events.timestamp], ::maxOf)
                }

            candidates
                .groupBy({ it.second }) { sentAt[it.first] ?: it.third } // pre-V15 fallback: lastModified
                .mapValues { (_, times) -> times.max() }
        }

    suspend fun list(
        view: FeedbackListView,
        callerUserId: UInt,
        filter: FeedbackListFilter,
        paging: PageRequest,
        includeIndirect: Boolean = false,
        targetUserId: UInt? = null,
    ): FeedbackListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            FeedbackListView.RECEIVED -> receivedScope(callerUserId)
            FeedbackListView.PROVIDED -> Feedbacks.providerId eq callerUserId
            FeedbackListView.USER -> {
                // Auditor view (HR-only, gated route-side via requireAuditListAccess): every
                // feedback the target is a party to, at every status and visibility.
                // The route guarantees a non-null userId.
                val target = requireNotNull(targetUserId) { "view=user requires userId" }
                (Feedbacks.subjectId eq target) or
                    (Feedbacks.providerId eq target) or
                    (Feedbacks.requesterId eq target)
            }
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
                // that it exists but not its content. The auditor view is never redacted —
                // the HR read includes content (canReadFeedbackContent).
                val unfinished = row[Feedbacks.status] == FeedbackStatus.DRAFT ||
                    row[Feedbacks.status] == FeedbackStatus.REQUESTED
                val redactContent = view != FeedbackListView.USER &&
                    unfinished && row[Feedbacks.requesterId]?.value == callerUserId
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
