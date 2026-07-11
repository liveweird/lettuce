package ch.nokillswit.oneonones

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure mapping from a 1:1 meeting creation to the notifications it should produce. The only
 * notification the feature mints (a deliberate product decision): the subordinate is told their
 * manager documented a new 1:1, with a link to the read-only view. Edits and deletions notify
 * nobody. Side-effect-free (no DB) like feedbacks/FeedbackNotifications.kt; [OneOnOneService.create]
 * resolves the manager's name and the route persists the result.
 */
internal fun oneOnOneCreationNotifications(
    meetingId: UInt,
    subordinateId: UInt,
    managerName: String,
    meetingDate: String,
): List<Notification> = listOf(
    Notification(
        recipientId = subordinateId,
        type = NotificationType.ONE_ON_ONE_CREATED_TO_SUBORDINATE,
        params = mapOf("manager" to managerName, "date" to meetingDate),
        // The subordinate may always read their own 1:1, so the link is unconditional.
        link = "/one-on-ones/$meetingId/view",
    ),
)
