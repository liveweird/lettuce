package ch.nokillswit

import ch.nokillswit.teamkpis.TeamKpiDefinitionUpdate
import ch.nokillswit.teamkpis.TeamKpiEventType
import ch.nokillswit.teamkpis.TeamKpiProgressUpdate
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teamkpis.teamKpiCreationEvent
import ch.nokillswit.teamkpis.teamKpiDefinitionUpdateEvents
import ch.nokillswit.teamkpis.teamKpiDeletionEvent
import ch.nokillswit.teamkpis.teamKpiProgressUpdateEvent
import ch.nokillswit.teamkpis.teamKpiTransitionEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pure unit tests of the team-KPI event descriptor builders (no DB, no HTTP). */
class TeamKpiEventsTest {

    private val before = TeamKpiResponse(
        id = 1u,
        teamId = 7u,
        teamName = "Team AAA",
        teamDeleted = false,
        managerId = 2u,
        managerName = "Mona Manager",
        createdAt = 1000L,
        title = "Deploy frequency",
        description = "Secret description",
        type = TeamKpiType.NUMBER,
        targetValue = 10.0,
        currentValue = 4.0,
        currentValueDate = "2026-07-20",
        status = TeamKpiStatus.DRAFT,
        summary = null,
        lastModified = 1000L,
    )

    @Test
    fun `creation event carries the type`() {
        val event = teamKpiCreationEvent(TeamKpiType.PERCENTAGE)
        assertEquals(TeamKpiEventType.CREATED, event.type)
        assertEquals(mapOf("type" to "PERCENTAGE"), event.params)
    }

    @Test
    fun `definition diff mints one event per changed aspect in stable order`() {
        val events = teamKpiDefinitionUpdateEvents(
            before,
            TeamKpiDefinitionUpdate(
                title = "New title",
                description = "New description",
                type = TeamKpiType.PERCENTAGE,
                targetValue = 80.0,
            ),
        )
        assertEquals(
            listOf(
                TeamKpiEventType.TITLE_CHANGED,
                TeamKpiEventType.DESCRIPTION_CHANGED,
                TeamKpiEventType.TYPE_CHANGED,
                TeamKpiEventType.TARGET_CHANGED,
            ),
            events.map { it.type },
        )
        assertEquals(mapOf("from" to "NUMBER", "to" to "PERCENTAGE"), events[2].params)
        assertEquals(mapOf("from" to "10.0", "to" to "80.0"), events[3].params)
    }

    @Test
    fun `a no-op definition PUT mints nothing`() {
        val events = teamKpiDefinitionUpdateEvents(
            before,
            TeamKpiDefinitionUpdate(
                title = before.title,
                description = before.description,
                type = before.type,
                targetValue = before.targetValue,
            ),
        )
        assertTrue(events.isEmpty())
    }

    @Test
    fun `params never carry title or description text`() {
        val events = teamKpiDefinitionUpdateEvents(
            before,
            TeamKpiDefinitionUpdate(
                title = "Leaky new title",
                description = "Leaky new description",
                type = before.type,
                targetValue = before.targetValue,
            ),
        )
        events.forEach { event ->
            event.params.values.forEach { assertFalse("Leaky" in it) }
        }
    }

    @Test
    fun `progress update carries the value and its date, and an exact no-op mints nothing`() {
        val event = teamKpiProgressUpdateEvent(
            before,
            TeamKpiProgressUpdate(currentValue = 7.5, date = "2026-08-01"),
        )
        assertNotNull(event)
        assertEquals(TeamKpiEventType.PROGRESS_UPDATED, event.type)
        assertEquals(mapOf("to" to "7.5", "date" to "2026-08-01"), event.params)

        // Same value + same date as the latest-dated record = exact no-op.
        assertNull(
            teamKpiProgressUpdateEvent(before, TeamKpiProgressUpdate(currentValue = 4.0, date = "2026-07-20")),
        )
    }

    @Test
    fun `re-recording the same value on a new date mints an event`() {
        val event = teamKpiProgressUpdateEvent(
            before,
            TeamKpiProgressUpdate(currentValue = 4.0, date = "2026-07-25"),
        )
        assertNotNull(event)
        assertEquals(mapOf("to" to "4.0", "date" to "2026-07-25"), event.params)
    }

    @Test
    fun `transition event carries both statuses`() {
        val event = teamKpiTransitionEvent(TeamKpiStatus.DRAFT, TeamKpiStatus.ACTIVE)
        assertEquals(TeamKpiEventType.STATUS_CHANGED, event.type)
        assertEquals(mapOf("from" to "DRAFT", "to" to "ACTIVE"), event.params)
    }

    @Test
    fun `deletion event has no params`() {
        val event = teamKpiDeletionEvent()
        assertEquals(TeamKpiEventType.DELETED, event.type)
        assertTrue(event.params.isEmpty())
    }
}
