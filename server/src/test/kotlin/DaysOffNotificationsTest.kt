package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffStatus
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.daysoff.daysOffAllowanceChangedNotification
import ch.nokillswit.daysoff.daysOffCancelledNotifications
import ch.nokillswit.daysoff.daysOffRecordedNotifications
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
    fun `an allowance change notifies the owner, omitting from on a first assignment`() {
        val first = daysOffAllowanceChangedNotification(ownerId = 3u, managerName = "Morgan", from = null, to = 20)
        assertEquals(3u, first.recipientId)
        assertEquals(NotificationType.DAYS_OFF_ALLOWANCE_CHANGED, first.type)
        assertEquals(mapOf("manager" to "Morgan", "to" to "20"), first.params)
        assertEquals("/days-off?tab=requests", first.link)

        val changed = daysOffAllowanceChangedNotification(ownerId = 3u, managerName = "Morgan", from = 20, to = 25)
        assertEquals(mapOf("manager" to "Morgan", "from" to "20", "to" to "25"), changed.params)
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
    fun `an on-behalf recording notifies both the owner and the acting manager`() {
        val notifications = daysOffRecordedNotifications(
            ownerId = 3u,
            ownerName = "Riley",
            managerId = 7u,
            managerName = "Morgan",
            type = DaysOffType.PAID,
            days = "2",
            startDate = "2030-03-04",
            endDate = "2030-03-05",
        )
        assertEquals(2, notifications.size)
        val toOwner = notifications.single { it.type == NotificationType.DAYS_OFF_RECORDED_TO_OWNER }
        assertEquals(3u, toOwner.recipientId)
        assertEquals(
            mapOf(
                "manager" to "Morgan",
                "type" to "PAID",
                "days" to "2",
                "startDate" to "2030-03-04",
                "endDate" to "2030-03-05",
            ),
            toOwner.params,
        )
        assertEquals("/days-off?tab=requests", toOwner.link)
        val toManager = notifications.single { it.type == NotificationType.DAYS_OFF_RECORDED_TO_MANAGER }
        assertEquals(7u, toManager.recipientId)
        assertEquals(
            mapOf(
                "requester" to "Riley",
                "type" to "PAID",
                "days" to "2",
                "startDate" to "2030-03-04",
                "endDate" to "2030-03-05",
            ),
            toManager.params,
        )
        assertEquals("/days-off?tab=team", toManager.link)
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
    fun `an owner-cancel pairs the owner receipt with every direct manager`() {
        val notifications = daysOffCancelledNotifications(
            ownerId = 3u,
            ownerName = "Riley",
            actorName = "Riley",
            managerRecipientIds = setOf(7u, 8u),
            byManager = false,
            startDate = "2030-03-04",
            endDate = "2030-03-05",
        )
        assertEquals(3, notifications.size)
        val toOwner = notifications.single { it.type == NotificationType.DAYS_OFF_CANCELLED_TO_OWNER }
        assertEquals(3u, toOwner.recipientId)
        assertEquals(
            mapOf("manager" to "Riley", "by" to "OWNER", "startDate" to "2030-03-04", "endDate" to "2030-03-05"),
            toOwner.params,
        )
        assertEquals("/days-off?tab=requests", toOwner.link)
        val toManagers = notifications.filter { it.type == NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER }
        assertEquals(setOf(7u, 8u), toManagers.map { it.recipientId }.toSet())
        for (note in toManagers) {
            assertEquals(
                mapOf(
                    "requester" to "Riley", "manager" to "Riley", "by" to "OWNER",
                    "startDate" to "2030-03-04", "endDate" to "2030-03-05",
                ),
                note.params,
            )
            assertEquals("/days-off?tab=team", note.link)
        }
    }

    @Test
    fun `a manager-cancel tells the owner who acted and keeps the acting manager's receipt`() {
        val notifications = daysOffCancelledNotifications(
            ownerId = 3u,
            ownerName = "Riley",
            actorName = "Morgan",
            managerRecipientIds = setOf(7u),
            byManager = true,
            startDate = "2030-03-04",
            endDate = "2030-03-05",
        )
        assertEquals(2, notifications.size)
        val toOwner = notifications.single { it.type == NotificationType.DAYS_OFF_CANCELLED_TO_OWNER }
        assertEquals("MANAGER", toOwner.params["by"])
        assertEquals("Morgan", toOwner.params["manager"])
        val receipt = notifications.single { it.type == NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER }
        assertEquals(7u, receipt.recipientId)
        assertEquals("MANAGER", receipt.params["by"])
        assertEquals("Riley", receipt.params["requester"])
    }
}
