package ch.nokillswit

import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.oneonones.ActionItemOwner
import ch.nokillswit.oneonones.OneOnOneActionItemInput
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.oneonones.OneOnOneItemInput
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
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
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Encryption-at-rest of 1:1 meeting content: what PostgreSQL stores in one_on_one_notes.content
 * and one_on_one_action_items.content is an `enc:v1:` AES-GCM envelope, while the API serves
 * plaintext; the plaintext event params never carry item text. Raw column state is asserted by
 * selecting the Exposed tables directly, bypassing the service's decrypt layer.
 */
class OneOnOneEncryptionTest {

    private suspend fun rawNoteContents(meetingId: UInt): List<String> =
        suspendTransaction(TestServices.oneOnOnes.database) {
            OneOnOneService.Notes.selectAll()
                .where { OneOnOneService.Notes.meetingId eq meetingId }
                .map { it[OneOnOneService.Notes.content] }
                .toList()
        }

    private suspend fun rawActionItemContents(meetingId: UInt): List<String> =
        suspendTransaction(TestServices.oneOnOnes.database) {
            OneOnOneService.ActionItems.selectAll()
                .where { OneOnOneService.ActionItems.meetingId eq meetingId }
                .map { it[OneOnOneService.ActionItems.content] }
                .toList()
        }

    @Test
    fun `note and action item content are ciphertext in the DB but plaintext over the API`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("subordinate"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "oo-enc-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        val manager = authedClient(managerEmail, "pw")

        val secretPoint = "Confidential point: struggling with the migration"
        val secretDecision = "Confidential decision: move them off the project"
        val secretAction = "Confidential action: arrange coaching sessions"
        val created = manager.post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(
                OneOnOneCreateRequest(
                    subordinateId = subordinateId,
                    meetingDate = "2026-07-01",
                    points = listOf(OneOnOneItemInput(content = secretPoint)),
                    decisions = listOf(OneOnOneItemInput(content = secretDecision)),
                    actionItems = listOf(
                        OneOnOneActionItemInput(content = secretAction, owner = ActionItemOwner.MANAGER),
                    ),
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val meeting = created.body<OneOnOneResponse>()

        // What the DB (a database-level attacker) sees: envelopes, no plaintext substring.
        val rawNotes = rawNoteContents(meeting.id)
        assertEquals(2, rawNotes.size)
        rawNotes.forEach { raw ->
            assertTrue(raw.startsWith(FieldCipher.PREFIX))
            assertFalse("Confidential" in raw)
        }
        val rawItems = rawActionItemContents(meeting.id)
        assertEquals(1, rawItems.size)
        assertTrue(rawItems.single().startsWith(FieldCipher.PREFIX))
        assertFalse("coaching" in rawItems.single())

        // What the API serves: the plaintext, decrypted transparently.
        val fetched = manager.get("/api/v1/one-on-ones/${meeting.id}").body<OneOnOneResponse>()
        assertEquals(secretPoint, fetched.points.single().content)
        assertEquals(secretDecision, fetched.decisions.single().content)
        assertEquals(secretAction, fetched.actionItems.single().content)

        // The event trail is plaintext by design — so it must never carry item text.
        val rawEventParams = suspendTransaction(TestServices.oneOnOnes.database) {
            ch.nokillswit.oneonones.OneOnOneEventService.OneOnOneEvents.selectAll()
                .where { ch.nokillswit.oneonones.OneOnOneEventService.OneOnOneEvents.meetingId eq meeting.id }
                .map { it[ch.nokillswit.oneonones.OneOnOneEventService.OneOnOneEvents.params] }
                .toList()
        }
        assertTrue(rawEventParams.isNotEmpty())
        rawEventParams.forEach { assertFalse("Confidential" in it) }
    }

    @Test
    fun `carried-over copies are re-encrypted rather than blanked or leaked`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("manager")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("subordinate"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "oo-enc-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        val manager = authedClient(managerEmail, "pw")

        val first = manager.post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(
                OneOnOneCreateRequest(
                    subordinateId = subordinateId, meetingDate = "2026-07-01",
                    actionItems = listOf(
                        OneOnOneActionItemInput(content = "carry me secretly", owner = ActionItemOwner.MANAGER),
                    ),
                ),
            )
        }.body<OneOnOneResponse>()
        val second = manager.post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(OneOnOneCreateRequest(subordinateId = subordinateId, meetingDate = "2026-07-08"))
        }.body<OneOnOneResponse>()

        assertEquals("carry me secretly", second.actionItems.single().content)
        assertEquals(first.actionItems.single().id, second.actionItems.single().copiedFromId)
        val raw = rawActionItemContents(second.id).single()
        assertTrue(raw.startsWith(FieldCipher.PREFIX))
        assertFalse("secretly" in raw)
    }

    @Test
    fun `rotation - encryptLegacyRows rewrites both tables under the current key`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(uniqueEmail("manager"), "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("subordinate"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "oo-rot-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        val oldKey = DEV_DATA_ENCRYPTION_KEY
        val newKey = "0000000000000000000000000000000000000000000000000000000000000007"

        // Rows encrypted under the old key (as the whole DB is before a rotation), written at the
        // service level with the dev-default cipher.
        val created = TestServices.oneOnOnes.create(
            managerId,
            OneOnOneCreateRequest(
                subordinateId = subordinateId,
                meetingDate = "2026-07-01",
                points = listOf(OneOnOneItemInput(content = "rotate this point")),
                actionItems = listOf(
                    OneOnOneActionItemInput(content = "rotate this action", owner = ActionItemOwner.MANAGER),
                ),
            ),
        )

        // Boot-time state during rotation: current = new key, previous = old key.
        val rotatingService = OneOnOneService(
            TestServices.oneOnOnes.database,
            FieldCipher(newKey, previousKeyHex = oldKey),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 2)

        // After the backfill the new key ALONE decrypts both tables — the old key can be retired.
        val note = rawNoteContents(created.id).single()
        assertEquals("rotate this point", FieldCipher(newKey).decrypt(note))
        val item = rawActionItemContents(created.id).single()
        assertEquals("rotate this action", FieldCipher(newKey).decrypt(item))
        // Idempotent second pass without rotation finds nothing legacy.
        assertEquals(0, rotatingService.encryptLegacyRows())
    }
}
