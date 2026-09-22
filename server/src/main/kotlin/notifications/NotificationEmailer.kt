package ch.nokillswit.notifications

import ch.nokillswit.infra.mail.Mailer
import ch.nokillswit.users.UserService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.slf4j.LoggerFactory

/**
 * Mirrors freshly minted in-app notifications to the recipients' inboxes (v2.3.0). Invoked by
 * [NotificationService.create]/[createAll] — the single chokepoint every mint site funnels
 * through — AFTER the notification transaction commits, and always off the request path: one
 * fire-and-forget [scope] launch per batch (the password-reset `app.launch` precedent), sends
 * sequential, each failure only logged (no queue/retry/outbox, matching the mail posture).
 *
 * Send-time skip rules, each evaluated per recipient against a fresh [UserService.read] (so an
 * opt-out takes effect immediately — no JWT-claim staleness, unlike the feature flags):
 *  - no mailer (`mail.transport=disabled`) → skip everything silently — email is a side
 *    effect here, never the requested feature, so there is no 503;
 *  - recipient soft-deleted or deactivated → skip;
 *  - the recipient opted out (`email_notifications_enabled = false`, V51) → skip;
 *  - the type's feature is in the recipient's disabled set → skip (mirrors the list read
 *    filter — minting is never suppressed, but we don't email about a disabled feature);
 *  - the recipient disabled that type's EMAIL channel (v4.0.0 — per-type notification
 *    preferences) → skip;
 *  - the catalog returns null (deliberately-not-emailed wordings) → skip.
 *
 * The V51 opt-out, the disabled-feature check, and the per-type EMAIL check are ALL skipped
 * outright for a [NotificationType.lockedOn] type (`PASSWORD_CHANGED`) — a security receipt
 * stays on for both channels regardless of any preference, master switch included; only the
 * deactivated/soft-deleted checks above still apply to it.
 */
class NotificationEmailer(
    private val scope: CoroutineScope,
    private val mailer: Mailer?,
    private val appUrl: String?,
    private val userService: UserService,
    private val notificationPreferenceService: NotificationPreferenceService,
) {
    private val log = LoggerFactory.getLogger("ch.nokillswit.mail")

    fun dispatch(notifications: List<Notification>) {
        val mailer = mailer ?: return
        if (notifications.isEmpty()) return
        scope.launch {
            // One batched EMAIL-channel disabled-set read for the whole batch rather than one
            // per recipient per send.
            val disabledEmail = notificationPreferenceService.disabledFor(
                notifications.map { it.recipientId }.toSet(),
                NotificationChannel.EMAIL,
            )
            notifications.forEach { notification ->
                try {
                    sendOne(mailer, notification, disabledEmail)
                } catch (e: Exception) {
                    log.error(
                        "Notification email to user ${notification.recipientId} (${notification.type}) failed",
                        e,
                    )
                }
            }
        }
    }

    private suspend fun sendOne(
        mailer: Mailer,
        notification: Notification,
        disabledEmail: Map<UInt, Set<NotificationType>>,
    ) {
        val recipient = userService.read(notification.recipientId) ?: return
        if (recipient.deactivated) return
        if (!notification.type.lockedOn) {
            if (!recipient.emailNotificationsEnabled) return
            if (notification.type.feature?.let { it in recipient.disabledFeatures } == true) return
            if (notification.type in disabledEmail.getOrDefault(notification.recipientId, emptySet())) return
        }
        val content = notificationEmailContent(
            recipientName = recipient.name,
            type = notification.type,
            params = notification.params,
            link = notification.link,
            appUrl = appUrl,
            language = recipient.language,
        ) ?: return
        mailer.send(recipient.email, content.subject, content.body)
    }
}
