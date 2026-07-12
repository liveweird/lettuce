package ch.nokillswit.oneonones

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure mapping from a 1:1 meeting creation to the notifications it should produce: the
 * subordinate is told their manager documented a new 1:1, and the manager (the author) gets a
 * confirmation — both with a link to the meeting. Creation is the only notifying event; edits
 * and deletions notify nobody (a deliberate product decision). Side-effect-free (no DB) like
 * feedbacks/FeedbackNotifications.kt; [OneOnOneService.create] resolves the party names and the
 * route persists the result.
 */
internal fun oneOnOneCreationNotifications(
    meetingId: UInt,
    managerId: UInt,
    subordinateId: UInt,
    managerName: String,
    subordinateName: String,
    meetingDate: String,
): List<Notification> = listOf(
    Notification(
        recipientId = subordinateId,
        type = NotificationType.ONE_ON_ONE_CREATED_TO_SUBORDINATE,
        params = mapOf("manager" to managerName, "date" to meetingDate),
        // Both parties may always read their own 1:1, so the links are unconditional.
        link = "/one-on-ones/$meetingId/view",
    ),
    Notification(
        recipientId = managerId,
        type = NotificationType.ONE_ON_ONE_CREATED_TO_MANAGER,
        params = mapOf("subordinate" to subordinateName, "date" to meetingDate),
        link = "/one-on-ones/$meetingId/view",
    ),
)
