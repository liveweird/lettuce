package ch.nokillswit

import ch.nokillswit.impactlog.ImpactEntryRequest
import ch.nokillswit.impactlog.ImpactEntryResponse
import ch.nokillswit.impactlog.ImpactLogService
import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Encryption-at-rest of impact log entries: what PostgreSQL stores in the four section columns
 * is an `enc:v1:` AES-GCM envelope, while the API serves plaintext; the period dates stay
 * plaintext by design (lists sort on them) and the plaintext event params never carry section
 * text. Raw column state is asserted by selecting the Exposed table directly, bypassing the
 * service's decrypt layer.
 */
class ImpactLogEncryptionTest {

    private data class RawEntry(
        val title: String,
        val periodStart: String,
        val whatHappened: String,
        val contribution: String,
        val whyItMattered: String,
        val evidence: String,
    )

    private suspend fun rawEntry(id: UInt): RawEntry =
        suspendTransaction(TestServices.impactLog.database) {
            ImpactLogService.Entries.selectAll()
                .where { ImpactLogService.Entries.id eq id }
                .map {
                    RawEntry(
                        title = it[ImpactLogService.Entries.title],
                        periodStart = it[ImpactLogService.Entries.periodStart],
                        whatHappened = it[ImpactLogService.Entries.whatHappened],
                        contribution = it[ImpactLogService.Entries.contribution],
                        whyItMattered = it[ImpactLogService.Entries.whyItMattered],
                        evidence = it[ImpactLogService.Entries.evidence],
                    )
                }
                .singleOrNull()!!
        }

    private fun secretBody() = ImpactEntryRequest(
        title = "Public title",
        periodStart = "2026-07-01",
        periodEnd = "2026-07-31",
        whatHappened = "Confidential happening: the acquisition dry-run",
        contribution = "Confidential contribution: led the diligence room",
        whyItMattered = "Confidential impact: the board decision",
        evidence = "Confidential evidence: CEO's note",
    )

    @Test
    fun `all four sections are ciphertext in the DB but plaintext over the API`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("impact-enc-owner")
        TestUsers.seed(ownerEmail, "pw", roles = emptySet())
        val owner = authedClient(ownerEmail, "pw")

        val created = owner.post("/api/v1/impact-log") {
            contentType(ContentType.Application.Json)
            setBody(secretBody())
        }.body<ImpactEntryResponse>()

        // What the DB (a database-level attacker) sees: envelopes for every section, the period
        // dates in plain view (deliberate — lists sort on them).
        val raw = rawEntry(created.id)
        // The title is deliberately in plain view (lists sort/filter on it — the goals rule).
        assertEquals("Public title", raw.title)
        assertEquals("2026-07-01", raw.periodStart)
        listOf(raw.whatHappened, raw.contribution, raw.whyItMattered, raw.evidence).forEach {
            assertTrue(it.startsWith(FieldCipher.PREFIX))
            assertFalse("Confidential" in it)
        }

        // What the API serves: the plaintext, decrypted transparently — the list preview too.
        val fetched = owner.get("/api/v1/impact-log/${created.id}").body<ImpactEntryResponse>()
        assertEquals(secretBody().whatHappened, fetched.whatHappened)
        assertEquals(secretBody().evidence, fetched.evidence)

        // The event trail is plaintext by design — so it must never carry the secret texts.
        val events = ch.nokillswit.impactlog.ImpactLogEventService.ImpactLogEvents
        val rawEventParams = suspendTransaction(TestServices.impactLog.database) {
            events.selectAll()
                .where { events.entryId eq created.id }
                .map { it[events.params] }
                .toList()
        }
        assertTrue(rawEventParams.isNotEmpty())
        rawEventParams.forEach { assertFalse("Confidential" in it) }
    }

    @Test
    fun `legacy plaintext rows are encrypted by the startup backfill, and rotation rewrites them`() = testApplication {
        usePostgresTestcontainer()
        val ownerId = TestUsers.seed(uniqueEmail("impact-legacy-owner"), "pw", roles = emptySet())

        // A pre-encryption row, as a legacy deployment would have written it.
        val now = System.currentTimeMillis()
        val legacyId = suspendTransaction(TestServices.impactLog.database) {
            ImpactLogService.Entries.insert {
                it[ImpactLogService.Entries.userId] = ownerId
                it[ImpactLogService.Entries.title] = "legacy title"
                it[ImpactLogService.Entries.periodStart] = "2026-01-01"
                it[ImpactLogService.Entries.periodEnd] = "2026-01-31"
                it[ImpactLogService.Entries.whatHappened] = "legacy plain happening"
                it[ImpactLogService.Entries.contribution] = "legacy plain contribution"
                it[ImpactLogService.Entries.whyItMattered] = "legacy plain impact"
                it[ImpactLogService.Entries.evidence] = "legacy plain evidence"
                it[ImpactLogService.Entries.createdAt] = now
                it[ImpactLogService.Entries.lastModified] = now
            }[ImpactLogService.Entries.id].value
        }

        // The backfill counts ROWS (one here — all four columns rewritten together).
        assertTrue(TestServices.impactLog.encryptLegacyRows() >= 1)
        val raw = rawEntry(legacyId)
        assertTrue(raw.whatHappened.startsWith(FieldCipher.PREFIX))
        assertTrue(raw.evidence.startsWith(FieldCipher.PREFIX))
        // The plaintext survives the wrap.
        assertEquals("legacy plain happening", TestServices.impactLog.read(legacyId)!!.whatHappened)
        // Idempotent: a second pass finds nothing legacy.
        assertEquals(0, TestServices.impactLog.encryptLegacyRows())

        // Rotation: with (new, previous=old) every row is rewritten under the new key alone.
        val newKey = "0000000000000000000000000000000000000000000000000000000000000009"
        val rotatingService = ImpactLogService(
            TestServices.impactLog.database,
            FieldCipher(newKey, previousKeyHex = DEV_DATA_ENCRYPTION_KEY),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 1)
        assertEquals("legacy plain contribution", FieldCipher(newKey).decrypt(rawEntry(legacyId).contribution))
        assertEquals(0, rotatingService.encryptLegacyRows())
    }
}
