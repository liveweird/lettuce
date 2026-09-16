package ch.nokillswit

import ch.nokillswit.daysoff.daysOffAllowanceChangedNotification
import ch.nokillswit.daysoff.daysOffCorrectionNotification
import ch.nokillswit.daysoff.daysOffFanoutNotifications
import ch.nokillswit.notifications.NotificationType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class DaysOffNotificationsTest {

    @Test
    fun `the create-delete fan-out notifies every recipient with only person and dates`() {
        val notifications = daysOffFanoutNotifications(
            type = NotificationType.DAYS_OFF_CREATED,
            recipientIds = setOf(7u, 9u),
            person = "Riley",
            startDate = "2030-03-04",
            endDate = "2030-03-05",
        )
        assertEquals(setOf(7u, 9u), notifications.map { it.recipientId }.toSet())
        notifications.forEach {
            assertEquals(NotificationType.DAYS_OFF_CREATED, it.type)
            // Deliberately no pool/type — the teammate redaction rule is honoured by
            // construction (the absence is shared, the category of leave is not).
            assertEquals(
                mapOf("person" to "Riley", "startDate" to "2030-03-04", "endDate" to "2030-03-05"),
                it.params,
            )
            assertEquals("/days-off?tab=team", it.link)
        }
        assertTrue(
            daysOffFanoutNotifications(NotificationType.DAYS_OFF_CREATED, emptySet(), "Riley", "a", "b").isEmpty(),
        )

        val deleted = daysOffFanoutNotifications(
            type = NotificationType.DAYS_OFF_DELETED,
            recipientIds = setOf(7u),
            person = "Riley",
            startDate = "2030-03-04",
            endDate = "2030-03-05",
        ).single()
        assertEquals(NotificationType.DAYS_OFF_DELETED, deleted.type)
        assertEquals(7u, deleted.recipientId)
    }

    @Test
    fun `an allowance change notifies the owner, omitting from on a first assignment`() {
        val first = daysOffAllowanceChangedNotification(
            ownerId = 3u, managerName = "Morgan", poolName = "Paid days off", from = null, to = 20,
        )
        assertEquals(3u, first.recipientId)
        assertEquals(NotificationType.DAYS_OFF_ALLOWANCE_CHANGED, first.type)
        assertEquals(mapOf("manager" to "Morgan", "pool" to "Paid days off", "to" to "20"), first.params)
        assertEquals("/days-off?tab=requests", first.link)

        val changed = daysOffAllowanceChangedNotification(
            ownerId = 3u, managerName = "Morgan", poolName = "Maternal leave", from = 20, to = 25,
        )
        assertEquals(
            mapOf("manager" to "Morgan", "pool" to "Maternal leave", "from" to "20", "to" to "25"),
            changed.params,
        )
    }

    @Test
    fun `a budget correction notifies the owner with the operation context`() {
        val note = daysOffCorrectionNotification(
            ownerId = 3u,
            managerName = "Morgan",
            poolName = "Paid days off",
            year = 2030,
            operation = ch.nokillswit.daysoff.DaysOffCorrectionOperation.SUBTRACT,
            days = "4.5",
        )
        assertEquals(3u, note.recipientId)
        assertEquals(NotificationType.DAYS_OFF_CORRECTED_TO_OWNER, note.type)
        assertEquals(
            mapOf("manager" to "Morgan", "pool" to "Paid days off", "year" to "2030", "operation" to "SUBTRACT", "days" to "4.5"),
            note.params,
        )
        assertEquals("/days-off?tab=requests", note.link)
    }
}
