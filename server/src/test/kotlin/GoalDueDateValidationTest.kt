package ch.nokillswit

import ch.nokillswit.goals.validateGoalDueDate
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertFailsWith

/** Pure boundary tests for the due-date rule (no DB); the route side lives in GoalRoutesTest. */
class GoalDueDateValidationTest {

    private val today = LocalDate.of(2026, 7, 27)

    @Test
    fun `today and future dates pass`() {
        validateGoalDueDate("2026-07-27", today)
        validateGoalDueDate("2026-07-28", today)
        validateGoalDueDate("2099-12-31", today)
    }

    @Test
    fun `yesterday fails`() {
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-07-26", today) }
    }

    @Test
    fun `malformed dates fail - only zero-padded ISO sorts correctly in the VARCHAR column`() {
        assertFailsWith<BadRequestException> { validateGoalDueDate("", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-7-27", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("27-07-2026", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-13-01", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("garbage", today) }
        assertFailsWith<BadRequestException> { validateGoalDueDate("2026-07-27T00:00", today) }
    }
}
