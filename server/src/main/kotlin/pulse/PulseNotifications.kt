package ch.nokillswit.pulse

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * Pure builders mapping pulse-cycle transitions to notifications (the GoalNotifications
 * pattern — no DB, unit-testable). Recipient sets are resolved by the service inside the
 * transition transaction; the route persists the returned list. The acting admin is excluded
 * from every set per convention. Params carry raw ISO dates and ids only — the SPA localizes.
 * Links only where the recipient may follow them: the fill page once OPEN, the results page
 * for respondents once CLOSED; scheduled/cancelled deliberately carry none.
 */

fun pulseScheduledNotifications(
    recipientIds: Set<UInt>,
    actorId: UInt,
    plannedOpenDate: String,
    plannedCloseDate: String,
): List<Notification> = (recipientIds - actorId).map { recipientId ->
    Notification(
        recipientId = recipientId,
        type = NotificationType.PULSE_CYCLE_SCHEDULED,
        params = mapOf("openDate" to plannedOpenDate, "closeDate" to plannedCloseDate),
        link = null,
    )
}

fun pulseOpenedNotifications(
    participantIds: Set<UInt>,
    actorId: UInt,
    plannedCloseDate: String,
): List<Notification> = (participantIds - actorId).map { recipientId ->
    Notification(
        recipientId = recipientId,
        type = NotificationType.PULSE_CYCLE_OPENED,
        params = mapOf("closeDate" to plannedCloseDate),
        link = "/pulse?tab=survey",
    )
}

fun pulseResultsNotifications(
    respondentIds: Set<UInt>,
    actorId: UInt,
    cycleId: UInt,
    plannedCloseDate: String,
): List<Notification> = (respondentIds - actorId).map { recipientId ->
    Notification(
        recipientId = recipientId,
        type = NotificationType.PULSE_RESULTS_AVAILABLE,
        params = mapOf("closeDate" to plannedCloseDate, "cycleId" to cycleId.toString()),
        link = "/pulse?tab=results&cycle=$cycleId",
    )
}

fun pulseCancelledNotifications(
    participantIds: Set<UInt>,
    actorId: UInt,
    plannedOpenDate: String,
): List<Notification> = (participantIds - actorId).map { recipientId ->
    Notification(
        recipientId = recipientId,
        type = NotificationType.PULSE_CYCLE_CANCELLED,
        params = mapOf("openDate" to plannedOpenDate),
        link = null,
    )
}
