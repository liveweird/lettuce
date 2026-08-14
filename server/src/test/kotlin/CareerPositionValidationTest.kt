package ch.nokillswit

import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.validateCareerPositionRefs
import ch.nokillswit.users.validateCareerPositionStartDate
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertFailsWith

/** The pure shape rules of a career position write (the GoalDueDateValidationTest shape). */
class CareerPositionValidationTest {

    private val today = LocalDate.of(2026, 8, 14)

    @Test
    fun `start date must be strict zero-padded ISO and not in the future`() {
        validateCareerPositionStartDate("2026-08-14", today) // == today is allowed
        validateCareerPositionStartDate("1999-01-31", today)
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("2026-08-15", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("2026-8-14", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("2026-08-4", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("14.08.2026", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("2026-08-14x", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("", today) }
    }

    @Test
    fun `a position must set at least one of the three refs`() {
        validateCareerPositionRefs(CareerPositionWrite("2020-01-01", careerPathId = 1u))
        validateCareerPositionRefs(CareerPositionWrite("2020-01-01", seniorityLevelId = 3u))
        assertFailsWith<BadRequestException> {
            validateCareerPositionRefs(CareerPositionWrite("2020-01-01"))
        }
    }
}
