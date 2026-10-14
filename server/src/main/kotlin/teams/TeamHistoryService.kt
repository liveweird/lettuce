package ch.nokillswit.teams

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.authz.NotFoundException
import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.teams.TeamService.TeamManagerPeriods
import ch.nokillswit.teams.TeamService.TeamMemberships
import ch.nokillswit.teams.TeamService.TeamRecords
import ch.nokillswit.users.UserService
import io.ktor.server.application.Application
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import java.time.LocalDate
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase

internal val TeamHistoryServiceKey = AttributeKey<TeamHistoryService>("TeamHistoryService")

/** Builds the team services over [database] and publishes their keys (incl. the V94 event trail) in one call. */
fun Application.publishTeamServices(database: R2dbcDatabase): TeamService = TeamService(database).also {
    attributes.put(TeamServiceKey, it)
    attributes.put(TeamHistoryServiceKey, TeamHistoryService(database))
    attributes.put(TeamStructureEventServiceKey, TeamStructureEventService(database))
}

/** [TeamHistoryService.replaceMembership]'s result: the row before and after (equal = a no-op PUT). */
internal data class MembershipUpdate(val before: MembershipRow, val after: MembershipRow)

/** [TeamHistoryService.createPeriod]'s result: the period now holding the start, and the rows an automatic merge removed. */
internal data class PeriodCreation(val period: TeamManagerPeriodResponse, val removedPeriodIds: List<UInt>)

/** [TeamHistoryService.replacePeriod]'s result: the row before, the period that now holds its start, the rows merged away. */
internal data class PeriodUpdate(val before: ManagerRow, val after: ManagerRow, val removedPeriodIds: List<UInt>)

/** [TeamHistoryService.deletePeriod]'s result: the removed row, the neighbour that absorbed its days, other rows merged away. */
internal data class PeriodDeletion(val deleted: ManagerRow, val absorbedBy: UInt, val removedPeriodIds: List<UInt>)

/** The stored line after a write, and the ids of the rows it no longer contains. */
private class LineResult(val rows: List<ManagerRow>, val removedPeriodIds: List<UInt>)

private data class PersonInfo(val name: String, val deleted: Boolean, val deactivated: Boolean)

/** The person columns of a row joined with `users`. */
private fun ResultRow.toPersonInfo() =
    PersonInfo(this[UserService.Users.name], this[UserService.Users.markedAsDeleted], this[UserService.Users.deactivated])

private val AS_OF_SORTABLE: Map<String, Column<*>> = mapOf(
    "id" to TeamRecords.id,
    "name" to TeamRecords.name,
)

/** The ISO day lies inside the period [start]..[end] (null bound = unbounded), as a SQL predicate. */
private fun coversDay(start: Column<String?>, end: Column<String?>, iso: String): Op<Boolean> =
    (start.isNull() or (start lessEq iso)) and (end.isNull() or (end greaterEq iso))

/**
 * The write and read side of the dated team structure's sub-resources (V93, v4.17.0): membership
 * periods, the manager succession line, one person's team history and the as-of team list. Every write
 * runs under the per-team advisory lock and re-checks the invariants on the FINAL state in the same
 * transaction; it does not touch TeamService's today-relative writes. See `.claude/docs/features/teams.md`.
 */
internal class TeamHistoryService(
    private val database: R2dbcDatabase,
    private val clock: () -> LocalDate = { LocalDate.now() },
) {
    // ——— Membership periods ———

    suspend fun listMemberships(teamId: UInt): TeamMembershipList = suspendTransaction(database) {
        requireLiveTeam(teamId)
        TeamMembershipList(membershipsFor(setOf(teamId), clock().toString())[teamId].orEmpty())
    }

    suspend fun createMembership(teamId: UInt, userId: UInt, start: String?, end: String?): TeamMembershipResponse =
        suspendTransaction(database) {
            lockTeam(teamId)
            requireLiveTeam(teamId)
            val today = clock()
            val iso = today.toString()
            val person = people(listOf(userId))[userId]?.takeUnless { it.deleted }
                ?: throw BadRequestException("Referenced user does not exist")
            if (person.deactivated && reachesFrom(end, iso)) throw BadRequestException(deactivatedMessage(userId))
            val rows = membershipRows(teamId)
            if (rows.any { it.userId == userId && periodsOverlap(it.start, it.end, start, end) }) {
                throw ConflictException("The membership overlaps another membership of this person in the team")
            }
            requireManagerNotMember(
                rows + MembershipRow(0u, userId, start, end), managerLineRows(teamId), today, ignoreHistory = false,
            )
            val now = System.currentTimeMillis()
            val id = TeamMemberships.insert {
                it[TeamMemberships.teamId] = teamId
                it[TeamMemberships.userId] = userId
                it[startDate] = start
                it[endDate] = end
                it[createdAt] = now
                it[lastModified] = now
            }[TeamMemberships.id].value
            MembershipRow(id, userId, start, end).toResponse(person, iso)
        }

    suspend fun replaceMembership(teamId: UInt, membershipId: UInt, start: String?, end: String?): MembershipUpdate =
        suspendTransaction(database) {
            lockTeam(teamId)
            requireLiveTeam(teamId)
            val today = clock()
            val rows = membershipRows(teamId)
            val before = rows.firstOrNull { it.id == membershipId } ?: throw NotFoundException("Membership not found")
            val after = before.copy(start = start, end = end)
            val person = people(listOf(before.userId)).getValue(before.userId)
            val iso = today.toString()
            // A soft-deleted person cannot hold a period reaching today (the create's rule); a deactivated one
            // only loses days: ANY day from today on that the old period did not cover is a new assignment.
            if (person.deleted && reachesFrom(end, iso)) throw BadRequestException("Referenced user does not exist")
            if (person.deactivated && extendsFrom(before.start, before.end, start, end, iso)) {
                throw BadRequestException(deactivatedMessage(before.userId))
            }
            if (rows.any { it.id != membershipId && it.userId == before.userId && periodsOverlap(it.start, it.end, start, end) }) {
                throw ConflictException("The membership overlaps another membership of this person in the team")
            }
            requireManagerNotMember(
                rows.map { if (it.id == membershipId) after else it }, managerLineRows(teamId), today, ignoreHistory = false,
            )
            if (after != before) {
                TeamMemberships.update({ TeamMemberships.id eq membershipId }) {
                    it[startDate] = start
                    it[endDate] = end
                    it[lastModified] = System.currentTimeMillis()
                }
            }
            MembershipUpdate(before, after)
        }

    suspend fun deleteMembership(teamId: UInt, membershipId: UInt): MembershipRow = suspendTransaction(database) {
        lockTeam(teamId)
        requireLiveTeam(teamId)
        val row = membershipRows(teamId).firstOrNull { it.id == membershipId }
            ?: throw NotFoundException("Membership not found")
        TeamMemberships.deleteWhere { TeamMemberships.id eq membershipId }
        row
    }

    // ——— The manager succession line ———

    suspend fun listPeriods(teamId: UInt): TeamManagerPeriodList = suspendTransaction(database) {
        requireLiveTeam(teamId)
        TeamManagerPeriodList(managerPeriodsFor(setOf(teamId), clock().toString())[teamId].orEmpty())
    }

    /**
     * Inserts a period starting [start]: it takes over the days until the next period begins (splitting
     * the period that contains [start]; a bounded stint is two inserts). The same manager as the period
     * it would split is a 409; the same manager as the NEXT period merges the two into the new row.
     * Returns the period now holding [start].
     */
    suspend fun createPeriod(teamId: UInt, managerId: UInt, start: String?): PeriodCreation =
        suspendTransaction(database) {
            lockTeam(teamId)
            requireLiveTeam(teamId)
            val today = clock()
            val line = managerLineRows(teamId)
            if (line.any { it.start == start }) throw ConflictException("A manager period already starts on that date")
            val desired = (line.map { DesiredPeriod(it.id, it.managerId, it.start) } + DesiredPeriod(null, managerId, start))
                .sortedBy { startKey(it.start) }
            val prior = desired.getOrNull(desired.indexOfFirst { it.id == null } - 1)
            if (prior?.managerId == managerId) {
                throw ConflictException("That person already manages the team on that date")
            }
            val result = applyLine(teamId, line, desired, today, assigned = managerId)
            val holder = result.rows.last { startKey(it.start) <= startKey(start) }
            PeriodCreation(periodResponses(listOf(holder), today.toString()).single(), result.removedPeriodIds)
        }

    /**
     * Corrects a period's manager and/or start. The start must stay strictly between the neighbours'
     * starts (409 — a correction never reorders the line); the end is re-derived.
     */
    suspend fun replacePeriod(teamId: UInt, periodId: UInt, managerId: UInt, start: String?): PeriodUpdate =
        suspendTransaction(database) {
            lockTeam(teamId)
            requireLiveTeam(teamId)
            val today = clock()
            val line = managerLineRows(teamId)
            val index = line.indexOfFirst { it.id == periodId }
            if (index < 0) throw NotFoundException("Manager period not found")
            val before = line[index]
            if (line.any { it.id != periodId && it.start == start }) {
                throw ConflictException("A manager period already starts on that date")
            }
            val previous = line.getOrNull(index - 1)
            val next = line.getOrNull(index + 1)
            if ((previous != null && startKey(start) < startKey(previous.start)) ||
                (next != null && startKey(start) > startKey(next.start))
            ) {
                throw ConflictException("A correction must keep the period between its neighbours' start dates")
            }
            val desired = line.map {
                if (it.id == periodId) DesiredPeriod(it.id, managerId, start) else DesiredPeriod(it.id, it.managerId, it.start)
            }
            val assigned = managerId.takeIf { it != before.managerId }
            val result = applyLine(teamId, line, desired, today, assigned = assigned)
            PeriodUpdate(before, result.rows.last { startKey(it.start) <= startKey(start) }, result.removedPeriodIds)
        }

    /**
     * Removes a period: the predecessor absorbs its days, or the successor when it is the first row (and
     * then inherits the removed start). The only period of a team cannot be removed (409).
     */
    suspend fun deletePeriod(teamId: UInt, periodId: UInt): PeriodDeletion = suspendTransaction(database) {
        lockTeam(teamId)
        requireLiveTeam(teamId)
        val today = clock()
        val line = managerLineRows(teamId)
        val index = line.indexOfFirst { it.id == periodId }
        if (index < 0) throw NotFoundException("Manager period not found")
        if (line.size == 1) throw ConflictException("A team needs at least one manager period")
        val removed = line[index]
        val absorber = if (index == 0) line[1] else line[index - 1]
        val desired = line.filter { it.id != periodId }.map {
            DesiredPeriod(it.id, it.managerId, if (index == 0 && it.id == absorber.id) removed.start else it.start)
        }
        val result = applyLine(teamId, line, desired, today, assigned = null)
        PeriodDeletion(removed, absorber.id, result.removedPeriodIds - periodId)
    }

    // ——— Reads across teams ———

    /** One person's membership and managed-team periods; a NULL-end period of a soft-deleted team is pre-V93 residue and hidden. */
    suspend fun userHistory(userId: UInt): UserTeamHistory =
        historyByUserIds(setOf(userId))[userId] ?: UserTeamHistory(emptyList(), emptyList())

    /**
     * Every dated membership row of each of [teamIds] (past, current and upcoming), ordered by start
     * (a null start first) then id — one transaction, one statement however many teams. A team without
     * rows (or an unknown id) is absent from the map. The batched read behind the integration API's
     * `Team.memberships`; the single-team [listMemberships] rides the same code.
     */
    suspend fun membershipsByTeamIds(teamIds: Set<UInt>): Map<UInt, List<TeamMembershipResponse>> =
        if (teamIds.isEmpty()) emptyMap() else suspendTransaction(database) { membershipsFor(teamIds, clock().toString()) }

    /** Each of [teamIds]' manager succession line, oldest first — one transaction, one statement (see [membershipsByTeamIds]). */
    suspend fun managerPeriodsByTeamIds(teamIds: Set<UInt>): Map<UInt, List<TeamManagerPeriodResponse>> =
        if (teamIds.isEmpty()) emptyMap() else suspendTransaction(database) { managerPeriodsFor(teamIds, clock().toString()) }

    /**
     * Each of [userIds]' membership and managed-team periods (the [userHistory] rules, residue hidden) —
     * one transaction, two statements (one per list) however many people. A person with no rows is absent.
     */
    suspend fun historyByUserIds(userIds: Set<UInt>): Map<UInt, UserTeamHistory> {
        if (userIds.isEmpty()) return emptyMap()
        return suspendTransaction(database) {
            val iso = clock().toString()
            val memberships = TeamMemberships
                .join(TeamRecords, JoinType.INNER, onColumn = TeamMemberships.teamId, otherColumn = TeamRecords.id)
                .select(
                    TeamMemberships.id, TeamMemberships.userId, TeamMemberships.startDate, TeamMemberships.endDate,
                    TeamRecords.id, TeamRecords.name, TeamRecords.markedAsDeleted,
                )
                .where {
                    (TeamMemberships.userId inList userIds) and
                        ((TeamRecords.markedAsDeleted eq false) or TeamMemberships.endDate.isNotNull())
                }
                .map {
                    it[TeamMemberships.userId].value to
                        userPeriod(it[TeamMemberships.id].value, it[TeamMemberships.startDate], it[TeamMemberships.endDate], it, iso)
                }
                .toList()
                .groupBy({ it.first }, { it.second })
            val managed = TeamManagerPeriods
                .join(TeamRecords, JoinType.INNER, onColumn = TeamManagerPeriods.teamId, otherColumn = TeamRecords.id)
                .select(
                    TeamManagerPeriods.id, TeamManagerPeriods.managerId, TeamManagerPeriods.startDate,
                    TeamManagerPeriods.endDate, TeamRecords.id, TeamRecords.name, TeamRecords.markedAsDeleted,
                )
                .where {
                    (TeamManagerPeriods.managerId inList userIds) and
                        ((TeamRecords.markedAsDeleted eq false) or TeamManagerPeriods.endDate.isNotNull())
                }
                .map {
                    it[TeamManagerPeriods.managerId].value to userPeriod(
                        it[TeamManagerPeriods.id].value, it[TeamManagerPeriods.startDate], it[TeamManagerPeriods.endDate], it, iso,
                    )
                }
                .toList()
                .groupBy({ it.first }, { it.second })
            (memberships.keys + managed.keys).associateWith {
                UserTeamHistory(memberships[it].orEmpty().chronological(), managed[it].orEmpty().chronological())
            }
        }
    }

    /**
     * The org chart's read: the teams that existed on [asOf] with their manager and roster of THAT day,
     * from the base tables (not the today views). Soft-deleted teams are included while their manager
     * line covers the day; a NULL-end covering period of a deleted team is pre-V93 residue and hidden.
     * Three statements however many teams (count, page, one grouped roster).
     */
    suspend fun listAsOf(filter: TeamListFilter, paging: PageRequest, asOf: LocalDate): TeamListResult =
        suspendTransaction(database) {
            val iso = asOf.toString()
            val join = TeamRecords
                .join(TeamManagerPeriods, JoinType.INNER, onColumn = TeamRecords.id, otherColumn = TeamManagerPeriods.teamId)
                .join(UserService.Users, JoinType.INNER, onColumn = TeamManagerPeriods.managerId, otherColumn = UserService.Users.id)
            var predicate: Op<Boolean> = coversDay(TeamManagerPeriods.startDate, TeamManagerPeriods.endDate, iso) and
                ((TeamRecords.markedAsDeleted eq false) or TeamManagerPeriods.endDate.isNotNull())
            filter.name?.takeIf { it.isNotBlank() }?.let { predicate = predicate and TeamRecords.name.containsNormalized(it) }
            filter.managerId?.let { predicate = predicate and (TeamManagerPeriods.managerId eq it) }
            filter.memberId?.let { member ->
                val memberTeams = TeamMemberships.select(TeamMemberships.teamId).where {
                    (TeamMemberships.userId eq member) and
                        coversDay(TeamMemberships.startDate, TeamMemberships.endDate, iso)
                }
                predicate = predicate and (TeamRecords.id inSubQuery memberTeams)
            }
            val total = join.selectAll().where { predicate }.count()
            val pageRows = join
                .select(
                    TeamRecords.id, TeamRecords.name, TeamRecords.markedAsDeleted,
                    TeamManagerPeriods.managerId, UserService.Users.name, UserService.Users.markedAsDeleted,
                )
                .where { predicate }
                .applyPaging(paging, AS_OF_SORTABLE)
                .toList()
            val rosters = if (pageRows.isEmpty()) emptyMap() else rostersAsOf(pageRows.map { it[TeamRecords.id].value }, iso)
            val items = pageRows.map { row ->
                val roster = rosters[row[TeamRecords.id].value].orEmpty()
                TeamListItem(
                    id = row[TeamRecords.id].value,
                    name = row[TeamRecords.name],
                    managerId = row[TeamManagerPeriods.managerId].value,
                    managerName = row[UserService.Users.name],
                    managerDeleted = row[UserService.Users.markedAsDeleted],
                    memberIds = roster.map { it.id }.sorted(),
                    deleted = row[TeamRecords.markedAsDeleted],
                    members = roster.sortedWith(compareBy({ it.name.lowercase() }, { it.id })),
                )
            }
            TeamListResult(items = items, total = total)
        }

    // ——— Internals ———

    private suspend fun rostersAsOf(teamIds: List<UInt>, iso: String): Map<UInt, List<TeamListMember>> =
        TeamMemberships
            .join(UserService.Users, JoinType.INNER, onColumn = TeamMemberships.userId, otherColumn = UserService.Users.id)
            .select(
                TeamMemberships.teamId, UserService.Users.id, UserService.Users.name,
                UserService.Users.markedAsDeleted, UserService.Users.deactivated,
            )
            .where { (TeamMemberships.teamId inList teamIds) and coversDay(TeamMemberships.startDate, TeamMemberships.endDate, iso) }
            .map {
                it[TeamMemberships.teamId].value to TeamListMember(
                    id = it[UserService.Users.id].value,
                    name = it[UserService.Users.name],
                    deleted = it[UserService.Users.markedAsDeleted],
                    deactivated = it[UserService.Users.deactivated],
                )
            }
            .toList()
            .groupBy({ it.first }, { it.second })

    private suspend fun requireLiveTeam(teamId: UInt) {
        TeamRecords.select(TeamRecords.id)
            .where { (TeamRecords.id eq teamId) and (TeamRecords.markedAsDeleted eq false) }
            .singleOrNull()
            ?: throw NotFoundException("Team not found")
    }

    private suspend fun people(ids: Collection<UInt>): Map<UInt, PersonInfo> {
        if (ids.isEmpty()) return emptyMap()
        return UserService.Users
            .select(UserService.Users.id, UserService.Users.name, UserService.Users.markedAsDeleted, UserService.Users.deactivated)
            .where { UserService.Users.id inList ids.toSet() }
            .map {
                it[UserService.Users.id].value to PersonInfo(
                    name = it[UserService.Users.name],
                    deleted = it[UserService.Users.markedAsDeleted],
                    deactivated = it[UserService.Users.deactivated],
                )
            }
            .toList()
            .toMap()
    }

    private fun deactivatedMessage(userId: UInt) = "User $userId is deactivated and cannot be newly assigned"

    private fun MembershipRow.toResponse(person: PersonInfo, iso: String) = TeamMembershipResponse(
        id = id,
        userId = userId,
        userName = person.name,
        userDeleted = person.deleted,
        deactivated = person.deactivated,
        startDate = start,
        endDate = end,
        current = periodCovers(start, end, iso),
    )

    /** Runs in the caller's transaction: one joined statement for all [teamIds]' membership rows and their people. */
    private suspend fun membershipsFor(teamIds: Set<UInt>, iso: String): Map<UInt, List<TeamMembershipResponse>> =
        TeamMemberships
            .join(UserService.Users, JoinType.INNER, onColumn = TeamMemberships.userId, otherColumn = UserService.Users.id)
            .select(
                TeamMemberships.id, TeamMemberships.teamId, TeamMemberships.userId, TeamMemberships.startDate,
                TeamMemberships.endDate, UserService.Users.name, UserService.Users.markedAsDeleted,
                UserService.Users.deactivated,
            )
            .where { TeamMemberships.teamId inList teamIds }
            .map {
                val row = MembershipRow(
                    it[TeamMemberships.id].value, it[TeamMemberships.userId].value,
                    it[TeamMemberships.startDate], it[TeamMemberships.endDate],
                )
                val person = it.toPersonInfo()
                it[TeamMemberships.teamId].value to (row to person)
            }
            .toList()
            .groupBy({ it.first }, { it.second })
            .mapValues { (_, rows) ->
                rows.sortedWith(compareBy({ startKey(it.first.start) }, { it.first.id }))
                    .map { (row, person) -> row.toResponse(person, iso) }
            }

    /** Runs in the caller's transaction: one joined statement for all [teamIds]' manager lines and their people. */
    private suspend fun managerPeriodsFor(teamIds: Set<UInt>, iso: String): Map<UInt, List<TeamManagerPeriodResponse>> =
        TeamManagerPeriods
            .join(UserService.Users, JoinType.INNER, onColumn = TeamManagerPeriods.managerId, otherColumn = UserService.Users.id)
            .select(
                TeamManagerPeriods.id, TeamManagerPeriods.teamId, TeamManagerPeriods.managerId, TeamManagerPeriods.startDate,
                TeamManagerPeriods.endDate, UserService.Users.name, UserService.Users.markedAsDeleted,
                UserService.Users.deactivated,
            )
            .where { TeamManagerPeriods.teamId inList teamIds }
            .map {
                val row = ManagerRow(
                    it[TeamManagerPeriods.id].value, it[TeamManagerPeriods.managerId].value,
                    it[TeamManagerPeriods.startDate], it[TeamManagerPeriods.endDate],
                )
                val person = it.toPersonInfo()
                it[TeamManagerPeriods.teamId].value to (row to person)
            }
            .toList()
            .groupBy({ it.first }, { it.second })
            .mapValues { (_, rows) ->
                rows.sortedWith(compareBy({ startKey(it.first.start) }, { it.first.id }))
                    .map { (row, person) -> row.toResponse(person, iso) }
            }

    private fun ManagerRow.toResponse(person: PersonInfo, iso: String) = TeamManagerPeriodResponse(
        id = id,
        managerId = managerId,
        managerName = person.name,
        managerDeleted = person.deleted,
        startDate = start,
        endDate = end,
        current = periodCovers(start, end, iso),
    )

    private suspend fun periodResponses(rows: List<ManagerRow>, iso: String): List<TeamManagerPeriodResponse> {
        val people = people(rows.map { it.managerId })
        return rows.map { it.toResponse(people.getValue(it.managerId), iso) }
    }

    private fun userPeriod(id: UInt, start: String?, end: String?, row: ResultRow, iso: String): UserTeamPeriod {
        val deleted = row[TeamRecords.markedAsDeleted]
        return UserTeamPeriod(
            id = id,
            team = TeamPeriodTeam(row[TeamRecords.id].value, row[TeamRecords.name], deleted),
            startDate = start,
            endDate = end,
            current = !deleted && periodCovers(start, end, iso),
        )
    }

    private fun List<UserTeamPeriod>.chronological(): List<UserTeamPeriod> =
        sortedWith(compareBy({ startKey(it.startDate) }, { it.team.name }, { it.id }))

    /**
     * Persists [desired] as the team's new manager line and re-checks every invariant on the FINAL stored
     * state: a live team's first start is today or earlier (409), adjacent equal managers merge into the
     * earlier period, any manager whose coverage of today-or-later GREW (a newly assigned manager, or a
     * neighbour absorbing days) must be an active, non-deleted user (400), the line is contiguous, and the
     * manager is not also a member on any day (400 today / 409 otherwise). A newly [assigned] manager
     * must exist and not be deleted even for a purely past period.
     */
    private suspend fun applyLine(
        teamId: UInt,
        existing: List<ManagerRow>,
        desired: List<DesiredPeriod>,
        today: LocalDate,
        assigned: UInt?,
    ): LineResult {
        val iso = today.toString()
        val sorted = desired.sortedBy { startKey(it.start) }
        sorted.first().start?.takeIf { it > iso }?.let {
            throw ConflictException("A live team needs a manager period that starts today or earlier")
        }
        val merged = mergeAdjacent(sorted)
        val ends = derivedEnds(merged)
        if (assigned != null && people(listOf(assigned))[assigned]?.deleted != false) {
            throw BadRequestException("Referenced user does not exist")
        }
        val proposed = merged.mapIndexed { i, period -> ManagerRow(period.id ?: 0u, period.managerId, period.start, ends[i]) }
        requireUsableManagers(grownManagers(existing, proposed, iso))
        persistLine(teamId, existing, merged, ends)
        val stored = managerLineRows(teamId)
        checkManagerLine(teamId, stored, today)
        requireManagerNotMember(membershipRows(teamId), stored, today, ignoreHistory = false)
        return LineResult(stored, existing.map { it.id }.filter { id -> stored.none { it.id == id } })
    }

    private suspend fun requireUsableManagers(ids: Set<UInt>) {
        if (ids.isEmpty()) return
        val people = people(ids)
        ids.sorted().forEach { id ->
            val person = people[id]
            if (person == null || person.deleted) throw BadRequestException("Referenced user does not exist")
            if (person.deactivated) throw BadRequestException(deactivatedMessage(id))
        }
    }

    /** Deletes the dropped rows first (the unique start index), then updates the changed rows and inserts the new ones. */
    private suspend fun persistLine(
        teamId: UInt,
        existing: List<ManagerRow>,
        merged: List<DesiredPeriod>,
        ends: List<String?>,
    ) {
        val now = System.currentTimeMillis()
        val keep = merged.mapNotNull { it.id }.toSet()
        existing.filter { it.id !in keep }.forEach { dropped ->
            TeamManagerPeriods.deleteWhere { TeamManagerPeriods.id eq dropped.id }
        }
        val byId = existing.associateBy { it.id }
        merged.forEachIndexed { i, period ->
            val end = ends[i]
            if (period.id == null) {
                TeamManagerPeriods.insert {
                    it[TeamManagerPeriods.teamId] = teamId
                    it[TeamManagerPeriods.managerId] = period.managerId
                    it[startDate] = period.start
                    it[endDate] = end
                    it[createdAt] = now
                    it[lastModified] = now
                }
            } else {
                val old = byId.getValue(period.id)
                if (old.managerId != period.managerId || old.start != period.start || old.end != end) {
                    TeamManagerPeriods.update({ TeamManagerPeriods.id eq period.id }) {
                        it[TeamManagerPeriods.managerId] = period.managerId
                        it[startDate] = period.start
                        it[endDate] = end
                        it[lastModified] = now
                    }
                }
            }
        }
    }
}
