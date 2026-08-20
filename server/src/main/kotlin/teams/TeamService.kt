package ch.nokillswit.teams

import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.users.UserService
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
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
    val teamId: UInt? = null,
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

class TeamService(val database: R2dbcDatabase) {
    object Teams : UIntIdTable() {
        val name = varchar("name", length = 100)
        val managerId = reference("manager_id", UserService.Users)
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    object TeamMembers : Table("team_members") {
        val teamId = reference("team_id", Teams)
        val userId = reference("user_id", UserService.Users)
        override val primaryKey = PrimaryKey(teamId, userId)
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

    suspend fun create(team: Team): UInt = suspendTransaction(database) {
        validateMembership(team)
        val newRecord = Teams.insert {
            it[name] = team.name
            it[managerId] = team.managerId
        }
        val teamId = newRecord[Teams.id].value
        insertMembers(teamId, team.memberIds)
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

    suspend fun update(id: UInt, team: Team): Int = suspendTransaction(database) {
        validateMembership(team)
        val updated = Teams.update({ (Teams.id eq id) and (Teams.markedAsDeleted eq false) }) {
            it[name] = team.name
            it[managerId] = team.managerId
        }
        if (updated > 0) {
            TeamMembers.deleteWhere { TeamMembers.teamId eq id }
            insertMembers(id, team.memberIds)
        }
        updated
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Teams.update({ (Teams.id eq id) and (Teams.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    /** `null` = team missing/soft-deleted, `true` = membership changed, `false` = already a member. */
    suspend fun addMember(teamId: UInt, userId: UInt): Boolean? =
        suspendTransaction(database) {
            val managerId = Teams.selectAll()
                .where { (Teams.id eq teamId) and active() }
                .singleOrNull()
                ?.get(Teams.managerId)?.value
                ?: return@suspendTransaction null
            if (userId == managerId) {
                throw BadRequestException("Manager cannot also be a standard member")
            }
            val alreadyMember = TeamMembers.selectAll()
                .where { (TeamMembers.teamId eq teamId) and (TeamMembers.userId eq userId) }
                .singleOrNull() != null
            if (!alreadyMember) {
                TeamMembers.insert {
                    it[TeamMembers.teamId] = teamId
                    it[TeamMembers.userId] = userId
                }
            }
            !alreadyMember
        }

    /** `null` = team missing/soft-deleted, `true` = membership changed, `false` = was not a member. */
    suspend fun removeMember(teamId: UInt, userId: UInt): Boolean? =
        suspendTransaction(database) {
            Teams.selectAll()
                .where { (Teams.id eq teamId) and active() }
                .singleOrNull()
                ?: return@suspendTransaction null
            TeamMembers.deleteWhere {
                (TeamMembers.teamId eq teamId) and (TeamMembers.userId eq userId)
            } > 0
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
            val rows = join
                .select(
                    Teams.id,
                    Teams.name,
                    Teams.managerId,
                    UserService.Users.name,
                    UserService.Users.markedAsDeleted,
                )
                .where { predicate }
                .applyPaging(paging, SORTABLE_COLUMNS)
                .map { row ->
                    TeamListItem(
                        id = row[Teams.id].value,
                        name = row[Teams.name],
                        managerId = row[Teams.managerId].value,
                        managerName = row[UserService.Users.name],
                        managerDeleted = row[UserService.Users.markedAsDeleted],
                    )
                }
                .toList()
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
        filter.teamId?.let {
            op = op and (Teams.id eq it)
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

    private suspend fun insertMembers(teamId: UInt, memberIds: List<UInt>) {
        memberIds.forEach { uid ->
            TeamMembers.insert {
                it[TeamMembers.teamId] = teamId
                it[TeamMembers.userId] = uid
            }
        }
    }
}
