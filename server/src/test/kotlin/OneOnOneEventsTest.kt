package ch.nokillswit

import ch.nokillswit.oneonones.ActionItemOwner
import ch.nokillswit.oneonones.OneOnOneActionItemInput
import ch.nokillswit.oneonones.OneOnOneActionItemResponse
import ch.nokillswit.oneonones.OneOnOneEventType
import ch.nokillswit.oneonones.OneOnOneItemInput
import ch.nokillswit.oneonones.OneOnOneItemResponse
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.oneonones.OneOnOneUpdateRequest
import ch.nokillswit.oneonones.oneOnOneCreationEvent
import ch.nokillswit.oneonones.oneOnOneDeletionEvent
import ch.nokillswit.oneonones.oneOnOneUpdateEvents
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Pure unit tests for the 1:1 meeting event descriptors — the per-item diff builder in
 * particular (no DB; the route-level persistence is covered by OneOnOneRoutesTest).
 */
class OneOnOneEventsTest {

    private fun doc(
        meetingDate: String = "2026-07-01",
        points: List<OneOnOneItemResponse> = emptyList(),
        decisions: List<OneOnOneItemResponse> = emptyList(),
        actionItems: List<OneOnOneActionItemResponse> = emptyList(),
    ) = OneOnOneResponse(
        id = 1u, managerId = 10u, managerName = "Mia", subordinateId = 20u, subordinateName = "Sam",
        meetingDate = meetingDate, lastModified = 0L,
        points = points, decisions = decisions, actionItems = actionItems,
    )

    private fun update(
        meetingDate: String = "2026-07-01",
        points: List<OneOnOneItemInput> = emptyList(),
        decisions: List<OneOnOneItemInput> = emptyList(),
        actionItems: List<OneOnOneActionItemInput> = emptyList(),
    ) = OneOnOneUpdateRequest(meetingDate, points, decisions, actionItems)

    private fun item(id: UInt, content: String) = OneOnOneItemResponse(id, content)

    private fun action(
        id: UInt,
        content: String = "do it",
        owner: ActionItemOwner = ActionItemOwner.MANAGER,
        dueDate: String? = null,
        resolved: Boolean = false,
    ) = OneOnOneActionItemResponse(id, content, owner, dueDate, resolved, copiedFromId = null)

    @Test
    fun `creation descriptor carries the date and carry-over count`() {
        val descriptor = oneOnOneCreationEvent("2026-07-01", carriedOver = 3)
        assertEquals(OneOnOneEventType.CREATED, descriptor.type)
        assertEquals(mapOf("date" to "2026-07-01", "carriedOver" to "3"), descriptor.params)
    }

    @Test
    fun `deletion descriptor carries no params`() {
        val descriptor = oneOnOneDeletionEvent()
        assertEquals(OneOnOneEventType.DELETED, descriptor.type)
        assertTrue(descriptor.params.isEmpty())
    }

    @Test
    fun `a no-op replace yields no events`() {
        val before = doc(
            points = listOf(item(1u, "a"), item(2u, "b")),
            decisions = listOf(item(3u, "c")),
            actionItems = listOf(action(4u)),
        )
        val after = update(
            points = listOf(OneOnOneItemInput(1u, "a"), OneOnOneItemInput(2u, "b")),
            decisions = listOf(OneOnOneItemInput(3u, "c")),
            actionItems = listOf(OneOnOneActionItemInput(4u, "do it", ActionItemOwner.MANAGER)),
        )
        assertEquals(emptyList(), oneOnOneUpdateEvents(before, after))
    }

    @Test
    fun `pure reordering yields no events`() {
        val before = doc(points = listOf(item(1u, "a"), item(2u, "b"), item(3u, "c")))
        val after = update(
            points = listOf(OneOnOneItemInput(3u, "c"), OneOnOneItemInput(1u, "a"), OneOnOneItemInput(2u, "b")),
        )
        assertEquals(emptyList(), oneOnOneUpdateEvents(before, after))
    }

    @Test
    fun `date change reports from and to`() {
        val events = oneOnOneUpdateEvents(doc(meetingDate = "2026-07-01"), update(meetingDate = "2026-07-02"))
        assertEquals(1, events.size)
        assertEquals(OneOnOneEventType.DATE_CHANGED, events.single().type)
        assertEquals(mapOf("from" to "2026-07-01", "to" to "2026-07-02"), events.single().params)
    }

    @Test
    fun `note add, edit, and remove report 1-based positions`() {
        val before = doc(points = listOf(item(1u, "keep"), item(2u, "drop"), item(3u, "revise")))
        val after = update(
            points = listOf(
                OneOnOneItemInput(1u, "keep"),
                OneOnOneItemInput(3u, "revised"),
                OneOnOneItemInput(content = "brand new"),
            ),
        )
        val events = oneOnOneUpdateEvents(before, after)
        // Removed cites the OLD position, edited/added the NEW; removed → edited → added.
        assertEquals(
            listOf(
                OneOnOneEventType.POINT_REMOVED to "2",
                OneOnOneEventType.POINT_EDITED to "2",
                OneOnOneEventType.POINT_ADDED to "3",
            ),
            events.map { it.type to it.params["position"] },
        )
    }

    @Test
    fun `decisions diff independently of points`() {
        val before = doc(
            points = listOf(item(1u, "p")),
            decisions = listOf(item(2u, "d")),
        )
        val after = update(
            points = listOf(OneOnOneItemInput(1u, "p")),
            decisions = listOf(OneOnOneItemInput(2u, "d"), OneOnOneItemInput(content = "new decision")),
        )
        val events = oneOnOneUpdateEvents(before, after)
        assertEquals(listOf(OneOnOneEventType.DECISION_ADDED), events.map { it.type })
        assertEquals("2", events.single().params["position"])
    }

    @Test
    fun `action item resolve and unresolve are distinct events`() {
        val before = doc(actionItems = listOf(action(1u, resolved = false), action(2u, resolved = true)))
        val after = update(
            actionItems = listOf(
                OneOnOneActionItemInput(1u, "do it", ActionItemOwner.MANAGER, resolved = true),
                OneOnOneActionItemInput(2u, "do it", ActionItemOwner.MANAGER, resolved = false),
            ),
        )
        val events = oneOnOneUpdateEvents(before, after)
        assertEquals(
            listOf(
                OneOnOneEventType.ACTION_ITEM_RESOLVED to "1",
                OneOnOneEventType.ACTION_ITEM_UNRESOLVED to "2",
            ),
            events.map { it.type to it.params["position"] },
        )
    }

    @Test
    fun `due date set, changed, and cleared use empty string for the unset side`() {
        val before = doc(
            actionItems = listOf(
                action(1u, dueDate = null),
                action(2u, dueDate = "2026-07-10"),
                action(3u, dueDate = "2026-07-15"),
            ),
        )
        val after = update(
            actionItems = listOf(
                OneOnOneActionItemInput(1u, "do it", ActionItemOwner.MANAGER, dueDate = "2026-08-01"),
                OneOnOneActionItemInput(2u, "do it", ActionItemOwner.MANAGER, dueDate = "2026-07-11"),
                OneOnOneActionItemInput(3u, "do it", ActionItemOwner.MANAGER, dueDate = null),
            ),
        )
        val events = oneOnOneUpdateEvents(before, after)
        assertEquals(
            listOf(
                mapOf("position" to "1", "from" to "", "to" to "2026-08-01"),
                mapOf("position" to "2", "from" to "2026-07-10", "to" to "2026-07-11"),
                mapOf("position" to "3", "from" to "2026-07-15", "to" to ""),
            ),
            events.map { it.params },
        )
        assertTrue(events.all { it.type == OneOnOneEventType.ACTION_ITEM_DUE_DATE_CHANGED })
    }

    @Test
    fun `owner change reports enum names`() {
        val before = doc(actionItems = listOf(action(1u, owner = ActionItemOwner.MANAGER)))
        val after = update(
            actionItems = listOf(OneOnOneActionItemInput(1u, "do it", ActionItemOwner.SUBORDINATE)),
        )
        val events = oneOnOneUpdateEvents(before, after)
        assertEquals(OneOnOneEventType.ACTION_ITEM_OWNER_CHANGED, events.single().type)
        assertEquals(
            mapOf("position" to "1", "from" to "MANAGER", "to" to "SUBORDINATE"),
            events.single().params,
        )
    }

    @Test
    fun `a multi-aspect action item edit yields one event per changed aspect`() {
        val before = doc(actionItems = listOf(action(1u, content = "old", dueDate = null, resolved = false)))
        val after = update(
            actionItems = listOf(
                OneOnOneActionItemInput(
                    1u, "new", ActionItemOwner.SUBORDINATE, dueDate = "2026-09-01", resolved = true,
                ),
            ),
        )
        val events = oneOnOneUpdateEvents(before, after)
        assertEquals(
            listOf(
                OneOnOneEventType.ACTION_ITEM_EDITED,
                OneOnOneEventType.ACTION_ITEM_RESOLVED,
                OneOnOneEventType.ACTION_ITEM_DUE_DATE_CHANGED,
                OneOnOneEventType.ACTION_ITEM_OWNER_CHANGED,
            ),
            events.map { it.type },
        )
    }

    @Test
    fun `sections diff in deterministic order - date, points, decisions, action items`() {
        val before = doc(
            meetingDate = "2026-07-01",
            points = listOf(item(1u, "p")),
            decisions = listOf(item(2u, "d")),
            actionItems = listOf(action(3u)),
        )
        val after = update(
            meetingDate = "2026-07-02",
            points = emptyList(),
            decisions = listOf(OneOnOneItemInput(2u, "d2")),
            actionItems = listOf(
                OneOnOneActionItemInput(3u, "do it", ActionItemOwner.MANAGER),
                OneOnOneActionItemInput(content = "extra", owner = ActionItemOwner.MANAGER),
            ),
        )
        assertEquals(
            listOf(
                OneOnOneEventType.DATE_CHANGED,
                OneOnOneEventType.POINT_REMOVED,
                OneOnOneEventType.DECISION_EDITED,
                OneOnOneEventType.ACTION_ITEM_ADDED,
            ),
            oneOnOneUpdateEvents(before, after).map { it.type },
        )
    }

    @Test
    fun `no event params ever carry item text`() {
        val secret = "SECRET-CONTENT-MUST-NOT-LEAK"
        val before = doc(
            points = listOf(item(1u, secret)),
            actionItems = listOf(action(2u, content = secret)),
        )
        val after = update(
            points = listOf(OneOnOneItemInput(content = "$secret v2")),
            actionItems = listOf(
                OneOnOneActionItemInput(2u, "$secret v3", ActionItemOwner.SUBORDINATE, "2026-09-09", true),
            ),
        )
        val events = oneOnOneUpdateEvents(before, after)
        assertTrue(events.isNotEmpty())
        events.flatMap { it.params.values }.forEach { value ->
            assertTrue("SECRET" !in value, "event params leaked content: $value")
        }
    }
}
