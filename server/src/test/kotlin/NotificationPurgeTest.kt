package ch.nokillswit

import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationService
import ch.nokillswit.notifications.NotificationType
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update
import kotlin.test.Test
import kotlin.test.assertEquals

private const val THIRTY_ONE_DAYS_MILLIS = 31L * 24 * 60 * 60 * 1000
private const val THIRTY_DAYS_MILLIS = 30L * 24 * 60 * 60 * 1000
private const val TWENTY_NINE_DAYS_MILLIS = 29L * 24 * 60 * 60 * 1000
private const val ONE_HOUR_MILLIS = 3_600_000L
private const val PAST_ONE_HOUR_MILLIS = 3_601_000L

/**
 * The v3.12.0/V82 on-mint stale-notification purge (`NotificationService.purgeStale`): a
 * notification that is seen or user-deleted AND older than the retention window is HARD-deleted
 * (physically removed) — the registered exception to the soft-delete convention, since
 * notifications are ephemeral UX, not the audit trail. The trigger is the mint path itself
 * (`create`/`createAll`), never a scheduler. Every test seeds its own fresh recipient — the
 * purge is org-wide (not scoped to the recipient just minted for), so a shared row would be at
 * risk of another test's mint.
 */
class NotificationPurgeTest {

    private suspend fun freshRecipient(prefix: String): UInt =
        TestUsers.seed(email = uniqueEmail(prefix), password = "pw", roles = emptySet())

    private suspend fun backdate(id: UInt, ageMillis: Long) = setTimestamp(id, System.currentTimeMillis() - ageMillis)

    private suspend fun setTimestamp(id: UInt, value: Long) {
        suspendTransaction(TestServices.database) {
            NotificationService.Notifications.update({ NotificationService.Notifications.id eq id }) {
                it[timestamp] = value
            }
        }
    }

    /** A raw row count — 0 means the row is physically gone, not merely hidden. */
    private suspend fun rowCount(id: UInt): Long = suspendTransaction(TestServices.database) {
        NotificationService.Notifications.selectAll().where { NotificationService.Notifications.id eq id }.count()
    }

    private fun dummyNotification(recipientId: UInt, label: String) = Notification(
        recipientId = recipientId,
        type = NotificationType.FEEDBACK_SENT_TO_SUBJECT,
        params = mapOf("subject" to label),
    )

    @Test
    fun `a seen notification older than the retention window is purged by the next mint, org-wide`(): Unit =
        runBlocking {
            val recipientId = freshRecipient("purge-seen")
            val id = TestNotifications.seed(recipientId)
            backdate(id, THIRTY_ONE_DAYS_MILLIS)
            TestNotifications.service.markSeen(id)

            // ANY mint triggers the purge — use a fresh, unrelated recipient.
            val otherRecipientId = freshRecipient("purge-seen-other")
            TestNotifications.seed(otherRecipientId)

            assertEquals(0L, rowCount(id))
        }

    @Test
    fun `an unseen notification is never purged regardless of age`(): Unit = runBlocking {
        val recipientId = freshRecipient("purge-unseen")
        val id = TestNotifications.seed(recipientId)
        backdate(id, THIRTY_ONE_DAYS_MILLIS)

        TestNotifications.seed(recipientId)

        assertEquals(1L, rowCount(id))
    }

    @Test
    fun `a seen notification inside the retention window survives`(): Unit = runBlocking {
        val recipientId = freshRecipient("purge-boundary")
        val id = TestNotifications.seed(recipientId)
        backdate(id, TWENTY_NINE_DAYS_MILLIS)
        TestNotifications.service.markSeen(id)

        TestNotifications.seed(recipientId)

        assertEquals(1L, rowCount(id))
    }

    @Test
    fun `the boundary is strict - a row exactly retention-old survives, one millisecond older goes`(): Unit =
        runBlocking {
            var now = System.currentTimeMillis()
            val recipientId = freshRecipient("purge-exact")
            // A fixed clock pins the comparison: created_at == now - retention must NOT match `less`.
            val fixed = NotificationService(TestServices.database) { now }
            val id = TestNotifications.seed(recipientId)
            setTimestamp(id, now - THIRTY_DAYS_MILLIS)
            TestNotifications.service.markSeen(id)

            fixed.create(dummyNotification(recipientId, "at-the-boundary"))
            assertEquals(1L, rowCount(id), "exactly retention-old is not older than the window")

            now += 1
            fixed.create(dummyNotification(recipientId, "past-the-boundary"))
            assertEquals(0L, rowCount(id))
        }

    @Test
    fun `a user-deleted notification older than the retention window is purged`(): Unit = runBlocking {
        val recipientId = freshRecipient("purge-deleted")
        val id = TestNotifications.seed(recipientId)
        backdate(id, THIRTY_ONE_DAYS_MILLIS)
        TestNotifications.service.delete(id)

        TestNotifications.seed(recipientId)

        assertEquals(0L, rowCount(id))
    }

    @Test
    fun `createAll also triggers the purge`(): Unit = runBlocking {
        val recipientId = freshRecipient("purge-createall")
        val id = TestNotifications.seed(recipientId)
        backdate(id, THIRTY_ONE_DAYS_MILLIS)
        TestNotifications.service.markSeen(id)

        TestNotifications.service.createAll(listOf(dummyNotification(recipientId, "batch")))

        assertEquals(0L, rowCount(id))
    }

    @Test
    fun `retentionMillis = 0 disables the purge entirely`(): Unit = runBlocking {
        val recipientId = freshRecipient("purge-disabled")
        val service = NotificationService(TestServices.database, retentionMillis = 0)
        val id = service.create(dummyNotification(recipientId, "one"))
        backdate(id, THIRTY_ONE_DAYS_MILLIS)
        service.markSeen(id)

        // Mint again on the same purge-disabled instance.
        service.create(dummyNotification(recipientId, "two"))

        assertEquals(1L, rowCount(id))
    }

    @Test
    fun `the purge gate bounds DB round-trips per instance, and reopens once the interval elapses`(): Unit =
        runBlocking {
            var now = System.currentTimeMillis()
            val recipientId = freshRecipient("purge-gate")
            // The row that gets purged is created/backdated/marked-seen through the ungated
            // TestNotifications.service (interval 0) so it never consumes the gate under test.
            val gated = NotificationService(TestServices.database, purgeIntervalMillis = ONE_HOUR_MILLIS) { now }

            val id1 = TestNotifications.seed(recipientId)
            backdate(id1, THIRTY_ONE_DAYS_MILLIS)
            TestNotifications.service.markSeen(id1)

            // First mint on the gated instance wins the gate and purges.
            gated.create(dummyNotification(recipientId, "one"))
            assertEquals(0L, rowCount(id1))

            // A second stale row is NOT purged by another mint within the same interval.
            val id2 = TestNotifications.seed(recipientId)
            backdate(id2, THIRTY_ONE_DAYS_MILLIS)
            TestNotifications.service.markSeen(id2)

            gated.create(dummyNotification(recipientId, "two"))
            assertEquals(1L, rowCount(id2), "the gate is still closed for this instance within the interval")

            // Driving the SAME instance's gate past the interval reopens it.
            now += PAST_ONE_HOUR_MILLIS
            gated.create(dummyNotification(recipientId, "three"))
            assertEquals(0L, rowCount(id2))
        }
}
