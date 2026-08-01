package ch.nokillswit.teamkpis

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.db.containsPattern
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
class TeamKpiService(val database: R2dbcDatabase, private val cipher: FieldCipher) {
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
     * current value, or summary). A type change re-initializes the current value to 0.0,
     * discarding any recorded progress (the audit events explain the reset). Returns the
     * affected-row count (0 → missing/deleted, mapped to 404 by the route); throws
     * [ConflictException] (→ 409) when the KPI is not in DRAFT.
     */
    suspend fun updateDefinition(id: UInt, update: TeamKpiDefinitionUpdate): Int = suspendTransaction(database) {
        val current = TeamKpis.selectAll()
            .where { (TeamKpis.id eq id) and active() }
            .map { Triple(it[TeamKpis.status], it[TeamKpis.type], it[TeamKpis.currentValue]) }
            .singleOrNull()
            ?: return@suspendTransaction 0
        if (current.first != TeamKpiStatus.DRAFT) {
            throw ConflictException("Only a DRAFT team KPI's definition may be edited")
        }
        validateTeamKpiDefinition(update.title, update.description, update.type, update.targetValue)
        val typeChanged = current.second != update.type
        TeamKpis.update({ (TeamKpis.id eq id) and (TeamKpis.markedAsDeleted eq false) }) {
            it[title] = update.title
            it[description] = cipher.encrypt(update.description)
            it[type] = update.type
            it[targetValue] = update.targetValue!!
            it[currentValue] = if (typeChanged) 0.0 else current.third
            // A type change resets the recorded progress, its date included.
            if (typeChanged) it[currentValueDate] = null
            it[lastModified] = System.currentTimeMillis()
        }
    }

    /**
     * Records an ACTIVE KPI's dated value. Latest-dated wins: the row's currentValue (+ its date)
     * is overwritten only when [TeamKpiProgressUpdate.date] is on or after the stored
     * current_value_date (ISO string compare; a null stored date always loses) — a backdated
     * update older than that lands only in the audit events (and hence the graph), while
     * lastModified still moves. Returns the affected-row count (0 → missing/deleted → 404);
     * throws [ConflictException] (→ 409) when the KPI is not ACTIVE.
     */
    suspend fun updateProgress(id: UInt, update: TeamKpiProgressUpdate): Int = suspendTransaction(database) {
        val current = TeamKpis.selectAll()
            .where { (TeamKpis.id eq id) and active() }
            .map { Triple(it[TeamKpis.status], it[TeamKpis.type], it[TeamKpis.currentValueDate]) }
            .singleOrNull()
            ?: return@suspendTransaction 0
        if (current.first != TeamKpiStatus.ACTIVE) {
            throw ConflictException("Only an ACTIVE team KPI's current value may be updated")
        }
        validateTeamKpiProgress(current.second, update)
        val latestDated = current.third == null || update.date!! >= current.third!!
        TeamKpis.update({ (TeamKpis.id eq id) and (TeamKpis.markedAsDeleted eq false) }) {
            if (latestDated) {
                it[currentValue] = update.currentValue!!
                it[currentValueDate] = update.date
            }
            it[lastModified] = System.currentTimeMillis()
        }
    }

    /**
     * Moves a KPI [from] one status to [target] via the status state machine (DRAFT <-> ACTIVE
     * <-> CLOSED, never skipping ACTIVE) and returns the notifications the transition should
     * produce (the caller persists them) — one per current team member, resolved inside this
     * transaction, minus the acting manager. Each action endpoint names its whole edge — [from]
     * as well as [target] — because activate and reopen share the ACTIVE target and would
     * otherwise be interchangeable. Closing records [summary] (required — the route validates it
     * non-blank); reopening keeps the stored summary, to be overwritten at the next close.
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
            // Each endpoint names a whole edge of the DRAFT <-> ACTIVE <-> CLOSED machine, so the
            // from-status check alone gates it; the summary was validated by the route
            // (validateTeamKpiSummary) before the transaction.
            if (current.status != from) {
                throw ConflictException("Invalid status transition: ${current.status} -> $target")
            }
            TeamKpis.update({ (TeamKpis.id eq id) and (TeamKpis.markedAsDeleted eq false) }) {
                it[status] = target
                if (target == TeamKpiStatus.CLOSED) it[this.summary] = cipher.encrypt(summary!!)
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
    suspend fun encryptLegacyRows(reencryptAll: Boolean = false): Int = suspendTransaction(database) {
        val enveloped = "${FieldCipher.PREFIX}%"
        val legacyOnly = (TeamKpis.description notLike enveloped) or
            (TeamKpis.summary.isNotNull() and (TeamKpis.summary notLike enveloped))
        val rows = TeamKpis
            .select(TeamKpis.id, TeamKpis.description, TeamKpis.summary)
            .where { if (reencryptAll) Op.TRUE else legacyOnly }
            .toList()
        rows.forEach { row ->
            TeamKpis.update({ TeamKpis.id eq row[TeamKpis.id] }) {
                it[description] = cipher.encrypt(cipher.decrypt(row[TeamKpis.description]))
                it[summary] = row[TeamKpis.summary]?.let { s -> cipher.encrypt(cipher.decrypt(s)) }
            }
        }
        rows.size
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
            op = op and (TeamService.Teams.name.lowerCase() like containsPattern(it))
        }
        filter.teamId?.let { op = op and (TeamKpis.teamId eq it) }
        filter.title?.takeIf { it.isNotBlank() }?.let {
            op = op and (TeamKpis.title.lowerCase() like containsPattern(it))
        }
        filter.type?.let { op = op and (TeamKpis.type eq it) }
        filter.status?.let { op = op and (TeamKpis.status eq it) }
        filter.createdAtGte?.let { op = op and (TeamKpis.createdAt greaterEq it) }
        filter.lastModifiedGte?.let { op = op and (TeamKpis.lastModified greaterEq it) }
        return op
    }
}
