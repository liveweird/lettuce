package ch.nokillswit.daysoff

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure mappings from days-off lifecycle moments to the notifications they should produce —
 * side-effect-free (no DB) like goals/GoalNotifications.kt; [DaysOffService] resolves names and
 * recipient ids in-transaction and the route persists the result. Params carry raw values (ISO
 * dates, a "1.5"-style days string, enum names) — the SPA formats them in the viewer's language.
 * There is deliberately no per-request detail page in the SPA, so links land on the list tabs.
 */

/** Creation: each current direct manager of the owner is asked to review the request. A user
 * with no manager (top of chain) notifies nobody — documented limitation. */
internal fun daysOffRequestedNotifications(
    managerIds: Set<UInt>,
    requesterName: String,
    type: DaysOffType,
    days: String,
    startDate: String,
    endDate: String,
): List<Notification> = managerIds.map { managerId ->
    Notification(
        recipientId = managerId,
        type = NotificationType.DAYS_OFF_REQUESTED_TO_MANAGER,
        params = mapOf(
            "requester" to requesterName,
            "type" to type.name,
            "days" to days,
            "startDate" to startDate,
            "endDate" to endDate,
        ),
        link = "/days-off?tab=team",
    )
}

/** Resolution (accept/reject): the owner is told what their manager decided. */
internal fun daysOffResolvedNotification(
    ownerId: UInt,
    target: DaysOffStatus,
    managerName: String,
    startDate: String,
    endDate: String,
): Notification = Notification(
    recipientId = ownerId,
    type = when (target) {
        DaysOffStatus.ACCEPTED -> NotificationType.DAYS_OFF_ACCEPTED_TO_OWNER
        DaysOffStatus.REJECTED -> NotificationType.DAYS_OFF_REJECTED_TO_OWNER
        else -> error("Not a resolution target: $target")
    },
    params = mapOf("manager" to managerName, "startDate" to startDate, "endDate" to endDate),
    link = "/days-off?tab=requests",
)

/** Cancellation: cancelled-from-ACCEPTED tells the manager who accepted it ([recipientIds] =
 * the resolver); cancelled-from-REQUESTED tells all current direct managers (they were asked
 * to review it). */
internal fun daysOffCancelledNotifications(
    recipientIds: Set<UInt>,
    requesterName: String,
    startDate: String,
    endDate: String,
): List<Notification> = recipientIds.map { recipientId ->
    Notification(
        recipientId = recipientId,
        type = NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER,
        params = mapOf("requester" to requesterName, "startDate" to startDate, "endDate" to endDate),
        link = "/days-off?tab=team",
    )
}
