package ch.nokillswit.goals

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.infra.crypto.EncryptedAtRest
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.db.containsNormalized
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
import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val GoalServiceKey = AttributeKey<GoalService>("GoalService")

enum class GoalListView { OWN, MANAGED, TEAM, USER }

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
    // Nullable value columns: PLAN rows sort as SQL NULLs (first on DESC, last on ASC) —
    // documented in the spec; acceptable for mixed-type lists.
    "targetValue" to GoalService.Goals.targetValue,
    "currentValue" to GoalService.Goals.currentValue,
    "createdAt" to GoalService.Goals.createdAt,
    // ISO YYYY-MM-DD in a VARCHAR: lexicographic == chronological, so a plain column sort works.
    "dueDate" to GoalService.Goals.dueDate,
    "lastModified" to GoalService.Goals.lastModified,
)

// description/summary and the milestone descriptions are encrypted at rest (see
// infra/crypto/FieldCipher.kt): the cipher wraps every write and unwraps every read, so nothing
// above this service ever sees ciphertext. None of these columns is filtered/sorted/searched in
// SQL, so queries are unaffected; the title stays plaintext on purpose — lists sort and
// substring-filter on it.
class GoalService(val database: R2dbcDatabase, private val cipher: FieldCipher) : EncryptedAtRest {
    override val encryptedRowLabel = "goal"

    object Goals : UIntIdTable("goals") {
        val managerId = reference("manager_id", UserService.Users)
        val subordinateId = reference("subordinate_id", UserService.Users)
        val createdAt = long("created_at")
        val dueDate = varchar("due_date", 10)
        val title = varchar("title", MAX_GOAL_TITLE_LENGTH)
        val description = text("description")
        val type = enumerationByName("type", 20, GoalType::class)
        val targetValue = double("target_value").nullable()
        val currentValue = double("current_value").nullable()
        val status = enumerationByName("status", 20, GoalStatus::class)
        val summary = text("summary").nullable()
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    // A PLAN goal's ordered milestones (V56; the 1:1 detail-table pattern): whole-list replaced
    // by the DRAFT definition PUT (rows hard-delete), done flags flipped by the ACTIVE progress
    // PUT. Descriptions are encrypted at rest like the goal description.
    object Milestones : UIntIdTable("goal_milestones") {
        val goalId = reference("goal_id", Goals)
        val position = integer("position")
        val description = text("description")
        val done = bool("done").default(false)
    }

    private fun active(): Op<Boolean> = Goals.markedAsDeleted eq false

    /**
     * Inserts a new goal, always in DRAFT status, with NO recorded value (both value fields
     * null until the first progress update — v2.8.1). The route has already verified the
     * manager→subordinate relationship; the definition invariants are validated here. Returns
     * the new id.
     */
    suspend fun create(managerId: UInt, request: GoalCreateRequest): UInt = suspendTransaction(database) {
        validateGoalDefinition(
            request.title, request.description, request.type, request.targetValue,
            request.milestones, request.dueDate, newMilestonesOnly = true,
        )
        val now = System.currentTimeMillis()
        val id = Goals.insert {
            it[this.managerId] = managerId
            it[subordinateId] = request.subordinateId
            it[createdAt] = now
            it[dueDate] = request.dueDate
            it[title] = request.title
            it[description] = cipher.encrypt(request.description)
            it[type] = request.type
            it[targetValue] = request.targetValue
            // No recorded value yet (v2.8.1): the value field stays null until the first
            // progress update — an auto-zero would read as recorded progress. (A PLAN goal's
            // milestones likewise all start not-done.)
            it[currentValue] = null
            it[status] = GoalStatus.DRAFT
            it[summary] = null
            it[lastModified] = now
        }[Goals.id].value
        replaceMilestones(id, request.milestones)
        id
    }

    suspend fun read(id: UInt): GoalResponse? = suspendTransaction(database) {
        // Drain the row's result stream BEFORE the milestones select — a nested query while
        // the outer flow is still open deadlocks the shared R2DBC connection.
        val row = joined()
            .selectAll()
            .where { (Goals.id eq id) and active() }
            .toList()
            .singleOrNull()
            ?: return@suspendTransaction null
        row.toResponse(milestonesFor(id))
    }

    /**
     * Edits a DRAFT goal's definition (title, description, type, target, milestones — never its
     * parties, status, current value, or summary). A type change re-initializes the value fields
     * for the new type, discarding any recorded progress — away from PLAN that means deleting
     * the milestone rows (the audit events explain the reset). A PLAN goal's [update]'s
     * milestones whole-list replace the stored ones: id-matched rows keep their done flags
     * (defining is not ticking), missing rows hard-delete, id-less rows insert not-done. Returns
     * the affected-row count (0 → missing/deleted, mapped to 404 by the route); throws
     * [ConflictException] (→ 409) when the goal is not in DRAFT.
     */
    suspend fun updateDefinition(id: UInt, update: GoalDefinitionUpdate): Int = suspendTransaction(database) {
        val current = Goals.selectAll()
            .where { (Goals.id eq id) and active() }
            .map { Triple(it[Goals.status], it[Goals.type], it[Goals.currentValue]) }
            .singleOrNull()
            ?: return@suspendTransaction 0
        if (current.first != GoalStatus.DRAFT) {
            throw ConflictException("Only a DRAFT goal's definition may be edited")
        }
        validateGoalDefinition(
            update.title, update.description, update.type, update.targetValue,
            update.milestones, update.dueDate,
        )
        val typeChanged = current.second != update.type
        val updated = Goals.update({ (Goals.id eq id) and (Goals.markedAsDeleted eq false) }) {
            it[dueDate] = update.dueDate
            it[title] = update.title
            it[description] = cipher.encrypt(update.description)
            it[type] = update.type
            it[targetValue] = update.targetValue
            // A type change discards recorded progress back to "no value" (v2.8.1: null, not
            // the old type's zero) — the audit events explain the reset.
            it[currentValue] = if (typeChanged) null else current.third
            it[lastModified] = System.currentTimeMillis()
        }
        // Milestones follow the type: PLAN reconciles the payload list (empty for a non-PLAN
        // payload by validation); a change away from PLAN drops the rows with the rest of the
        // discarded progress.
        replaceMilestones(id, update.milestones)
        updated
    }

    /**
     * Updates an ACTIVE goal's progress state ([GoalProgressUpdate.milestones] for PLAN,
     * [GoalProgressUpdate.currentValue] otherwise) on behalf of [actorUserId] — either party
     * (the route's requireGoalProgressWrite has already checked that). A PLAN update carries
     * the COMPLETE done-state — ids matching the stored milestone set exactly (else 400).
     * Returns the counterparty notifications to persist (the transition pattern) — empty on a
     * true no-op (nothing changed, no comment), null when the row is missing/deleted (→ 404);
     * throws [ConflictException] (→ 409) when the goal is not ACTIVE.
     */
    suspend fun updateProgress(
        id: UInt,
        actorUserId: UInt,
        update: GoalProgressUpdate,
    ): List<Notification>? = suspendTransaction(database) {
        val current = Goals.selectAll()
            .where { (Goals.id eq id) and active() }
            .map { it.toGoalRow() to (it[Goals.type] to it[Goals.currentValue]) }
            .singleOrNull()
            ?: return@suspendTransaction null
        val (row, state) = current
        val (type, currentValue) = state
        if (row.status != GoalStatus.ACTIVE) {
            throw ConflictException("Only an ACTIVE goal's current value may be updated")
        }
        validateGoalProgress(type, update)
        // The progress field is optional (v2.8.1): absent = leave the state untouched (a
        // comment-only update; the validator guaranteed a non-blank comment then).
        val milestonesChanged = update.milestones?.let { applyMilestoneTicks(id, it) } ?: false
        Goals.update({ (Goals.id eq id) and (Goals.markedAsDeleted eq false) }) {
            if (update.currentValue != null) it[this.currentValue] = update.currentValue
            it[lastModified] = System.currentTimeMillis()
        }
        // A true no-op (same state, no comment) stays silent — mirroring the event rule; a
        // state change or a comment-only update notifies the counterparty.
        val valueChanged = milestonesChanged ||
            (update.currentValue != null && update.currentValue != currentValue)
        if (!valueChanged && update.comment.isNullOrBlank()) {
            emptyList()
        } else {
            listOf(
                goalProgressUpdateNotification(
                    goalId = id,
                    actorUserId = actorUserId,
                    managerId = row.managerId,
                    subordinateId = row.subordinateId,
                    actorName = userName(actorUserId),
                    title = row.title,
                ),
            )
        }
    }

    /**
     * Moves a goal [from] one status to [target] via the status state machine (DRAFT <-> ACTIVE
     * <-> ARCHIVED, never skipping ACTIVE) and returns the notifications the transition should
     * produce (the caller persists them). Each action endpoint names its whole edge — [from] as
     * well as [target] — because activate and reopen share the ACTIVE target and would otherwise
     * be interchangeable. Closing records [summary] (required — the route validates it
     * non-blank); reopening keeps the stored summary, to be overwritten at the next archiving.
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
            // Each endpoint names a whole edge of the DRAFT <-> ACTIVE <-> ARCHIVED machine, so the
            // from-status check alone gates it; the summary was validated by the route
            // (validateGoalSummary) before the transaction.
            if (current.status != from) {
                throw ConflictException("Invalid status transition: ${current.status} -> $target")
            }
            Goals.update({ (Goals.id eq id) and (Goals.markedAsDeleted eq false) }) {
                it[status] = target
                if (target == GoalStatus.ARCHIVED) it[this.summary] = cipher.encrypt(summary!!)
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
        targetUserId: UInt? = null,
    ): GoalListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            GoalListView.OWN -> Goals.subordinateId eq callerUserId
            GoalListView.USER -> {
                // Auditor view (HR-only, gated route-side via requireAuditListAccess): every
                // goal the target is a party to, at every status — DRAFTs included, unlike
                // the chain views below. The route guarantees a non-null userId.
                val target = requireNotNull(targetUserId) { "view=user requires userId" }
                (Goals.managerId eq target) or (Goals.subordinateId eq target)
            }
            GoalListView.MANAGED ->
                if (!includeIndirect) {
                    Goals.managerId eq callerUserId
                } else {
                    // The widened "Reports: all" scope: the caller's own goals at any status,
                    // plus goals set by managers in their transitive chain — whose DRAFTs stay
                    // hidden (the single-GET's chain rule), so every listed row is openable.
                    val chain = transitiveSubordinateIds(callerUserId)
                    if (chain.isEmpty()) {
                        Goals.managerId eq callerUserId
                    } else {
                        (Goals.managerId eq callerUserId) or
                            ((Goals.managerId inList chain) and (Goals.status neq GoalStatus.DRAFT))
                    }
                }
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
                Goals.status,
                Goals.createdAt,
                Goals.dueDate,
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
                    milestonesDone = null,
                    milestonesTotal = null,
                    status = row[Goals.status],
                    createdAt = row[Goals.createdAt],
                    dueDate = row[Goals.dueDate],
                    lastModified = row[Goals.lastModified],
                )
            }
            .toList()
        GoalListResult(items = withMilestoneTallies(rows), total = total)
    }

    /**
     * Fills the PLAN rows' milestone tally (done/total) with one grouped query over the page's
     * ids (the users-list `teams` enrichment idiom, inside the list transaction). Numeric-type
     * rows keep nulls; a milestone-less PLAN draft reads 0/0.
     */
    private suspend fun withMilestoneTallies(rows: List<GoalListItem>): List<GoalListItem> {
        val planIds = rows.filter { it.type == GoalType.PLAN }.map { it.id }
        if (planIds.isEmpty()) return rows
        // Tiny per-page result set (≤ pageSize × MAX_GOAL_MILESTONES flags), tallied in Kotlin —
        // no SQL ever touches the encrypted descriptions.
        val flags = Milestones
            .select(Milestones.goalId, Milestones.done)
            .where { Milestones.goalId inList planIds }
            .map { it[Milestones.goalId].value to it[Milestones.done] }
            .toList()
        val totals = flags.groupingBy { it.first }.eachCount()
        val dones = flags.filter { it.second }.groupingBy { it.first }.eachCount()
        return rows.map { row ->
            if (row.type != GoalType.PLAN) row
            else row.copy(milestonesDone = dones[row.id] ?: 0, milestonesTotal = totals[row.id] ?: 0)
        }
    }

    /**
     * Per manager in [managerIds], how many ACTIVE goals they currently have set for
     * [subordinateId] — the "My managers" dashboard-card stat. Managers with none are absent
     * from the map. Only ACTIVE is counted (drafts are pair-private anyway; ARCHIVED are records),
     * and an ACTIVE goal is always visible to both parties, so no visibility filtering applies.
     */
    suspend fun activeGoalCountsByManager(
        managerIds: Set<UInt>,
        subordinateId: UInt,
    ): Map<UInt, Int> =
        if (managerIds.isEmpty()) emptyMap()
        else activeCountsBy(
            Goals.managerId,
            (Goals.managerId inList managerIds) and (Goals.subordinateId eq subordinateId),
        )

    /** The "My subordinates" mirror of [activeGoalCountsByManager], keyed by subordinate. */
    suspend fun activeGoalCountsBySubordinate(
        managerId: UInt,
        subordinateIds: Set<UInt>,
    ): Map<UInt, Int> =
        if (subordinateIds.isEmpty()) emptyMap()
        else activeCountsBy(
            Goals.subordinateId,
            (Goals.managerId eq managerId) and (Goals.subordinateId inList subordinateIds),
        )

    private suspend fun activeCountsBy(
        keyColumn: Column<EntityID<UInt>>,
        scope: Op<Boolean>,
    ): Map<UInt, Int> = suspendTransaction(database) {
        val count = Goals.id.count()
        Goals.select(keyColumn, count)
            .where { scope and (Goals.status eq GoalStatus.ACTIVE) and active() }
            .groupBy(keyColumn)
            .map { it[keyColumn].value to it[count].toInt() }
            .toList()
            .toMap()
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
    override suspend fun encryptLegacyRows(reencryptAll: Boolean): Int = suspendTransaction(database) {
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
        // Milestone descriptions ride the same envelope — this pass also encrypts the V56
        // conversion's plaintext 'Done' rows at first boot.
        val milestoneRows = Milestones
            .select(Milestones.id, Milestones.description)
            .where { if (reencryptAll) Op.TRUE else Milestones.description notLike enveloped }
            .toList()
        milestoneRows.forEach { row ->
            Milestones.update({ Milestones.id eq row[Milestones.id] }) {
                it[description] = cipher.encrypt(cipher.decrypt(row[Milestones.description]))
            }
        }
        rows.size + milestoneRows.size
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

    // Row → full document, from the joined() select (party names come from the aliases; the
    // milestones come from their own ordered select — see milestonesFor).
    private fun ResultRow.toResponse(milestones: List<GoalMilestoneResponse>): GoalResponse = GoalResponse(
        id = this[Goals.id].value,
        managerId = this[Goals.managerId].value,
        subordinateId = this[Goals.subordinateId].value,
        createdAt = this[Goals.createdAt],
        dueDate = this[Goals.dueDate],
        title = this[Goals.title],
        description = cipher.decrypt(this[Goals.description]),
        type = this[Goals.type],
        targetValue = this[Goals.targetValue],
        currentValue = this[Goals.currentValue],
        milestones = milestones,
        status = this[Goals.status],
        summary = this[Goals.summary]?.let(cipher::decrypt),
        lastModified = this[Goals.lastModified],
        managerName = this[managerUsers[UserService.Users.name]],
        subordinateName = this[subordinateUsers[UserService.Users.name]],
    )

    // The goal's milestones in stored order (empty for the numeric types), decrypted.
    private suspend fun milestonesFor(goalId: UInt): List<GoalMilestoneResponse> =
        Milestones.selectAll()
            .where { Milestones.goalId eq goalId }
            .orderBy(Milestones.position to SortOrder.ASC, Milestones.id to SortOrder.ASC)
            .map {
                GoalMilestoneResponse(
                    id = it[Milestones.id].value,
                    description = cipher.decrypt(it[Milestones.description]),
                    done = it[Milestones.done],
                )
            }
            .toList()

    /**
     * Whole-list milestone replace (the 1:1 replaceActionItems algorithm): payload ids must
     * reference this goal's rows without duplicates (else 400), rows missing from the payload
     * hard-delete, id-matched rows re-encrypt description at their new position with the done
     * flag deliberately untouched (ticking is the ACTIVE progress write), id-less rows insert
     * not-done. Payload order IS the order.
     */
    private suspend fun replaceMilestones(goalId: UInt, items: List<GoalMilestoneInput>) {
        val existingIds = Milestones.select(Milestones.id)
            .where { Milestones.goalId eq goalId }
            .map { it[Milestones.id].value }
            .toList()
            .toSet()
        val payloadIds = items.mapNotNull { it.id }
        if (payloadIds.size != payloadIds.toSet().size) {
            throw BadRequestException("Duplicate milestone id in payload")
        }
        val foreign = payloadIds.filterNot { it in existingIds }
        if (foreign.isNotEmpty()) {
            throw BadRequestException("Unknown milestone id(s) for this goal: ${foreign.joinToString()}")
        }
        val toDelete = existingIds - payloadIds.toSet()
        if (toDelete.isNotEmpty()) Milestones.deleteWhere { Milestones.id inList toDelete }
        items.forEachIndexed { index, item ->
            if (item.id != null) {
                Milestones.update({ Milestones.id eq item.id }) {
                    it[position] = index
                    it[description] = cipher.encrypt(item.description)
                }
            } else {
                Milestones.insert {
                    it[this.goalId] = goalId
                    it[position] = index
                    it[description] = cipher.encrypt(item.description)
                    it[done] = false
                }
            }
        }
    }

    /**
     * Applies a PLAN progress update's complete done-state: the sent ids must match the stored
     * milestone set exactly (duplicate or mismatch → 400 — the client edits a stale document
     * otherwise); only actually-flipped flags are written. Returns true when at least one flag
     * changed.
     */
    private suspend fun applyMilestoneTicks(goalId: UInt, sent: List<GoalMilestoneDone>): Boolean {
        val stored = Milestones.select(Milestones.id, Milestones.done)
            .where { Milestones.goalId eq goalId }
            .map { it[Milestones.id].value to it[Milestones.done] }
            .toList()
            .toMap()
        val sentIds = sent.map { it.id }
        if (sentIds.size != sentIds.toSet().size) {
            throw BadRequestException("Duplicate milestone id in payload")
        }
        if (sentIds.toSet() != stored.keys) {
            throw BadRequestException("A progress update must cover exactly the goal's milestones")
        }
        val changed = sent.filter { it.done != stored.getValue(it.id) }
        changed.forEach { tick ->
            Milestones.update({ Milestones.id eq tick.id }) { it[done] = tick.done }
        }
        return changed.isNotEmpty()
    }

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
            op = op and (managerUsers[UserService.Users.name].containsNormalized(it))
        }
        filter.subordinateName?.takeIf { it.isNotBlank() }?.let {
            op = op and (subordinateUsers[UserService.Users.name].containsNormalized(it))
        }
        filter.managerId?.let { op = op and (Goals.managerId eq it) }
        filter.subordinateId?.let { op = op and (Goals.subordinateId eq it) }
        filter.title?.takeIf { it.isNotBlank() }?.let {
            op = op and (Goals.title.containsNormalized(it))
        }
        filter.type?.let { op = op and (Goals.type eq it) }
        filter.status?.let { op = op and (Goals.status eq it) }
        filter.createdAtGte?.let { op = op and (Goals.createdAt greaterEq it) }
        filter.lastModifiedGte?.let { op = op and (Goals.lastModified greaterEq it) }
        return op
    }


}
