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
        // v2.26.1: one day of timezone tolerance — clients submit their browser-local date.
        validateCareerPositionStartDate("2026-08-15", today)
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("2026-08-16", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("2026-8-14", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("2026-08-4", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("14.08.2026", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("2026-08-14x", today) }
        assertFailsWith<BadRequestException> { validateCareerPositionStartDate("", today) }
    }

    @Test
    fun `a position must set all three refs (v2 15 1)`() {
        validateCareerPositionRefs(
            CareerPositionWrite("2020-01-01", careerPathId = 1u, careerSpecializationId = 2u, seniorityLevelId = 3u),
        )
        assertFailsWith<BadRequestException> {
            validateCareerPositionRefs(CareerPositionWrite("2020-01-01"))
        }
        assertFailsWith<BadRequestException> {
            validateCareerPositionRefs(
                CareerPositionWrite("2020-01-01", careerSpecializationId = 2u, seniorityLevelId = 3u),
            )
        }
        assertFailsWith<BadRequestException> {
            validateCareerPositionRefs(
                CareerPositionWrite("2020-01-01", careerPathId = 1u, seniorityLevelId = 3u),
            )
        }
        assertFailsWith<BadRequestException> {
            validateCareerPositionRefs(
                CareerPositionWrite("2020-01-01", careerPathId = 1u, careerSpecializationId = 2u),
            )
        }
    }
}
