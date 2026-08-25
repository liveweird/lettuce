package ch.nokillswit

import ch.nokillswit.succession.CandidateAwareness
import ch.nokillswit.succession.NominationType
import ch.nokillswit.succession.SuccessionNominationRequest
import ch.nokillswit.succession.SuccessorReadiness
import ch.nokillswit.succession.validateNomination
import ch.nokillswit.succession.validateSuccessionPlanFields
import io.ktor.server.plugins.BadRequestException
import kotlin.test.Test
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/** The pure payload validators — the DB-dependent rules (goal links, candidates) live in the service. */
class SuccessionValidationTest {

    private fun nomination(
        candidateId: UInt = 2u,
        competencyGaps: List<String> = listOf("Delegation"),
        goalIds: List<UInt> = emptyList(),
    ) = SuccessionNominationRequest(
        candidateId = candidateId,
        readiness = SuccessorReadiness.READY_NOW,
        nominationType = NominationType.PRIMARY,
        competencyGaps = competencyGaps,
        awareness = CandidateAwareness.CONFIDENTIAL,
        goalIds = goalIds,
    )

    @Test
    fun `plan fields - list bounds and bench depth range`() {
        validateSuccessionPlanFields(emptyList(), 2)
        validateSuccessionPlanFields(List(20) { "impact $it" }, 1)
        validateSuccessionPlanFields(listOf("x".repeat(200)), 10)

        assertFailsWith<BadRequestException> { validateSuccessionPlanFields(listOf(""), 2) }
        assertFailsWith<BadRequestException> { validateSuccessionPlanFields(listOf("   "), 2) }
        assertFailsWith<BadRequestException> { validateSuccessionPlanFields(listOf("x".repeat(201)), 2) }
        assertFailsWith<BadRequestException> { validateSuccessionPlanFields(List(21) { "i$it" }, 2) }
        assertFailsWith<BadRequestException> { validateSuccessionPlanFields(emptyList(), 0) }
        assertFailsWith<BadRequestException> { validateSuccessionPlanFields(emptyList(), 11) }
        assertFailsWith<BadRequestException> { validateSuccessionPlanFields(emptyList(), -1) }
    }

    @Test
    fun `nomination - the seat person is never a candidate, gap-list bounds, duplicate goal ids`() {
        validateNomination(nomination(), seatUserId = 1u)
        validateNomination(nomination(competencyGaps = emptyList(), goalIds = listOf(5u, 6u)), seatUserId = 1u)

        val self = assertFailsWith<BadRequestException> { validateNomination(nomination(candidateId = 1u), 1u) }
        assertTrue(self.message!!.contains("successor"))
        assertFailsWith<BadRequestException> { validateNomination(nomination(competencyGaps = listOf(" ")), 1u) }
        assertFailsWith<BadRequestException> {
            validateNomination(nomination(competencyGaps = listOf("x".repeat(201))), 1u)
        }
        assertFailsWith<BadRequestException> {
            validateNomination(nomination(competencyGaps = List(21) { "g$it" }), 1u)
        }
        val dup = assertFailsWith<BadRequestException> {
            validateNomination(nomination(goalIds = listOf(5u, 6u, 5u)), 1u)
        }
        assertTrue(dup.message!!.contains("Duplicate goal id"))
    }
}
