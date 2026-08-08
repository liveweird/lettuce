package ch.nokillswit

import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.pulse.pulseCancelledNotifications
import ch.nokillswit.pulse.pulseOpenedNotifications
import ch.nokillswit.pulse.pulseResultsNotifications
import ch.nokillswit.pulse.pulseScheduledNotifications
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The pure pulse notification builders: recipients, actor exclusion, params, link rules. */
class PulseNotificationsTest {

    @Test
    fun `scheduled - all eligible minus the actor, dates as params, deliberately no link`() {
        val list = pulseScheduledNotifications(
            recipientIds = setOf(1u, 2u, 3u),
            actorId = 2u,
            plannedOpenDate = "2026-09-01",
            plannedCloseDate = "2026-09-08",
        )
        assertEquals(setOf(1u, 3u), list.map { it.recipientId }.toSet())
        list.forEach {
            assertEquals(NotificationType.PULSE_CYCLE_SCHEDULED, it.type)
            assertEquals(mapOf("openDate" to "2026-09-01", "closeDate" to "2026-09-08"), it.params)
            assertNull(it.link)
        }
    }

    @Test
    fun `opened - participants minus the actor, linked to the fill page`() {
        val list = pulseOpenedNotifications(
            participantIds = setOf(1u, 2u),
            actorId = 9u,
            plannedCloseDate = "2026-09-08",
        )
        assertEquals(setOf(1u, 2u), list.map { it.recipientId }.toSet())
        list.forEach {
            assertEquals(NotificationType.PULSE_CYCLE_OPENED, it.type)
            assertEquals("/pulse?tab=survey", it.link)
            assertEquals(mapOf("closeDate" to "2026-09-08"), it.params)
        }
    }

    @Test
    fun `results - respondents only, deep-linked to the cycle's results`() {
        val list = pulseResultsNotifications(
            respondentIds = setOf(4u),
            actorId = 9u,
            cycleId = 17u,
            plannedCloseDate = "2026-09-08",
        )
        assertEquals(listOf(4u), list.map { it.recipientId })
        assertEquals(NotificationType.PULSE_RESULTS_AVAILABLE, list.single().type)
        assertEquals("/pulse?tab=results&cycle=17", list.single().link)
        assertEquals("17", list.single().params["cycleId"])
    }

    @Test
    fun `cancelled - participants minus the actor, no link`() {
        val list = pulseCancelledNotifications(
            participantIds = setOf(1u, 9u),
            actorId = 9u,
            plannedOpenDate = "2026-09-01",
        )
        assertEquals(listOf(1u), list.map { it.recipientId })
        assertEquals(NotificationType.PULSE_CYCLE_CANCELLED, list.single().type)
        assertNull(list.single().link)
    }

    @Test
    fun `an actor-only audience produces nothing`() {
        assertTrue(pulseOpenedNotifications(setOf(9u), actorId = 9u, plannedCloseDate = "2026-09-08").isEmpty())
    }
}
