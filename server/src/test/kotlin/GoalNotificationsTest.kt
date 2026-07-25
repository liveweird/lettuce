package ch.nokillswit

import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.goalTransitionNotifications
import ch.nokillswit.notifications.NotificationType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Pure builder tests (no DB); persistence and delivery live in GoalRoutesTest. */
class GoalNotificationsTest {

    private fun build(from: GoalStatus, to: GoalStatus) = goalTransitionNotifications(
        goalId = 42u,
        from = from,
        to = to,
        subordinateId = 7u,
        managerName = "Mona Manager",
        title = "Ship the migration",
    )

    @Test
    fun `each valid edge maps to its own notification type`() {
        assertEquals(
            NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE,
            build(GoalStatus.DRAFT, GoalStatus.ACTIVE).single().type,
        )
        assertEquals(
            NotificationType.GOAL_DEACTIVATED_TO_SUBORDINATE,
            build(GoalStatus.ACTIVE, GoalStatus.DRAFT).single().type,
        )
        assertEquals(
            NotificationType.GOAL_CLOSED_TO_SUBORDINATE,
            build(GoalStatus.ACTIVE, GoalStatus.CLOSED).single().type,
        )
        assertEquals(
            NotificationType.GOAL_REOPENED_TO_SUBORDINATE,
            build(GoalStatus.CLOSED, GoalStatus.ACTIVE).single().type,
        )
    }

    @Test
    fun `the recipient is always the subordinate, with manager name and title in params`() {
        val notification = build(GoalStatus.DRAFT, GoalStatus.ACTIVE).single()
        assertEquals(7u, notification.recipientId)
        assertEquals(mapOf("manager" to "Mona Manager", "title" to "Ship the migration"), notification.params)
        assertEquals("/goals/42/view", notification.link)
    }

    @Test
    fun `an invalid edge produces no notifications`() {
        assertTrue(build(GoalStatus.DRAFT, GoalStatus.CLOSED).isEmpty())
        assertTrue(build(GoalStatus.CLOSED, GoalStatus.DRAFT).isEmpty())
        assertTrue(build(GoalStatus.DRAFT, GoalStatus.DRAFT).isEmpty())
    }
}
