package ch.nokillswit

import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teamkpis.teamKpiTransitionNotifications
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pure unit tests of the team-KPI transition → notification fan-out (no DB, no HTTP). */
class TeamKpiNotificationsTest {

    private fun notify(
        from: TeamKpiStatus,
        to: TeamKpiStatus,
        memberIds: Set<UInt> = setOf(10u, 11u, 12u),
        actingManagerId: UInt = 2u,
    ) = teamKpiTransitionNotifications(
        kpiId = 5u,
        from = from,
        to = to,
        memberIds = memberIds,
        actingManagerId = actingManagerId,
        managerName = "Mona Manager",
        title = "Deploy frequency",
        teamName = "Team AAA",
    )

    @Test
    fun `each valid edge maps to its type, one notification per member`() {
        val cases = mapOf(
            (TeamKpiStatus.DRAFT to TeamKpiStatus.ACTIVE) to NotificationType.TEAM_KPI_ACTIVATED_TO_MEMBER,
            (TeamKpiStatus.ACTIVE to TeamKpiStatus.DRAFT) to NotificationType.TEAM_KPI_DEACTIVATED_TO_MEMBER,
            (TeamKpiStatus.ACTIVE to TeamKpiStatus.ARCHIVED) to NotificationType.TEAM_KPI_ARCHIVED_TO_MEMBER,
            (TeamKpiStatus.ARCHIVED to TeamKpiStatus.ACTIVE) to NotificationType.TEAM_KPI_REOPENED_TO_MEMBER,
        )
        cases.forEach { (edge, expectedType) ->
            val notes = notify(edge.first, edge.second)
            assertEquals(setOf(10u, 11u, 12u), notes.map { it.recipientId }.toSet())
            notes.forEach { note ->
                assertEquals(expectedType, note.type)
                assertEquals(
                    mapOf("manager" to "Mona Manager", "title" to "Deploy frequency", "team" to "Team AAA"),
                    note.params,
                )
            }
        }
    }

    @Test
    fun `the acting manager is excluded even when a member of their own team`() {
        val notes = notify(TeamKpiStatus.DRAFT, TeamKpiStatus.ACTIVE, memberIds = setOf(2u, 10u))
        assertEquals(listOf(10u), notes.map { it.recipientId })
    }

    @Test
    fun `deactivation carries no link - a draft is not readable by members`() {
        notify(TeamKpiStatus.ACTIVE, TeamKpiStatus.DRAFT).forEach { assertNull(it.link) }
        // Every other edge lands readable and links to the view.
        notify(TeamKpiStatus.DRAFT, TeamKpiStatus.ACTIVE).forEach { assertEquals("/team-kpis/5/view", it.link) }
        notify(TeamKpiStatus.ACTIVE, TeamKpiStatus.ARCHIVED).forEach { assertEquals("/team-kpis/5/view", it.link) }
        notify(TeamKpiStatus.ARCHIVED, TeamKpiStatus.ACTIVE).forEach { assertEquals("/team-kpis/5/view", it.link) }
    }

    @Test
    fun `an invalid edge and an empty membership both produce nothing`() {
        assertTrue(notify(TeamKpiStatus.DRAFT, TeamKpiStatus.ARCHIVED).isEmpty())
        assertTrue(notify(TeamKpiStatus.DRAFT, TeamKpiStatus.ACTIVE, memberIds = emptySet()).isEmpty())
    }
}
