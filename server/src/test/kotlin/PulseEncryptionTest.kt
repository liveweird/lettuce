package ch.nokillswit

import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.pulse.PulseCycleCreateRequest
import ch.nokillswit.pulse.PulseCycleStatus
import ch.nokillswit.pulse.PulseMyResponse
import ch.nokillswit.pulse.PulseResponseService
import ch.nokillswit.pulse.PulseResponseSubmitRequest
import ch.nokillswit.pulse.PulseScaleAnswer
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Encryption-at-rest of pulse responses: PostgreSQL stores `enc:v1:` envelopes in all six
 * scored-answer columns and the comment, while the owner's my-response read serves plaintext.
 * Backfill and key rotation follow the GoalEncryptionTest pattern.
 */
class PulseEncryptionTest {

    private data class RawResponse(
        val enps: String, val driver1: String, val driver2: String, val driver3: String,
        val driver4: String, val rotating: String, val comment: String?,
    )

    private suspend fun rawResponse(cycleId: UInt, userId: UInt): RawResponse =
        suspendTransaction(TestServices.users.database) {
            val t = PulseResponseService.PulseResponses
            t.selectAll()
                .where { (t.cycleId eq cycleId) and (t.userId eq userId) }
                .map {
                    RawResponse(
                        enps = it[t.enps], driver1 = it[t.driver1], driver2 = it[t.driver2],
                        driver3 = it[t.driver3], driver4 = it[t.driver4], rotating = it[t.rotating],
                        comment = it[t.comment],
                    )
                }
                .singleOrNull()!!
        }

    private fun RawResponse.allColumns() =
        listOf(enps, driver1, driver2, driver3, driver4, rotating) + listOfNotNull(comment)

    @Test
    fun `all seven columns are ciphertext in the DB but plaintext for the owner`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val userEmail = uniqueEmail("pulse-enc")
        val userId = TestUsers.seed(userEmail, "pw", roles = emptySet())
        val cycleId = TestPulse.cycles.schedule(PulseCycleCreateRequest("2099-01-01", "2099-01-08"))
        try {
            TestPulse.addParticipants(cycleId, listOf(userId))
            TestPulse.forceStatus(cycleId, PulseCycleStatus.OPEN, openedAt = System.currentTimeMillis())

            val user = authedClient(userEmail, "pw")
            val secret = "Confidential feelings about leadership"
            assertEquals(
                HttpStatusCode.NoContent,
                user.put("/api/v1/pulse-surveys/cycles/$cycleId/my-response") {
                    contentType(ContentType.Application.Json)
                    setBody(
                        PulseResponseSubmitRequest(
                            enps = 3,
                            q2 = PulseScaleAnswer.DISAGREE,
                            q3 = PulseScaleAnswer.NEITHER,
                            q4 = PulseScaleAnswer.AGREE,
                            q5 = PulseScaleAnswer.NOT_APPLICABLE,
                            rotating = PulseScaleAnswer.STRONGLY_DISAGREE,
                            comment = secret,
                        ),
                    )
                }.status,
            )

            val raw = rawResponse(cycleId, userId)
            raw.allColumns().forEach { assertTrue(it.startsWith(FieldCipher.PREFIX), "not enveloped: $it") }
            assertFalse("Confidential" in raw.comment!!)
            // No bare score strings anywhere in the raw row.
            assertFalse(raw.enps == "3")

            val readBack = user.get("/api/v1/pulse-surveys/cycles/$cycleId/my-response").body<PulseMyResponse>()
            assertEquals(3, readBack.enps)
            assertEquals(secret, readBack.comment)
        } finally {
            TestPulse.sweepNonTerminal()
        }
    }

    @Test
    fun `legacy plaintext rows are encrypted by the startup backfill`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val userId = TestUsers.seed(uniqueEmail("pulse-legacy"), "pw", roles = emptySet())
        val cycleId = TestPulse.cycles.schedule(PulseCycleCreateRequest("2099-01-01", "2099-01-08"))
        TestPulse.addParticipants(cycleId, listOf(userId))
        TestPulse.forceStatus(cycleId, PulseCycleStatus.CLOSED, closedAt = System.currentTimeMillis())

        // A pre-encryption row, as a legacy deployment would have written it.
        val now = System.currentTimeMillis()
        suspendTransaction(TestServices.users.database) {
            val t = PulseResponseService.PulseResponses
            t.insert {
                it[t.cycleId] = cycleId
                it[t.userId] = userId
                it[t.enps] = "7"
                it[t.driver1] = "4"
                it[t.driver2] = "3"
                it[t.driver3] = "NA"
                it[t.driver4] = "5"
                it[t.rotating] = "2"
                it[t.comment] = "legacy plain comment"
                it[t.submittedAt] = now
                it[t.lastModified] = now
            }
        }

        assertTrue(TestPulse.responses.encryptLegacyRows() >= 1)
        val raw = rawResponse(cycleId, userId)
        raw.allColumns().forEach { assertTrue(it.startsWith(FieldCipher.PREFIX)) }
        // The plaintext survives the wrap (decrypted at the service layer).
        assertEquals(7, TestPulse.responses.myResponse(cycleId, userId)!!.enps)
        assertEquals("legacy plain comment", TestPulse.responses.myResponse(cycleId, userId)!!.comment)
        // Idempotent: a second pass finds nothing legacy.
        assertEquals(0, TestPulse.responses.encryptLegacyRows())
    }

    @Test
    fun `rotation - encryptLegacyRows rewrites every column under the current key`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val userId = TestUsers.seed(uniqueEmail("pulse-rot"), "pw", roles = emptySet())
        val cycleId = TestPulse.cycles.schedule(PulseCycleCreateRequest("2099-01-01", "2099-01-08"))
        TestPulse.addParticipants(cycleId, listOf(userId))
        TestPulse.forceStatus(cycleId, PulseCycleStatus.CLOSED, closedAt = System.currentTimeMillis())
        // Written under the old (dev-default) key.
        TestPulse.responses.upsert(
            cycleId,
            userId,
            PulseResponseSubmitRequest(
                enps = 9,
                q2 = PulseScaleAnswer.AGREE,
                q3 = PulseScaleAnswer.AGREE,
                q4 = PulseScaleAnswer.AGREE,
                q5 = PulseScaleAnswer.AGREE,
                rotating = PulseScaleAnswer.AGREE,
                comment = "rotate this comment",
            ),
        )

        val newKey = "0000000000000000000000000000000000000000000000000000000000000011"
        val rotatingService = PulseResponseService(
            TestServices.users.database,
            FieldCipher(newKey, previousKeyHex = DEV_DATA_ENCRYPTION_KEY),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 1)

        // The new key ALONE decrypts everything — the old key can be retired.
        val raw = rawResponse(cycleId, userId)
        val newOnly = FieldCipher(newKey)
        assertEquals("9", newOnly.decrypt(raw.enps))
        assertEquals("rotate this comment", newOnly.decrypt(raw.comment!!))
        assertEquals(0, rotatingService.encryptLegacyRows())
    }
}
