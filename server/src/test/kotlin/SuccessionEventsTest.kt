package ch.nokillswit

import ch.nokillswit.succession.CandidateAwareness
import ch.nokillswit.succession.NominationType
import ch.nokillswit.succession.RetentionRisk
import ch.nokillswit.succession.RoleCriticality
import ch.nokillswit.succession.SuccessionCompetencyGap
import ch.nokillswit.succession.SuccessionEventType
import ch.nokillswit.succession.SuccessionGoalRef
import ch.nokillswit.succession.SuccessionNominationRequest
import ch.nokillswit.succession.SuccessionNominationResponse
import ch.nokillswit.succession.SuccessionPlanCreateRequest
import ch.nokillswit.succession.SuccessionPlanResponse
import ch.nokillswit.succession.SuccessionPlanStatus
import ch.nokillswit.succession.SuccessionPlanUpdate
import ch.nokillswit.succession.SuccessorReadiness
import ch.nokillswit.succession.nominationAddedEvent
import ch.nokillswit.succession.nominationRemovedEvent
import ch.nokillswit.succession.nominationUpdateEvents
import ch.nokillswit.succession.primaryDemotedEvent
import ch.nokillswit.succession.successionPlanClosedEvent
import ch.nokillswit.succession.successionPlanCreationEvent
import ch.nokillswit.succession.successionPlanDeletedEvent
import ch.nokillswit.succession.successionPlanUpdateEvents
import ch.nokillswit.succession.successionReviewCompletedEvent
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** Pure descriptor-builder matrix (the ImpactLogEventsTest shape — no DB, no testApplication). */
class SuccessionEventsTest {

    private fun planResponse(
        roleCriticality: RoleCriticality = RoleCriticality.CRITICAL,
        retentionRisk: RetentionRisk = RetentionRisk.HIGH,
        lossImpact: List<String> = listOf("Key clients"),
        targetBenchDepth: Int = 2,
    ) = SuccessionPlanResponse(
        id = 1u, managerId = 7u, managerName = "Mona", userId = 8u, userName = "Sam",
        roleCriticality = roleCriticality, retentionRisk = retentionRisk,
        lossImpact = lossImpact, targetBenchDepth = targetBenchDepth,
        status = SuccessionPlanStatus.OPEN, benchCount = 0, nominations = emptyList(),
        createdAt = 1L, lastReviewedAt = 1L,
    )

    private fun planUpdate(
        roleCriticality: RoleCriticality = RoleCriticality.CRITICAL,
        retentionRisk: RetentionRisk = RetentionRisk.HIGH,
        lossImpact: List<String> = listOf("Key clients"),
        targetBenchDepth: Int = 2,
    ) = SuccessionPlanUpdate(roleCriticality, retentionRisk, lossImpact, targetBenchDepth)

    private fun nominationResponse(
        candidateId: UInt = 9u,
        readiness: SuccessorReadiness = SuccessorReadiness.READY_SOON,
        nominationType: NominationType = NominationType.PRIMARY,
        competencyGaps: List<SuccessionCompetencyGap> = listOf(SuccessionCompetencyGap("Delegation")),
        awareness: CandidateAwareness = CandidateAwareness.IMPLICIT,
        goals: List<SuccessionGoalRef> = emptyList(),
    ) = SuccessionNominationResponse(
        id = 31u, planId = 1u, candidateId = candidateId, candidateName = "Cleo",
        readiness = readiness, nominationType = nominationType, competencyGaps = competencyGaps,
        awareness = awareness, goals = goals, createdAt = 1L, lastModified = 2L,
    )

    private fun nominationRequest(
        candidateId: UInt = 9u,
        readiness: SuccessorReadiness = SuccessorReadiness.READY_SOON,
        nominationType: NominationType = NominationType.PRIMARY,
        competencyGaps: List<SuccessionCompetencyGap> = listOf(SuccessionCompetencyGap("Delegation")),
        awareness: CandidateAwareness = CandidateAwareness.IMPLICIT,
        goalIds: List<UInt> = emptyList(),
    ) = SuccessionNominationRequest(candidateId, readiness, nominationType, competencyGaps, awareness, goalIds)

    @Test
    fun `creation event carries the definition scalars only`() {
        val event = successionPlanCreationEvent(
            SuccessionPlanCreateRequest(
                userId = 8u,
                roleCriticality = RoleCriticality.CORE,
                retentionRisk = RetentionRisk.MEDIUM,
                lossImpact = listOf("Secret impact"),
                targetBenchDepth = 3,
            ),
        )
        assertEquals(SuccessionEventType.CREATED, event.type)
        assertEquals(
            mapOf("roleCriticality" to "CORE", "retentionRisk" to "MEDIUM", "targetBenchDepth" to "3"),
            event.params,
        )
        assertTrue(event.params.values.none { it.contains("Secret impact") })
    }

    @Test
    fun `a no-op definition update yields no events`() {
        assertEquals(emptyList(), successionPlanUpdateEvents(planResponse(), planUpdate()))
    }

    @Test
    fun `a definition edit fans out per-field events with from-to, loss impact name-only`() {
        val events = successionPlanUpdateEvents(
            planResponse(),
            planUpdate(
                roleCriticality = RoleCriticality.STANDARD,
                retentionRisk = RetentionRisk.LOW,
                targetBenchDepth = 4,
                lossImpact = listOf("Secret new impact"),
            ),
        )
        assertEquals(
            listOf(
                SuccessionEventType.CRITICALITY_CHANGED,
                SuccessionEventType.RISK_CHANGED,
                SuccessionEventType.BENCH_DEPTH_CHANGED,
                SuccessionEventType.LOSS_IMPACT_CHANGED,
            ),
            events.map { it.type },
        )
        assertEquals(mapOf("from" to "CRITICAL", "to" to "STANDARD"), events[0].params)
        assertEquals(mapOf("from" to "HIGH", "to" to "LOW"), events[1].params)
        assertEquals(mapOf("from" to "2", "to" to "4"), events[2].params)
        // The encrypted list contributes its NAME only — content never rides params.
        assertEquals(emptyMap(), events[3].params)
    }

    @Test
    fun `the bare lifecycle events carry no params`() {
        assertEquals(SuccessionEventType.REVIEW_COMPLETED, successionReviewCompletedEvent().type)
        assertEquals(SuccessionEventType.CLOSED, successionPlanClosedEvent().type)
        assertEquals(SuccessionEventType.DELETED, successionPlanDeletedEvent().type)
        assertTrue(successionReviewCompletedEvent().params.isEmpty())
        assertTrue(successionPlanClosedEvent().params.isEmpty())
        assertTrue(successionPlanDeletedEvent().params.isEmpty())
    }

    @Test
    fun `nomination added carries the candidate name and the three enums`() {
        assertEquals(
            mapOf(
                "candidateName" to "Cleo",
                "readiness" to "READY_SOON",
                "nominationType" to "PRIMARY",
                "awareness" to "IMPLICIT",
            ),
            nominationAddedEvent(nominationResponse()).params,
        )
    }

    @Test
    fun `a no-op nomination update yields no event`() {
        assertNull(nominationUpdateEvents(nominationResponse(), nominationRequest()))
    }

    @Test
    fun `a nomination edit names the changed fields with enum from-to, gaps and goals name-only`() {
        val event = nominationUpdateEvents(
            nominationResponse(),
            nominationRequest(
                candidateId = 12u,
                readiness = SuccessorReadiness.READY_NOW,
                competencyGaps = listOf(SuccessionCompetencyGap("Delegation", filled = true)),
                goalIds = listOf(5u),
            ),
        )!!
        assertEquals(SuccessionEventType.NOMINATION_UPDATED, event.type)
        assertEquals("candidate,readiness,competencyGaps,goals", event.params["changed"])
        assertEquals("Cleo", event.params["candidateName"])
        assertEquals("READY_SOON", event.params["readinessFrom"])
        assertEquals("READY_NOW", event.params["readinessTo"])
        assertTrue(event.params.values.none { it.contains("Delegation") })
    }

    @Test
    fun `a filled-flag tick alone counts as a gaps change`() {
        val event = nominationUpdateEvents(
            nominationResponse(),
            nominationRequest(competencyGaps = listOf(SuccessionCompetencyGap("Delegation", filled = true))),
        )!!
        assertEquals("competencyGaps", event.params["changed"])
    }

    @Test
    fun `removed and demoted events carry the candidate name only`() {
        assertEquals(mapOf("candidateName" to "Cleo"), nominationRemovedEvent(nominationResponse()).params)
        assertEquals(mapOf("candidateName" to "Cleo"), primaryDemotedEvent(nominationResponse()).params)
        assertEquals(SuccessionEventType.PRIMARY_DEMOTED, primaryDemotedEvent(nominationResponse()).type)
    }
}
