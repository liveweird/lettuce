package ch.nokillswit

import ch.nokillswit.goals.GoalDefinitionUpdate
import ch.nokillswit.goals.GoalEventType
import ch.nokillswit.goals.GoalMilestoneDone
import ch.nokillswit.goals.GoalMilestoneInput
import ch.nokillswit.goals.GoalMilestoneResponse
import ch.nokillswit.goals.GoalProgressUpdate
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.goals.goalCreationEvent
import ch.nokillswit.goals.goalDefinitionUpdateEvents
import ch.nokillswit.goals.goalDeletionEvent
import ch.nokillswit.goals.goalProgressUpdateEvents
import ch.nokillswit.goals.goalTransitionEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Pure descriptor-builder tests (no DB); the route/persistence side lives in GoalRoutesTest. */
class GoalEventsTest {

    private fun goal(
        title: String = "Ship the migration",
        description: String = "Secret description",
        type: GoalType = GoalType.NUMBER,
        targetValue: Double? = 10.0,
        currentValue: Double? = 0.0,
        milestones: List<GoalMilestoneResponse> = emptyList(),
        status: GoalStatus = GoalStatus.DRAFT,
        summary: String? = null,
        dueDate: String = "2099-12-31",
    ) = GoalResponse(
        id = 1u, managerId = 2u, subordinateId = 3u, createdAt = 0L, dueDate = dueDate,
        title = title, description = description, type = type,
        targetValue = targetValue, currentValue = currentValue, milestones = milestones,
        status = status, summary = summary, lastModified = 0L,
        managerName = "Manager", subordinateName = "Subordinate",
    )

    // A PLAN goal fixture with three stored milestones (ids 11..13, stored order).
    private fun planGoal(
        first: Boolean = false,
        second: Boolean = false,
        third: Boolean = false,
        status: GoalStatus = GoalStatus.ACTIVE,
    ) = goal(
        type = GoalType.PLAN, targetValue = null, currentValue = null, status = status,
        milestones = listOf(
            GoalMilestoneResponse(11u, "Draft the design", first),
            GoalMilestoneResponse(12u, "Build it", second),
            GoalMilestoneResponse(13u, "Ship it", third),
        ),
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
    fun `a target change to or from PLAN uses an empty string for the missing side`() {
        val toPlan = goalDefinitionUpdateEvents(
            goal(),
            GoalDefinitionUpdate(
                title = "Ship the migration",
                description = "Secret description",
                type = GoalType.PLAN,
                targetValue = null,
                dueDate = "2099-12-31",
            ),
        )
        val target = toPlan.single { it.type == GoalEventType.TARGET_CHANGED }
        assertEquals(mapOf("from" to "10.0", "to" to ""), target.params)
    }

    @Test
    fun `milestone definition diff yields removed then edited then added, by 1-based position`() {
        val before = planGoal(status = GoalStatus.DRAFT)
        // Remove "Build it" (stored position 2), rename "Ship it" (now payload position 2),
        // append a new milestone (payload position 3).
        val events = goalDefinitionUpdateEvents(
            before,
            GoalDefinitionUpdate(
                title = before.title,
                description = before.description,
                type = GoalType.PLAN,
                targetValue = null,
                milestones = listOf(
                    GoalMilestoneInput(id = 11u, description = "Draft the design"),
                    GoalMilestoneInput(id = 13u, description = "Ship it to prod"),
                    GoalMilestoneInput(description = "Celebrate"),
                ),
                dueDate = before.dueDate,
            ),
        )
        assertEquals(
            listOf(
                GoalEventType.MILESTONE_REMOVED to mapOf("position" to "2"),
                GoalEventType.MILESTONE_EDITED to mapOf("position" to "2"),
                GoalEventType.MILESTONE_ADDED to mapOf("position" to "3"),
            ),
            events.map { it.type to it.params },
        )
    }

    @Test
    fun `a pure milestone reorder yields no events`() {
        val before = planGoal(status = GoalStatus.DRAFT)
        val events = goalDefinitionUpdateEvents(
            before,
            GoalDefinitionUpdate(
                title = before.title,
                description = before.description,
                type = GoalType.PLAN,
                targetValue = null,
                milestones = listOf(
                    GoalMilestoneInput(id = 13u, description = "Ship it"),
                    GoalMilestoneInput(id = 11u, description = "Draft the design"),
                    GoalMilestoneInput(id = 12u, description = "Build it"),
                ),
                dueDate = before.dueDate,
            ),
        )
        assertTrue(events.isEmpty())
    }

    @Test
    fun `a type change away from PLAN narrates the milestone reset as removals`() {
        val before = planGoal(status = GoalStatus.DRAFT)
        val events = goalDefinitionUpdateEvents(
            before,
            GoalDefinitionUpdate(
                title = before.title,
                description = before.description,
                type = GoalType.NUMBER,
                targetValue = 10.0,
                milestones = emptyList(),
                dueDate = before.dueDate,
            ),
        )
        assertEquals(
            listOf(
                GoalEventType.TYPE_CHANGED,
                GoalEventType.TARGET_CHANGED,
                GoalEventType.MILESTONE_REMOVED,
                GoalEventType.MILESTONE_REMOVED,
                GoalEventType.MILESTONE_REMOVED,
            ),
            events.map { it.type },
        )
        assertEquals(
            listOf("1", "2", "3"),
            events.filter { it.type == GoalEventType.MILESTONE_REMOVED }.map { it.params["position"] },
        )
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
        val events = goalProgressUpdateEvents(before, GoalProgressUpdate(currentValue = 7.5))
        assertEquals(GoalEventType.PROGRESS_UPDATED, events.single().type)
        assertEquals(mapOf("from" to "2.5", "to" to "7.5"), events.single().params)
    }

    @Test
    fun `the first progress update on a valueless goal reports an empty from side`() {
        // v2.8.1: a fresh goal has no recorded value — "" is the "no value" convention (the
        // TARGET_CHANGED empty-side precedent).
        val before = goal(status = GoalStatus.ACTIVE, currentValue = null)
        val events = goalProgressUpdateEvents(before, GoalProgressUpdate(currentValue = 7.5))
        assertEquals(GoalEventType.PROGRESS_UPDATED, events.single().type)
        assertEquals(mapOf("from" to "", "to" to "7.5"), events.single().params)
    }

    @Test
    fun `milestone toggles yield one event per flipped flag, by 1-based stored position`() {
        // Tick the first and third, un-tick the second — the untouched sent flags mint nothing.
        val before = planGoal(second = true)
        val events = goalProgressUpdateEvents(
            before,
            GoalProgressUpdate(
                milestones = listOf(
                    GoalMilestoneDone(11u, true),
                    GoalMilestoneDone(12u, false),
                    GoalMilestoneDone(13u, true),
                ),
            ),
        )
        assertEquals(
            listOf(
                GoalEventType.MILESTONE_COMPLETED to mapOf("position" to "1"),
                GoalEventType.MILESTONE_REOPENED to mapOf("position" to "2"),
                GoalEventType.MILESTONE_COMPLETED to mapOf("position" to "3"),
            ),
            events.map { it.type to it.params },
        )
    }

    @Test
    fun `a no-op progress update yields no events`() {
        assertTrue(goalProgressUpdateEvents(goal(currentValue = 5.0), GoalProgressUpdate(currentValue = 5.0)).isEmpty())
        assertTrue(
            goalProgressUpdateEvents(
                planGoal(first = true),
                GoalProgressUpdate(
                    milestones = listOf(
                        GoalMilestoneDone(11u, true),
                        GoalMilestoneDone(12u, false),
                        GoalMilestoneDone(13u, false),
                    ),
                ),
            ).isEmpty(),
        )
        // A blank comment counts as absent — still a no-op.
        assertTrue(
            goalProgressUpdateEvents(goal(currentValue = 5.0), GoalProgressUpdate(currentValue = 5.0, comment = "  "))
                .isEmpty(),
        )
    }

    @Test
    fun `a comment-only update yields PROGRESS_COMMENTED with content-free params`() {
        val events = goalProgressUpdateEvents(
            goal(status = GoalStatus.ACTIVE, currentValue = 5.0),
            GoalProgressUpdate(currentValue = 5.0, comment = "Blocked on the vendor"),
        )
        assertEquals(GoalEventType.PROGRESS_COMMENTED, events.single().type)
        // The comment text never enters the plaintext params (it rides the encrypted column).
        assertEquals(emptyMap(), events.single().params)
    }

    @Test
    fun `a state change with a comment yields no extra PROGRESS_COMMENTED event`() {
        val numeric = goalProgressUpdateEvents(
            goal(status = GoalStatus.ACTIVE, currentValue = 2.5),
            GoalProgressUpdate(currentValue = 7.5, comment = "Two modules landed"),
        )
        assertEquals(listOf(GoalEventType.PROGRESS_UPDATED), numeric.map { it.type })
        assertEquals(mapOf("from" to "2.5", "to" to "7.5"), numeric.single().params)
        val plan = goalProgressUpdateEvents(
            planGoal(),
            GoalProgressUpdate(
                milestones = listOf(
                    GoalMilestoneDone(11u, true),
                    GoalMilestoneDone(12u, false),
                    GoalMilestoneDone(13u, false),
                ),
                comment = "First step done",
            ),
        )
        assertEquals(listOf(GoalEventType.MILESTONE_COMPLETED), plan.map { it.type })
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
