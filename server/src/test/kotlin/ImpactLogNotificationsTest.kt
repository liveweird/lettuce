package ch.nokillswit

import ch.nokillswit.impactlog.impactEntryCreatedNotifications
import ch.nokillswit.impactlog.impactEntryDeletedNotifications
import ch.nokillswit.impactlog.impactEntryUpdatedNotifications
import ch.nokillswit.notifications.NotificationType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ImpactLogNotificationsTest {

    @Test
    fun `created fans out to every direct manager with the period params and the view link`() {
        val notifications = impactEntryCreatedNotifications(
            entryId = 7u,
            managerIds = setOf(3u, 4u),
            authorName = "Olga Owner",
            periodStart = "2026-07-01",
            periodEnd = "2026-07-31",
        )
        assertEquals(setOf(3u, 4u), notifications.map { it.recipientId }.toSet())
        notifications.forEach {
            assertEquals(NotificationType.IMPACT_ENTRY_CREATED_TO_MANAGER, it.type)
            assertEquals(
                mapOf("author" to "Olga Owner", "periodStart" to "2026-07-01", "periodEnd" to "2026-07-31"),
                it.params,
            )
            assertEquals("/impact-log/7/view", it.link)
        }
    }

    @Test
    fun `updated mirrors created with its own type`() {
        val notifications = impactEntryUpdatedNotifications(
            entryId = 7u,
            managerIds = setOf(3u),
            authorName = "Olga Owner",
            periodStart = "2026-07-01",
            periodEnd = "2026-07-31",
        )
        assertEquals(NotificationType.IMPACT_ENTRY_UPDATED_TO_MANAGER, notifications.single().type)
        assertEquals("/impact-log/7/view", notifications.single().link)
    }

    @Test
    fun `deleted links to the managed journal list, not the vanished entry`() {
        val notifications = impactEntryDeletedNotifications(
            managerIds = setOf(3u),
            authorName = "Olga Owner",
            periodStart = "2026-07-01",
            periodEnd = "2026-07-31",
        )
        assertEquals(NotificationType.IMPACT_ENTRY_DELETED_TO_MANAGER, notifications.single().type)
        assertEquals("/impact-log?tab=managed", notifications.single().link)
    }

    @Test
    fun `a manager-less owner produces no notifications`() {
        assertTrue(
            impactEntryCreatedNotifications(
                entryId = 7u,
                managerIds = emptySet(),
                authorName = "Solo",
                periodStart = "2026-07-01",
                periodEnd = "2026-07-31",
            ).isEmpty(),
        )
    }
}
