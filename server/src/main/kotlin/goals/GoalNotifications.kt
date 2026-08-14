package ch.nokillswit.goals

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure mapping from a goal status transition to the notifications it should produce: the
 * subordinate is told their manager moved the goal (the manager is always the actor, so they get
 * nothing). Transitions and progress updates (v2.8.0, [goalProgressUpdateNotification] below)
 * are the only notifying events; creation (a private draft), edits, and deletion notify nobody.
 * Side-effect-free (no DB) like feedbacks/FeedbackNotifications.kt; [GoalService.transition]
 * resolves the manager's name and the route persists the result.
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

/**
 * The progress-update notification (v2.8.0): the counterparty of the actor — subordinate
 * updates → the manager hears, manager updates → the subordinate hears. Params carry the
 * actor's name under the recipient-relative key the wording interpolates; the comment itself
 * (encrypted at rest on the event) never rides along. [GoalService.updateProgress] resolves
 * the actor's name and the route persists the result.
 */
internal fun goalProgressUpdateNotification(
    goalId: UInt,
    actorUserId: UInt,
    managerId: UInt,
    subordinateId: UInt,
    actorName: String,
    title: String,
): Notification {
    require(actorUserId == managerId || actorUserId == subordinateId) {
        "Progress actor $actorUserId is neither party of goal $goalId"
    }
    val actorIsManager = actorUserId == managerId
    return Notification(
        recipientId = if (actorIsManager) subordinateId else managerId,
        type = if (actorIsManager) {
            NotificationType.GOAL_PROGRESS_UPDATED_TO_SUBORDINATE
        } else {
            NotificationType.GOAL_PROGRESS_UPDATED_TO_MANAGER
        },
        params = mapOf(
            (if (actorIsManager) "manager" else "subordinate") to actorName,
            "title" to title,
        ),
        // Both parties may always read the goal (progress only mutates while ACTIVE anyway).
        link = "/goals/$goalId/view",
    )
}
