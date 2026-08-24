package ch.nokillswit.impactlog

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure mapping from an impact log mutation to the notifications it should produce: the owner's
 * DIRECT managers hear about every create/update/delete (the days-off fan-out rule — the chain
 * above stays pull-only, and the acting owner is never notified of their own action; a user with
 * no manager notifies nobody). Side-effect-free (no DB) like goals/GoalNotifications.kt;
 * [ImpactLogService] resolves the manager ids and the owner's name, the route persists the
 * result.
 *
 * Params carry the author's name and the entry's period dates only — the four sections are
 * encrypted at rest and NEVER ride the plaintext params (the days-off cancelReason rule).
 */
internal fun impactEntryCreatedNotifications(
    entryId: UInt,
    managerIds: Set<UInt>,
    authorName: String,
    periodStart: String,
    periodEnd: String,
): List<Notification> = managerIds.map { managerId ->
    Notification(
        recipientId = managerId,
        type = NotificationType.IMPACT_ENTRY_CREATED_TO_MANAGER,
        params = entryParams(authorName, periodStart, periodEnd),
        // A direct manager is in the owner's chain, so the entry is always readable to them.
        link = "/impact-log/$entryId/view",
    )
}

internal fun impactEntryUpdatedNotifications(
    entryId: UInt,
    managerIds: Set<UInt>,
    authorName: String,
    periodStart: String,
    periodEnd: String,
): List<Notification> = managerIds.map { managerId ->
    Notification(
        recipientId = managerId,
        type = NotificationType.IMPACT_ENTRY_UPDATED_TO_MANAGER,
        params = entryParams(authorName, periodStart, periodEnd),
        link = "/impact-log/$entryId/view",
    )
}

internal fun impactEntryDeletedNotifications(
    managerIds: Set<UInt>,
    authorName: String,
    periodStart: String,
    periodEnd: String,
): List<Notification> = managerIds.map { managerId ->
    Notification(
        recipientId = managerId,
        type = NotificationType.IMPACT_ENTRY_DELETED_TO_MANAGER,
        params = entryParams(authorName, periodStart, periodEnd),
        // The entry is soft-deleted (its view would 404), so the link lands on the journal list.
        link = "/impact-log?tab=managed",
    )
}

private fun entryParams(authorName: String, periodStart: String, periodEnd: String): Map<String, String> =
    mapOf("author" to authorName, "periodStart" to periodStart, "periodEnd" to periodEnd)
