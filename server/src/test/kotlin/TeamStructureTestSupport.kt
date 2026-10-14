package ch.nokillswit

import ch.nokillswit.teams.TeamService
import java.time.LocalDate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update

/**
 * Raw access to the V93 dated base tables for the team-structure tests: the service API only ever
 * writes today-relative rows, so past-ended and future-starting fixtures go in directly (the views
 * must hide them from every today-reader — that is exactly what these tests pin).
 */
internal data class MembershipRecord(val id: UInt, val userId: UInt, val start: String?, val end: String?)

internal data class PeriodRecord(val id: UInt, val managerId: UInt, val start: String?, val end: String?)

/** The ISO date [days] from today in the JVM zone (the zone the views' CURRENT_DATE is aligned to). */
internal fun dayIso(days: Long): String = LocalDate.now().plusDays(days).toString()

internal suspend fun membershipRecords(teamId: UInt): List<MembershipRecord> =
    suspendTransaction(TestServices.database) {
        TeamService.TeamMemberships.selectAll()
            .where { TeamService.TeamMemberships.teamId eq teamId }
            .map {
                MembershipRecord(
                    it[TeamService.TeamMemberships.id].value,
                    it[TeamService.TeamMemberships.userId].value,
                    it[TeamService.TeamMemberships.startDate],
                    it[TeamService.TeamMemberships.endDate],
                )
            }
            .toList()
            .sortedWith(compareBy({ it.start ?: "" }, { it.id }))
    }

internal suspend fun periodRecords(teamId: UInt): List<PeriodRecord> =
    suspendTransaction(TestServices.database) {
        TeamService.TeamManagerPeriods.selectAll()
            .where { TeamService.TeamManagerPeriods.teamId eq teamId }
            .map {
                PeriodRecord(
                    it[TeamService.TeamManagerPeriods.id].value,
                    it[TeamService.TeamManagerPeriods.managerId].value,
                    it[TeamService.TeamManagerPeriods.startDate],
                    it[TeamService.TeamManagerPeriods.endDate],
                )
            }
            .toList()
            .sortedBy { it.start ?: "" }
    }

internal suspend fun insertMembershipRow(teamId: UInt, userId: UInt, start: String?, end: String?): UInt =
    suspendTransaction(TestServices.database) {
        TeamService.TeamMemberships.insert {
            it[TeamService.TeamMemberships.teamId] = teamId
            it[TeamService.TeamMemberships.userId] = userId
            it[startDate] = start
            it[endDate] = end
            it[createdAt] = 0L
            it[lastModified] = 0L
        }[TeamService.TeamMemberships.id].value
    }

internal suspend fun insertPeriodRow(teamId: UInt, managerId: UInt, start: String?, end: String?): UInt =
    suspendTransaction(TestServices.database) {
        TeamService.TeamManagerPeriods.insert {
            it[TeamService.TeamManagerPeriods.teamId] = teamId
            it[TeamService.TeamManagerPeriods.managerId] = managerId
            it[startDate] = start
            it[endDate] = end
            it[createdAt] = 0L
            it[lastModified] = 0L
        }[TeamService.TeamManagerPeriods.id].value
    }

internal suspend fun setPeriodEnd(periodId: UInt, end: String?) {
    suspendTransaction(TestServices.database) {
        TeamService.TeamManagerPeriods.update({ TeamService.TeamManagerPeriods.id eq periodId }) {
            it[endDate] = end
        }
    }
}

internal suspend fun setPeriodStart(periodId: UInt, start: String?) {
    suspendTransaction(TestServices.database) {
        TeamService.TeamManagerPeriods.update({ TeamService.TeamManagerPeriods.id eq periodId }) {
            it[startDate] = start
        }
    }
}

/** Flags the team soft-deleted WITHOUT touching its structure rows (an "earlier-day deletion" fixture). */
internal suspend fun softDeleteTeamRow(teamId: UInt) {
    suspendTransaction(TestServices.database) {
        TeamService.TeamRecords.update({ TeamService.TeamRecords.id eq teamId }) {
            it[markedAsDeleted] = true
        }
    }
}
