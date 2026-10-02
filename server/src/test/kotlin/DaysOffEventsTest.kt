package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffCorrectionOperation
import ch.nokillswit.daysoff.DaysOffCorrectionResponse
import ch.nokillswit.daysoff.DaysOffCorrectionWrite
import ch.nokillswit.daysoff.DaysOffEventType
import ch.nokillswit.daysoff.DaysOffResponse
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.daysoff.daysOffAllowanceChangedEvent
import ch.nokillswit.daysoff.daysOffCorrectionCreatedEvent
import ch.nokillswit.daysoff.daysOffCorrectionDeletedEvent
import ch.nokillswit.daysoff.daysOffCorrectionUpdatedEvent
import ch.nokillswit.daysoff.daysOffEntryDeletedEvent
import ch.nokillswit.daysoff.daysOffEntryRecordedEvent
import ch.nokillswit.daysoff.daysOffPoolArchivedEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pure descriptor-builder tests (no DB); the route/persistence side lives in `DaysOffEventMintingTest`. */
class DaysOffEventsTest {

    private fun entry(owner: UInt = 7u, type: DaysOffType = DaysOffType.PAID, pool: UInt? = 3u) = DaysOffResponse(
        id = 11u, userId = owner, userName = "Owner", type = type, poolTypeId = pool, poolName = pool?.let { "Parental" },
        startDate = "2085-03-03", endDate = "2085-03-04", startHalf = false, endHalf = false, days = 2.0,
        createdAt = 0L, lastModified = 0L,
    )

    private fun correction() = DaysOffCorrectionResponse(
        id = 5u, userId = 7u, authorId = 9u, authorName = "Boss", authorDeleted = false, poolTypeId = 3u,
        poolName = "Parental", year = 2085, operation = DaysOffCorrectionOperation.ADD, days = 1.5,
        comment = "SECRET REASON", createdAt = 0L, lastModified = 0L,
    )

    @Test
    fun `a self-create is recorded too, flagged onBehalf false, and keyed on the owner`() {
        val event = daysOffEntryRecordedEvent(actorId = 7u, entry = entry(owner = 7u))
        assertEquals(DaysOffEventType.ENTRY_RECORDED, event.type)
        assertEquals(7u, event.ownerId)
        assertEquals(7u, event.userId)
        assertEquals(
            mapOf(
                "requestId" to "11", "type" to "PAID", "poolTypeId" to "3", "poolName" to "Parental", "startDate" to "2085-03-03",
                "endDate" to "2085-03-04", "days" to "2.0", "onBehalf" to "false",
            ),
            event.params,
        )
    }

    @Test
    fun `a manager's recording and deletion are onBehalf and the unpaid entry carries no pool`() {
        val recorded = daysOffEntryRecordedEvent(actorId = 9u, entry = entry(type = DaysOffType.UNPAID, pool = null))
        assertEquals(7u, recorded.ownerId)
        assertEquals(9u, recorded.userId)
        assertEquals("true", recorded.params["onBehalf"])
        assertFalse("poolTypeId" in recorded.params || "poolName" in recorded.params)
        val deleted = daysOffEntryDeletedEvent(actorId = 9u, entry = entry())
        assertEquals(DaysOffEventType.ENTRY_DELETED, deleted.type)
        assertEquals("true", deleted.params["onBehalf"])
        assertEquals("11", deleted.params["requestId"])
    }

    @Test
    fun `correction events carry ids and numbers, never the encrypted comment`() {
        val created = daysOffCorrectionCreatedEvent(9u, correction())
        assertEquals(DaysOffEventType.CORRECTION_CREATED, created.type)
        assertEquals(
            mapOf(
                "correctionId" to "5", "year" to "2085", "poolTypeId" to "3", "poolName" to "Parental",
                "operation" to "ADD", "days" to "1.5",
            ),
            created.params,
        )
        val deleted = daysOffCorrectionDeletedEvent(9u, correction())
        assertEquals(created.params, deleted.params)
        val updated = daysOffCorrectionUpdatedEvent(
            9u, correction(),
            DaysOffCorrectionWrite(7u, 2086, DaysOffCorrectionOperation.SUBTRACT, 2.0, "ANOTHER SECRET"),
        )!!
        assertEquals(DaysOffEventType.CORRECTION_UPDATED, updated.type)
        assertEquals(
            mapOf(
                "correctionId" to "5", "poolTypeId" to "3", "poolName" to "Parental", "yearFrom" to "2085", "yearTo" to "2086",
                "operationFrom" to "ADD", "operationTo" to "SUBTRACT", "daysFrom" to "1.5", "daysTo" to "2.0",
            ),
            updated.params,
        )
        assertTrue(listOf(created, deleted, updated).none { e -> e.params.values.any { "SECRET" in it } })
        // Change-only: a comment-only edit or an idempotent re-PUT mints nothing.
        assertNull(
            daysOffCorrectionUpdatedEvent(
                9u, correction(),
                DaysOffCorrectionWrite(7u, 2085, DaysOffCorrectionOperation.ADD, 1.5, "A NEW COMMENT"),
            ),
        )
    }

    @Test
    fun `allowance and pool events`() {
        val fresh = daysOffAllowanceChangedEvent(9u, 7u, poolTypeId = 3u, poolName = "Parental", from = null, to = 5)
        assertEquals(DaysOffEventType.ALLOWANCE_CHANGED, fresh.type)
        assertEquals(7u, fresh.ownerId)
        assertEquals(mapOf("poolTypeId" to "3", "poolName" to "Parental", "to" to "5"), fresh.params)
        assertEquals(
            mapOf("poolTypeId" to "3", "poolName" to "Parental", "from" to "5", "to" to "7"),
            daysOffAllowanceChangedEvent(9u, 7u, 3u, "Parental", 5, 7).params,
        )
        val archived = daysOffPoolArchivedEvent(9u, 7u, poolId = 4u, poolTypeId = 3u, poolName = "Parental", allowance = 5)
        assertEquals(DaysOffEventType.POOL_ARCHIVED, archived.type)
        assertEquals(
            mapOf("poolId" to "4", "poolTypeId" to "3", "poolName" to "Parental", "allowance" to "5"),
            archived.params,
        )
    }
}
