package ch.nokillswit.notifications

/**
 * A side channel a freshly minted notification batch is mirrored to, alongside the in-app row —
 * [NotificationService.create]/[NotificationService.createAll] dispatch to every registered
 * mirror AFTER the insert transaction commits, always off the request path (the mail mirror's
 * fire-and-forget precedent). Two implementations today: [NotificationEmailer] (v2.3.0) and
 * `notifications/NotificationTeamsSender.kt`'s `NotificationTeamsSender` (v4.5.0) — each owns its
 * own per-recipient skip rules and failure handling; a mirror failing must never fail the mint
 * that triggered it or block another mirror.
 */
interface NotificationMirror {
    fun dispatch(notifications: List<Notification>)
}
