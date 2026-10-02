package ch.nokillswit

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.users.CareerPositionEventType
import ch.nokillswit.users.CareerPositionService.PositionRow
import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.careerPositionCreatedEvent
import ch.nokillswit.users.careerPositionDeletedEvent
import ch.nokillswit.users.careerPositionUpdatedEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/** Pure descriptor-builder tests (no DB); the route/persistence side lives in `CareerPositionEventMintingTest`. */
class CareerPositionEventsTest {

    private val entries = mapOf(
        10u to DictionaryEntry(10u, mapOf("en" to "Engineering", "pl" to "Inżynieria")),
        11u to DictionaryEntry(11u, mapOf("en" to "Backend")),
        12u to DictionaryEntry(12u, mapOf("en" to "Senior")),
        13u to DictionaryEntry(13u, mapOf("en" to "Staff")),
    )

    private fun row(
        path: UInt? = 10u,
        spec: UInt? = 11u,
        level: UInt? = 12u,
        start: String = "2024-01-01",
    ) = PositionRow(
        id = 5u, userId = 7u, startDate = start, endDate = null,
        careerPathId = path, careerSpecializationId = spec, seniorityLevelId = level, createdAt = 0L, lastModified = 0L,
    )

    @Test
    fun `a created position carries its ids and the frozen default-language names, keyed on the owner`() {
        val event = careerPositionCreatedEvent(9u, 7u, 5u, CareerPositionWrite("2024-01-01", 10u, 11u, 12u), entries)
        assertEquals(CareerPositionEventType.POSITION_CREATED, event.type)
        assertEquals(7u, event.ownerId)
        assertEquals(9u, event.userId)
        assertEquals(
            mapOf(
                "positionId" to "5", "startDate" to "2024-01-01",
                "careerPath" to "10", "careerPathName" to "Engineering",
                "careerSpecialization" to "11", "careerSpecializationName" to "Backend",
                "seniorityLevel" to "12", "seniorityLevelName" to "Senior",
            ),
            event.params,
        )
        // An unset ref is simply absent.
        val partial = careerPositionCreatedEvent(9u, 7u, 5u, CareerPositionWrite("2024-01-01", 10u, null, null), entries)
        assertEquals(setOf("positionId", "startDate", "careerPath", "careerPathName"), partial.params.keys)
    }

    @Test
    fun `a deleted position carries the row it removed`() {
        val event = careerPositionDeletedEvent(9u, row(), entries)
        assertEquals(CareerPositionEventType.POSITION_DELETED, event.type)
        assertEquals(7u, event.ownerId)
        assertEquals("Senior", event.params["seniorityLevelName"])
        assertEquals("5", event.params["positionId"])
    }

    @Test
    fun `an update carries only the changed aspects as from-to with frozen names, and no-ops mint nothing`() {
        val event = careerPositionUpdatedEvent(
            9u, row(), CareerPositionWrite("2023-06-01", 10u, 11u, 13u), entries,
        )!!
        assertEquals(CareerPositionEventType.POSITION_UPDATED, event.type)
        assertEquals(
            mapOf(
                "positionId" to "5", "startDate" to "2023-06-01",
                "startDateFrom" to "2024-01-01", "startDateTo" to "2023-06-01",
                "seniorityLevelFrom" to "12", "seniorityLevelFromName" to "Senior",
                "seniorityLevelTo" to "13", "seniorityLevelToName" to "Staff",
            ),
            event.params,
        )
        // A cleared ref has no To; a newly set one no From.
        val cleared = careerPositionUpdatedEvent(9u, row(), CareerPositionWrite("2024-01-01", 10u, null, 12u), entries)!!
        assertEquals("11", cleared.params["careerSpecializationFrom"])
        assertNull(cleared.params["careerSpecializationTo"])
        // Unchanged → null.
        assertNull(careerPositionUpdatedEvent(9u, row(), CareerPositionWrite("2024-01-01", 10u, 11u, 12u), entries))
    }
}
