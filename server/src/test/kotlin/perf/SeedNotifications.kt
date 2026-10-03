package ch.nokillswit.perf

import ch.nokillswit.infra.db.encodeParams
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationService

/**
 * The generator's notification mint — the notification catalogue is applied by each feature seeder
 * through the SAME pure builders the routes use (`oneOnOneCreationNotifications`,
 * `goalTransitionNotifications`, `feedbackTransitionNotifications`, `reviewTransitionNotifications`,
 * … — the table in `.claude/docs/features/notifications.md`), so recipients, types, params and links
 * cannot drift from production; this class only decides which of the minted rows still EXIST.
 *
 * **Retention-shaped (v3.12.0/V82, "Retention" in the notifications doc):** the on-mint purge
 * hard-deletes a notification once it is seen or user-deleted AND older than 30 days. So a row from
 * the last 30 days (before the anchor) always exists — seen by its recipient with probability
 * [SEEN_SHARE_RECENT] — while an older row exists only if its recipient never saw it
 * ([UNSEEN_SHARE_OLD], 5 %). The email/Teams mirrors are not part of the dataset.
 */
class NotificationMint(private val ctx: SeedContext) {
    private val rng = ctx.rng("notifications")
    private val ids = IdCounter(0u)
    private val sink = RowSink<MintedRow>(ctx.db, NotificationService.Notifications) { r ->
        this[NotificationService.Notifications.id] = r.id
        this[NotificationService.Notifications.recipientId] = r.notification.recipientId
        this[NotificationService.Notifications.timestamp] = r.timestamp
        this[NotificationService.Notifications.notificationType] = r.notification.type.name
        this[NotificationService.Notifications.params] = encodeParams(r.notification.params)
        this[NotificationService.Notifications.link] = r.notification.link
        this[NotificationService.Notifications.wasSeen] = r.seen
    }
    private val recentFrom = ctx.anchorMillis - NOTIFICATION_RETENTION_DAYS * MILLIS_PER_DAY

    /** Every notification the builders produced / how many survived the retention rule. */
    var minted = 0L
        private set
    val kept: Long get() = sink.written

    val sinkGroup = SinkGroup(sink)

    private class MintedRow(val id: UInt, val notification: Notification, val timestamp: Long, val seen: Boolean)

    suspend fun start() {
        ids.reset(nextFreeId(ctx.db, NotificationService.Notifications))
    }

    fun emit(notification: Notification, at: Long) {
        minted++
        val recent = at >= recentFrom
        val seen = if (recent) rng.chance(SEEN_SHARE_RECENT) else false
        if (recent || rng.chance(UNSEEN_SHARE_OLD)) {
            sink.add(MintedRow(ids.take(), notification, at, seen))
        }
    }

    fun emitAll(notifications: List<Notification>, at: Long) = notifications.forEach { emit(it, at) }

    suspend fun finish() {
        sink.flush()
        advanceSequences(ctx.db, listOf(NotificationService.Notifications))
    }

    private companion object {
        const val SEEN_SHARE_RECENT = 0.7
        const val UNSEEN_SHARE_OLD = 0.05
    }
}
