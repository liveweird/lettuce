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

/** On-behalf recording (v2.29.0): a direct manager entered days off for a report, born
 * ACCEPTED. Both parties are told — the owner learns an entry now sits on their record, and
 * the acting manager keeps a durable receipt (the 1:1-creation precedent: an on-behalf write
 * to someone else's record deserves more than a 2.5-second toast). Other direct managers
 * deliberately hear nothing — the row is visible in their managed list. */
internal fun daysOffRecordedNotifications(
    ownerId: UInt,
    ownerName: String,
    managerId: UInt,
    managerName: String,
    type: DaysOffType,
    days: String,
    startDate: String,
    endDate: String,
): List<Notification> = listOf(
    Notification(
        recipientId = ownerId,
        type = NotificationType.DAYS_OFF_RECORDED_TO_OWNER,
        params = mapOf(
            "manager" to managerName,
            "type" to type.name,
            "days" to days,
            "startDate" to startDate,
            "endDate" to endDate,
        ),
        link = "/days-off?tab=requests",
    ),
    Notification(
        recipientId = managerId,
        type = NotificationType.DAYS_OFF_RECORDED_TO_MANAGER,
        params = mapOf(
            "requester" to ownerName,
            "type" to type.name,
            "days" to days,
            "startDate" to startDate,
            "endDate" to endDate,
        ),
        link = "/days-off?tab=team",
    ),
)

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

/** Budget correction (v1.43.0): the subordinate hears about a new ± adjustment to their
 * paid-days budget (create only — edits and deletions stay silent, the budget numbers are
 * live). The SPA words ADD/SUBTRACT via i18next context on `operation`; `pool` (v3.2.0) is
 * the adjusted pool kind's name. */
internal fun daysOffCorrectionNotification(
    ownerId: UInt,
    managerName: String,
    poolName: String,
    year: Int,
    operation: DaysOffCorrectionOperation,
    days: String,
): Notification = Notification(
    recipientId = ownerId,
    type = NotificationType.DAYS_OFF_CORRECTED_TO_OWNER,
    params = mapOf(
        "manager" to managerName,
        "pool" to poolName,
        "year" to year.toString(),
        "operation" to operation.name,
        "days" to days,
    ),
    // The budget card (with its Corrections view) lives on the requests tab.
    link = "/days-off?tab=requests",
)

/** Allowance change (v2.32.0): a chain manager set or changed the owner's annual paid
 * allowance — the owner hears about it like a correction (create only there, change only
 * here: a no-op re-PUT stays silent). Params carry the manager's name, the pool kind's name
 * (`pool`, v3.2.0 — a fresh extra-pool grant is this same event with no `from`), and the
 * whole-day numbers; `from` is omitted on a first assignment (the audit-delta idiom). */
internal fun daysOffAllowanceChangedNotification(
    ownerId: UInt,
    managerName: String,
    poolName: String,
    from: Int?,
    to: Int,
): Notification = Notification(
    recipientId = ownerId,
    type = NotificationType.DAYS_OFF_ALLOWANCE_CHANGED,
    params = buildMap {
        put("manager", managerName)
        put("pool", poolName)
        from?.let { put("from", it.toString()) }
        put("to", to.toString())
    },
    // The budget card lives on the requests tab (the correction-notification precedent).
    link = "/days-off?tab=requests",
)

/** Cancellation (reworked v2.31.0 — owner or a chain manager cancels, always with a reason):
 * both sides are told, always. The owner gets [DAYS_OFF_CANCELLED_TO_OWNER] (a durable receipt
 * even when they cancelled themselves — the recorded-pair precedent); the manager side gets
 * [DAYS_OFF_CANCELLED_TO_MANAGER] — every current direct manager on an owner-cancel, or just
 * the acting manager's receipt on a manager-cancel (other managers deliberately silent, the
 * row is visible in their managed list). The `by` param (OWNER/MANAGER) is an i18next context
 * for the wording split; the REASON never rides params (content-free rule) — it lives
 * encrypted on the row and renders via the table's popover. */
internal fun daysOffCancelledNotifications(
    ownerId: UInt,
    ownerName: String,
    actorName: String,
    managerRecipientIds: Set<UInt>,
    byManager: Boolean,
    startDate: String,
    endDate: String,
): List<Notification> {
    val by = if (byManager) "MANAGER" else "OWNER"
    val toOwner = Notification(
        recipientId = ownerId,
        type = NotificationType.DAYS_OFF_CANCELLED_TO_OWNER,
        params = mapOf(
            "manager" to actorName,
            "by" to by,
            "startDate" to startDate,
            "endDate" to endDate,
        ),
        link = "/days-off?tab=requests",
    )
    val toManagers = managerRecipientIds.map { recipientId ->
        Notification(
            recipientId = recipientId,
            type = NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER,
            params = mapOf(
                "requester" to ownerName,
                "manager" to actorName,
                "by" to by,
                "startDate" to startDate,
                "endDate" to endDate,
            ),
            link = "/days-off?tab=team",
        )
    }
    return listOf(toOwner) + toManagers
}
