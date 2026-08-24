package ch.nokillswit

import ch.nokillswit.impactlog.ImpactEntryEventType
import ch.nokillswit.impactlog.ImpactEntryRequest
import ch.nokillswit.impactlog.ImpactEntryResponse
import ch.nokillswit.impactlog.impactEntryCreationEvent
import ch.nokillswit.impactlog.impactEntryDeletionEvent
import ch.nokillswit.impactlog.impactEntryUpdateEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ImpactLogEventsTest {

    private fun response(
        title: String = "Pipeline",
        periodStart: String = "2026-07-01",
        periodEnd: String = "2026-07-31",
        whatHappened: String = "Shipped it.",
        contribution: String = "Built it.",
        whyItMattered: String = "Unblocked the team.",
        evidence: String = "Kudos thread.",
    ) = ImpactEntryResponse(
        id = 1u,
        userId = 2u,
        userName = "Olga Owner",
        title = title,
        periodStart = periodStart,
        periodEnd = periodEnd,
        whatHappened = whatHappened,
        contribution = contribution,
        whyItMattered = whyItMattered,
        evidence = evidence,
        createdAt = 1L,
        lastModified = 1L,
    )

    private fun request(
        title: String = "Pipeline",
        periodStart: String = "2026-07-01",
        periodEnd: String = "2026-07-31",
        whatHappened: String = "Shipped it.",
        contribution: String = "Built it.",
        whyItMattered: String = "Unblocked the team.",
        evidence: String = "Kudos thread.",
    ) = ImpactEntryRequest(
        title = title,
        periodStart = periodStart,
        periodEnd = periodEnd,
        whatHappened = whatHappened,
        contribution = contribution,
        whyItMattered = whyItMattered,
        evidence = evidence,
    )

    @Test
    fun `creation event carries the period only`() {
        val event = impactEntryCreationEvent("2026-07-01", "2026-07-31")
        assertEquals(ImpactEntryEventType.CREATED, event.type)
        assertEquals(mapOf("periodStart" to "2026-07-01", "periodEnd" to "2026-07-31"), event.params)
    }

    @Test
    fun `a no-op update yields no event`() {
        assertNull(impactEntryUpdateEvent(response(), request()))
    }

    @Test
    fun `an update names the changed fields in stable order with period deltas`() {
        val event = impactEntryUpdateEvent(
            response(),
            request(
                title = "Pipeline v2",
                periodStart = "2026-06-01",
                evidence = "New dashboard screenshots.",
                contribution = "Built and documented it.",
            ),
        )!!
        assertEquals(ImpactEntryEventType.UPDATED, event.type)
        // Stable order: title first, then period, then the sections.
        assertEquals("title,periodStart,contribution,evidence", event.params["changed"])
        assertEquals("2026-07-01", event.params["periodStartFrom"])
        assertEquals("2026-06-01", event.params["periodStartTo"])
        // The end date did not move — no deltas for it.
        assertNull(event.params["periodEndFrom"])
        // Section text NEVER rides the plaintext params.
        assertTrue(event.params.values.none { it.contains("dashboard") || it.contains("documented") })
    }

    @Test
    fun `a section-only update carries the field list without date deltas`() {
        val event = impactEntryUpdateEvent(response(), request(whyItMattered = "It set the direction."))!!
        assertEquals(mapOf("changed" to "whyItMattered"), event.params)
    }

    @Test
    fun `deletion event is bare`() {
        val event = impactEntryDeletionEvent()
        assertEquals(ImpactEntryEventType.DELETED, event.type)
        assertTrue(event.params.isEmpty())
    }
}
