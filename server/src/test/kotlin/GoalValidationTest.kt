package ch.nokillswit

import ch.nokillswit.goals.GoalProgressUpdate
import ch.nokillswit.goals.GoalType
import ch.nokillswit.goals.MAX_GOAL_TEXT_LENGTH
import ch.nokillswit.goals.MAX_GOAL_TITLE_LENGTH
import ch.nokillswit.goals.validateGoalDefinition
import ch.nokillswit.goals.validateGoalDueDate
import ch.nokillswit.goals.validateGoalProgress
import ch.nokillswit.goals.validateGoalSummary
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertFailsWith

/**
 * Pure validator tests (no DB) — every branch of the goal validation rules in goals/Goal.kt.
 * The happy paths and the most common rejections are also exercised through the routes
 * (GoalRoutesTest); this file pins the full combination matrix cheaply.
 */
class GoalValidationTest {

    private val today: LocalDate = LocalDate.of(2026, 8, 1)
    private val futureDate = "2026-12-31"

    private fun definition(
        title: String = "Ship it",
        description: String = "desc",
        type: GoalType = GoalType.NUMBER,
        targetValue: Double? = 10.0,
        dueDate: String = futureDate,
    ) = validateGoalDefinition(title, description, type, targetValue, dueDate, today)

    // ---- definition: title / description bounds ----

    @Test
    fun `definition accepts a boundary-length title and description`() {
        definition(title = "x".repeat(MAX_GOAL_TITLE_LENGTH), description = "y".repeat(MAX_GOAL_TEXT_LENGTH))
    }

    @Test
    fun `definition rejects a blank title`() {
        assertFailsWith<BadRequestException> { definition(title = "   ") }
    }

    @Test
    fun `definition rejects an oversized title`() {
        assertFailsWith<BadRequestException> { definition(title = "x".repeat(MAX_GOAL_TITLE_LENGTH + 1)) }
    }

    @Test
    fun `definition rejects an oversized description`() {
        assertFailsWith<BadRequestException> {
            definition(description = "y".repeat(MAX_GOAL_TEXT_LENGTH + 1))
        }
    }

    // ---- definition: type-specific target rules ----

    @Test
    fun `BINARY accepts a null target and rejects a set one`() {
        definition(type = GoalType.BINARY, targetValue = null)
        assertFailsWith<BadRequestException> { definition(type = GoalType.BINARY, targetValue = 1.0) }
    }

    @Test
    fun `NUMBER requires a finite target`() {
        definition(type = GoalType.NUMBER, targetValue = 42.0)
        assertFailsWith<BadRequestException> { definition(type = GoalType.NUMBER, targetValue = null) }
        assertFailsWith<BadRequestException> {
            definition(type = GoalType.NUMBER, targetValue = Double.NaN)
        }
        assertFailsWith<BadRequestException> {
            definition(type = GoalType.NUMBER, targetValue = Double.POSITIVE_INFINITY)
        }
    }

    @Test
    fun `PERCENTAGE requires a finite target between 0 and 100`() {
        definition(type = GoalType.PERCENTAGE, targetValue = 0.0)
        definition(type = GoalType.PERCENTAGE, targetValue = 100.0)
        assertFailsWith<BadRequestException> { definition(type = GoalType.PERCENTAGE, targetValue = null) }
        assertFailsWith<BadRequestException> {
            definition(type = GoalType.PERCENTAGE, targetValue = Double.NaN)
        }
        assertFailsWith<BadRequestException> {
            definition(type = GoalType.PERCENTAGE, targetValue = -0.1)
        }
        assertFailsWith<BadRequestException> {
            definition(type = GoalType.PERCENTAGE, targetValue = 100.1)
        }
    }

    // ---- due date ----

    @Test
    fun `due date accepts today and future ISO dates`() {
        validateGoalDueDate("2026-08-01", today) // == today is allowed
        validateGoalDueDate("2027-01-01", today)
    }

    @Test
    fun `due date rejects non-ISO, non-padded, and past values`() {
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-8-1", today) } // not zero-padded
        assertFailsWith<BadRequestException> { validateGoalDueDate("31-12-2026", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-13-01", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("not-a-date!", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-07-31", today) } // yesterday
    }

    // ---- progress ----

    @Test
    fun `BINARY progress requires exactly achieved`() {
        validateGoalProgress(GoalType.BINARY, GoalProgressUpdate(achieved = true))
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.BINARY, GoalProgressUpdate(currentValue = 1.0))
        }
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.BINARY, GoalProgressUpdate())
        }
    }

    @Test
    fun `NUMBER progress requires exactly a finite currentValue`() {
        validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate(currentValue = 7.5))
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate(achieved = true))
        }
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate())
        }
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate(currentValue = Double.NaN))
        }
    }

    @Test
    fun `PERCENTAGE progress additionally bounds currentValue to 0-100`() {
        validateGoalProgress(GoalType.PERCENTAGE, GoalProgressUpdate(currentValue = 0.0))
        validateGoalProgress(GoalType.PERCENTAGE, GoalProgressUpdate(currentValue = 100.0))
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.PERCENTAGE, GoalProgressUpdate(currentValue = -1.0))
        }
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.PERCENTAGE, GoalProgressUpdate(currentValue = 100.5))
        }
    }

    // ---- close summary ----

    @Test
    fun `summary must be present, non-blank, and bounded`() {
        validateGoalSummary("Done, shipped on time.")
        validateGoalSummary("z".repeat(MAX_GOAL_TEXT_LENGTH)) // boundary
        assertFailsWith<BadRequestException> { validateGoalSummary(null) }
        assertFailsWith<BadRequestException> { validateGoalSummary("   ") }
        assertFailsWith<BadRequestException> { validateGoalSummary("z".repeat(MAX_GOAL_TEXT_LENGTH + 1)) }
    }
}
