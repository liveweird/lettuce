package ch.nokillswit

import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.succession.CandidateAwareness
import ch.nokillswit.succession.NominationType
import ch.nokillswit.succession.RetentionRisk
import ch.nokillswit.succession.RoleCriticality
import ch.nokillswit.succession.SuccessionCompetencyGap
import ch.nokillswit.succession.SuccessionNominationRequest
import ch.nokillswit.succession.SuccessionPlanCreateRequest
import ch.nokillswit.succession.SuccessionPlanResponse
import ch.nokillswit.succession.SuccessionPlanService
import ch.nokillswit.succession.SuccessionPlanStatus
import ch.nokillswit.succession.SuccessorReadiness
import ch.nokillswit.teams.Team
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Encryption-at-rest of succession plans: what PostgreSQL stores in the two ordered-list
 * columns (`loss_impact`, `competency_gaps`) is an `enc:v1:` AES-GCM envelope around a JSON
 * array, while the API serves the plaintext lists; everything else (enums, ids, timestamps)
 * stays plaintext by design. Raw column state is asserted by selecting the Exposed tables
 * directly, bypassing the service's decrypt layer.
 */
class SuccessionEncryptionTest {

    private suspend fun rawLossImpact(planId: UInt): String =
        suspendTransaction(TestServices.successionPlans.database) {
            SuccessionPlanService.Plans.selectAll()
                .where { SuccessionPlanService.Plans.id eq planId }
                .map { it[SuccessionPlanService.Plans.lossImpact] }
                .singleOrNull()!!
        }

    private suspend fun rawCompetencyGaps(nominationId: UInt): String =
        suspendTransaction(TestServices.successionPlans.database) {
            SuccessionPlanService.Nominations.selectAll()
                .where { SuccessionPlanService.Nominations.id eq nominationId }
                .map { it[SuccessionPlanService.Nominations.competencyGaps] }
                .singleOrNull()!!
        }

    @Test
    fun `both ordered lists are ciphertext in the DB but plaintext lists over the API`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("succ-enc-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val seatId = TestUsers.seed(uniqueEmail("succ-enc-seat"), "pw", roles = emptySet())
        val candidateId = TestUsers.seed(uniqueEmail("succ-enc-cand"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "succ-enc-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, seatId)
        TestServices.teams.addMember(teamId, candidateId)
        val manager = authedClient(managerEmail, "pw")

        val plan = manager.post("/api/v1/succession-plans") {
            contentType(ContentType.Application.Json)
            setBody(
                SuccessionPlanCreateRequest(
                    userId = seatId,
                    roleCriticality = RoleCriticality.CRITICAL,
                    retentionRisk = RetentionRisk.HIGH,
                    lossImpact = listOf("Confidential impact: sole payments approver"),
                ),
            )
        }.body<SuccessionPlanResponse>()
        val nomination = manager.post("/api/v1/succession-plans/${plan.id}/nominations") {
            contentType(ContentType.Application.Json)
            setBody(
                SuccessionNominationRequest(
                    candidateId = candidateId,
                    readiness = SuccessorReadiness.READY_SOON,
                    nominationType = NominationType.PRIMARY,
                    competencyGaps = listOf(SuccessionCompetencyGap("Confidential gap: no budget experience", filled = true)),
                    awareness = CandidateAwareness.CONFIDENTIAL,
                ),
            )
        }.body<ch.nokillswit.succession.SuccessionNominationResponse>()

        // What the DB (a database-level attacker) sees: one envelope per list, no JSON, no text.
        val rawImpact = rawLossImpact(plan.id)
        assertTrue(rawImpact.startsWith(FieldCipher.PREFIX))
        assertFalse("Confidential" in rawImpact)
        val rawGaps = rawCompetencyGaps(nomination.id)
        assertTrue(rawGaps.startsWith(FieldCipher.PREFIX))
        assertFalse("Confidential" in rawGaps)

        // What the API serves: the decrypted ordered lists.
        val fetched = manager.get("/api/v1/succession-plans/${plan.id}").body<SuccessionPlanResponse>()
        assertEquals(listOf("Confidential impact: sole payments approver"), fetched.lossImpact)
        assertEquals(
            listOf(SuccessionCompetencyGap("Confidential gap: no budget experience", filled = true)),
            fetched.nominations.single().competencyGaps,
        )
    }

    @Test
    fun `legacy plaintext rows are encrypted by the startup backfill, and rotation rewrites them`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(uniqueEmail("succ-legacy-manager"), "pw", roles = emptySet())
        val seatId = TestUsers.seed(uniqueEmail("succ-legacy-seat"), "pw", roles = emptySet())

        // A pre-encryption row pair, as a legacy deployment would have written it.
        val now = System.currentTimeMillis()
        val (legacyPlanId, legacyNominationId) = suspendTransaction(TestServices.successionPlans.database) {
            val planId = SuccessionPlanService.Plans.insert {
                it[SuccessionPlanService.Plans.managerId] = managerId
                it[SuccessionPlanService.Plans.userId] = seatId
                it[SuccessionPlanService.Plans.roleCriticality] = RoleCriticality.STANDARD
                it[SuccessionPlanService.Plans.retentionRisk] = RetentionRisk.LOW
                it[SuccessionPlanService.Plans.lossImpact] = """["legacy plain impact"]"""
                it[SuccessionPlanService.Plans.targetBenchDepth] = 2
                it[SuccessionPlanService.Plans.status] = SuccessionPlanStatus.OPEN
                it[SuccessionPlanService.Plans.createdAt] = now
                it[SuccessionPlanService.Plans.lastReviewedAt] = now
            }[SuccessionPlanService.Plans.id].value
            val nominationId = SuccessionPlanService.Nominations.insert {
                it[SuccessionPlanService.Nominations.planId] = planId
                it[SuccessionPlanService.Nominations.candidateId] = managerId
                it[SuccessionPlanService.Nominations.readiness] = SuccessorReadiness.FUTURE_PIPELINE
                it[SuccessionPlanService.Nominations.nominationType] = NominationType.CROSS_TEAM
                it[SuccessionPlanService.Nominations.competencyGaps] = """["legacy plain gap"]"""
                it[SuccessionPlanService.Nominations.awareness] = CandidateAwareness.IMPLICIT
                it[SuccessionPlanService.Nominations.createdAt] = now
                it[SuccessionPlanService.Nominations.lastModified] = now
            }[SuccessionPlanService.Nominations.id].value
            planId to nominationId
        }

        // The backfill counts ROWS across both tables (two here).
        assertTrue(TestServices.successionPlans.encryptLegacyRows() >= 2)
        assertTrue(rawLossImpact(legacyPlanId).startsWith(FieldCipher.PREFIX))
        assertTrue(rawCompetencyGaps(legacyNominationId).startsWith(FieldCipher.PREFIX))
        // The plaintext survives the wrap.
        val read = TestServices.successionPlans.read(legacyPlanId)!!
        assertEquals(listOf("legacy plain impact"), read.lossImpact)
        // The pre-flag STRING element shape lifts to filled = false (the lenient decode).
        assertEquals(
            listOf(SuccessionCompetencyGap("legacy plain gap", filled = false)),
            read.nominations.single().competencyGaps,
        )
        // Idempotent: a second pass finds nothing legacy.
        assertEquals(0, TestServices.successionPlans.encryptLegacyRows())

        // Rotation: with (new, previous=old) every row is rewritten under the new key alone.
        val newKey = "0000000000000000000000000000000000000000000000000000000000000010"
        val rotatingService = SuccessionPlanService(
            TestServices.successionPlans.database,
            FieldCipher(newKey, previousKeyHex = DEV_DATA_ENCRYPTION_KEY),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 2)
        assertEquals(
            """["legacy plain impact"]""",
            FieldCipher(newKey).decrypt(rawLossImpact(legacyPlanId)),
        )
        assertEquals(0, rotatingService.encryptLegacyRows())
    }
}
