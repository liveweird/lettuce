package ch.nokillswit.daysoff

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure mappings from days-off moments to the notifications they should produce —
 * side-effect-free (no DB) like goals/GoalNotifications.kt; [DaysOffService] resolves names and
 * recipient ids in-transaction and the route persists the result. Params carry raw values (ISO
 * dates) — the SPA formats them in the viewer's language.
 * There is deliberately no per-entry detail page in the SPA, so links land on the list tabs.
 */

/** Create/delete fan-out (v3.9.0 — no approval lifecycle): every person sharing a team with the
 * owner plus each such team's direct manager, minus the acting person — see
 * [DaysOffService.create]/[DaysOffService.delete]. Params carry `person` (the owner's display
 * name — the reader may be the owner themselves, a teammate, or a manager, so the sentence
 * fills in "you"/the name client-side), `startDate`, `endDate` — deliberately no `pool`/`type`,
 * so the teammate redaction rule (v3.2.1) is honoured by construction. */
internal fun daysOffFanoutNotifications(
    type: NotificationType,
    recipientIds: Set<UInt>,
    person: String,
    startDate: String,
    endDate: String,
): List<Notification> = recipientIds.map { recipientId ->
    Notification(
        recipientId = recipientId,
        type = type,
        params = mapOf("person" to person, "startDate" to startDate, "endDate" to endDate),
        link = "/days-off?tab=team",
    )
}

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
