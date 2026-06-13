package ch.nokillswit.teams

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

    suspend fun update(id: UInt, team: Team) {
        suspendTransaction(database) {
            validateMembership(team)
            Teams.update({ Teams.id eq id }) {
                it[name] = team.name
                it[managerId] = team.managerId
            }
            TeamMembers.deleteWhere { TeamMembers.teamId eq id }
            insertMembers(id, team.memberIds)
        }
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Teams.update({ (Teams.id eq id) and (Teams.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    suspend fun addMember(teamId: UInt, userId: UInt) {
        suspendTransaction(database) {
            val managerId = Teams.selectAll()
                .where { Teams.id eq teamId }
                .singleOrNull()
                ?.get(Teams.managerId)?.value
                ?: throw BadRequestException("Team $teamId not found")
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
        }
    }

    suspend fun removeMember(teamId: UInt, userId: UInt) {
        suspendTransaction(database) {
            val currentMembers = TeamMembers.selectAll()
                .where { TeamMembers.teamId eq teamId }
                .map { it[TeamMembers.userId].value }
                .toList()
            if (userId !in currentMembers) return@suspendTransaction
            TeamMembers.deleteWhere {
                (TeamMembers.teamId eq teamId) and (TeamMembers.userId eq userId)
            }
        }
    }

    suspend fun list(filter: TeamListFilter, paging: PageRequest): TeamListResult =
        suspendTransaction(database) {
            val predicate: Op<Boolean> = buildPredicate(filter) and active()
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
            op = op and (Teams.name.lowerCase() like containsPattern(it))
        }
        filter.managerId?.let {
            op = op and (Teams.managerId eq it)
        }
        return op
    }

    private fun buildMemberPredicate(filter: TeamMemberListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.name?.takeIf { it.isNotBlank() }?.let {
            op = op and (UserService.Users.name.lowerCase() like containsPattern(it))
        }
        filter.email?.takeIf { it.isNotBlank() }?.let {
            op = op and (UserService.Users.email.lowerCase() like containsPattern(it))
        }
        filter.teamId?.let {
            op = op and (Teams.id eq it)
        }
        return op
    }

    private fun containsPattern(raw: String): LikePattern {
        val escaped = raw.lowercase()
            .replace("\\", "\\\\")
            .replace("%", "\\%")
            .replace("_", "\\_")
        return LikePattern("%$escaped%", escapeChar = '\\')
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
