package ch.nokillswit.teams

import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.select

/**
 * [managerId]'s direct reports: members of the non-deleted teams they manage.
 * Never includes [managerId] themselves. Runs in the caller's transaction.
 */
suspend fun directSubordinateIds(managerId: UInt): Set<UInt> =
    membersOfTeamsManagedBy(setOf(managerId)) - managerId

/**
 * All users in [managerId]'s transitive management chain: members of the non-deleted teams
 * they manage, plus (recursively) members of teams those members manage. Cycle-safe (only
 * newly discovered members are expanded) and never includes [managerId] themselves.
 * Runs in the caller's transaction.
 */
suspend fun transitiveSubordinateIds(managerId: UInt): Set<UInt> {
    val subordinates = mutableSetOf<UInt>()
    var frontier = setOf(managerId)
    while (frontier.isNotEmpty()) {
        val members = membersOfTeamsManagedBy(frontier)
        frontier = members - subordinates - managerId
        subordinates += frontier
    }
    return subordinates
}

/**
 * True iff [managerId] is in [subjectId]'s management chain — the manager of a non-deleted team
 * the subject belongs to, or, transitively, the manager of such a manager, and so on. Walks
 * upward from the subject (bounded by chain height); a management cycle terminates via the
 * visited set, and a caller is never considered their own manager.
 * Runs in the caller's transaction.
 */
suspend fun isInManagementChain(managerId: UInt, subjectId: UInt): Boolean {
    if (managerId == subjectId) return false
    var frontier = setOf(subjectId)
    val visited = mutableSetOf<UInt>()
    while (frontier.isNotEmpty()) {
        val managers = managersOf(frontier)
        if (managerId in managers) return true
        visited += frontier
        frontier = managers - visited
    }
    return false
}

/** Managers of the non-deleted teams the [userIds] are members of. Runs in the caller's transaction. */
private suspend fun managersOf(userIds: Set<UInt>): Set<UInt> =
    TeamService.TeamMembers
        .join(
            TeamService.Teams,
            JoinType.INNER,
            onColumn = TeamService.TeamMembers.teamId,
            otherColumn = TeamService.Teams.id,
        )
        .select(TeamService.Teams.managerId)
        .where {
            (TeamService.TeamMembers.userId inList userIds) and
                (TeamService.Teams.markedAsDeleted eq false)
        }
        .map { it[TeamService.Teams.managerId].value }
        .toList()
        .toSet()

/** Members of the non-deleted teams managed by any of [managerIds]. */
private suspend fun membersOfTeamsManagedBy(managerIds: Set<UInt>): Set<UInt> =
    TeamService.TeamMembers
        .join(
            TeamService.Teams,
            JoinType.INNER,
            onColumn = TeamService.TeamMembers.teamId,
            otherColumn = TeamService.Teams.id,
        )
        .select(TeamService.TeamMembers.userId)
        .where {
            (TeamService.Teams.managerId inList managerIds) and
                (TeamService.Teams.markedAsDeleted eq false)
        }
        .map { it[TeamService.TeamMembers.userId].value }
        .toList()
        .toSet()
