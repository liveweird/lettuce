package ch.nokillswit.goals

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure mapping from a goal status transition to the notifications it should produce: the
 * subordinate is told their manager moved the goal (the manager is always the actor, so they get
 * nothing). Transitions are the only notifying events; creation (a private draft), edits, and
 * deletion notify nobody. Side-effect-free (no DB) like feedbacks/FeedbackNotifications.kt;
 * [GoalService.transition] resolves the manager's name and the route persists the result.
 *
 * The goal title rides along in params — it is plaintext by design (unlike description/summary),
 * so the localized message can name the goal.
 */
internal fun goalTransitionNotifications(
    goalId: UInt,
    from: GoalStatus,
    to: GoalStatus,
    subordinateId: UInt,
    managerName: String,
    title: String,
): List<Notification> {
    val type = when (from to to) {
        GoalStatus.DRAFT to GoalStatus.ACTIVE -> NotificationType.GOAL_ACTIVATED_TO_SUBORDINATE
        GoalStatus.ACTIVE to GoalStatus.DRAFT -> NotificationType.GOAL_DEACTIVATED_TO_SUBORDINATE
        GoalStatus.ACTIVE to GoalStatus.ARCHIVED -> NotificationType.GOAL_ARCHIVED_TO_SUBORDINATE
        GoalStatus.ARCHIVED to GoalStatus.ACTIVE -> NotificationType.GOAL_REOPENED_TO_SUBORDINATE
        // Every legal edge of the DRAFT <-> ACTIVE <-> ARCHIVED machine is named above, so this
        // is unreachable for a legal call — fail loud (the daysoff precedent) instead of silently
        // dropping notifications when a future edge forgets its wording.
        else -> error("Not a goal transition edge: $from -> $to")
    }
    return listOf(
        Notification(
            recipientId = subordinateId,
            type = type,
            params = mapOf("manager" to managerName, "title" to title),
            // The subordinate may always read their own goal, so the link is unconditional.
            link = "/goals/$goalId/view",
        ),
    )
}
