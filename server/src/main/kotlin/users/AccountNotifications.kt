package ch.nokillswit.users

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType

/**
 * The notice an administrator's reactivation of a deactivated account (V44) sends the person —
 * locked on, feature-neutral, no params (the admin is deliberately not named) and no link. Pure,
 * so the route and the perf dataset generator share one shape. See `ACCOUNT_REACTIVATED` in
 * `.claude/docs/features/notifications.md`.
 */
fun accountReactivatedNotification(userId: UInt): Notification =
    Notification(recipientId = userId, type = NotificationType.ACCOUNT_REACTIVATED)
