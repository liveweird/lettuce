package ch.nokillswit.goals

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

val GoalServiceKey = AttributeKey<GoalService>("GoalService")

enum class GoalListView { OWN, MANAGED, TEAM }

data class GoalListFilter(
    val managerName: String? = null,
    val subordinateName: String? = null,
    val managerId: UInt? = null,
    val subordinateId: UInt? = null,
    val title: String? = null,
    val type: GoalType? = null,
    val status: GoalStatus? = null,
    val createdAtGte: Long? = null,
    val lastModifiedGte: Long? = null,
)

data class GoalListResult(
    val items: List<GoalListItem>,
    val total: Long,
)

private val managerUsers = UserService.Users.alias("manager_users")
private val subordinateUsers = UserService.Users.alias("subordinate_users")

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to GoalService.Goals.id,
    "managerName" to managerUsers[UserService.Users.name],
    "subordinateName" to subordinateUsers[UserService.Users.name],
    "title" to GoalService.Goals.title,
    "type" to GoalService.Goals.type,
    "status" to GoalService.Goals.status,
    // Nullable value columns: BINARY rows sort as SQL NULLs (first on DESC, last on ASC) —
    // documented in the spec; acceptable for mixed-type lists.
    "targetValue" to GoalService.Goals.targetValue,
    "currentValue" to GoalService.Goals.currentValue,
    "createdAt" to GoalService.Goals.createdAt,
    "lastModified" to GoalService.Goals.lastModified,
)

// description/summary are encrypted at rest (see infra/crypto/FieldCipher.kt): the cipher wraps
// every write and unwraps every read, so nothing above this service ever sees ciphertext. Neither
// column is filtered/sorted/searched in SQL, so queries are unaffected; the title stays plaintext
// on purpose — lists sort and substring-filter on it.
class GoalService(val database: R2dbcDatabase, private val cipher: FieldCipher) {
    object Goals : UIntIdTable("goals") {
        val managerId = reference("manager_id", UserService.Users)
        val subordinateId = reference("subordinate_id", UserService.Users)
        val createdAt = long("created_at")
        val title = varchar("title", MAX_GOAL_TITLE_LENGTH)
        val description = text("description")
        val type = enumerationByName("type", 20, GoalType::class)
        val targetValue = double("target_value").nullable()
        val currentValue = double("current_value").nullable()
        val achieved = bool("achieved").nullable()
        val status = enumerationByName("status", 20, GoalStatus::class)
        val summary = text("summary").nullable()
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Goals.markedAsDeleted eq false

    /**
     * Inserts a new goal, always in DRAFT status, with its current value initialized to the
     * type's zero (not achieved / 0.0). The route has already verified the manager→subordinate
     * relationship; the definition invariants are validated here. Returns the new id.
     */
    suspend fun create(managerId: UInt, request: GoalCreateRequest): UInt = suspendTransaction(database) {
        validateGoalDefinition(request.title, request.description, request.type, request.targetValue)
        val now = System.currentTimeMillis()
        Goals.insert {
            it[this.managerId] = managerId
            it[subordinateId] = request.subordinateId
            it[createdAt] = now
            it[title] = request.title
            it[description] = cipher.encrypt(request.description)
            it[type] = request.type
            it[targetValue] = request.targetValue
            it[currentValue] = initialCurrentValue(request.type)
            it[achieved] = initialAchieved(request.type)
            it[status] = GoalStatus.DRAFT
            it[summary] = null
            it[lastModified] = now
        }[Goals.id].value
    }

    suspend fun read(id: UInt): GoalResponse? = suspendTransaction(database) {
        joined()
            .selectAll()
            .where { (Goals.id eq id) and active() }
            .map { it.toResponse() }
            .singleOrNull()
    }

    /**
     * Edits a DRAFT goal's definition (title, description, type, target — never its parties,
     * status, current value, or summary). A type change re-initializes the value fields for the
     * new type, discarding any recorded progress (the audit events explain the reset). Returns
     * the affected-row count (0 → missing/deleted, mapped to 404 by the route); throws
     * [ConflictException] (→ 409) when the goal is not in DRAFT.
     */
    suspend fun updateDefinition(id: UInt, update: GoalDefinitionUpdate): Int = suspendTransaction(database) {
        val current = Goals.selectAll()
            .where { (Goals.id eq id) and active() }
            .map { Triple(it[Goals.status], it[Goals.type], it[Goals.currentValue] to it[Goals.achieved]) }
            .singleOrNull()
            ?: return@suspendTransaction 0
        if (current.first != GoalStatus.DRAFT) {
            throw ConflictException("Only a DRAFT goal's definition may be edited")
        }
        validateGoalDefinition(update.title, update.description, update.type, update.targetValue)
        val typeChanged = current.second != update.type
        Goals.update({ (Goals.id eq id) and (Goals.markedAsDeleted eq false) }) {
            it[title] = update.title
            it[description] = cipher.encrypt(update.description)
            it[type] = update.type
            it[targetValue] = update.targetValue
            it[currentValue] = if (typeChanged) initialCurrentValue(update.type) else current.third.first
            it[achieved] = if (typeChanged) initialAchieved(update.type) else current.third.second
            it[lastModified] = System.currentTimeMillis()
        }
    }

    /**
     * Updates an ACTIVE goal's current value ([GoalProgressUpdate.achieved] for BINARY,
     * [GoalProgressUpdate.currentValue] otherwise). Returns the affected-row count (0 →
     * missing/deleted → 404); throws [ConflictException] (→ 409) when the goal is not ACTIVE.
     */
    suspend fun updateProgress(id: UInt, update: GoalProgressUpdate): Int = suspendTransaction(database) {
        val current = Goals.selectAll()
            .where { (Goals.id eq id) and active() }
            .map { it[Goals.status] to it[Goals.type] }
            .singleOrNull()
            ?: return@suspendTransaction 0
        if (current.first != GoalStatus.ACTIVE) {
            throw ConflictException("Only an ACTIVE goal's current value may be updated")
        }
        validateGoalProgress(current.second, update)
        Goals.update({ (Goals.id eq id) and (Goals.markedAsDeleted eq false) }) {
            when (current.second) {
                GoalType.BINARY -> it[achieved] = update.achieved
                GoalType.NUMBER, GoalType.PERCENTAGE -> it[currentValue] = update.currentValue
            }
            it[lastModified] = System.currentTimeMillis()
        }
    }

    /**
     * Moves a goal [from] one status to [target] via the status state machine (DRAFT <-> ACTIVE
     * <-> CLOSED, never skipping ACTIVE) and returns the notifications the transition should
     * produce (the caller persists them). Each action endpoint names its whole edge — [from] as
     * well as [target] — because activate and reopen share the ACTIVE target and would otherwise
     * be interchangeable. Closing records [summary] (required — the route validates it
     * non-blank); reopening keeps the stored summary, to be overwritten at the next close.
     * Returns null when the row is missing (→ 404); throws [ConflictException] (→ 409) when the
     * goal is not at [from] or the edge is not in the machine.
     */
    suspend fun transition(id: UInt, from: GoalStatus, target: GoalStatus, summary: String? = null): List<Notification>? {
        return suspendTransaction(database) {
            val current = Goals.selectAll()
                .where { (Goals.id eq id) and active() }
                .map { it.toGoalRow() }
                .singleOrNull()
                ?: return@suspendTransaction null
            if (current.status != from || !isAllowedTransition(from, target)) {
                throw ConflictException("Invalid status transition: ${current.status} -> $target")
            }
            if (target == GoalStatus.CLOSED && summary.isNullOrBlank()) {
                throw BadRequestException("Closing a goal requires a summary")
            }
            Goals.update({ (Goals.id eq id) and (Goals.markedAsDeleted eq false) }) {
                it[status] = target
                if (target == GoalStatus.CLOSED) it[this.summary] = cipher.encrypt(summary!!)
                it[lastModified] = System.currentTimeMillis()
            }
            goalTransitionNotifications(
                goalId = id,
                from = current.status,
                to = target,
                subordinateId = current.subordinateId,
                managerName = userName(current.managerId),
                title = current.title,
            )
        }
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Goals.update({ (Goals.id eq id) and (Goals.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    suspend fun list(
        view: GoalListView,
        callerUserId: UInt,
        filter: GoalListFilter,
        paging: PageRequest,
        includeIndirect: Boolean = false,
    ): GoalListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            GoalListView.OWN -> Goals.subordinateId eq callerUserId
            GoalListView.MANAGED -> Goals.managerId eq callerUserId
            GoalListView.TEAM -> {
                // Goals set by the caller's direct reports (as managers), widened by
                // includeIndirect to the transitive chain. DRAFT goals are excluded — they stay
                // private to the pair, mirroring requireGoalReadAllowingManager's chain rule
                // (the subordinate of such a goal is always in the caller's transitive chain,
                // so every listed row is also openable).
                val subordinateIds =
                    if (includeIndirect) transitiveSubordinateIds(callerUserId)
                    else directSubordinateIds(callerUserId)
                if (subordinateIds.isEmpty()) {
                    Op.FALSE
                } else {
                    (Goals.managerId inList subordinateIds) and (Goals.status neq GoalStatus.DRAFT)
                }
            }
        }
        val predicate: Op<Boolean> = scope and buildPredicate(filter) and active()
        val join = joined()
        val total = join.selectAll().where { predicate }.count()
        val rows = join
            .select(
                Goals.id,
                Goals.managerId,
                Goals.subordinateId,
                Goals.title,
                Goals.type,
                Goals.targetValue,
                Goals.currentValue,
                Goals.achieved,
                Goals.status,
                Goals.createdAt,
                Goals.lastModified,
                managerUsers[UserService.Users.name],
                managerUsers[UserService.Users.markedAsDeleted],
                subordinateUsers[UserService.Users.name],
                subordinateUsers[UserService.Users.markedAsDeleted],
            )
            .where { predicate }
            .applyPaging(paging, SORTABLE_COLUMNS)
            .map { row ->
                GoalListItem(
                    id = row[Goals.id].value,
                    managerId = row[Goals.managerId].value,
                    managerName = row[managerUsers[UserService.Users.name]],
                    managerDeleted = row[managerUsers[UserService.Users.markedAsDeleted]],
                    subordinateId = row[Goals.subordinateId].value,
                    subordinateName = row[subordinateUsers[UserService.Users.name]],
                    subordinateDeleted = row[subordinateUsers[UserService.Users.markedAsDeleted]],
                    title = row[Goals.title],
                    type = row[Goals.type],
                    targetValue = row[Goals.targetValue],
                    currentValue = row[Goals.currentValue],
                    achieved = row[Goals.achieved],
                    status = row[Goals.status],
                    createdAt = row[Goals.createdAt],
                    lastModified = row[Goals.lastModified],
                )
            }
            .toList()
        GoalListResult(items = rows, total = total)
    }

    /** True iff [subordinateId] is currently a member of a non-deleted team [managerId] manages. */
    suspend fun isDirectReport(managerId: UInt, subordinateId: UInt): Boolean =
        suspendTransaction(database) { subordinateId in directSubordinateIds(managerId) }

    /**
     * True iff [managerId] is in [subordinateId]'s management chain — the manager of a non-deleted
     * team the subordinate belongs to, or, transitively, the manager of such a manager, and so on.
     * Backs [ch.nokillswit.authz.requireGoalReadAllowingManager]'s lazy chain check; the walk
     * itself lives in teams/ManagementChain.kt and is shared with feedbacks and 1:1 meetings.
     */
    suspend fun managesSubordinate(managerId: UInt, subordinateId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(managerId, subordinateId) }

    /**
     * Startup backfill (see infra/db/Bootstrap.kt): encrypts rows still holding legacy plaintext
     * — including soft-deleted ones. With [reencryptAll] (set during key rotation) every row is
     * decrypted (current or previous key) and rewritten under the current key. Idempotent;
     * returns the rewritten count.
     */
    suspend fun encryptLegacyRows(reencryptAll: Boolean = false): Int = suspendTransaction(database) {
        val enveloped = "${FieldCipher.PREFIX}%"
        val legacyOnly = (Goals.description notLike enveloped) or
            (Goals.summary.isNotNull() and (Goals.summary notLike enveloped))
        val rows = Goals
            .select(Goals.id, Goals.description, Goals.summary)
            .where { if (reencryptAll) Op.TRUE else legacyOnly }
            .toList()
        rows.forEach { row ->
            Goals.update({ Goals.id eq row[Goals.id] }) {
                it[description] = cipher.encrypt(cipher.decrypt(row[Goals.description]))
                it[summary] = row[Goals.summary]?.let { s -> cipher.encrypt(cipher.decrypt(s)) }
            }
        }
        rows.size
    }

    private fun joined() = Goals
        .join(
            managerUsers,
            JoinType.INNER,
            onColumn = Goals.managerId,
            otherColumn = managerUsers[UserService.Users.id],
        )
        .join(
            subordinateUsers,
            JoinType.INNER,
            onColumn = Goals.subordinateId,
            otherColumn = subordinateUsers[UserService.Users.id],
        )

    // Row → full document, from the joined() select (party names come from the aliases).
    private fun ResultRow.toResponse(): GoalResponse = GoalResponse(
        id = this[Goals.id].value,
        managerId = this[Goals.managerId].value,
        subordinateId = this[Goals.subordinateId].value,
        createdAt = this[Goals.createdAt],
        title = this[Goals.title],
        description = cipher.decrypt(this[Goals.description]),
        type = this[Goals.type],
        targetValue = this[Goals.targetValue],
        currentValue = this[Goals.currentValue],
        achieved = this[Goals.achieved],
        status = this[Goals.status],
        summary = this[Goals.summary]?.let(cipher::decrypt),
        lastModified = this[Goals.lastModified],
        managerName = this[managerUsers[UserService.Users.name]],
        subordinateName = this[subordinateUsers[UserService.Users.name]],
    )

    // The transition path's un-joined row view (no name aliases, no decryption of the summary —
    // only the plaintext title is needed for the notification params).
    private data class GoalRow(
        val managerId: UInt,
        val subordinateId: UInt,
        val title: String,
        val status: GoalStatus,
    )

    private fun ResultRow.toGoalRow() = GoalRow(
        managerId = this[Goals.managerId].value,
        subordinateId = this[Goals.subordinateId].value,
        title = this[Goals.title],
        status = this[Goals.status],
    )

    private suspend fun userName(id: UInt): String =
        UserService.Users
            .select(UserService.Users.name)
            .where { UserService.Users.id eq id }
            .map { it[UserService.Users.name] }
            .singleOrNull() ?: "#$id"

    private fun buildPredicate(filter: GoalListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.managerName?.takeIf { it.isNotBlank() }?.let {
            op = op and (managerUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.subordinateName?.takeIf { it.isNotBlank() }?.let {
            op = op and (subordinateUsers[UserService.Users.name].lowerCase() like containsPattern(it))
        }
        filter.managerId?.let { op = op and (Goals.managerId eq it) }
        filter.subordinateId?.let { op = op and (Goals.subordinateId eq it) }
        filter.title?.takeIf { it.isNotBlank() }?.let {
            op = op and (Goals.title.lowerCase() like containsPattern(it))
        }
        filter.type?.let { op = op and (Goals.type eq it) }
        filter.status?.let { op = op and (Goals.status eq it) }
        filter.createdAtGte?.let { op = op and (Goals.createdAt greaterEq it) }
        filter.lastModifiedGte?.let { op = op and (Goals.lastModified greaterEq it) }
        return op
    }

    private fun initialCurrentValue(type: GoalType): Double? = when (type) {
        GoalType.BINARY -> null
        GoalType.NUMBER, GoalType.PERCENTAGE -> 0.0
    }

    private fun initialAchieved(type: GoalType): Boolean? = when (type) {
        GoalType.BINARY -> false
        GoalType.NUMBER, GoalType.PERCENTAGE -> null
    }

    // DRAFT <-> ACTIVE <-> CLOSED, both directions, never skipping ACTIVE.
    private fun isAllowedTransition(from: GoalStatus, to: GoalStatus): Boolean = when (from to to) {
        GoalStatus.DRAFT to GoalStatus.ACTIVE,
        GoalStatus.ACTIVE to GoalStatus.DRAFT,
        GoalStatus.ACTIVE to GoalStatus.CLOSED,
        GoalStatus.CLOSED to GoalStatus.ACTIVE -> true
        else -> false
    }
}
