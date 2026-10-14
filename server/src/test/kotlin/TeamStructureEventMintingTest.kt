package ch.nokillswit

import ch.nokillswit.teams.ManagerRow
import ch.nokillswit.teams.MembershipRow
import ch.nokillswit.teams.MembershipUpdate
import ch.nokillswit.teams.PeriodCreation
import ch.nokillswit.teams.PeriodDeletion
import ch.nokillswit.teams.PeriodUpdate
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamDeleteOutcome
import ch.nokillswit.teams.TeamJoinOutcome
import ch.nokillswit.teams.TeamLeaveOutcome
import ch.nokillswit.teams.TeamManagerPeriodResponse
import ch.nokillswit.teams.TeamMembershipResponse
import ch.nokillswit.teams.TeamStructureEventType
import ch.nokillswit.teams.managerPeriodCreatedEvent
import ch.nokillswit.teams.managerPeriodDeletedEvent
import ch.nokillswit.teams.managerPeriodUpdatedEvent
import ch.nokillswit.teams.memberAddedEvent
import ch.nokillswit.teams.memberRemovedEvent
import ch.nokillswit.teams.membershipCreatedEvent
import ch.nokillswit.teams.membershipDeletedEvent
import ch.nokillswit.teams.membershipUpdatedEvent
import ch.nokillswit.teams.teamCreatedEvent
import ch.nokillswit.teams.teamDeletedEvent
import ch.nokillswit.teams.teamUpdatedEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Pure descriptor-builder tests (no DB); the route/persistence side lives in `TeamStructureEventsTest`. */
class TeamStructureEventMintingTest {

    private val names = mapOf(1u to "Ann", 2u to "Bob", 3u to "Cy", 4u to "Di")

    @Test
    fun `a created team carries its name, the manager's id and name and the member count`() {
        val event = teamCreatedEvent(9u, 5u, Team("Platform", 1u, listOf(2u, 3u, 3u)), names)
        assertEquals(TeamStructureEventType.TEAM_CREATED, event.type)
        assertEquals(5u, event.teamId)
        assertEquals(9u, event.userId)
        assertEquals(
            mapOf("team" to "Platform", "managerId" to "1", "manager" to "Ann", "memberCount" to "2"),
            event.params,
        )
        // An unresolved name is simply absent.
        assertEquals(setOf("team", "managerId", "memberCount"), teamCreatedEvent(9u, 5u, Team("P", 1u), emptyMap()).params.keys)
    }

    @Test
    fun `a team update carries only the changed aspects and a no-op mints nothing`() {
        val before = Team("Old", 1u, listOf(2u, 3u))
        val event = teamUpdatedEvent(9u, 5u, before, Team("New", 4u, listOf(3u, 2u, 4u)), 77u, names)!!
        assertEquals(TeamStructureEventType.TEAM_UPDATED, event.type)
        assertEquals(
            mapOf(
                "team" to "New", "nameFrom" to "Old", "nameTo" to "New",
                "managerFrom" to "1", "managerFromName" to "Ann", "managerTo" to "4", "managerToName" to "Di",
                "managerPeriodId" to "77", "membersAdded" to "4", "membersAddedNames" to "Di",
            ),
            event.params,
        )
        val roster = teamUpdatedEvent(9u, 5u, before, Team("Old", 1u, listOf(4u)), null, names)!!
        assertEquals(
            mapOf(
                "team" to "Old", "membersAdded" to "4", "membersAddedNames" to "Di",
                "membersRemoved" to "2,3", "membersRemovedNames" to "Bob, Cy",
            ),
            roster.params,
        )
        // A rename alone is an event; resubmitting the same team (in any member order) is not.
        val renamed = teamUpdatedEvent(9u, 5u, before, before.copy(name = "N"), null, names)!!
        assertEquals(setOf("team", "nameFrom", "nameTo"), renamed.params.keys)
        assertNull(teamUpdatedEvent(9u, 5u, before, Team("Old", 1u, listOf(3u, 2u)), null, names))
    }

    @Test
    fun `a deleted team carries the dated-row counts`() {
        val event = teamDeletedEvent(9u, 5u, "Platform", TeamDeleteOutcome(membershipsEnded = 3, futureRowsRemoved = 1))
        assertEquals(TeamStructureEventType.TEAM_DELETED, event.type)
        assertEquals(mapOf("team" to "Platform", "membershipsEnded" to "3", "futureRowsRemoved" to "1"), event.params)
    }

    @Test
    fun `member added and removed carry the person, the period and how it ended`() {
        val added = memberAddedEvent(9u, 5u, "P", 2u, TeamJoinOutcome(true, 11u, "2026-01-05", reopened = true), names)
        assertEquals(TeamStructureEventType.MEMBER_ADDED, added.type)
        assertEquals(
            mapOf(
                "team" to "P", "memberUserId" to "2", "member" to "Bob", "membershipId" to "11",
                "startDate" to "2026-01-05", "reopened" to "true",
            ),
            added.params,
        )
        // A fresh add has no reopened flag; a null start (reopened pre-V93 row) is absent.
        assertEquals(
            setOf("team", "memberUserId", "member", "membershipId"),
            memberAddedEvent(9u, 5u, "P", 2u, TeamJoinOutcome(true, 11u, null), names).params.keys,
        )
        val ended = memberRemovedEvent(9u, 5u, "P", 2u, TeamLeaveOutcome(true, "2026-01-04", false), names)
        assertEquals(mapOf("team" to "P", "memberUserId" to "2", "member" to "Bob", "endDate" to "2026-01-04"), ended.params)
        val hard = memberRemovedEvent(9u, 5u, "P", 2u, TeamLeaveOutcome(true, null, true), names)
        assertEquals(mapOf("team" to "P", "memberUserId" to "2", "member" to "Bob", "hardDeleted" to "true"), hard.params)
    }

    @Test
    fun `membership events carry the dates that are set and change-only deltas`() {
        val created = membershipCreatedEvent(
            9u, 5u, "P", TeamMembershipResponse(11u, 2u, "Bob", false, false, "2026-01-01", null, true),
        )
        assertEquals(TeamStructureEventType.MEMBERSHIP_CREATED, created.type)
        assertEquals(
            mapOf("team" to "P", "membershipId" to "11", "memberUserId" to "2", "member" to "Bob", "startDate" to "2026-01-01"),
            created.params,
        )

        val before = MembershipRow(11u, 2u, null, "2026-02-01")
        val updated = membershipUpdatedEvent(
            9u, 5u, "P", MembershipUpdate(before, before.copy(start = "2025-12-01", end = null)), names,
        )!!
        assertEquals(TeamStructureEventType.MEMBERSHIP_UPDATED, updated.type)
        assertEquals(
            mapOf(
                "team" to "P", "membershipId" to "11", "memberUserId" to "2", "member" to "Bob",
                "startDate" to "2025-12-01", "startDateTo" to "2025-12-01", "endDateFrom" to "2026-02-01",
            ),
            updated.params,
        )
        assertNull(membershipUpdatedEvent(9u, 5u, "P", MembershipUpdate(before, before), names))

        val deleted = membershipDeletedEvent(9u, 5u, "P", before, names)
        assertEquals(TeamStructureEventType.MEMBERSHIP_DELETED, deleted.type)
        assertEquals(
            mapOf("team" to "P", "membershipId" to "11", "memberUserId" to "2", "member" to "Bob", "endDate" to "2026-02-01"),
            deleted.params,
        )
    }

    @Test
    fun `manager period events carry the manager, the dates and the rows a merge touched`() {
        val period = TeamManagerPeriodResponse(21u, 1u, "Ann", false, "2026-03-01", null, true)
        val created = managerPeriodCreatedEvent(9u, 5u, "P", PeriodCreation(period, listOf(24u, 23u)), "2026-03-01")
        assertEquals(TeamStructureEventType.MANAGER_PERIOD_CREATED, created.type)
        assertEquals(
            mapOf(
                "team" to "P", "periodId" to "21", "managerId" to "1", "manager" to "Ann",
                "startDate" to "2026-03-01", "removedPeriodIds" to "23,24",
            ),
            created.params,
        )

        val before = ManagerRow(21u, 1u, "2026-03-01", null)
        // Manager swap + a start correction, folded into the neighbour 20 which absorbed 22.
        val updated = managerPeriodUpdatedEvent(
            9u, 5u, "P", 21u, PeriodUpdate(before, ManagerRow(20u, 2u, "2026-02-01", null), listOf(22u)),
            newManagerId = 2u, newStart = "2026-02-01", names = names,
        )!!
        assertEquals(TeamStructureEventType.MANAGER_PERIOD_UPDATED, updated.type)
        assertEquals(
            mapOf(
                "team" to "P", "periodId" to "21", "managerId" to "2", "manager" to "Bob", "startDate" to "2026-02-01",
                "managerFrom" to "1", "managerFromName" to "Ann", "managerTo" to "2", "managerToName" to "Bob",
                "startDateFrom" to "2026-03-01", "startDateTo" to "2026-02-01",
                "mergedIntoPeriodId" to "20", "removedPeriodIds" to "22",
            ),
            updated.params,
        )
        // Nothing changed -> nothing minted; a first period's null start is a delta with no From.
        assertNull(
            managerPeriodUpdatedEvent(
                9u, 5u, "P", 21u, PeriodUpdate(before, before, emptyList()), 1u, "2026-03-01", names,
            ),
        )
        val firstBefore = ManagerRow(21u, 1u, null, null)
        val dated = managerPeriodUpdatedEvent(
            9u, 5u, "P", 21u, PeriodUpdate(firstBefore, firstBefore.copy(start = "2026-01-01"), emptyList()), 1u, "2026-01-01", names,
        )!!
        assertNull(dated.params["startDateFrom"])
        assertEquals("2026-01-01", dated.params["startDateTo"])

        val deleted = managerPeriodDeletedEvent(
            9u, 5u, "P", PeriodDeletion(ManagerRow(21u, 1u, "2026-03-01", "2026-03-31"), 20u, listOf(22u)), 21u, names,
        )
        assertEquals(TeamStructureEventType.MANAGER_PERIOD_DELETED, deleted.type)
        assertEquals(
            mapOf(
                "team" to "P", "periodId" to "21", "managerId" to "1", "manager" to "Ann",
                "startDate" to "2026-03-01", "endDate" to "2026-03-31", "absorbedByPeriodId" to "20",
                "removedPeriodIds" to "22",
            ),
            deleted.params,
        )
    }
}
