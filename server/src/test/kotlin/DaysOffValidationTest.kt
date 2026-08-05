package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.daysoff.formatHalfDaysParam
import ch.nokillswit.daysoff.parseDaysOffDate
import ch.nokillswit.daysoff.parseDaysOffMonth
import ch.nokillswit.daysoff.validateDaysOffCreate
import io.ktor.server.plugins.BadRequestException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

/** The pure create-shape rules — the DB-dependent rules (overlap, budget, zero-cost) live in
 * DaysOffRoutesTest. */
class DaysOffValidationTest {

    private fun request(
        start: String,
        end: String,
        startHalf: Boolean = false,
        endHalf: Boolean = false,
    ) = DaysOffCreateRequest(DaysOffType.PAID, start, end, startHalf, endHalf)

    @Test
    fun `accepts a plain period, a single day, and edge halves`() {
        validateDaysOffCreate(request("2030-03-04", "2030-03-08"))
        validateDaysOffCreate(request("2030-03-04", "2030-03-04", startHalf = true))
        validateDaysOffCreate(request("2030-03-04", "2030-03-08", startHalf = true, endHalf = true))
        // Dec 31 is fine as long as the period stays inside the year.
        validateDaysOffCreate(request("2030-12-30", "2030-12-31"))
    }

    @Test
    fun `dates must be strict zero-padded ISO`() {
        assertFailsWith<BadRequestException> { validateDaysOffCreate(request("2030-3-04", "2030-03-08")) }
        assertFailsWith<BadRequestException> { validateDaysOffCreate(request("2030-03-04", "garbage")) }
        assertFailsWith<BadRequestException> { validateDaysOffCreate(request("2030-03-04", "2030-02-30")) }
        assertFailsWith<BadRequestException> { parseDaysOffDate("2030/03/04", "startDate") }
    }

    @Test
    fun `startDate must not be after endDate`() {
        assertFailsWith<BadRequestException> { validateDaysOffCreate(request("2030-03-08", "2030-03-04")) }
    }

    @Test
    fun `a period must not span calendar years`() {
        assertFailsWith<BadRequestException> { validateDaysOffCreate(request("2030-12-30", "2031-01-02")) }
    }

    @Test
    fun `a single-day request expresses its half via startHalf only`() {
        assertFailsWith<BadRequestException> {
            validateDaysOffCreate(request("2030-03-04", "2030-03-04", endHalf = true))
        }
        // On a multi-day period endHalf is fine.
        validateDaysOffCreate(request("2030-03-04", "2030-03-05", endHalf = true))
    }

    @Test
    fun `calendar months parse strictly`() {
        assertEquals(java.time.YearMonth.of(2030, 3), parseDaysOffMonth("2030-03"))
        assertFailsWith<BadRequestException> { parseDaysOffMonth("2030-3") }
        assertFailsWith<BadRequestException> { parseDaysOffMonth("2030-13") }
        assertFailsWith<BadRequestException> { parseDaysOffMonth("garbage") }
    }

    @Test
    fun `half-day units format as whole or half days`() {
        assertEquals("0", formatHalfDaysParam(0))
        assertEquals("0.5", formatHalfDaysParam(1))
        assertEquals("1", formatHalfDaysParam(2))
        assertEquals("3.5", formatHalfDaysParam(7))
    }

    // ── Corrections (v1.43.0) ───────────────────────────────────────────────────────────────

    private fun correction(
        year: Int = 2030,
        operation: ch.nokillswit.daysoff.DaysOffCorrectionOperation =
            ch.nokillswit.daysoff.DaysOffCorrectionOperation.ADD,
        days: Double = 4.5,
        comment: String = "Overtime compensation",
    ) = ch.nokillswit.daysoff.DaysOffCorrectionWrite(1u, year, operation, days, comment)

    @Test
    fun `correction shape rules`() {
        ch.nokillswit.daysoff.validateDaysOffCorrection(correction())
        ch.nokillswit.daysoff.validateDaysOffCorrection(
            correction(operation = ch.nokillswit.daysoff.DaysOffCorrectionOperation.SUBTRACT, days = 0.5),
        )
        assertFailsWith<BadRequestException> { ch.nokillswit.daysoff.validateDaysOffCorrection(correction(year = 1999)) }
        assertFailsWith<BadRequestException> { ch.nokillswit.daysoff.validateDaysOffCorrection(correction(days = 0.0)) }
        assertFailsWith<BadRequestException> { ch.nokillswit.daysoff.validateDaysOffCorrection(correction(days = -1.0)) }
        assertFailsWith<BadRequestException> { ch.nokillswit.daysoff.validateDaysOffCorrection(correction(days = 1.3)) }
        assertFailsWith<BadRequestException> { ch.nokillswit.daysoff.validateDaysOffCorrection(correction(days = 400.0)) }
        assertFailsWith<BadRequestException> { ch.nokillswit.daysoff.validateDaysOffCorrection(correction(comment = "  ")) }
        assertFailsWith<BadRequestException> {
            ch.nokillswit.daysoff.validateDaysOffCorrection(correction(comment = "x".repeat(1001)))
        }
    }

    @Test
    fun `the stored amount is signed by the operation`() {
        assertEquals(9, ch.nokillswit.daysoff.correctionHalfDays(correction(days = 4.5)))
        assertEquals(
            -9,
            ch.nokillswit.daysoff.correctionHalfDays(
                correction(operation = ch.nokillswit.daysoff.DaysOffCorrectionOperation.SUBTRACT, days = 4.5),
            ),
        )
    }
}
