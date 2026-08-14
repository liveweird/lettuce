package ch.nokillswit.teams

import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.select

/**
 * Team-subtree traversal (v2.0.0, built for pulse-survey scopes) — the TEAM-id counterpart of
 * ManagementChain.kt's user-id walks, in the same style: pure set-at-a-time BFS helpers,
 * non-deleted teams only, cycle-safe via visited sets, all running in the caller's transaction.
 *
 * The team hierarchy is derived, not stored: team T2 is BELOW team T1 iff T2's manager is a
 * member of T1. (A manager is never a plain member of their own team, so a team is never its
 * own descendant; genuine management cycles terminate via the visited set.)
 */

/** Non-deleted teams the [userIds] currently manage. Runs in the caller's transaction. */
suspend fun teamsManagedBy(userIds: Set<UInt>): Set<UInt> =
    if (userIds.isEmpty()) emptySet()
    else TeamService.Teams
        .select(TeamService.Teams.id)
        .where {
            (TeamService.Teams.managerId inList userIds) and
                (TeamService.Teams.markedAsDeleted eq false)
        }
        .map { it[TeamService.Teams.id].value }
        .toList()
        .toSet()

/** Non-deleted teams the [userId] is currently a member of. Runs in the caller's transaction. */
suspend fun memberTeamIds(userId: UInt): Set<UInt> =
    TeamService.TeamMembers
        .join(
            TeamService.Teams,
            JoinType.INNER,
            onColumn = TeamService.TeamMembers.teamId,
            otherColumn = TeamService.Teams.id,
        )
        .select(TeamService.TeamMembers.teamId)
        .where {
            (TeamService.TeamMembers.userId inList setOf(userId)) and
                (TeamService.Teams.markedAsDeleted eq false)
        }
        .map { it[TeamService.TeamMembers.teamId].value }
        .toList()
        .toSet()

/** Current members of the non-deleted [teamIds]. Runs in the caller's transaction. */
suspend fun membersOf(teamIds: Set<UInt>): Set<UInt> =
    if (teamIds.isEmpty()) emptySet()
    else TeamService.TeamMembers
        .join(
            TeamService.Teams,
            JoinType.INNER,
            onColumn = TeamService.TeamMembers.teamId,
            otherColumn = TeamService.Teams.id,
        )
        .select(TeamService.TeamMembers.userId)
        .where {
            (TeamService.TeamMembers.teamId inList teamIds) and
                (TeamService.Teams.markedAsDeleted eq false)
        }
        .map { it[TeamService.TeamMembers.userId].value }
        .toList()
        .toSet()

/**
 * The teams DIRECTLY below [teamId]: teams managed by its current members — exactly the first
 * BFS edge of [teamsBelow] (v2.10.0, backing the pulse team-comparison view). Never includes
 * [teamId] itself (a manager is never a member of their own team, so the subtraction is
 * defensive only). Runs in the caller's transaction.
 */
suspend fun childTeamsOf(teamId: UInt): Set<UInt> =
    teamsManagedBy(membersOf(setOf(teamId))) - teamId

/**
 * Every team strictly below any of [startTeamIds]: teams managed by their members, teams
 * managed by THOSE teams' members, and so on. Never includes the start set itself.
 * Runs in the caller's transaction.
 */
suspend fun teamsBelow(startTeamIds: Set<UInt>): Set<UInt> {
    val below = mutableSetOf<UInt>()
    var frontier = startTeamIds
    while (frontier.isNotEmpty()) {
        val children = teamsManagedBy(membersOf(frontier))
        frontier = children - below - startTeamIds
        below += frontier
    }
    return below
}

/**
 * The teams whose pulse RESULTS the [userId] may view: the teams they are a member of, the
 * teams they manage, and everything below either ("their team(s) and below — teams managed by
 * their peers, and so on"). Runs in the caller's transaction.
 */
suspend fun visibleResultTeamIds(userId: UInt): Set<UInt> {
    val start = memberTeamIds(userId) + teamsManagedBy(setOf(userId))
    return start + teamsBelow(start)
}

/**
 * The teams the [userId] may MONITOR as a manager (pulse participation status + anonymized
 * comments): the teams they manage and everything below those. Empty for non-managers.
 * Runs in the caller's transaction.
 */
suspend fun monitoredTeamIds(userId: UInt): Set<UInt> {
    val start = teamsManagedBy(setOf(userId))
    return start + teamsBelow(start)
}

/**
 * The users a pulse aggregate over [teamId] draws from. Direct scope ([subtree] = false):
 * the team's current members. Subtree scope: the members plus every transitive subordinate
 * of a member (members of teams a member manages, and so on down). The team's own manager is
 * never included by their manager role — their response aggregates under the team they are a
 * MEMBER of. Runs in the caller's transaction.
 */
suspend fun teamScopeUserIds(teamId: UInt, subtree: Boolean): Set<UInt> {
    val members = membersOf(setOf(teamId))
    if (!subtree) return members
    val all = members.toMutableSet()
    var frontier: Set<UInt> = members
    while (frontier.isNotEmpty()) {
        val next = membersOf(teamsManagedBy(frontier)) - all
        all += next
        frontier = next
    }
    return all
}
