package ch.nokillswit

import ch.nokillswit.goals.GoalDefinitionUpdate
import ch.nokillswit.goals.GoalEventType
import ch.nokillswit.goals.GoalProgressUpdate
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.goals.goalCreationEvent
import ch.nokillswit.goals.goalDefinitionUpdateEvents
import ch.nokillswit.goals.goalDeletionEvent
import ch.nokillswit.goals.goalProgressUpdateEvent
import ch.nokillswit.goals.goalTransitionEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pure descriptor-builder tests (no DB); the route/persistence side lives in GoalRoutesTest. */
class GoalEventsTest {

    private fun goal(
        title: String = "Ship the migration",
        description: String = "Secret description",
        type: GoalType = GoalType.NUMBER,
        targetValue: Double? = 10.0,
        currentValue: Double? = 0.0,
        achieved: Boolean? = null,
        status: GoalStatus = GoalStatus.DRAFT,
        summary: String? = null,
        dueDate: String = "2099-12-31",
    ) = GoalResponse(
        id = 1u, managerId = 2u, subordinateId = 3u, createdAt = 0L, dueDate = dueDate,
        title = title, description = description, type = type,
        targetValue = targetValue, currentValue = currentValue, achieved = achieved,
        status = status, summary = summary, lastModified = 0L,
        managerName = "Manager", subordinateName = "Subordinate",
    )

    @Test
    fun `creation descriptor carries the goal type`() {
        val event = goalCreationEvent(GoalType.PERCENTAGE)
        assertEquals(GoalEventType.CREATED, event.type)
        assertEquals(mapOf("type" to "PERCENTAGE"), event.params)
    }

    @Test
    fun `definition update yields one event per changed aspect, in stable order`() {
        val before = goal()
        val events = goalDefinitionUpdateEvents(
            before,
            GoalDefinitionUpdate(
                title = "New title",
                description = "New description",
                type = GoalType.PERCENTAGE,
                targetValue = 80.0,
                dueDate = "2100-06-15",
            ),
        )
        assertEquals(
            listOf(
                GoalEventType.TITLE_CHANGED,
                GoalEventType.DESCRIPTION_CHANGED,
                GoalEventType.TYPE_CHANGED,
                GoalEventType.TARGET_CHANGED,
                GoalEventType.DUE_DATE_CHANGED,
            ),
            events.map { it.type },
        )
        assertEquals(mapOf("from" to "NUMBER", "to" to "PERCENTAGE"), events[2].params)
        assertEquals(mapOf("from" to "10.0", "to" to "80.0"), events[3].params)
        assertEquals(mapOf("from" to "2099-12-31", "to" to "2100-06-15"), events[4].params)
    }

    @Test
    fun `a no-op definition update yields no events`() {
        val before = goal()
        val events = goalDefinitionUpdateEvents(
            before,
            GoalDefinitionUpdate(
                title = before.title,
                description = before.description,
                type = before.type,
                targetValue = before.targetValue,
                dueDate = before.dueDate,
            ),
        )
        assertTrue(events.isEmpty())
    }

    @Test
    fun `a target change to or from BINARY uses an empty string for the missing side`() {
        val toBinary = goalDefinitionUpdateEvents(
            goal(),
            GoalDefinitionUpdate(
                title = "Ship the migration",
                description = "Secret description",
                type = GoalType.BINARY,
                targetValue = null,
                dueDate = "2099-12-31",
            ),
        )
        val target = toBinary.single { it.type == GoalEventType.TARGET_CHANGED }
        assertEquals(mapOf("from" to "10.0", "to" to ""), target.params)
    }

    @Test
    fun `definition update params never contain the title or description text`() {
        val events = goalDefinitionUpdateEvents(
            goal(),
            GoalDefinitionUpdate(
                title = "Brand-new title",
                description = "Brand-new description",
                type = GoalType.NUMBER,
                targetValue = 10.0,
                dueDate = "2099-12-31",
            ),
        )
        events.flatMap { it.params.values }.forEach { value ->
            assertTrue("title" !in value.lowercase() && "description" !in value.lowercase())
        }
        assertEquals(emptyMap(), events.single { it.type == GoalEventType.TITLE_CHANGED }.params)
        assertEquals(emptyMap(), events.single { it.type == GoalEventType.DESCRIPTION_CHANGED }.params)
    }

    @Test
    fun `progress update reports the numeric change with from and to`() {
        val before = goal(status = GoalStatus.ACTIVE, currentValue = 2.5)
        val event = goalProgressUpdateEvent(before, GoalProgressUpdate(currentValue = 7.5))
        assertEquals(GoalEventType.PROGRESS_UPDATED, event?.type)
        assertEquals(mapOf("from" to "2.5", "to" to "7.5"), event?.params)
    }

    @Test
    fun `progress update on a BINARY goal reports the achieved flip`() {
        val before = goal(
            type = GoalType.BINARY, targetValue = null, currentValue = null,
            achieved = false, status = GoalStatus.ACTIVE,
        )
        val event = goalProgressUpdateEvent(before, GoalProgressUpdate(achieved = true))
        assertEquals(GoalEventType.ACHIEVED_CHANGED, event?.type)
        assertEquals(mapOf("to" to "true"), event?.params)
    }

    @Test
    fun `a no-op progress update yields no event`() {
        assertNull(goalProgressUpdateEvent(goal(currentValue = 5.0), GoalProgressUpdate(currentValue = 5.0)))
        assertNull(
            goalProgressUpdateEvent(
                goal(type = GoalType.BINARY, targetValue = null, currentValue = null, achieved = true),
                GoalProgressUpdate(achieved = true),
            ),
        )
    }

    @Test
    fun `transition descriptor carries both statuses`() {
        val event = goalTransitionEvent(GoalStatus.ACTIVE, GoalStatus.ARCHIVED)
        assertEquals(GoalEventType.STATUS_CHANGED, event.type)
        assertEquals(mapOf("from" to "ACTIVE", "to" to "ARCHIVED"), event.params)
    }

    @Test
    fun `deletion descriptor has no params`() {
        val event = goalDeletionEvent()
        assertEquals(GoalEventType.DELETED, event.type)
        assertEquals(emptyMap(), event.params)
    }
}
