package ch.nokillswit

import ch.nokillswit.goals.TargetDirection
import ch.nokillswit.teamkpis.TeamKpiDefinitionUpdate
import ch.nokillswit.teamkpis.TeamKpiEventType
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teamkpis.TeamKpiValueResponse
import ch.nokillswit.teamkpis.teamKpiCreationEvent
import ch.nokillswit.teamkpis.teamKpiDefinitionUpdateEvents
import ch.nokillswit.teamkpis.teamKpiDeletionEvent
import ch.nokillswit.teamkpis.teamKpiTransitionEvent
import ch.nokillswit.teamkpis.teamKpiValueCorrectedEvent
import ch.nokillswit.teamkpis.teamKpiValueRecordedEvent
import ch.nokillswit.teamkpis.teamKpiValueRemovedEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
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
        creatorId = 2u,
        creatorName = "Mona Manager",
        creatorDeleted = false,
        createdAt = 1000L,
        title = "Deploy frequency",
        description = "Secret description",
        type = TeamKpiType.NUMBER,
        targetValue = 10.0,
        targetDirection = TargetDirection.AT_LEAST,
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
    fun `a target direction flip mints TARGET_DIRECTION_CHANGED with both names`() {
        val events = teamKpiDefinitionUpdateEvents(
            before,
            TeamKpiDefinitionUpdate(
                title = "Deploy frequency",
                description = "Secret description",
                type = TeamKpiType.NUMBER,
                targetValue = 10.0,
                targetDirection = TargetDirection.AT_MOST,
            ),
        )
        assertEquals(listOf(TeamKpiEventType.TARGET_DIRECTION_CHANGED), events.map { it.type })
        assertEquals(mapOf("from" to "AT_LEAST", "to" to "AT_MOST"), events.single().params)
    }

    @Test
    fun `a recorded data point carries its date and value`() {
        val event = teamKpiValueRecordedEvent("2026-08-01", 7.5)
        assertEquals(TeamKpiEventType.VALUE_RECORDED, event.type)
        assertEquals(mapOf("date" to "2026-08-01", "value" to "7.5"), event.params)
    }

    @Test
    fun `a corrected data point always carries all four params, even for a one-dimension change`() {
        val old = TeamKpiValueResponse(id = 9u, date = "2026-07-20", value = 4.0)
        assertEquals(
            mapOf("fromDate" to "2026-07-20", "fromValue" to "4.0", "toDate" to "2026-07-25", "toValue" to "6.0"),
            teamKpiValueCorrectedEvent(old, "2026-07-25", 6.0).params,
        )
        // Only the value changed — the unchanged date still appears on both sides.
        assertEquals(
            mapOf("fromDate" to "2026-07-20", "fromValue" to "4.0", "toDate" to "2026-07-20", "toValue" to "5.5"),
            teamKpiValueCorrectedEvent(old, "2026-07-20", 5.5).params,
        )
        assertEquals(TeamKpiEventType.VALUE_CORRECTED, teamKpiValueCorrectedEvent(old, "2026-07-20", 5.5).type)
    }

    @Test
    fun `a removed data point carries its date and value`() {
        val event = teamKpiValueRemovedEvent(TeamKpiValueResponse(id = 9u, date = "2026-07-20", value = 4.0))
        assertEquals(TeamKpiEventType.VALUE_REMOVED, event.type)
        assertEquals(mapOf("date" to "2026-07-20", "value" to "4.0"), event.params)
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
