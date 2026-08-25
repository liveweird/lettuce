package ch.nokillswit

import ch.nokillswit.goals.GoalMilestoneDone
import ch.nokillswit.goals.GoalMilestoneInput
import ch.nokillswit.goals.GoalProgressUpdate
import ch.nokillswit.goals.GoalType
import ch.nokillswit.goals.MAX_GOAL_MILESTONES
import ch.nokillswit.goals.MAX_GOAL_TEXT_LENGTH
import ch.nokillswit.goals.MAX_GOAL_TITLE_LENGTH
import ch.nokillswit.goals.TargetDirection
import ch.nokillswit.goals.normalizedTargetDirection
import ch.nokillswit.goals.validateGoalDefinition
import ch.nokillswit.goals.validateGoalDueDate
import ch.nokillswit.goals.validateGoalProgress
import ch.nokillswit.goals.validateGoalSummary
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull

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
        targetDirection: TargetDirection? = null,
        milestones: List<GoalMilestoneInput> = emptyList(),
        dueDate: String = futureDate,
        newMilestonesOnly: Boolean = false,
    ) = validateGoalDefinition(
        title, description, type, targetValue, targetDirection, milestones, dueDate,
        newMilestonesOnly = newMilestonesOnly, today = today,
    )

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
    fun `PLAN accepts a null target and rejects a set one`() {
        definition(type = GoalType.PLAN, targetValue = null)
        assertFailsWith<BadRequestException> { definition(type = GoalType.PLAN, targetValue = 1.0) }
    }

    @Test
    fun `PLAN rejects a target direction, the numeric types accept either`() {
        assertFailsWith<BadRequestException> {
            definition(type = GoalType.PLAN, targetValue = null, targetDirection = TargetDirection.AT_LEAST)
        }
        definition(type = GoalType.NUMBER, targetDirection = TargetDirection.AT_MOST)
        definition(type = GoalType.PERCENTAGE, targetValue = 5.0, targetDirection = TargetDirection.AT_LEAST)
    }

    @Test
    fun `normalizedTargetDirection defaults the numeric types to AT_LEAST and nulls PLAN`() {
        assertEquals(TargetDirection.AT_LEAST, normalizedTargetDirection(GoalType.NUMBER, null))
        assertEquals(TargetDirection.AT_MOST, normalizedTargetDirection(GoalType.PERCENTAGE, TargetDirection.AT_MOST))
        assertNull(normalizedTargetDirection(GoalType.PLAN, null))
    }

    // ---- definition: milestone rules (PLAN) ----

    @Test
    fun `PLAN milestones must be non-blank, bounded, and capped at 100`() {
        definition(
            type = GoalType.PLAN, targetValue = null,
            milestones = listOf(GoalMilestoneInput(description = "m".repeat(MAX_GOAL_TEXT_LENGTH))),
        )
        definition(
            type = GoalType.PLAN, targetValue = null,
            milestones = List(MAX_GOAL_MILESTONES) { GoalMilestoneInput(description = "step $it") },
        )
        assertFailsWith<BadRequestException> {
            definition(
                type = GoalType.PLAN, targetValue = null,
                milestones = listOf(GoalMilestoneInput(description = "   ")),
            )
        }
        assertFailsWith<BadRequestException> {
            definition(
                type = GoalType.PLAN, targetValue = null,
                milestones = listOf(GoalMilestoneInput(description = "m".repeat(MAX_GOAL_TEXT_LENGTH + 1))),
            )
        }
        assertFailsWith<BadRequestException> {
            definition(
                type = GoalType.PLAN, targetValue = null,
                milestones = List(MAX_GOAL_MILESTONES + 1) { GoalMilestoneInput(description = "step $it") },
            )
        }
    }

    @Test
    fun `milestones are rejected on the numeric types`() {
        assertFailsWith<BadRequestException> {
            definition(type = GoalType.NUMBER, milestones = listOf(GoalMilestoneInput(description = "step")))
        }
        assertFailsWith<BadRequestException> {
            definition(
                type = GoalType.PERCENTAGE, targetValue = 50.0,
                milestones = listOf(GoalMilestoneInput(description = "step")),
            )
        }
    }

    @Test
    fun `create-time milestones must not carry ids`() {
        // The DRAFT edit references existing rows by id; a create has none to reference.
        definition(
            type = GoalType.PLAN, targetValue = null,
            milestones = listOf(GoalMilestoneInput(id = 7u, description = "kept")),
        )
        assertFailsWith<BadRequestException> {
            definition(
                type = GoalType.PLAN, targetValue = null,
                milestones = listOf(GoalMilestoneInput(id = 7u, description = "kept")),
                newMilestonesOnly = true,
            )
        }
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
    fun `due date accepts today, the future, and one day of timezone tolerance backwards`() {
        validateGoalDueDate("2026-08-01", today) // == today is allowed
        validateGoalDueDate("2027-01-01", today)
        // v2.26.1: a behind-UTC user's local today is the server's yesterday in their evening.
        validateGoalDueDate("2026-07-31", today)
    }

    @Test
    fun `due date rejects non-ISO, non-padded, and past values`() {
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-8-1", today) } // not zero-padded
        assertFailsWith<BadRequestException> { validateGoalDueDate("31-12-2026", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-13-01", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("not-a-date!", today) }
        // Yesterday sits inside the timezone tolerance (v2.26.1) — the day before it does not.
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-07-30", today) }
    }

    // ---- progress ----

    @Test
    fun `PLAN progress accepts only milestones - optional when a comment is present`() {
        validateGoalProgress(GoalType.PLAN, GoalProgressUpdate(milestones = listOf(GoalMilestoneDone(1u, true))))
        // v2.8.1: the progress field is optional — a state-less update needs a non-blank comment.
        validateGoalProgress(GoalType.PLAN, GoalProgressUpdate(comment = "status note"))
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.PLAN, GoalProgressUpdate(currentValue = 1.0))
        }
        // The wrong-type field stays rejected even alongside a comment.
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.PLAN, GoalProgressUpdate(currentValue = 1.0, comment = "note"))
        }
        // Neither a state change field nor a comment = nothing to record.
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.PLAN, GoalProgressUpdate())
        }
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.PLAN, GoalProgressUpdate(comment = "   "))
        }
    }

    @Test
    fun `NUMBER progress accepts only a finite currentValue - optional when a comment is present`() {
        validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate(currentValue = 7.5))
        validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate(comment = "blocked this week"))
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate(milestones = listOf(GoalMilestoneDone(1u, true))))
        }
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate())
        }
        // A present value must still be finite — a comment doesn't rescue a broken value.
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate(currentValue = Double.NaN))
        }
        assertFailsWith<BadRequestException> {
            validateGoalProgress(GoalType.NUMBER, GoalProgressUpdate(currentValue = Double.NaN, comment = "note"))
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
