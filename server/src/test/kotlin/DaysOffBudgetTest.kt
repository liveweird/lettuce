package ch.nokillswit

import ch.nokillswit.daysoff.carriedOverHalfDays
import ch.nokillswit.daysoff.remainingHalfDays
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * The closed-form carry-over math (half-day units). `usedByYear` maps year → summed counting
 * (REQUESTED/ACCEPTED) PAID cost; the anchor is the earliest key (or the target year).
 */
class DaysOffBudgetTest {

    @Test
    fun `a user with no history has exactly this year's allowance`() {
        assertEquals(20, remainingHalfDays(10, 2030, emptyMap()))
        assertEquals(0, carriedOverHalfDays(10, 2030, emptyMap()))
    }

    @Test
    fun `null allowance means zero budget`() {
        assertEquals(0, remainingHalfDays(null, 2030, emptyMap()))
        assertEquals(-4, remainingHalfDays(null, 2030, mapOf(2030 to 4)))
        assertEquals(0, carriedOverHalfDays(null, 2030, emptyMap()))
    }

    @Test
    fun `usage in the target year reduces the remainder`() {
        assertEquals(14, remainingHalfDays(10, 2030, mapOf(2030 to 6)))
    }

    @Test
    fun `unused budget carries into the next year`() {
        val used = mapOf(2030 to 6) // 3 of 10 days used in 2030
        // 2031: own 20 half-units + carried 14.
        assertEquals(14, carriedOverHalfDays(10, 2031, used))
        assertEquals(34, remainingHalfDays(10, 2031, used))
    }

    @Test
    fun `carry-over compounds across several years of usage`() {
        val used = mapOf(2030 to 6, 2031 to 20, 2032 to 10)
        // Cumulative: 3 years x 20 - 36 used.
        assertEquals(24, remainingHalfDays(10, 2032, used))
        // Into 2032: 2 years x 20 - 26 used.
        assertEquals(14, carriedOverHalfDays(10, 2032, used))
    }

    @Test
    fun `the anchor is the earliest counting year — no phantom accumulation before it`() {
        val used = mapOf(2031 to 2)
        // 2031 is the first year with usage, so 2030 contributes nothing.
        assertEquals(0, carriedOverHalfDays(10, 2031, used))
        assertEquals(18, remainingHalfDays(10, 2031, used))
        // A target year BEFORE the earliest usage anchors at itself (a plain single year).
        assertEquals(20, remainingHalfDays(10, 2030, used))
        assertEquals(0, carriedOverHalfDays(10, 2030, used))
    }

    @Test
    fun `a retroactive allowance cut may push the balance negative — unclamped by design`() {
        // 5 days were used in 2030 while the allowance was higher; the admin then cut it to 1.
        val used = mapOf(2030 to 10)
        assertEquals(-8, remainingHalfDays(1, 2030, used))
        // The deficit carries forward.
        assertEquals(-8, carriedOverHalfDays(1, 2031, used))
        assertEquals(-6, remainingHalfDays(1, 2031, used))
    }
}
