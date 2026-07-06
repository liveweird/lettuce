package ch.nokillswit.teams

import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.select

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
        val members = TeamService.TeamMembers
            .join(
                TeamService.Teams,
                JoinType.INNER,
                onColumn = TeamService.TeamMembers.teamId,
                otherColumn = TeamService.Teams.id,
            )
            .select(TeamService.TeamMembers.userId)
            .where {
                (TeamService.Teams.managerId inList frontier) and
                    (TeamService.Teams.markedAsDeleted eq false)
            }
            .map { it[TeamService.TeamMembers.userId].value }
            .toList()
        frontier = members.toSet() - subordinates - managerId
        subordinates += frontier
    }
    return subordinates
}
