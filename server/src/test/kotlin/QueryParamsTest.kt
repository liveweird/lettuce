package ch.nokillswit

import ch.nokillswit.infra.paging.MAX_FILTER_VALUES
import ch.nokillswit.infra.paging.optionalEnumSet
import ch.nokillswit.infra.paging.optionalString
import ch.nokillswit.infra.paging.optionalUIntSet
import io.ktor.http.Parameters
import io.ktor.server.plugins.BadRequestException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

/** Direct tests of the repeated-key `IN` helpers (infra/paging/QueryParams.kt, API-LIST-004). */
class QueryParamsTest {

    private enum class Color { RED, GREEN }

    private fun params(vararg pairs: Pair<String, String>) = Parameters.build {
        pairs.forEach { (k, v) -> append(k, v) }
    }

    @Test
    fun `an absent or all-blank key is no filter`() {
        assertNull(params().optionalUIntSet("teamId"))
        assertNull(params("teamId" to "", "teamId" to "  ").optionalUIntSet("teamId"))
        assertNull(params().optionalEnumSet<Color>("c"))
    }

    @Test
    fun `a single value parses to a one-element set`() {
        assertEquals(setOf(3u), params("teamId" to "3").optionalUIntSet("teamId"))
        assertEquals(setOf(Color.RED), params("c" to "RED").optionalEnumSet<Color>("c"))
    }

    @Test
    fun `repeated values are unioned, deduplicated and blank ones dropped`() {
        assertEquals(
            setOf(1u, 2u),
            params("teamId" to "1", "teamId" to "", "teamId" to "2", "teamId" to "1").optionalUIntSet("teamId"),
        )
        assertEquals(
            setOf(Color.RED, Color.GREEN),
            params("c" to "GREEN", "c" to "RED", "c" to "GREEN").optionalEnumSet<Color>("c"),
        )
    }

    @Test
    fun `an invalid value is a 400 with the scalar helpers' wording`() {
        val uint = assertFailsWith<BadRequestException> { params("teamId" to "1", "teamId" to "abc").optionalUIntSet("teamId") }
        assertEquals("Invalid teamId: abc", uint.message)
        assertFailsWith<BadRequestException> { params("teamId" to "-1").optionalUIntSet("teamId") }
        val enum = assertFailsWith<BadRequestException> { params("c" to "RED", "c" to "BLUE").optionalEnumSet<Color>("c") }
        assertEquals("Unknown c: BLUE (allowed: RED, GREEN)", enum.message)
    }

    @Test
    fun `the cap counts distinct values - 100 pass, 101 fail, duplicates do not count`() {
        val hundred = (1..MAX_FILTER_VALUES).map { "teamId" to it.toString() }.toTypedArray()
        assertEquals(MAX_FILTER_VALUES, params(*hundred).optionalUIntSet("teamId")?.size)
        // Repeating an already-seen value is free: still 100 distinct.
        assertEquals(MAX_FILTER_VALUES, params(*hundred, "teamId" to "1").optionalUIntSet("teamId")?.size)
        val tooMany = assertFailsWith<BadRequestException> {
            params(*hundred, "teamId" to "${MAX_FILTER_VALUES + 1}").optionalUIntSet("teamId")
        }
        assertEquals("Parameter 'teamId' accepts at most 100 values", tooMany.message)
    }

    @Test
    fun `every other helper keeps rejecting a repeated key`() {
        val e = assertFailsWith<BadRequestException> { params("x" to "1", "x" to "2").optionalString("x") }
        assertEquals("Parameter 'x' must not be repeated", e.message)
    }
}
