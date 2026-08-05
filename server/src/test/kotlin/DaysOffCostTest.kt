package ch.nokillswit

import ch.nokillswit.daysoff.daysOffCostHalfDays
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The working-day cost function (half-day integer units). Fixed anchor week: Mon 2026-01-05 …
 * Sun 2026-01-11 (2026-01-01 is a Thursday).
 */
class DaysOffCostTest {

    private val mon = LocalDate.of(2026, 1, 5)
    private val tue = LocalDate.of(2026, 1, 6)
    private val wed = LocalDate.of(2026, 1, 7)
    private val fri = LocalDate.of(2026, 1, 9)
    private val sat = LocalDate.of(2026, 1, 10)
    private val sun = LocalDate.of(2026, 1, 11)
    private val nextMon = LocalDate.of(2026, 1, 12)

    private fun cost(
        start: LocalDate,
        end: LocalDate,
        startHalf: Boolean = false,
        endHalf: Boolean = false,
        holidays: Set<LocalDate> = emptySet(),
    ) = daysOffCostHalfDays(start, end, startHalf, endHalf, holidays)

    @Test
    fun `a full working week costs five days`() {
        assertEquals(10, cost(mon, fri))
    }

    @Test
    fun `weekends inside the period cost nothing`() {
        // Fri..next Mon = Fri + Mon.
        assertEquals(4, cost(fri, nextMon))
        // A weekend-only period costs zero.
        assertEquals(0, cost(sat, sun))
    }

    @Test
    fun `public holidays inside the period cost nothing`() {
        assertEquals(8, cost(mon, fri, holidays = setOf(wed)))
        // A holiday on a weekend changes nothing.
        assertEquals(4, cost(fri, nextMon, holidays = setOf(sat)))
        // A period made only of a holiday costs zero.
        assertEquals(0, cost(wed, wed, holidays = setOf(wed)))
    }

    @Test
    fun `single-day requests cost one or half a day`() {
        assertEquals(2, cost(mon, mon))
        assertEquals(1, cost(mon, mon, startHalf = true))
    }

    @Test
    fun `edge halves subtract only on counted working days`() {
        // Both halves on a two-day range: 2 + 2 - 1 - 1.
        assertEquals(2, cost(mon, tue, startHalf = true, endHalf = true))
        // startHalf on a Saturday edge subtracts nothing — the day already costs zero.
        assertEquals(2, cost(sat, nextMon, startHalf = true))
        // endHalf on the counted Monday still works from the same period.
        assertEquals(1, cost(sat, nextMon, endHalf = true))
        // startHalf on a holiday edge subtracts nothing either.
        assertEquals(2, cost(wed, LocalDate.of(2026, 1, 8), startHalf = true, holidays = setOf(wed)))
    }

    @Test
    fun `a leap February iterates all 29 days`() {
        // Feb 2028 (leap): starts Tue 02-01, 8 weekend days -> 21 working days.
        assertEquals(42, cost(LocalDate.of(2028, 2, 1), LocalDate.of(2028, 2, 29)))
    }
}
