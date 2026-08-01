package ch.nokillswit

import ch.nokillswit.teamkpis.TeamKpiProgressUpdate
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teamkpis.validateTeamKpiDefinition
import ch.nokillswit.teamkpis.validateTeamKpiProgress
import ch.nokillswit.teamkpis.validateTeamKpiSummary
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertFailsWith

/**
 * Pure combination matrix of the team-KPI validators — no BINARY flavor, so a target/current
 * value is always required (finite; 0–100 for PERCENTAGE). The route/service behavior on top is
 * covered by TeamKpiRoutesTest.
 */
class TeamKpiValidationTest {

    private fun definition(
        title: String = "Ship it",
        description: String = "",
        type: TeamKpiType = TeamKpiType.NUMBER,
        targetValue: Double? = 10.0,
    ) = validateTeamKpiDefinition(title, description, type, targetValue)

    // ---- definition: title/description bounds ----

    @Test
    fun `a valid NUMBER definition passes`() = definition()

    @Test
    fun `a blank title is rejected`() {
        assertFailsWith<BadRequestException> { definition(title = "   ") }
    }

    @Test
    fun `a title at the 200-char bound passes, one over is rejected`() {
        definition(title = "x".repeat(200))
        assertFailsWith<BadRequestException> { definition(title = "x".repeat(201)) }
    }

    @Test
    fun `a description at the 4000-char bound passes, one over is rejected`() {
        definition(description = "d".repeat(4000))
        assertFailsWith<BadRequestException> { definition(description = "d".repeat(4001)) }
    }

    // ---- definition: target rules ----

    @Test
    fun `a missing target is rejected for both types`() {
        assertFailsWith<BadRequestException> { definition(type = TeamKpiType.NUMBER, targetValue = null) }
        assertFailsWith<BadRequestException> { definition(type = TeamKpiType.PERCENTAGE, targetValue = null) }
    }

    @Test
    fun `a non-finite target is rejected`() {
        assertFailsWith<BadRequestException> { definition(targetValue = Double.NaN) }
        assertFailsWith<BadRequestException> { definition(targetValue = Double.POSITIVE_INFINITY) }
    }

    @Test
    fun `a PERCENTAGE target accepts the 0 and 100 bounds and rejects beyond them`() {
        definition(type = TeamKpiType.PERCENTAGE, targetValue = 0.0)
        definition(type = TeamKpiType.PERCENTAGE, targetValue = 100.0)
        assertFailsWith<BadRequestException> { definition(type = TeamKpiType.PERCENTAGE, targetValue = -0.1) }
        assertFailsWith<BadRequestException> { definition(type = TeamKpiType.PERCENTAGE, targetValue = 100.1) }
    }

    @Test
    fun `a NUMBER target has no range bound`() {
        definition(type = TeamKpiType.NUMBER, targetValue = -5000.0)
        definition(type = TeamKpiType.NUMBER, targetValue = 1e9)
    }

    // ---- progress ----

    private val today = LocalDate.of(2026, 8, 1)

    private fun progress(
        type: TeamKpiType = TeamKpiType.NUMBER,
        currentValue: Double? = 42.0,
        date: String? = "2026-08-01",
    ) = validateTeamKpiProgress(type, TeamKpiProgressUpdate(currentValue = currentValue, date = date), today)

    @Test
    fun `a progress update requires a finite currentValue`() {
        progress()
        assertFailsWith<BadRequestException> { progress(currentValue = null) }
        assertFailsWith<BadRequestException> { progress(currentValue = Double.NaN) }
    }

    @Test
    fun `a PERCENTAGE progress value accepts the bounds and rejects beyond them`() {
        progress(type = TeamKpiType.PERCENTAGE, currentValue = 0.0)
        progress(type = TeamKpiType.PERCENTAGE, currentValue = 100.0)
        assertFailsWith<BadRequestException> { progress(type = TeamKpiType.PERCENTAGE, currentValue = -0.1) }
        assertFailsWith<BadRequestException> { progress(type = TeamKpiType.PERCENTAGE, currentValue = 100.1) }
    }

    @Test
    fun `a progress update requires a date`() {
        assertFailsWith<BadRequestException> { progress(date = null) }
    }

    @Test
    fun `a progress date must be a strict zero-padded ISO date`() {
        assertFailsWith<BadRequestException> { progress(date = "2026-8-1") }
        assertFailsWith<BadRequestException> { progress(date = "01-08-2026") }
        assertFailsWith<BadRequestException> { progress(date = "yesterday") }
    }

    @Test
    fun `a progress date accepts today and the past, never the future`() {
        progress(date = "2026-08-01")
        progress(date = "2020-01-15")
        assertFailsWith<BadRequestException> { progress(date = "2026-08-02") }
    }

    // ---- summary ----

    @Test
    fun `the close summary must be present, non-blank, and bounded`() {
        validateTeamKpiSummary("done")
        validateTeamKpiSummary("s".repeat(4000))
        assertFailsWith<BadRequestException> { validateTeamKpiSummary(null) }
        assertFailsWith<BadRequestException> { validateTeamKpiSummary("   ") }
        assertFailsWith<BadRequestException> { validateTeamKpiSummary("s".repeat(4001)) }
    }
}
