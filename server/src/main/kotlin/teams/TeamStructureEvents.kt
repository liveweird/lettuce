package ch.nokillswit.teams

import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import ch.nokillswit.teams.TeamService.TeamRecords
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.select
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val TeamStructureEventServiceKey = AttributeKey<TeamStructureEventService>("TeamStructureEventService")

/**
 * The team-structure action trail (v4.18.0, V94) — the eleventh [EventLogTable] clone, keyed on the
 * TEAM the action concerns (`team_id`; `user_id` = the acting ADMIN). Append-only and written by the
 * routes after each service commit and audit line; its only reader is the per-user activity log
 * (`activity/ActivityService.kt`, area `TEAM_MEMBERSHIP`).
 */
class TeamStructureEventService(val database: R2dbcDatabase) {
    object TeamStructureEvents : EventLogTable("team_structure_events", "team_id", TeamRecords)

    private val log = EventLog(database, TeamStructureEvents)

    /** Inserts an event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: TeamStructureEvent): UInt =
        log.create(event.teamId, event.userId, event.type.name, event.params)

    /**
     * The name snapshots a route needs for its event, in ONE transaction: the team's name ([teamId]
     * null skips it — pass it only when the route does not already know the name) and the display
     * names of [userIds]. Soft-deleted teams and people resolve too.
     */
    suspend fun names(teamId: UInt?, userIds: Collection<UInt>): StructureNames = suspendTransaction(database) {
        val team = teamId?.let { id ->
            TeamRecords.select(TeamRecords.name)
                .where { TeamRecords.id eq id }
                .map { it[TeamRecords.name] }
                .singleOrNull()
        }
        val ids = userIds.toSet()
        val users = if (ids.isEmpty()) {
            emptyMap()
        } else {
            UserService.Users.select(UserService.Users.id, UserService.Users.name)
                .where { UserService.Users.id inList ids }
                .map { it[UserService.Users.id].value to it[UserService.Users.name] }
                .toList()
                .toMap()
        }
        StructureNames(team, users)
    }
}

/** [TeamStructureEventService.names]'s result: the team's name (when asked for) and the people's names by id. */
data class StructureNames(val team: String?, val users: Map<UInt, String>)

/**
 * Pure mapping from a team-structure write to the structured event the route records after the
 * service commit and its audit line (the `CareerPositionEvents.kt` shape — side-effect-free,
 * unit-testable; persistence is the route's, see [TeamStructureEventService]). Keyed on the TEAM
 * ([TeamStructureEvent.teamId]) with the acting ADMIN in [TeamStructureEvent.userId].
 *
 * Params are content-free: ids, ISO dates, and NAME SNAPSHOTS frozen at mint time — `team`, and for a
 * person a name beside the id (`manager` beside `managerId`, `member` beside `memberUserId`,
 * `managerFromName` beside `managerFrom`). Teams are renamed and people renamed or deleted later, so
 * the log line keeps its own text; the SPA renders the snapshot. The
 * `…From`/`…To` deltas are the change-only ones the matching `audit("team.…")` line carries (a
 * manager change reads `managerFrom`/`managerTo` + `managerFromName`/`managerToName` on both the
 * team PUT and the manager-period PUT). A null date is simply absent: no `startDate` = "since before
 * records", no `endDate` = open-ended; for a delta, no `…From` = was unset, no `…To` = cleared.
 * Several people ride one param as comma-joined ids (`membersAdded`) next to their names joined
 * with ", " (`membersAddedNames`).
 */
enum class TeamStructureEventType {
    TEAM_CREATED,
    TEAM_UPDATED,
    TEAM_DELETED,
    MEMBER_ADDED,
    MEMBER_REMOVED,
    MEMBERSHIP_CREATED,
    MEMBERSHIP_UPDATED,
    MEMBERSHIP_DELETED,
    MANAGER_PERIOD_CREATED,
    MANAGER_PERIOD_UPDATED,
    MANAGER_PERIOD_DELETED,
}

/** One team-structure event: the team it concerns, the actor, its type and its params. */
data class TeamStructureEvent(
    val teamId: UInt,
    val userId: UInt?,
    val type: TeamStructureEventType,
    val params: Map<String, String> = emptyMap(),
)

private fun MutableMap<String, String>.putIfSet(key: String, value: String?) {
    if (value != null) put(key, value)
}

/** A person: the id under [key] and their snapshot name under [nameKey] (omitted when unresolved). */
private fun MutableMap<String, String>.putPersonAs(key: String, nameKey: String, id: UInt, names: Map<UInt, String>) {
    put(key, id.toString())
    names[id]?.let { put(nameKey, it) }
}

/** Comma-joined ascending ids under [key] and their names (", "-joined) under `<key>Names`; nothing when empty. */
private fun MutableMap<String, String>.putPeople(key: String, ids: Collection<UInt>, names: Map<UInt, String>) {
    if (ids.isEmpty()) return
    val sorted = ids.sorted()
    put(key, sorted.joinToString(","))
    val resolved = sorted.mapNotNull { names[it] }
    if (resolved.isNotEmpty()) put("${key}Names", resolved.joinToString(", "))
}

private fun MutableMap<String, String>.putRemoved(removedPeriodIds: List<UInt>) {
    if (removedPeriodIds.isNotEmpty()) put("removedPeriodIds", removedPeriodIds.sorted().joinToString(","))
}

private fun MutableMap<String, String>.putDateDelta(key: String, from: String?, to: String?) {
    if (from == to) return
    putIfSet("${key}From", from)
    putIfSet("${key}To", to)
}

internal fun teamCreatedEvent(
    actorId: UInt,
    teamId: UInt,
    team: Team,
    names: Map<UInt, String>,
): TeamStructureEvent = TeamStructureEvent(
    teamId,
    actorId,
    TeamStructureEventType.TEAM_CREATED,
    buildMap {
        put("team", team.name)
        putPersonAs("managerId", "manager", team.managerId, names)
        put("memberCount", team.memberIds.toSet().size.toString())
    },
)

/**
 * A PUT's deltas — a rename (`nameFrom`/`nameTo`), a manager handover and the roster delta (added /
 * removed ids + names), plus the manager period now covering today after a handover. **Change-only:**
 * a PUT that changes none of them yields `null`.
 */
internal fun teamUpdatedEvent(
    actorId: UInt,
    teamId: UInt,
    before: Team,
    after: Team,
    managerPeriodId: UInt?,
    names: Map<UInt, String>,
): TeamStructureEvent? {
    val added = after.memberIds.toSet() - before.memberIds.toSet()
    val removed = before.memberIds.toSet() - after.memberIds.toSet()
    val renamed = before.name != after.name
    val handover = before.managerId != after.managerId
    if (!renamed && !handover && added.isEmpty() && removed.isEmpty()) return null
    return TeamStructureEvent(
        teamId,
        actorId,
        TeamStructureEventType.TEAM_UPDATED,
        buildMap {
            put("team", after.name)
            if (renamed) {
                put("nameFrom", before.name)
                put("nameTo", after.name)
            }
            if (handover) {
                putPersonAs("managerFrom", "managerFromName", before.managerId, names)
                putPersonAs("managerTo", "managerToName", after.managerId, names)
                managerPeriodId?.let { put("managerPeriodId", it.toString()) }
            }
            putPeople("membersAdded", added, names)
            putPeople("membersRemoved", removed, names)
        },
    )
}

internal fun teamDeletedEvent(
    actorId: UInt,
    teamId: UInt,
    teamName: String,
    outcome: TeamDeleteOutcome,
): TeamStructureEvent = TeamStructureEvent(
    teamId,
    actorId,
    TeamStructureEventType.TEAM_DELETED,
    mapOf(
        "team" to teamName,
        "membershipsEnded" to outcome.membershipsEnded.toString(),
        "futureRowsRemoved" to outcome.futureRowsRemoved.toString(),
    ),
)

internal fun memberAddedEvent(
    actorId: UInt,
    teamId: UInt,
    teamName: String,
    memberUserId: UInt,
    joined: TeamJoinOutcome,
    names: Map<UInt, String>,
): TeamStructureEvent = TeamStructureEvent(
    teamId,
    actorId,
    TeamStructureEventType.MEMBER_ADDED,
    buildMap {
        put("team", teamName)
        putPersonAs("memberUserId", "member", memberUserId, names)
        joined.membershipId?.let { put("membershipId", it.toString()) }
        putIfSet("startDate", joined.startDate)
        if (joined.reopened) put("reopened", "true")
    },
)

internal fun memberRemovedEvent(
    actorId: UInt,
    teamId: UInt,
    teamName: String,
    memberUserId: UInt,
    left: TeamLeaveOutcome,
    names: Map<UInt, String>,
): TeamStructureEvent = TeamStructureEvent(
    teamId,
    actorId,
    TeamStructureEventType.MEMBER_REMOVED,
    buildMap {
        put("team", teamName)
        putPersonAs("memberUserId", "member", memberUserId, names)
        if (left.hardDeleted) put("hardDeleted", "true") else putIfSet("endDate", left.endDate)
    },
)

internal fun membershipCreatedEvent(
    actorId: UInt,
    teamId: UInt,
    teamName: String,
    created: TeamMembershipResponse,
): TeamStructureEvent = TeamStructureEvent(
    teamId,
    actorId,
    TeamStructureEventType.MEMBERSHIP_CREATED,
    buildMap {
        put("team", teamName)
        put("membershipId", created.id.toString())
        putPersonAs("memberUserId", "member", created.userId, mapOf(created.userId to created.userName))
        putIfSet("startDate", created.startDate)
        putIfSet("endDate", created.endDate)
    },
)

/** Change-only: a PUT that moves neither bound yields `null`. */
internal fun membershipUpdatedEvent(
    actorId: UInt,
    teamId: UInt,
    teamName: String,
    update: MembershipUpdate,
    names: Map<UInt, String>,
): TeamStructureEvent? {
    if (update.after == update.before) return null
    return TeamStructureEvent(
        teamId,
        actorId,
        TeamStructureEventType.MEMBERSHIP_UPDATED,
        buildMap {
            put("team", teamName)
            put("membershipId", update.before.id.toString())
            putPersonAs("memberUserId", "member", update.before.userId, names)
            putIfSet("startDate", update.after.start)
            putIfSet("endDate", update.after.end)
            putDateDelta("startDate", update.before.start, update.after.start)
            putDateDelta("endDate", update.before.end, update.after.end)
        },
    )
}

internal fun membershipDeletedEvent(
    actorId: UInt,
    teamId: UInt,
    teamName: String,
    removed: MembershipRow,
    names: Map<UInt, String>,
): TeamStructureEvent = TeamStructureEvent(
    teamId,
    actorId,
    TeamStructureEventType.MEMBERSHIP_DELETED,
    buildMap {
        put("team", teamName)
        put("membershipId", removed.id.toString())
        putPersonAs("memberUserId", "member", removed.userId, names)
        putIfSet("startDate", removed.start)
        putIfSet("endDate", removed.end)
    },
)

internal fun managerPeriodCreatedEvent(
    actorId: UInt,
    teamId: UInt,
    teamName: String,
    creation: PeriodCreation,
    startDate: String?,
): TeamStructureEvent = TeamStructureEvent(
    teamId,
    actorId,
    TeamStructureEventType.MANAGER_PERIOD_CREATED,
    buildMap {
        put("team", teamName)
        put("periodId", creation.period.id.toString())
        val manager = creation.period
        putPersonAs("managerId", "manager", manager.managerId, mapOf(manager.managerId to manager.managerName))
        putIfSet("startDate", startDate)
        putRemoved(creation.removedPeriodIds)
    },
)

/**
 * A correction's deltas (manager and/or start) next to the resulting manager and start; the row it
 * folded into (`mergedIntoPeriodId`) and any rows an automatic merge deleted. **Change-only:** a PUT
 * that changes neither yields `null`.
 */
internal fun managerPeriodUpdatedEvent(
    actorId: UInt,
    teamId: UInt,
    teamName: String,
    periodId: UInt,
    update: PeriodUpdate,
    newManagerId: UInt,
    newStart: String?,
    names: Map<UInt, String>,
): TeamStructureEvent? {
    val managerChanged = newManagerId != update.before.managerId
    val startChanged = newStart != update.before.start
    if (!managerChanged && !startChanged) return null
    return TeamStructureEvent(
        teamId,
        actorId,
        TeamStructureEventType.MANAGER_PERIOD_UPDATED,
        buildMap {
            put("team", teamName)
            put("periodId", periodId.toString())
            putPersonAs("managerId", "manager", newManagerId, names)
            putIfSet("startDate", newStart)
            if (managerChanged) {
                putPersonAs("managerFrom", "managerFromName", update.before.managerId, names)
                putPersonAs("managerTo", "managerToName", newManagerId, names)
            }
            if (startChanged) putDateDelta("startDate", update.before.start, newStart)
            if (update.after.id != periodId) put("mergedIntoPeriodId", update.after.id.toString())
            putRemoved(update.removedPeriodIds)
        },
    )
}

internal fun managerPeriodDeletedEvent(
    actorId: UInt,
    teamId: UInt,
    teamName: String,
    removal: PeriodDeletion,
    periodId: UInt,
    names: Map<UInt, String>,
): TeamStructureEvent = TeamStructureEvent(
    teamId,
    actorId,
    TeamStructureEventType.MANAGER_PERIOD_DELETED,
    buildMap {
        put("team", teamName)
        put("periodId", periodId.toString())
        putPersonAs("managerId", "manager", removal.deleted.managerId, names)
        putIfSet("startDate", removal.deleted.start)
        putIfSet("endDate", removal.deleted.end)
        put("absorbedByPeriodId", removal.absorbedBy.toString())
        putRemoved(removal.removedPeriodIds)
    },
)
