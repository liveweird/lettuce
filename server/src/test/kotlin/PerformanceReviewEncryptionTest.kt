package ch.nokillswit

import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.reviews.CategoryAssessment
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.reviews.PerformanceReviewResponse
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.teams.Team
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Encryption-at-rest of performance-review content: what PostgreSQL stores in the four
 * `*_summary` columns is an `enc:v1:` AES-GCM envelope, while the API serves plaintext; the
 * numeric ratings stay plaintext by design (lists carry them, calculations run on them) and the
 * plaintext event params never carry the summary texts. Raw column state is asserted by
 * selecting the Exposed table directly, bypassing the service's decrypt layer.
 */
class PerformanceReviewEncryptionTest {

    private data class RawReview(
        val attitudeRating: Short?,
        val attitudeSummary: String?,
        val overallSummary: String?,
    )

    private suspend fun rawReview(id: UInt): RawReview =
        suspendTransaction(TestServices.performanceReviews.database) {
            val t = PerformanceReviewService.Reviews
            t.selectAll()
                .where { t.id eq id }
                .map {
                    RawReview(
                        attitudeRating = it[t.attitudeRating],
                        attitudeSummary = it[t.attitudeSummary],
                        overallSummary = it[t.overallSummary],
                    )
                }
                .singleOrNull()!!
        }

    @Test
    fun `summaries are ciphertext in the DB but plaintext over the API, ratings plain numbers`() =
        testApplication {
            usePostgresTestcontainer()
            val managerEmail = uniqueEmail("review-enc-manager")
            val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
            val subordinateId = TestUsers.seed(uniqueEmail("review-enc-sub"), "pw", roles = emptySet())
            val teamId = TestServices.teams.create(
                Team(name = "review-enc-${UUID.randomUUID()}", managerId = managerId),
            )
            TestServices.teams.addMember(teamId, subordinateId)
            val period = TestReviewPeriods.append()
            val manager = authedClient(managerEmail, "pw")

            val secret = "Confidential assessment: struggles under pressure"
            val response = manager.post("/api/v1/performance-reviews") {
                contentType(ContentType.Application.Json)
                setBody(
                    PerformanceReviewCreateRequest(
                        subordinateId = subordinateId,
                        periodId = period.id,
                        attitude = CategoryAssessment(2, secret),
                    ),
                )
            }
            assertEquals(HttpStatusCode.Created, response.status)
            val created = response.body<PerformanceReviewResponse>()

            // What the DB (a database-level attacker) sees: an envelope for the summary, the
            // rating as a plain number (deliberate), NULL for the unset summary.
            val raw = rawReview(created.id)
            assertEquals(2, raw.attitudeRating?.toInt())
            assertTrue(raw.attitudeSummary!!.startsWith(FieldCipher.PREFIX))
            assertFalse("Confidential" in raw.attitudeSummary)
            assertNull(raw.overallSummary)

            // What the API serves: the plaintext, decrypted transparently.
            val fetched = manager.get("/api/v1/performance-reviews/${created.id}")
                .body<PerformanceReviewResponse>()
            assertEquals(secret, fetched.attitude.summary)

            // The event trail is plaintext by design — so it must never carry the secret texts.
            val rawEventParams = suspendTransaction(TestServices.performanceReviews.database) {
                val e = ch.nokillswit.reviews.PerformanceReviewEventService.ReviewEvents
                e.selectAll()
                    .where { e.reviewId eq created.id }
                    .map { it[e.params] }
                    .toList()
            }
            assertTrue(rawEventParams.isNotEmpty())
            rawEventParams.forEach { assertFalse("Confidential" in it) }
        }

    @Test
    fun `legacy plaintext rows are encrypted by the startup backfill`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(uniqueEmail("review-legacy-manager"), "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("review-legacy-sub"), "pw", roles = emptySet())
        val period = TestReviewPeriods.append()

        // A pre-encryption row, as a legacy deployment would have written it.
        val now = System.currentTimeMillis()
        val legacyId = suspendTransaction(TestServices.performanceReviews.database) {
            val t = PerformanceReviewService.Reviews
            t.insert {
                it[t.managerId] = managerId
                it[t.subordinateId] = subordinateId
                it[t.periodId] = period.id
                it[t.createdAt] = now
                it[t.status] = PerformanceReviewStatus.DRAFT
                it[t.attitudeRating] = 3.toShort()
                it[t.attitudeSummary] = "legacy plain attitude"
                it[t.overallSummary] = "legacy plain overall"
                it[t.lastModified] = now
            }[t.id].value
        }

        assertTrue(TestServices.performanceReviews.encryptLegacyRows() >= 1)
        val raw = rawReview(legacyId)
        assertTrue(raw.attitudeSummary!!.startsWith(FieldCipher.PREFIX))
        assertTrue(raw.overallSummary!!.startsWith(FieldCipher.PREFIX))
        // The plaintext survives the wrap; the untouched columns stay NULL.
        val read = TestServices.performanceReviews.read(legacyId)!!
        assertEquals("legacy plain attitude", read.attitude.summary)
        assertEquals("legacy plain overall", read.overall.summary)
        assertNull(read.delivery.summary)
        // Idempotent: a second pass finds nothing legacy.
        assertEquals(0, TestServices.performanceReviews.encryptLegacyRows())
    }

    @Test
    fun `rotation - encryptLegacyRows rewrites every summary under the current key`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(uniqueEmail("review-rot-manager"), "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("review-rot-sub"), "pw", roles = emptySet())
        val period = TestReviewPeriods.append()
        val oldKey = DEV_DATA_ENCRYPTION_KEY
        val newKey = "0000000000000000000000000000000000000000000000000000000000000011"

        // A row encrypted under the old key, written at the service level with the dev cipher.
        val id = TestServices.performanceReviews.create(
            managerId,
            PerformanceReviewCreateRequest(
                subordinateId = subordinateId,
                periodId = period.id,
                attitude = CategoryAssessment(4, "rotate this attitude"),
                overall = CategoryAssessment(5, "rotate this overall"),
            ),
        )

        // Boot-time state during rotation: current = new key, previous = old key.
        val rotatingService = PerformanceReviewService(
            TestServices.performanceReviews.database,
            FieldCipher(newKey, previousKeyHex = oldKey),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 1)

        // After the backfill the new key ALONE decrypts the summaries — the old key can be retired.
        val raw = rawReview(id)
        assertEquals("rotate this attitude", FieldCipher(newKey).decrypt(raw.attitudeSummary!!))
        assertEquals("rotate this overall", FieldCipher(newKey).decrypt(raw.overallSummary!!))
        // Idempotent second pass without rotation finds nothing legacy.
        assertEquals(0, rotatingService.encryptLegacyRows())
    }
}
