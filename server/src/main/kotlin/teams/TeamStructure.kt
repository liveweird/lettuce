package ch.nokillswit.teams

import ch.nokillswit.authz.ConflictException
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.IntegerColumnType
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.R2dbcTransaction
import org.jetbrains.exposed.v1.r2dbc.selectAll

/*
 * The dated team structure (V93, v4.17.0): the pure date maths and the row loaders the write paths of
 * [TeamService] share. Dates are strict ISO `YYYY-MM-DD` strings, so lexicographic == chronological;
 * a null START means "since before records began" and a null END means open-ended (the end is the
 * INCLUSIVE last day). Everything here runs in the caller's transaction.
 */

/** The first key of the two-key per-team advisory lock — a namespace disjoint from the share lock (86)
 *  and from `MfaChallenges`' one-key lock. */
internal const val TEAM_LOCK_NAMESPACE = 93

private const val ISO_MIN = "0000-00-00"
private const val ISO_MAX = "9999-99-99"

/** One membership period of a person in a team. */
internal data class MembershipRow(val id: UInt, val userId: UInt, val start: String?, val end: String?)

/** One period of a team's manager succession line. */
internal data class ManagerRow(val id: UInt, val managerId: UInt, val start: String?, val end: String?)

/** True iff the period [start]..[end] (null = unbounded) contains the ISO day [iso]. */
internal fun periodCovers(start: String?, end: String?, iso: String): Boolean =
    (start == null || start <= iso) && (end == null || end >= iso)

/** The last day both periods share, or null when they do not overlap at all. */
private fun overlapEnd(aStart: String?, aEnd: String?, bStart: String?, bEnd: String?): String? {
    val lastCommon = minOf(aEnd ?: ISO_MAX, bEnd ?: ISO_MAX)
    return if (maxOf(aStart ?: ISO_MIN, bStart ?: ISO_MIN) <= lastCommon) lastCommon else null
}

internal fun LocalDate.yesterdayIso(): String = minusDays(1).toString()

/** Serialises the structure writes of ONE team for this transaction (released on commit/rollback). */
internal suspend fun R2dbcTransaction.lockTeam(teamId: UInt) {
    exec(
        "SELECT pg_advisory_xact_lock(?, ?)",
        listOf(IntegerColumnType() to TEAM_LOCK_NAMESPACE, IntegerColumnType() to teamId.toInt()),
    )
}

internal suspend fun membershipRows(teamId: UInt): List<MembershipRow> =
    TeamService.TeamMemberships.selectAll()
        .where { TeamService.TeamMemberships.teamId eq teamId }
        .map {
            MembershipRow(
                id = it[TeamService.TeamMemberships.id].value,
                userId = it[TeamService.TeamMemberships.userId].value,
                start = it[TeamService.TeamMemberships.startDate],
                end = it[TeamService.TeamMemberships.endDate],
            )
        }
        .toList()

/** The team's manager line, earliest period first (a null start — "since before records" — sorts first). */
internal suspend fun managerLineRows(teamId: UInt): List<ManagerRow> =
    TeamService.TeamManagerPeriods.selectAll()
        .where { TeamService.TeamManagerPeriods.teamId eq teamId }
        .map {
            ManagerRow(
                id = it[TeamService.TeamManagerPeriods.id].value,
                managerId = it[TeamService.TeamManagerPeriods.managerId].value,
                start = it[TeamService.TeamManagerPeriods.startDate],
                end = it[TeamService.TeamManagerPeriods.endDate],
            )
        }
        .toList()
        .sortedBy { it.start ?: ISO_MIN }

/**
 * The "a manager is never a member of their own team" rule on the FINAL state of a write: no
 * membership of the team's manager may overlap their manager period from [today] on. An overlap that
 * includes [today] is the payload-shaped 400 (the rule's original message); one that only touches a
 * future day is a state 409. Purely historical overlaps are ignored — history is never re-litigated.
 */
internal fun requireManagerNotMember(members: List<MembershipRow>, line: List<ManagerRow>, today: LocalDate) {
    val iso = today.toString()
    for (member in members) {
        for (period in line) {
            if (member.userId != period.managerId) continue
            val lastCommonDay = overlapEnd(member.start, member.end, period.start, period.end) ?: continue
            if (lastCommonDay < iso) continue
            if (periodCovers(member.start, member.end, iso) && periodCovers(period.start, period.end, iso)) {
                throw BadRequestException("Manager cannot also be a standard member")
            }
            throw ConflictException("Manager would also be a standard member of this team in a future period")
        }
    }
}

/**
 * The line invariants a live team's succession line must hold after every write: contiguous (each
 * end is the next start minus one day), no two adjacent periods with the same manager, and one
 * period covering [today]. A violation is a bug in the write path, never a client error → `IllegalStateException`
 * (500, the transaction rolls back).
 */
internal fun checkManagerLine(teamId: UInt, line: List<ManagerRow>, today: LocalDate) {
    val iso = today.toString()
    check(line.any { periodCovers(it.start, it.end, iso) }) { "Team $teamId has no manager period covering $iso" }
    line.zipWithNext().forEach { (a, b) ->
        check(a.end != null && b.start != null && LocalDate.parse(a.end).plusDays(1).toString() == b.start) {
            "Team $teamId manager line is not contiguous between period ${a.id} and ${b.id}"
        }
        check(a.managerId != b.managerId) { "Team $teamId has adjacent periods ${a.id}/${b.id} with the same manager" }
    }
}
