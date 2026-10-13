package ch.nokillswit.teams

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ConflictException
import ch.nokillswit.authz.requirePulseTrendAccess
import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.users.UserService
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import java.time.LocalDate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

val TeamServiceKey = AttributeKey<TeamService>("TeamService")

data class TeamListFilter(
    val name: String? = null,
    val managerId: UInt? = null,
    val memberId: UInt? = null,
)

data class TeamListResult(
    val items: List<TeamListItem>,
    val total: Long,
)

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to TeamService.Teams.id,
    "name" to TeamService.Teams.name,
)

enum class TeamMemberListView { MEMBER, MANAGED, MANAGERS }

data class TeamMemberListFilter(
    val name: String? = null,
    val email: String? = null,
    /** Repeated-key `IN` (API-LIST-004): rows of ANY of these teams. */
    val teamIds: Set<UInt>? = null,
    /** Strict boolean (the `GET /users` semantics): true = only deactivated, false = only active, null = any. */
    val deactivated: Boolean? = null,
)

data class TeamMemberListResult(
    val items: List<TeamMemberListItem>,
    val total: Long,
)

private val MEMBER_SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to UserService.Users.id,
    "teamId" to TeamService.Teams.id,
    "name" to UserService.Users.name,
    "email" to UserService.Users.email,
    "teamName" to TeamService.Teams.name,
)

/** [TeamService.updateTeam]'s result: the id of the manager period now covering today when the manager changed. */
data class TeamUpdateOutcome(val managerPeriodId: UInt?)

/** [TeamService.deleteTeam]'s counts for the audit event. */
data class TeamDeleteOutcome(val membershipsEnded: Int, val futureRowsRemoved: Int)

/** [TeamService.joinTeam]'s result; [changed] = false means the person was already a current member. */
data class TeamJoinOutcome(
    val changed: Boolean,
    val membershipId: UInt?,
    val startDate: String?,
    /** True when a period that ended yesterday was reopened (the same-day undo of a removal). */
    val reopened: Boolean = false,
)

/** [TeamService.leaveTeam]'s result: the new last day, or [hardDeleted] when the period started today. */
data class TeamLeaveOutcome(val changed: Boolean, val endDate: String?, val hardDeleted: Boolean)

/**
 * Teams, rosters and the manager succession line. Since V93 (v4.17.0) the structure is DATED:
 * [Teams] and [TeamMembers] are read-only VIEWS (`teams_current`, `team_members`) holding today's
 * manager and today's roster, so every reader keeps its old shape; all writes go to the base tables
 * [TeamRecords], [TeamMemberships] and [TeamManagerPeriods]. "Today" comes through the injectable
 * [clock] seam (the `ShareService` idiom) and must agree with the views' `CURRENT_DATE` — the pooled
 * session time zone is aligned with the JVM's in `infra/db/Database.kt`.
 */
class TeamService(
    val database: R2dbcDatabase,
    private val clock: () -> LocalDate = { LocalDate.now() },
) {
    /** READ-ONLY view `teams_current` (V93): each team with its manager as of today. Never written. */
    object Teams : UIntIdTable("teams_current") {
        val name = varchar("name", length = 100)
        val managerId = reference("manager_id", UserService.Users)
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    /** READ-ONLY view `team_members` (V93): the CURRENT memberships only. Never written. */
    object TeamMembers : Table("team_members") {
        val teamId = reference("team_id", Teams)
        val userId = reference("user_id", UserService.Users)
        override val primaryKey = PrimaryKey(teamId, userId)
    }

    /** The `teams` base table — the write side of [Teams] (name and the soft-delete flag). */
    object TeamRecords : UIntIdTable("teams") {
        val name = varchar("name", length = 100)
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    /** Membership periods (V93); a null start = since before records, a null end = open, end inclusive. */
    object TeamMemberships : UIntIdTable("team_memberships") {
        val teamId = reference("team_id", TeamRecords)
        val userId = reference("user_id", UserService.Users)
        val startDate = varchar("start_date", length = 10).nullable()
        val endDate = varchar("end_date", length = 10).nullable()
        val createdAt = long("created_at")
        val lastModified = long("last_modified")
    }

    /** The manager succession line (V93): same date semantics as [TeamMemberships]. */
    object TeamManagerPeriods : UIntIdTable("team_manager_periods") {
        val teamId = reference("team_id", TeamRecords)
        val managerId = reference("manager_id", UserService.Users)
        val startDate = varchar("start_date", length = 10).nullable()
        val endDate = varchar("end_date", length = 10).nullable()
        val createdAt = long("created_at")
        val lastModified = long("last_modified")
    }

    /** How many distinct people currently report directly to [managerId] (non-deleted teams). */
    suspend fun directReportCount(managerId: UInt): Int = suspendTransaction(database) {
        directSubordinateIds(managerId).size
    }

    // ——— Team-tree scopes (v2.0.0, backing the pulse-survey views) ———
    // Thin transaction wrappers over teams/TeamTree.kt's pure walks, plus the name lookups the
    // routes need. The tree is derived per call, never cached.

    /** Teams whose pulse results [userId] may view: member-of + managed + everything below. */
    suspend fun visibleTeamTreeIds(userId: UInt): Set<UInt> = suspendTransaction(database) {
        visibleResultTeamIds(userId)
    }

    /** Teams [userId] may monitor as a manager: managed + everything below (empty for non-managers). */
    suspend fun managedTeamTreeIds(userId: UInt): Set<UInt> = suspendTransaction(database) {
        monitoredTeamIds(userId)
    }

    /** Teams [userId] is currently a MEMBER of (see TeamTree.memberTeamIds; v2.12.0). */
    suspend fun membershipTeamIds(userId: UInt): Set<UInt> = suspendTransaction(database) {
        memberTeamIds(userId)
    }

    /**
     * True iff [userId] manages the team [teamId] or sits in the chain above its manager (see
     * TeamTree.managesTeamOrChain) — the pulse-results share AUTHOR rule, the team-KPI manage
     * predicate's twin (v4.12.0).
     */
    suspend fun managesTeamOrChain(userId: UInt, teamId: UInt): Boolean = suspendTransaction(database) {
        ch.nokillswit.teams.managesTeamOrChain(userId, teamId)
    }

    /**
     * The team-visibility rule of a team's pulse results for [principal] — the ONE binding of
     * `requirePulseTrendAccess` to [visibleTeamTreeIds], shared by the trend route and the
     * results-sharing adapter (v4.12.0). Sharing always calls it with the HR role stripped, so its
     * HR branch never fires from there; the per-cycle fill gate is NOT part of it (a content gate
     * the results route applies per read). Throws `ForbiddenException` on a denial.
     */
    suspend fun requireResultsVisible(principal: CallerPrincipal, teamId: UInt) {
        requirePulseTrendAccess(principal, teamId) { visibleTeamTreeIds(principal.userId) }
    }

    /** The users a team-scoped pulse aggregate draws from (see TeamTree.teamScopeUserIds). */
    suspend fun teamScopeMembers(teamId: UInt, subtree: Boolean): Set<UInt> = suspendTransaction(database) {
        teamScopeUserIds(teamId, subtree)
    }

    /** (id, name) of the non-deleted teams among [ids], name-ascending. */
    suspend fun teamRefs(ids: Set<UInt>): List<TeamRef> = suspendTransaction(database) {
        if (ids.isEmpty()) return@suspendTransaction emptyList()
        Teams.select(Teams.id, Teams.name)
            .where { (Teams.id inList ids) and active() }
            .map { TeamRef(id = it[Teams.id].value, name = it[Teams.name]) }
            .toList()
            .sortedBy { it.name }
    }

    /**
     * (id, name) of ONE non-deleted team — one statement, for callers that need only the name
     * (the pulse results/comments/trend handlers; [read] also loads the member ids, v4.15.0).
     */
    suspend fun readRef(id: UInt): TeamRef? = suspendTransaction(database) {
        Teams.select(Teams.id, Teams.name)
            .where { (Teams.id eq id) and active() }
            .map { TeamRef(id = it[Teams.id].value, name = it[Teams.name]) }
            .singleOrNull()
    }

    /** Every non-deleted team, name-ascending (the HR org-wide scope). */
    suspend fun allTeamRefs(): List<TeamRef> = suspendTransaction(database) {
        Teams.select(Teams.id, Teams.name)
            .where { active() }
            .map { TeamRef(id = it[Teams.id].value, name = it[Teams.name]) }
            .toList()
            .sortedBy { it.name }
    }

    /**
     * (userId, name) of each team's current members with non-deleted accounts, keyed by team
     * id, per-team name-ascending — ONE grouped join query however many teams are asked for
     * (the careerProfilesByUserIds batching shape). A team without members is simply absent
     * from the map.
     */
    suspend fun membersWithNamesByTeamIds(teamIds: Set<UInt>): Map<UInt, List<Pair<UInt, String>>> =
        suspendTransaction(database) {
            if (teamIds.isEmpty()) return@suspendTransaction emptyMap()
            TeamMembers
                .join(
                    UserService.Users,
                    JoinType.INNER,
                    onColumn = TeamMembers.userId,
                    otherColumn = UserService.Users.id,
                )
                .select(TeamMembers.teamId, TeamMembers.userId, UserService.Users.name)
                .where {
                    (TeamMembers.teamId inList teamIds) and
                        (UserService.Users.markedAsDeleted eq false)
                }
                .map { Triple(it[TeamMembers.teamId].value, it[TeamMembers.userId].value, it[UserService.Users.name]) }
                .toList()
                .groupBy({ it.first }, { it.second to it.third })
                .mapValues { (_, members) -> members.sortedBy { it.second } }
        }

    /** The manager and every listed member start TODAY (V93). */
    suspend fun create(team: Team): UInt = suspendTransaction(database) {
        validateMembership(team)
        val iso = clock().toString()
        val now = System.currentTimeMillis()
        val teamId = TeamRecords.insert {
            it[name] = team.name
        }[TeamRecords.id].value
        TeamManagerPeriods.insert {
            it[TeamManagerPeriods.teamId] = teamId
            it[managerId] = team.managerId
            it[startDate] = iso
            it[createdAt] = now
            it[lastModified] = now
        }
        team.memberIds.forEach { uid -> insertMembership(teamId, uid, iso, now) }
        teamId
    }

    suspend fun read(id: UInt): Team? = suspendTransaction(database) {
        val row = Teams.selectAll()
            .where { (Teams.id eq id) and active() }
            .singleOrNull()
            ?: return@suspendTransaction null
        val memberIds = TeamMembers.selectAll()
            .where { TeamMembers.teamId eq id }
            .map { it[TeamMembers.userId].value }
            .toList()
        Team(
            name = row[Teams.name],
            managerId = row[Teams.managerId].value,
            memberIds = memberIds,
        )
    }

    /**
     * The single-team GET's read: [read] plus the manager's display fields via the list's
     * Users join — deliberately no active() on Users, so a soft-deleted manager still
     * resolves (with the flag set) exactly like the teams-list rows.
     */
    suspend fun readDetail(id: UInt): TeamDetail? = suspendTransaction(database) {
        val row = (Teams innerJoin UserService.Users)
            .select(Teams.name, Teams.managerId, UserService.Users.name, UserService.Users.markedAsDeleted)
            .where { (Teams.id eq id) and active() }
            .singleOrNull()
            ?: return@suspendTransaction null
        val memberIds = TeamMembers.selectAll()
            .where { TeamMembers.teamId eq id }
            .map { it[TeamMembers.userId].value }
            .toList()
        TeamDetail(
            team = Team(
                name = row[Teams.name],
                managerId = row[Teams.managerId].value,
                memberIds = memberIds,
            ),
            managerName = row[UserService.Users.name],
            managerDeleted = row[UserService.Users.markedAsDeleted],
        )
    }

    /**
     * True iff [callerId] is [managerId] themselves or anywhere in their transitive chain —
     * backs the TeamResponse `canManageKpis` capability (v2.34.0; the
     * TeamKpiService.managesTeamOrChain predicate, keyed on the manager already in hand so
     * the single GET/create pay one walk, not a team lookup). Own transaction.
     */
    suspend fun canManageKpisOf(callerId: UInt, managerId: UInt): Boolean =
        suspendTransaction(database) {
            callerId == managerId || isInManagementChain(callerId, managerId)
        }

    /** [updateTeam] for callers that only need to know whether the team existed (`1`/`0`). */
    suspend fun update(id: UInt, team: Team): Int = if (updateTeam(id, team) == null) 0 else 1

    /**
     * The `PUT /teams/{id}` write, with TODAY semantics (V93): a rename keeps the history; the roster
     * delta is applied from today (added people join today, removed people leave — their period ends
     * yesterday, or is hard-deleted when it started today; unchanged people are untouched); a CHANGED
     * manager starts a new period today (corrected in place when today's period itself started today,
     * merged into the previous period when it is the same person). `null` = missing/soft-deleted team.
     * A future period of an added person, or a manager who would also be a member, is a 409/400.
     */
    suspend fun updateTeam(id: UInt, team: Team): TeamUpdateOutcome? = suspendTransaction(database) {
        validateMembership(team)
        lockTeam(id)
        val renamed = TeamRecords.update({ (TeamRecords.id eq id) and (TeamRecords.markedAsDeleted eq false) }) {
            it[name] = team.name
        }
        if (renamed == 0) return@suspendTransaction null
        val today = clock()
        val now = System.currentTimeMillis()
        applyRoster(id, team.memberIds.toSet(), today, now)
        val managerPeriodId = handOverManager(id, team.managerId, today, now)
        requireManagerNotMember(membershipRows(id), managerLineRows(id), today)
        TeamUpdateOutcome(managerPeriodId)
    }

    /** [deleteTeam] for callers that only need to know whether the team existed (`1`/`0`). */
    suspend fun delete(id: UInt): Int = if (deleteTeam(id) == null) 0 else 1

    /**
     * Soft-deletes the team and closes its structure on TODAY (V93): open memberships and the final
     * manager period get end = today (earlier as-of views still show the team), rows that start
     * after today are hard-deleted. `null` = missing/already deleted.
     */
    suspend fun deleteTeam(id: UInt): TeamDeleteOutcome? = suspendTransaction(database) {
        lockTeam(id)
        val flagged = TeamRecords.update({ (TeamRecords.id eq id) and (TeamRecords.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
        if (flagged == 0) return@suspendTransaction null
        val iso = clock().toString()
        val now = System.currentTimeMillis()
        var membershipsEnded = 0
        var futureRowsRemoved = 0
        membershipRows(id).forEach { row ->
            if (row.start != null && row.start > iso) {
                TeamMemberships.deleteWhere { TeamMemberships.id eq row.id }
                futureRowsRemoved++
            } else if (row.end == null || row.end > iso) {
                endMembership(row.id, iso, now)
                membershipsEnded++
            }
        }
        val line = managerLineRows(id)
        line.filter { it.start != null && it.start > iso }.forEach { row ->
            TeamManagerPeriods.deleteWhere { TeamManagerPeriods.id eq row.id }
            futureRowsRemoved++
        }
        line.lastOrNull { it.start == null || it.start <= iso }
            ?.takeIf { it.end == null || it.end > iso }
            ?.let { last ->
                TeamManagerPeriods.update({ TeamManagerPeriods.id eq last.id }) {
                    it[endDate] = iso
                    it[lastModified] = now
                }
            }
        TeamDeleteOutcome(membershipsEnded, futureRowsRemoved)
    }

    /** `null` = team missing/soft-deleted, `true` = membership changed, `false` = already a member. */
    suspend fun addMember(teamId: UInt, userId: UInt): Boolean? = joinTeam(teamId, userId)?.changed

    /**
     * Adds [userId] to the team from TODAY (V93). Idempotent when they are a current member; a
     * not-yet-started period of the same pair is a 409 (joining today would overlap it); a period
     * that ended yesterday is reopened (the same-day undo of a removal).
     * `null` = team missing/soft-deleted.
     */
    suspend fun joinTeam(teamId: UInt, userId: UInt): TeamJoinOutcome? =
        suspendTransaction(database) {
            lockTeam(teamId)
            val managerId = Teams.selectAll()
                .where { (Teams.id eq teamId) and active() }
                .singleOrNull()
                ?.get(Teams.managerId)?.value
                ?: return@suspendTransaction null
            if (userId == managerId) {
                throw BadRequestException("Manager cannot also be a standard member")
            }
            val today = clock()
            val iso = today.toString()
            val own = membershipRows(teamId).filter { it.userId == userId }
            if (own.any { periodCovers(it.start, it.end, iso) }) {
                return@suspendTransaction TeamJoinOutcome(changed = false, membershipId = null, startDate = null)
            }
            if (own.any { it.start != null && it.start > iso }) {
                throw ConflictException("A future membership of this person in the team already exists")
            }
            val now = System.currentTimeMillis()
            // The same-day undo of a removal: the person's period ended exactly yesterday (only a
            // removal today produces that), so it is reopened instead of leaving two adjacent rows.
            val undone = own.firstOrNull { it.end == today.yesterdayIso() }
            val outcome = if (undone != null) {
                reopenMembership(undone.id, now)
                TeamJoinOutcome(changed = true, membershipId = undone.id, startDate = undone.start, reopened = true)
            } else {
                TeamJoinOutcome(changed = true, membershipId = insertMembership(teamId, userId, iso, now), startDate = iso)
            }
            requireManagerNotMember(membershipRows(teamId), managerLineRows(teamId), today)
            outcome
        }

    /** `null` = team missing/soft-deleted, `true` = membership changed, `false` = was not a member. */
    suspend fun removeMember(teamId: UInt, userId: UInt): Boolean? = leaveTeam(teamId, userId)?.changed

    /**
     * Ends [userId]'s current membership TODAY (V93): the period ends yesterday, or is hard-deleted
     * when it started today. A no-op (`changed = false`) when they are not a current member.
     * `null` = team missing/soft-deleted.
     */
    suspend fun leaveTeam(teamId: UInt, userId: UInt): TeamLeaveOutcome? =
        suspendTransaction(database) {
            lockTeam(teamId)
            Teams.selectAll()
                .where { (Teams.id eq teamId) and active() }
                .singleOrNull()
                ?: return@suspendTransaction null
            val today = clock()
            val iso = today.toString()
            val current = membershipRows(teamId)
                .firstOrNull { it.userId == userId && periodCovers(it.start, it.end, iso) }
                ?: return@suspendTransaction TeamLeaveOutcome(changed = false, endDate = null, hardDeleted = false)
            leaveMembership(current, today, System.currentTimeMillis())
        }

    /**
     * [includeIndirect] (v2.26.0, only with a `managerId` filter — the route 400s otherwise)
     * widens the manager-equality filter to the manager's transitive subtree: teams managed by
     * them or by anyone below them (the listMembers MANAGED idiom). Backs the KPI create
     * picker's "any team I manage directly or indirectly".
     */
    suspend fun list(
        filter: TeamListFilter,
        paging: PageRequest,
        includeIndirect: Boolean = false,
    ): TeamListResult =
        suspendTransaction(database) {
            var predicate: Op<Boolean> =
                buildPredicate(if (includeIndirect) filter.copy(managerId = null) else filter) and active()
            if (includeIndirect && filter.managerId != null) {
                predicate = predicate and
                    (Teams.managerId inList (transitiveSubordinateIds(filter.managerId) + filter.managerId))
            }
            val join = Teams innerJoin UserService.Users
            val total = join.selectAll().where { predicate }.count()
            val pageRows = join
                .select(
                    Teams.id,
                    Teams.name,
                    Teams.managerId,
                    UserService.Users.name,
                    UserService.Users.markedAsDeleted,
                )
                .where { predicate }
                .applyPaging(paging, SORTABLE_COLUMNS)
                .toList()
            // ONE grouped statement for the whole page (the users-list `teams` idiom); like
            // readDetail, no soft-deleted-user filter, so the ids equal GET /teams/{id}'s.
            val memberIdsByTeam = if (pageRows.isEmpty()) {
                emptyMap()
            } else {
                TeamMembers
                    .select(TeamMembers.teamId, TeamMembers.userId)
                    .where { TeamMembers.teamId inList pageRows.map { it[Teams.id].value } }
                    .toList()
                    .groupBy({ it[TeamMembers.teamId].value }, { it[TeamMembers.userId].value })
            }
            val rows = pageRows.map { row ->
                TeamListItem(
                    id = row[Teams.id].value,
                    name = row[Teams.name],
                    managerId = row[Teams.managerId].value,
                    managerName = row[UserService.Users.name],
                    managerDeleted = row[UserService.Users.markedAsDeleted],
                    memberIds = memberIdsByTeam[row[Teams.id].value].orEmpty().sorted(),
                )
            }
            TeamListResult(items = rows, total = total)
        }

    suspend fun listMembers(
        view: TeamMemberListView,
        callerUserId: UInt,
        filter: TeamMemberListFilter,
        paging: PageRequest,
        includeIndirect: Boolean = false,
    ): TeamMemberListResult = suspendTransaction(database) {
        val callerMemberships = TeamMembers.alias("caller_memberships")
        val callerTeamIds = callerMemberships
            .select(callerMemberships[TeamMembers.teamId])
            .where { callerMemberships[TeamMembers.userId] eq callerUserId }
        val join: Join
        val predicate: Op<Boolean>
        when (view) {
            TeamMemberListView.MEMBER, TeamMemberListView.MANAGED -> {
                val scope: Op<Boolean> = if (view == TeamMemberListView.MEMBER) {
                    TeamMembers.teamId inSubQuery callerTeamIds
                } else if (includeIndirect) {
                    // All transitive reports: rows of teams managed by the caller or by anyone
                    // in the caller's management chain, so each indirect report shows up with
                    // the team(s) they hold under their own manager.
                    Teams.managerId inList (transitiveSubordinateIds(callerUserId) + callerUserId)
                } else {
                    Teams.managerId eq callerUserId
                }
                join = TeamMembers
                    .join(Teams, JoinType.INNER, onColumn = TeamMembers.teamId, otherColumn = Teams.id)
                    .join(
                        UserService.Users,
                        JoinType.INNER,
                        onColumn = TeamMembers.userId,
                        otherColumn = UserService.Users.id,
                    )
                predicate = scope and
                    (TeamMembers.userId neq callerUserId) and
                    active() and
                    (UserService.Users.markedAsDeleted eq false) and
                    buildMemberPredicate(filter)
            }
            TeamMemberListView.MANAGERS -> {
                join = Teams.join(
                    UserService.Users,
                    JoinType.INNER,
                    onColumn = Teams.managerId,
                    otherColumn = UserService.Users.id,
                )
                predicate = (Teams.id inSubQuery callerTeamIds) and
                    (Teams.managerId neq callerUserId) and
                    active() and
                    (UserService.Users.markedAsDeleted eq false) and
                    buildMemberPredicate(filter)
            }
        }
        val total = join.selectAll().where { predicate }.count()
        // parsePaging only appends "id" (the user id), which is not unique here — the same
        // user may appear once per shared team — so add the team id as a final tiebreaker.
        val stablePaging =
            if (paging.sort.any { it.name == "teamId" }) paging
            else paging.copy(sort = paging.sort + SortField("teamId", descending = false))
        val rows = join
            .select(
                UserService.Users.id,
                UserService.Users.name,
                UserService.Users.email,
                Teams.id,
                Teams.name,
                UserService.Users.deactivated,
            )
            .where { predicate }
            .applyPaging(stablePaging, MEMBER_SORTABLE_COLUMNS)
            .map { row ->
                TeamMemberListItem(
                    userId = row[UserService.Users.id].value,
                    name = row[UserService.Users.name],
                    email = row[UserService.Users.email],
                    teamId = row[Teams.id].value,
                    teamName = row[Teams.name],
                    deactivated = row[UserService.Users.deactivated],
                )
            }
            .toList()
        TeamMemberListResult(items = rows, total = total)
    }

    private fun active(): Op<Boolean> = Teams.markedAsDeleted eq false

    private fun buildPredicate(filter: TeamListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.name?.takeIf { it.isNotBlank() }?.let {
            op = op and (Teams.name.containsNormalized(it))
        }
        filter.managerId?.let {
            op = op and (Teams.managerId eq it)
        }
        filter.memberId?.let {
            val memberTeamIds = TeamMembers
                .select(TeamMembers.teamId)
                .where { TeamMembers.userId eq it }
            op = op and (Teams.id inSubQuery memberTeamIds)
        }
        return op
    }

    private fun buildMemberPredicate(filter: TeamMemberListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.name?.takeIf { it.isNotBlank() }?.let {
            op = op and (UserService.Users.name.containsNormalized(it))
        }
        filter.email?.takeIf { it.isNotBlank() }?.let {
            op = op and (UserService.Users.email.containsNormalized(it))
        }
        filter.teamIds?.let {
            op = op and (Teams.id inList it)
        }
        filter.deactivated?.let {
            op = op and (UserService.Users.deactivated eq it)
        }
        return op
    }

    private fun validateMembership(team: Team) {
        if (team.memberIds.distinct().size != team.memberIds.size) {
            throw BadRequestException("Duplicate memberIds")
        }
        if (team.managerId in team.memberIds) {
            throw BadRequestException("Manager cannot also be a standard member")
        }
    }

    private suspend fun insertMembership(teamId: UInt, userId: UInt, startIso: String, now: Long): UInt =
        TeamMemberships.insert {
            it[TeamMemberships.teamId] = teamId
            it[TeamMemberships.userId] = userId
            it[startDate] = startIso
            it[createdAt] = now
            it[lastModified] = now
        }[TeamMemberships.id].value

    private suspend fun reopenMembership(membershipId: UInt, now: Long) {
        TeamMemberships.update({ TeamMemberships.id eq membershipId }) {
            it[endDate] = null
            it[lastModified] = now
        }
    }

    private suspend fun endMembership(membershipId: UInt, endIso: String, now: Long) {
        TeamMemberships.update({ TeamMemberships.id eq membershipId }) {
            it[endDate] = endIso
            it[lastModified] = now
        }
    }

    /** Ends [row] as of [today]: yesterday is its last day, or it is hard-deleted when it started today. */
    private suspend fun leaveMembership(row: MembershipRow, today: LocalDate, now: Long): TeamLeaveOutcome =
        if (row.start == today.toString()) {
            TeamMemberships.deleteWhere { TeamMemberships.id eq row.id }
            TeamLeaveOutcome(changed = true, endDate = null, hardDeleted = true)
        } else {
            val yesterday = today.yesterdayIso()
            endMembership(row.id, yesterday, now)
            TeamLeaveOutcome(changed = true, endDate = yesterday, hardDeleted = false)
        }

    /** Applies the PUT's roster as a delta from [today]: see [updateTeam]. */
    private suspend fun applyRoster(teamId: UInt, desired: Set<UInt>, today: LocalDate, now: Long) {
        val iso = today.toString()
        val rows = membershipRows(teamId)
        val current = rows.filter { periodCovers(it.start, it.end, iso) }.associateBy { it.userId }
        val added = (desired - current.keys).sorted()
        added.forEach { uid ->
            if (rows.any { it.userId == uid && it.start != null && it.start > iso }) {
                throw ConflictException("A future membership of user $uid in the team already exists")
            }
        }
        (current.keys - desired).sorted().forEach { uid -> leaveMembership(current.getValue(uid), today, now) }
        val yesterday = today.yesterdayIso()
        added.forEach { uid ->
            // Same-day undo of a removal: reopen the period that ended yesterday instead of adding a row.
            val undone = rows.firstOrNull { it.userId == uid && it.end == yesterday }
            if (undone != null) reopenMembership(undone.id, now) else insertMembership(teamId, uid, iso, now)
        }
    }

    /**
     * Makes [managerId] the manager from [today] when they are not already: splits (or corrects in
     * place) the period covering today, merges equal neighbours and re-checks the line. Returns the
     * id of the period now covering today, or null when the manager did not change.
     */
    private suspend fun handOverManager(teamId: UInt, managerId: UInt, today: LocalDate, now: Long): UInt? {
        val iso = today.toString()
        val current = managerLineRows(teamId).firstOrNull { periodCovers(it.start, it.end, iso) }
            ?: error("Team $teamId has no manager period covering $iso")
        if (current.managerId == managerId) return null
        if (current.start == iso) {
            TeamManagerPeriods.update({ TeamManagerPeriods.id eq current.id }) {
                it[TeamManagerPeriods.managerId] = managerId
                it[lastModified] = now
            }
        } else {
            TeamManagerPeriods.update({ TeamManagerPeriods.id eq current.id }) {
                it[endDate] = today.yesterdayIso()
                it[lastModified] = now
            }
            TeamManagerPeriods.insert {
                it[TeamManagerPeriods.teamId] = teamId
                it[TeamManagerPeriods.managerId] = managerId
                it[startDate] = iso
                it[endDate] = current.end
                it[createdAt] = now
                it[lastModified] = now
            }
        }
        val line = mergeEqualNeighbours(managerLineRows(teamId), now)
        checkManagerLine(teamId, line, today)
        return line.first { periodCovers(it.start, it.end, iso) }.id
    }

    /** Folds adjacent periods of the same manager into the earlier row (its end extended); returns the line. */
    private suspend fun mergeEqualNeighbours(line: List<ManagerRow>, now: Long): List<ManagerRow> {
        val merged = mutableListOf<ManagerRow>()
        line.forEach { row ->
            val previous = merged.lastOrNull()
            if (previous != null && previous.managerId == row.managerId) {
                TeamManagerPeriods.update({ TeamManagerPeriods.id eq previous.id }) {
                    it[endDate] = row.end
                    it[lastModified] = now
                }
                TeamManagerPeriods.deleteWhere { TeamManagerPeriods.id eq row.id }
                merged[merged.lastIndex] = previous.copy(end = row.end)
            } else {
                merged += row
            }
        }
        return merged
    }
}
