package ch.nokillswit

import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.notifications.feature
import ch.nokillswit.notifications.lockedOn
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.sharing.batchSharedNotification
import ch.nokillswit.users.Feature
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull

/** The pure share-notification builders and type mappings (`sharing/ShareNotifications.kt`, `Share.kt`) — no DB. */
class ShareNotificationsTest {

    @Test
    fun `only performance reviews are batchable and they map to the summary type (v4_10_0)`() {
        ShareableResourceType.entries.forEach { type ->
            val expected = if (type == ShareableResourceType.PERFORMANCE_REVIEW) {
                NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED
            } else {
                null
            }
            assertEquals(expected, type.batchSharedNotification, "$type")
        }
        // The summary type follows its feature and is silenceable like every other share notice.
        assertEquals(Feature.PERFORMANCE_REVIEWS, NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED.feature)
        assertFalse(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED.lockedOn)
    }

    @Test
    fun `the batch summary notice carries exactly sharer and count, plus expiresOn when bound`() {
        val open = batchSharedNotification(
            NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, 7u, "Sia Sharer", 3, null,
        )
        assertEquals(7u, open.recipientId)
        assertEquals(NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, open.type)
        assertEquals(mapOf("sharer" to "Sia Sharer", "count" to "3"), open.params)
        assertEquals("/shares", open.link)

        val bound = batchSharedNotification(
            NotificationType.PERFORMANCE_REVIEWS_BATCH_SHARED, 7u, "Sia Sharer", 1, "2026-12-31",
        )
        assertEquals(mapOf("sharer" to "Sia Sharer", "count" to "1", "expiresOn" to "2026-12-31"), bound.params)
        assertNull(ShareableResourceType.GOAL.batchSharedNotification)
    }
}
