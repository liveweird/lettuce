package ch.nokillswit

import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teamkpis.teamKpiTransitionNotifications
import ch.nokillswit.teamkpis.teamKpiValueNotifications
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertFailsWith
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
    fun `a non-edge fails loud and an empty membership produces nothing`() {
        assertFailsWith<IllegalStateException> { notify(TeamKpiStatus.DRAFT, TeamKpiStatus.ARCHIVED) }
        assertTrue(notify(TeamKpiStatus.DRAFT, TeamKpiStatus.ACTIVE, memberIds = emptySet()).isEmpty())
    }

    // ---- data-point notifications ----

    private fun notifyValue(
        type: NotificationType = NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER,
        memberIds: Set<UInt> = setOf(10u, 11u),
        actingManagerId: UInt = 2u,
        valueParams: Map<String, String> = mapOf("date" to "2026-07-27", "value" to "72.0"),
    ) = teamKpiValueNotifications(
        kpiId = 5u,
        type = type,
        memberIds = memberIds,
        actingManagerId = actingManagerId,
        managerName = "Mona Manager",
        title = "Deploy frequency",
        teamName = "Team AAA",
        kpiType = TeamKpiType.PERCENTAGE,
        valueParams = valueParams,
    )

    @Test
    fun `a data-point mutation notifies each member with the display and value params`() {
        val notes = notifyValue()
        assertEquals(setOf(10u, 11u), notes.map { it.recipientId }.toSet())
        notes.forEach { note ->
            assertEquals(NotificationType.TEAM_KPI_VALUE_RECORDED_TO_MEMBER, note.type)
            assertEquals(
                mapOf(
                    "manager" to "Mona Manager",
                    "title" to "Deploy frequency",
                    "team" to "Team AAA",
                    "kpiType" to "PERCENTAGE",
                    "date" to "2026-07-27",
                    "value" to "72.0",
                ),
                note.params,
            )
            // Data points only mutate while ACTIVE, which members may read — always linked.
            assertEquals("/team-kpis/5/view", note.link)
        }
    }

    @Test
    fun `a correction carries the four-sided value params`() {
        val params = mapOf(
            "fromDate" to "2026-07-27", "fromValue" to "72.0",
            "toDate" to "2026-07-28", "toValue" to "75.0",
        )
        val notes = notifyValue(
            type = NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER,
            valueParams = params,
        )
        notes.forEach { note ->
            assertEquals(NotificationType.TEAM_KPI_VALUE_CORRECTED_TO_MEMBER, note.type)
            params.forEach { (k, v) -> assertEquals(v, note.params[k]) }
        }
    }

    @Test
    fun `the acting manager is excluded from data-point notifications too`() {
        val notes = notifyValue(memberIds = setOf(2u, 10u))
        assertEquals(listOf(10u), notes.map { it.recipientId })
    }
}
