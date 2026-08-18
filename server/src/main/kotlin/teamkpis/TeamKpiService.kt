package ch.nokillswit.teamkpis

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.infra.crypto.EncryptedAtRest
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.crypto.reencryptRows
import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.TeamService
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val TeamKpiServiceKey = AttributeKey<TeamKpiService>("TeamKpiService")

enum class TeamKpiListView { OWN, MANAGED }

data class TeamKpiListFilter(
    val teamName: String? = null,
    val teamId: UInt? = null,
    val title: String? = null,
    val type: TeamKpiType? = null,
    val status: TeamKpiStatus? = null,
    val createdAtGte: Long? = null,
    val lastModifiedGte: Long? = null,
)

data class TeamKpiListResult(
    val items: List<TeamKpiListItem>,
    val total: Long,
)

/** Result of [TeamKpiService.correctValue]: the pre-edit row (for the audit event) + whether anything changed. */
data class TeamKpiValueCorrection(
    val old: TeamKpiValueResponse,
    val changed: Boolean,
)

private val managerUsers = UserService.Users.alias("manager_users")

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to TeamKpiService.TeamKpis.id,
    "teamName" to TeamService.Teams.name,
    "managerName" to managerUsers[UserService.Users.name],
    "title" to TeamKpiService.TeamKpis.title,
    "type" to TeamKpiService.TeamKpis.type,
    "status" to TeamKpiService.TeamKpis.status,
    "targetValue" to TeamKpiService.TeamKpis.targetValue,
    "currentValue" to TeamKpiService.TeamKpis.currentValue,
    "createdAt" to TeamKpiService.TeamKpis.createdAt,
    "lastModified" to TeamKpiService.TeamKpis.lastModified,
)

// description/summary are encrypted at rest (see infra/crypto/FieldCipher.kt): the cipher wraps
// every write and unwraps every read, so nothing above this service ever sees ciphertext. Neither
// column is filtered/sorted/searched in SQL, so queries are unaffected; the title stays plaintext
// on purpose — lists sort and substring-filter on it.
//
// There is no manager_id column: the KPI belongs to the TEAM, and the manager is resolved from
// teams.manager_id at read time — so a reassigned team's new manager takes over its KPIs.
class TeamKpiService(val database: R2dbcDatabase, private val cipher: FieldCipher) : EncryptedAtRest {
    override val encryptedRowLabel = "team KPI"

    object TeamKpis : UIntIdTable("team_kpis") {
        val teamId = reference("team_id", TeamService.Teams)
        val createdAt = long("created_at")
        val title = varchar("title", MAX_TEAM_KPI_TITLE_LENGTH)
        val description = text("description")
        val type = enumerationByName("type", 20, TeamKpiType::class)
        val targetValue = double("target_value")
        val currentValue = double("current_value")
        val currentValueDate = varchar("current_value_date", 10).nullable()
        val status = enumerationByName("status", 20, TeamKpiStatus::class)
        val summary = text("summary").nullable()
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    // The collected data points (V30) — a hard-delete detail table (the 1:1 notes precedent).
    // UNIQUE (team_kpi_id, value_date) in the DB enforces one value per date; a duplicate raises
    // 23505, mapped centrally to 409 (race-free, no pre-check needed).
    object TeamKpiValues : UIntIdTable("team_kpi_values") {
        val kpiId = reference("team_kpi_id", TeamKpis)
        val valueDate = varchar("value_date", 10)
        val value = double("value")
    }

    private fun active(): Op<Boolean> = TeamKpis.markedAsDeleted eq false

    /**
     * Inserts a new KPI, always in DRAFT status, with its current value initialized to 0.0. The
     * route has already verified the caller manages the team; the definition invariants are
     * validated here. Returns the new id.
     */
    suspend fun create(request: TeamKpiCreateRequest): UInt = suspendTransaction(database) {
        validateTeamKpiDefinition(request.title, request.description, request.type, request.targetValue)
        val now = System.currentTimeMillis()
        TeamKpis.insert {
            it[teamId] = request.teamId
            it[createdAt] = now
            it[title] = request.title
            it[description] = cipher.encrypt(request.description)
            it[type] = request.type
            it[targetValue] = request.targetValue!!
            it[currentValue] = 0.0
            it[currentValueDate] = null
            it[status] = TeamKpiStatus.DRAFT
            it[summary] = null
            it[lastModified] = now
        }[TeamKpis.id].value
    }

    suspend fun read(id: UInt): TeamKpiResponse? = suspendTransaction(database) {
        joined()
            .selectAll()
            .where { (TeamKpis.id eq id) and active() }
            .map { it.toResponse() }
            .singleOrNull()
    }

    /**
     * Edits a DRAFT KPI's definition (title, description, type, target — never its team, status,
     * data points, or summary). A type change WIPES the collected data points — a NUMBER series
     * is meaningless against a PERCENTAGE target and vice versa — which resets the denormalized
     * current value to 0.0/null via [recomputeCurrent] (the audit events explain the reset).
     * Returns the affected-row count (0 → missing/deleted, mapped to 404 by the route); throws
     * [ConflictException] (→ 409) when the KPI is not in DRAFT.
     */
    suspend fun updateDefinition(id: UInt, update: TeamKpiDefinitionUpdate): Int = suspendTransaction(database) {
        val current = TeamKpis.selectAll()
            .where { (TeamKpis.id eq id) and active() }
            .map { Pair(it[TeamKpis.status], it[TeamKpis.type]) }
            .singleOrNull()
            ?: return@suspendTransaction 0
        if (current.first != TeamKpiStatus.DRAFT) {
            throw ConflictException("Only a DRAFT team KPI's definition may be edited")
        }
        validateTeamKpiDefinition(update.title, update.description, update.type, update.targetValue)
        val typeChanged = current.second != update.type
        // Local capture: inside deleteWhere the table receiver's `id` column would shadow the
        // function parameter (and silently compile as column-eq-column).
        val kpiRowId = id
        if (typeChanged) TeamKpiValues.deleteWhere { kpiId eq kpiRowId }
        val count = TeamKpis.update({ (TeamKpis.id eq id) and (TeamKpis.markedAsDeleted eq false) }) {
            it[title] = update.title
            it[description] = cipher.encrypt(update.description)
            it[type] = update.type
            it[targetValue] = update.targetValue!!
            it[lastModified] = System.currentTimeMillis()
        }
        if (typeChanged) recomputeCurrent(id)
        count
    }

    /** The KPI's collected data points, newest first (`value_date DESC` — one row per date). */
    suspend fun listValues(kpiId: UInt): List<TeamKpiValueResponse> = suspendTransaction(database) {
        TeamKpiValues.selectAll()
            .where { TeamKpiValues.kpiId eq kpiId }
            .orderBy(TeamKpiValues.valueDate to SortOrder.DESC)
            .map { it.toValueResponse() }
            .toList()
    }

    /**
     * Adds a data point to an ACTIVE KPI and recomputes the denormalized current value. Returns
     * the new row's id, or null when the KPI is missing/deleted (→ 404); throws
     * [ConflictException] (→ 409) when the KPI is not ACTIVE, and the DB's unique
     * (kpi, date) constraint raises 23505 → 409 on a duplicate date.
     */
    suspend fun addValue(kpiId: UInt, write: TeamKpiValueWrite): UInt? = suspendTransaction(database) {
        val type = requireActiveKpi(kpiId) ?: return@suspendTransaction null
        validateTeamKpiValue(type, write)
        val targetKpiId = kpiId // the insert lambda's table receiver shadows the parameter
        val newId = TeamKpiValues.insert {
            it[this.kpiId] = targetKpiId
            it[valueDate] = write.date!!
            it[value] = write.value!!
        }[TeamKpiValues.id].value
        recomputeCurrent(kpiId)
        newId
    }

    /**
     * Corrects a data point (date and/or value) of an ACTIVE KPI and recomputes the denormalized
     * current value. Returns the PRE-edit row (for the audit event) plus a changed flag — an
     * exact no-op skips the write entirely (no event, no lastModified bump, still 204). Null when
     * the KPI or the value row is missing, or the row belongs to another KPI (→ 404); not-ACTIVE
     * → [ConflictException]; moving onto an occupied date → 23505 → 409.
     */
    suspend fun correctValue(kpiId: UInt, valueId: UInt, write: TeamKpiValueWrite): TeamKpiValueCorrection? =
        suspendTransaction(database) {
            val type = requireActiveKpi(kpiId) ?: return@suspendTransaction null
            val old = TeamKpiValues.selectAll()
                .where { (TeamKpiValues.id eq valueId) and (TeamKpiValues.kpiId eq kpiId) }
                .map { it.toValueResponse() }
                .singleOrNull()
                ?: return@suspendTransaction null
            validateTeamKpiValue(type, write)
            if (write.date == old.date && write.value == old.value) {
                return@suspendTransaction TeamKpiValueCorrection(old, changed = false)
            }
            TeamKpiValues.update({ TeamKpiValues.id eq valueId }) {
                it[valueDate] = write.date!!
                it[value] = write.value!!
            }
            recomputeCurrent(kpiId)
            TeamKpiValueCorrection(old, changed = true)
        }

    /**
     * Removes a data point of an ACTIVE KPI and recomputes the denormalized current value —
     * removing the latest-dated point rolls Current back to the next-latest (0.0/null when none
     * remain). Returns the removed row (for the audit event); null → 404, not-ACTIVE → 409.
     */
    suspend fun removeValue(kpiId: UInt, valueId: UInt): TeamKpiValueResponse? = suspendTransaction(database) {
        requireActiveKpi(kpiId) ?: return@suspendTransaction null
        val old = TeamKpiValues.selectAll()
            .where { (TeamKpiValues.id eq valueId) and (TeamKpiValues.kpiId eq kpiId) }
            .map { it.toValueResponse() }
            .singleOrNull()
            ?: return@suspendTransaction null
        TeamKpiValues.deleteWhere { TeamKpiValues.id eq valueId }
        recomputeCurrent(kpiId)
        old
    }

    /**
     * Values-mutation gate: the KPI's type when it exists (non-deleted) AND is ACTIVE; null when
     * missing (→ 404); [ConflictException] otherwise. Runs inside the caller's transaction.
     */
    private suspend fun requireActiveKpi(kpiId: UInt): TeamKpiType? {
        val current = TeamKpis.selectAll()
            .where { (TeamKpis.id eq kpiId) and active() }
            .map { Pair(it[TeamKpis.status], it[TeamKpis.type]) }
            .singleOrNull()
            ?: return null
        if (current.first != TeamKpiStatus.ACTIVE) {
            throw ConflictException("Data points can only be changed while the team KPI is ACTIVE")
        }
        return current.second
    }

    /**
     * Recomputes the denormalized current value from the data points — the max-dated row wins,
     * 0.0/null when none — and bumps lastModified. Runs inside the caller's transaction so the
     * mutation and the recompute are atomic.
     */
    private suspend fun recomputeCurrent(kpiId: UInt) {
        val latest = TeamKpiValues.selectAll()
            .where { TeamKpiValues.kpiId eq kpiId }
            .orderBy(TeamKpiValues.valueDate to SortOrder.DESC)
            .limit(1)
            .map { Pair(it[TeamKpiValues.value], it[TeamKpiValues.valueDate]) }
            .singleOrNull()
        TeamKpis.update({ TeamKpis.id eq kpiId }) {
            it[currentValue] = latest?.first ?: 0.0
            it[currentValueDate] = latest?.second
            it[lastModified] = System.currentTimeMillis()
        }
    }

    /**
     * Moves a KPI [from] one status to [target] via the status state machine (DRAFT <-> ACTIVE
     * <-> ARCHIVED, never skipping ACTIVE) and returns the notifications the transition should
     * produce (the caller persists them) — one per current team member, resolved inside this
     * transaction, minus the acting manager. Each action endpoint names its whole edge — [from]
     * as well as [target] — because activate and reopen share the ACTIVE target and would
     * otherwise be interchangeable. Archiving records [summary] (required — the route validates
     * it non-blank); reopening keeps the stored summary, to be overwritten at the next archive.
     * Returns null when the row is missing (→ 404); throws [ConflictException] (→ 409) when the
     * KPI is not at [from] or the edge is not in the machine.
     */
    suspend fun transition(
        id: UInt,
        from: TeamKpiStatus,
        target: TeamKpiStatus,
        summary: String? = null,
    ): List<Notification>? {
        return suspendTransaction(database) {
            val current = joined()
                .selectAll()
                .where { (TeamKpis.id eq id) and active() }
                .map { it.toResponse() }
                .singleOrNull()
                ?: return@suspendTransaction null
            // Each endpoint names a whole edge of the DRAFT <-> ACTIVE <-> ARCHIVED machine, so
            // the from-status check alone gates it; the summary was validated by the route
            // (validateTeamKpiSummary) before the transaction.
            if (current.status != from) {
                throw ConflictException("Invalid status transition: ${current.status} -> $target")
            }
            TeamKpis.update({ (TeamKpis.id eq id) and (TeamKpis.markedAsDeleted eq false) }) {
                it[status] = target
                if (target == TeamKpiStatus.ARCHIVED) it[this.summary] = cipher.encrypt(summary!!)
                it[lastModified] = System.currentTimeMillis()
            }
            teamKpiTransitionNotifications(
                kpiId = id,
                from = current.status,
                to = target,
                memberIds = memberIdsOf(current.teamId),
                actingManagerId = current.managerId,
                managerName = current.managerName,
                title = current.title,
                teamName = current.teamName,
            )
        }
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        TeamKpis.update({ (TeamKpis.id eq id) and (TeamKpis.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    suspend fun list(
        view: TeamKpiListView,
        callerUserId: UInt,
        filter: TeamKpiListFilter,
        paging: PageRequest,
    ): TeamKpiListResult = suspendTransaction(database) {
        val scope: Op<Boolean> = when (view) {
            // The member view: KPIs of the (non-deleted) teams the caller belongs to, once out
            // of DRAFT — a draft stays private to the manager, mirroring the single-GET rule so
            // every listed row is openable.
            TeamKpiListView.OWN -> {
                val memberTeams = TeamService.TeamMembers
                    .join(
                        TeamService.Teams,
                        JoinType.INNER,
                        onColumn = TeamService.TeamMembers.teamId,
                        otherColumn = TeamService.Teams.id,
                    )
                    .select(TeamService.TeamMembers.teamId)
                    .where {
                        (TeamService.TeamMembers.userId eq callerUserId) and
                            (TeamService.Teams.markedAsDeleted eq false)
                    }
                (TeamKpis.teamId inSubQuery memberTeams) and (TeamKpis.status neq TeamKpiStatus.DRAFT)
            }
            // The manager view: KPIs of the teams whose CURRENT manager the caller is, at every
            // status — soft-deleted teams included, so the manager keeps the history (flagged
            // via teamDeleted).
            TeamKpiListView.MANAGED -> {
                val managedTeams = TeamService.Teams
                    .select(TeamService.Teams.id)
                    .where { TeamService.Teams.managerId eq callerUserId }
                TeamKpis.teamId inSubQuery managedTeams
            }
        }
        val predicate: Op<Boolean> = scope and buildPredicate(filter) and active()
        val join = joined()
        val total = join.selectAll().where { predicate }.count()
        val rows = join
            .select(
                TeamKpis.id,
                TeamKpis.teamId,
                TeamKpis.title,
                TeamKpis.type,
                TeamKpis.targetValue,
                TeamKpis.currentValue,
                TeamKpis.status,
                TeamKpis.createdAt,
                TeamKpis.lastModified,
                TeamService.Teams.name,
                TeamService.Teams.markedAsDeleted,
                TeamService.Teams.managerId,
                managerUsers[UserService.Users.name],
                managerUsers[UserService.Users.markedAsDeleted],
            )
            .where { predicate }
            .applyPaging(paging, SORTABLE_COLUMNS)
            .map { row ->
                TeamKpiListItem(
                    id = row[TeamKpis.id].value,
                    teamId = row[TeamKpis.teamId].value,
                    teamName = row[TeamService.Teams.name],
                    teamDeleted = row[TeamService.Teams.markedAsDeleted],
                    managerId = row[TeamService.Teams.managerId].value,
                    managerName = row[managerUsers[UserService.Users.name]],
                    managerDeleted = row[managerUsers[UserService.Users.markedAsDeleted]],
                    title = row[TeamKpis.title],
                    type = row[TeamKpis.type],
                    targetValue = row[TeamKpis.targetValue],
                    currentValue = row[TeamKpis.currentValue],
                    status = row[TeamKpis.status],
                    createdAt = row[TeamKpis.createdAt],
                    lastModified = row[TeamKpis.lastModified],
                )
            }
            .toList()
        TeamKpiListResult(items = rows, total = total)
    }

    /** True iff [userId] is currently a member of [teamId] and the team is not soft-deleted. */
    suspend fun isTeamMember(userId: UInt, teamId: UInt): Boolean = suspendTransaction(database) {
        TeamService.TeamMembers
            .join(
                TeamService.Teams,
                JoinType.INNER,
                onColumn = TeamService.TeamMembers.teamId,
                otherColumn = TeamService.Teams.id,
            )
            .select(TeamService.TeamMembers.userId)
            .where {
                (TeamService.TeamMembers.teamId eq teamId) and
                    (TeamService.TeamMembers.userId eq userId) and
                    (TeamService.Teams.markedAsDeleted eq false)
            }
            .count() > 0
    }

    /** True iff [userId] is the CURRENT manager of the non-deleted team [teamId] — the POST gate. */
    suspend fun managesTeam(userId: UInt, teamId: UInt): Boolean = suspendTransaction(database) {
        TeamService.Teams
            .select(TeamService.Teams.id)
            .where {
                (TeamService.Teams.id eq teamId) and
                    (TeamService.Teams.managerId eq userId) and
                    (TeamService.Teams.markedAsDeleted eq false)
            }
            .count() > 0
    }

    /**
     * True iff [callerId] is in [managerId]'s management chain — the chain-read rule for team
     * KPIs: the managers ABOVE the team's current manager (transitively) may read a KPI once it
     * has left DRAFT. Backs [ch.nokillswit.authz.requireTeamKpiReadAllowingChain]'s lazy check;
     * the walk itself lives in teams/ManagementChain.kt and is shared with the other features.
     */
    suspend fun managesManagerOf(callerId: UInt, managerId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(callerId, managerId) }

    /**
     * Startup backfill (see infra/db/Bootstrap.kt): encrypts rows still holding legacy plaintext
     * — including soft-deleted ones. With [reencryptAll] (set during key rotation) every row is
     * decrypted (current or previous key) and rewritten under the current key. Idempotent;
     * returns the rewritten count.
     */
    override suspend fun encryptLegacyRows(reencryptAll: Boolean): Int = suspendTransaction(database) {
        cipher.reencryptRows(TeamKpis, listOf(TeamKpis.description, TeamKpis.summary), reencryptAll)
    }

    // KPI ⋈ its team (INNER — the team row always exists, soft-deleted or not; the manager is
    // resolved through it) ⋈ the team's current manager.
    private fun joined() = TeamKpis
        .join(
            TeamService.Teams,
            JoinType.INNER,
            onColumn = TeamKpis.teamId,
            otherColumn = TeamService.Teams.id,
        )
        .join(
            managerUsers,
            JoinType.INNER,
            onColumn = TeamService.Teams.managerId,
            otherColumn = managerUsers[UserService.Users.id],
        )

    // Row → full document, from the joined() select (team + manager fields come from the join).
    private fun ResultRow.toResponse(): TeamKpiResponse = TeamKpiResponse(
        id = this[TeamKpis.id].value,
        teamId = this[TeamKpis.teamId].value,
        teamName = this[TeamService.Teams.name],
        teamDeleted = this[TeamService.Teams.markedAsDeleted],
        managerId = this[TeamService.Teams.managerId].value,
        managerName = this[managerUsers[UserService.Users.name]],
        createdAt = this[TeamKpis.createdAt],
        title = this[TeamKpis.title],
        description = cipher.decrypt(this[TeamKpis.description]),
        type = this[TeamKpis.type],
        targetValue = this[TeamKpis.targetValue],
        currentValue = this[TeamKpis.currentValue],
        currentValueDate = this[TeamKpis.currentValueDate],
        status = this[TeamKpis.status],
        summary = this[TeamKpis.summary]?.let(cipher::decrypt),
        lastModified = this[TeamKpis.lastModified],
    )

    private fun ResultRow.toValueResponse(): TeamKpiValueResponse = TeamKpiValueResponse(
        id = this[TeamKpiValues.id].value,
        date = this[TeamKpiValues.valueDate],
        value = this[TeamKpiValues.value],
    )

    /**
     * The team's current member ids — the transition path resolves them inside its own
     * transaction (via the private overload below); the values routes call this public wrapper
     * right after their mutation to fan out the data-point notifications (no authorization
     * hangs on the tiny window, and a notification to a just-removed member is harmless).
     */
    suspend fun memberIds(teamId: UInt): Set<UInt> = suspendTransaction(database) { memberIdsOf(teamId) }

    private suspend fun memberIdsOf(teamId: UInt): Set<UInt> =
        TeamService.TeamMembers
            .select(TeamService.TeamMembers.userId)
            .where { TeamService.TeamMembers.teamId eq teamId }
            .map { it[TeamService.TeamMembers.userId].value }
            .toList()
            .toSet()

    private fun buildPredicate(filter: TeamKpiListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.teamName?.takeIf { it.isNotBlank() }?.let {
            op = op and (TeamService.Teams.name.containsNormalized(it))
        }
        filter.teamId?.let { op = op and (TeamKpis.teamId eq it) }
        filter.title?.takeIf { it.isNotBlank() }?.let {
            op = op and (TeamKpis.title.containsNormalized(it))
        }
        filter.type?.let { op = op and (TeamKpis.type eq it) }
        filter.status?.let { op = op and (TeamKpis.status eq it) }
        filter.createdAtGte?.let { op = op and (TeamKpis.createdAt greaterEq it) }
        filter.lastModifiedGte?.let { op = op and (TeamKpis.lastModified greaterEq it) }
        return op
    }
}
