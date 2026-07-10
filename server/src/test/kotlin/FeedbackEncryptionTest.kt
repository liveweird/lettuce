package ch.nokillswit

import ch.nokillswit.feedbacks.FeedbackCreateRequest
import ch.nokillswit.feedbacks.FeedbackContentUpdate
import ch.nokillswit.feedbacks.FeedbackResponse
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.single

/**
 * Encryption-at-rest of feedback content: what PostgreSQL stores is an `enc:v1:` AES-GCM
 * envelope, while the API serves plaintext. Raw column state is asserted by selecting the
 * Exposed table directly, bypassing the service's decrypt layer.
 */
class FeedbackEncryptionTest {

    private data class RawRow(val content: String, val requesterMessage: String?)

    private suspend fun rawRow(id: UInt): RawRow =
        suspendTransaction(TestServices.feedbacks.database) {
            FeedbackService.Feedbacks.selectAll()
                .where { FeedbackService.Feedbacks.id eq id }
                .map {
                    RawRow(
                        it[FeedbackService.Feedbacks.content],
                        it[FeedbackService.Feedbacks.requesterMessage],
                    )
                }
                .single()
        }

    @Test
    fun `content and requester message are ciphertext in the DB but plaintext over the API`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw")
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw")
        val requesterId = TestUsers.seed(email = uniqueEmail("requester"), password = "pw")
        val client = authedClient(providerEmail, "pw")

        val content = "Confidential: needs to work on estimation"
        val message = "Please be candid"
        val created = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    requesterId = requesterId,
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT,
                    status = FeedbackStatus.REQUESTED,
                    content = content,
                    requesterMessage = message,
                )
            )
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val id = created.body<FeedbackResponse>().id

        // What the DB (a database-level attacker) sees: envelopes, no plaintext substring.
        val raw = rawRow(id)
        assertTrue(raw.content.startsWith(FieldCipher.PREFIX))
        assertFalse(raw.content.contains("estimation"))
        assertNotNull(raw.requesterMessage)
        assertTrue(raw.requesterMessage.startsWith(FieldCipher.PREFIX))
        assertFalse(raw.requesterMessage.contains("candid"))

        // What the API serves: the plaintext, decrypted transparently.
        val fetched = client.get("/api/v1/feedbacks/$id").body<FeedbackResponse>()
        assertEquals(content, fetched.content)
        assertEquals(message, fetched.requesterMessage)
    }

    @Test
    fun `edited content is re-encrypted`() = testApplication {
        usePostgresTestcontainer()
        val providerEmail = uniqueEmail("provider")
        val providerId = TestUsers.seed(email = providerEmail, password = "pw")
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw")
        val client = authedClient(providerEmail, "pw")

        val id = client.post("/api/v1/feedbacks") {
            contentType(ContentType.Application.Json)
            setBody(
                FeedbackCreateRequest(
                    subjectId = subjectId,
                    providerId = providerId,
                    visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                    status = FeedbackStatus.DRAFT,
                    content = "first version",
                )
            )
        }.body<FeedbackResponse>().id

        val updated = client.put("/api/v1/feedbacks/$id") {
            contentType(ContentType.Application.Json)
            setBody(FeedbackContentUpdate(content = "second version", visibility = FeedbackVisibility.PROVIDER_SUBJECT))
        }
        assertEquals(HttpStatusCode.NoContent, updated.status)

        val raw = rawRow(id)
        assertTrue(raw.content.startsWith(FieldCipher.PREFIX))
        assertFalse(raw.content.contains("second version"))
        assertEquals("second version", client.get("/api/v1/feedbacks/$id").body<FeedbackResponse>().content)
    }

    @Test
    fun `the startup backfill encrypts legacy plaintext rows`() = testApplication {
        usePostgresTestcontainer()
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw")

        // A row written before the cipher existed: raw plaintext, inserted below the service.
        val legacyId = suspendTransaction(TestServices.feedbacks.database) {
            FeedbackService.Feedbacks.insert {
                it[FeedbackService.Feedbacks.subjectId] = subjectId
                it[FeedbackService.Feedbacks.providerId] = providerId
                it[visibility] = FeedbackVisibility.PROVIDER_SUBJECT
                it[status] = FeedbackStatus.DRAFT
                it[content] = "legacy plaintext row"
                it[requesterMessage] = "legacy plaintext message"
                it[lastModified] = System.currentTimeMillis()
            }[FeedbackService.Feedbacks.id].value
        }

        val rewritten = TestServices.feedbacks.encryptLegacyRows()
        assertTrue(rewritten >= 1)

        val raw = rawRow(legacyId)
        assertTrue(raw.content.startsWith(FieldCipher.PREFIX))
        assertTrue(raw.requesterMessage!!.startsWith(FieldCipher.PREFIX))
        // The service reads it back decrypted, and a second pass finds nothing legacy about it.
        assertEquals("legacy plaintext row", TestServices.feedbacks.read(legacyId)?.content)
        val rawAfterFirstPass = rawRow(legacyId)
        TestServices.feedbacks.encryptLegacyRows()
        assertEquals(rawAfterFirstPass, rawRow(legacyId))
    }

    @Test
    fun `rotation - reencryptAll rewrites previous-key rows under the current key`() = testApplication {
        usePostgresTestcontainer()
        val providerId = TestUsers.seed(email = uniqueEmail("provider"), password = "pw")
        val subjectId = TestUsers.seed(email = uniqueEmail("subject"), password = "pw")
        val oldKey = DEV_DATA_ENCRYPTION_KEY
        val newKey = "0000000000000000000000000000000000000000000000000000000000000003"

        // A row encrypted under the old key (as the whole DB is before a rotation).
        val id = TestServices.feedbacks.create(
            ch.nokillswit.feedbacks.Feedback(
                subjectId = subjectId,
                providerId = providerId,
                visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                status = FeedbackStatus.DRAFT,
                content = "rotate me",
            )
        ).id

        // Boot-time state during rotation: current = new key, previous = old key.
        val rotatingService = FeedbackService(
            TestServices.feedbacks.database,
            FieldCipher(newKey, previousKeyHex = oldKey),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 1)

        // After the backfill the new key ALONE decrypts the row — the old key can be retired.
        val raw = rawRow(id)
        assertEquals("rotate me", FieldCipher(newKey).decrypt(raw.content))
    }

    @Test
    fun `the committed dev encryption key refuses to start outside development`() = testApplication {
        configureApp(
            "jwt.secret" to "strong-${java.util.UUID.randomUUID()}",
            "bootstrap.adminInitialPassword" to "rotated-${java.util.UUID.randomUUID()}",
            // The dev-default `log` mail transport is refused in production (see infra/mail).
            "mail.transport" to "disabled",
        )
        serverConfig { developmentMode = false }
        try {
            val failure = runCatching { startApplication() }.exceptionOrNull()
            assertNotNull(failure, "startup must fail closed on the burned committed encryption key")
            val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
            assertTrue("Data encryption key" in messages, "unexpected startup failure: $messages")
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `a malformed encryption key fails startup even in development`() = testApplication {
        configureApp("security.encryption.key" to "not-a-hex-key")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "a key that cannot encrypt must fail startup in any mode")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("hex characters" in messages, "unexpected startup failure: $messages")
    }
}
