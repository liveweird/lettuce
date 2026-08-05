package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffStatus
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.daysoff.daysOffCancelledNotifications
import ch.nokillswit.daysoff.daysOffRequestedNotifications
import ch.nokillswit.daysoff.daysOffResolvedNotification
import ch.nokillswit.notifications.NotificationType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class DaysOffNotificationsTest {

    @Test
    fun `creation notifies every direct manager with the request facts`() {
        val notifications = daysOffRequestedNotifications(
            managerIds = setOf(7u, 9u),
            requesterName = "Riley",
            type = DaysOffType.PAID,
            days = "1.5",
            startDate = "2030-03-04",
            endDate = "2030-03-05",
        )
        assertEquals(setOf(7u, 9u), notifications.map { it.recipientId }.toSet())
        notifications.forEach {
            assertEquals(NotificationType.DAYS_OFF_REQUESTED_TO_MANAGER, it.type)
            assertEquals(
                mapOf(
                    "requester" to "Riley",
                    "type" to "PAID",
                    "days" to "1.5",
                    "startDate" to "2030-03-04",
                    "endDate" to "2030-03-05",
                ),
                it.params,
            )
            assertEquals("/days-off?tab=team", it.link)
        }
        assertTrue(daysOffRequestedNotifications(emptySet(), "Riley", DaysOffType.PAID, "1", "a", "b").isEmpty())
    }

    @Test
    fun `resolution notifies the owner with the manager's name`() {
        val accepted = daysOffResolvedNotification(3u, DaysOffStatus.ACCEPTED, "Morgan", "2030-03-04", "2030-03-05")
        assertEquals(3u, accepted.recipientId)
        assertEquals(NotificationType.DAYS_OFF_ACCEPTED_TO_OWNER, accepted.type)
        assertEquals(mapOf("manager" to "Morgan", "startDate" to "2030-03-04", "endDate" to "2030-03-05"), accepted.params)
        assertEquals("/days-off?tab=requests", accepted.link)

        val rejected = daysOffResolvedNotification(3u, DaysOffStatus.REJECTED, "Morgan", "2030-03-04", "2030-03-05")
        assertEquals(NotificationType.DAYS_OFF_REJECTED_TO_OWNER, rejected.type)

        assertFailsWith<IllegalStateException> {
            daysOffResolvedNotification(3u, DaysOffStatus.CANCELLED, "Morgan", "a", "b")
        }
    }

    @Test
    fun `a budget correction notifies the owner with the operation context`() {
        val note = ch.nokillswit.daysoff.daysOffCorrectionNotification(
            ownerId = 3u,
            managerName = "Morgan",
            year = 2030,
            operation = ch.nokillswit.daysoff.DaysOffCorrectionOperation.SUBTRACT,
            days = "4.5",
        )
        assertEquals(3u, note.recipientId)
        assertEquals(NotificationType.DAYS_OFF_CORRECTED_TO_OWNER, note.type)
        assertEquals(
            mapOf("manager" to "Morgan", "year" to "2030", "operation" to "SUBTRACT", "days" to "4.5"),
            note.params,
        )
        assertEquals("/days-off?tab=requests", note.link)
    }

    @Test
    fun `cancellation notifies the given managers`() {
        val notifications = daysOffCancelledNotifications(setOf(7u), "Riley", "2030-03-04", "2030-03-05")
        assertEquals(1, notifications.size)
        assertEquals(7u, notifications.single().recipientId)
        assertEquals(NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER, notifications.single().type)
        assertEquals(
            mapOf("requester" to "Riley", "startDate" to "2030-03-04", "endDate" to "2030-03-05"),
            notifications.single().params,
        )
        assertEquals("/days-off?tab=team", notifications.single().link)
    }
}
