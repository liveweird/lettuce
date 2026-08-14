package ch.nokillswit

import ch.nokillswit.goals.GoalArchiveRequest
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalResponse
import ch.nokillswit.goals.GoalService
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
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
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Encryption-at-rest of goal content: what PostgreSQL stores in goals.description and
 * goals.summary is an `enc:v1:` AES-GCM envelope, while the API serves plaintext; the title stays
 * plaintext by design (lists sort/filter on it) and the plaintext event params never carry the
 * secret texts. Raw column state is asserted by selecting the Exposed table directly, bypassing
 * the service's decrypt layer.
 */
class GoalEncryptionTest {

    private data class RawGoal(val title: String, val description: String, val summary: String?)

    private suspend fun rawGoal(id: UInt): RawGoal =
        suspendTransaction(TestServices.goals.database) {
            GoalService.Goals.selectAll()
                .where { GoalService.Goals.id eq id }
                .map {
                    RawGoal(
                        title = it[GoalService.Goals.title],
                        description = it[GoalService.Goals.description],
                        summary = it[GoalService.Goals.summary],
                    )
                }
                .singleOrNull()!!
        }

    @Test
    fun `description and summary are ciphertext in the DB but plaintext over the API`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("goal-enc-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("goal-enc-sub"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "goal-enc-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        val manager = authedClient(managerEmail, "pw")

        val secretDescription = "Confidential description: performance concerns"
        val secretSummary = "Confidential summary: goal missed, PIP next"
        val created = manager.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subordinateId,
                    title = "Public title",
                    description = secretDescription,
                    type = GoalType.BINARY,
                    dueDate = "2099-12-31",
                ),
            )
        }.body<GoalResponse>()
        manager.post("/api/v1/goals/${created.id}/activate")
        assertEquals(
            HttpStatusCode.NoContent,
            manager.post("/api/v1/goals/${created.id}/archive") {
                contentType(ContentType.Application.Json)
                setBody(GoalArchiveRequest(summary = secretSummary))
            }.status,
        )

        // What the DB (a database-level attacker) sees: envelopes for the secret columns, the
        // title in plain view (deliberate — it is list-sortable/filterable).
        val raw = rawGoal(created.id)
        assertEquals("Public title", raw.title)
        assertTrue(raw.description.startsWith(FieldCipher.PREFIX))
        assertFalse("Confidential" in raw.description)
        assertTrue(raw.summary!!.startsWith(FieldCipher.PREFIX))
        assertFalse("Confidential" in raw.summary)

        // What the API serves: the plaintext, decrypted transparently.
        val fetched = manager.get("/api/v1/goals/${created.id}").body<GoalResponse>()
        assertEquals(secretDescription, fetched.description)
        assertEquals(secretSummary, fetched.summary)

        // The event trail is plaintext by design — so it must never carry the secret texts.
        val rawEventParams = suspendTransaction(TestServices.goals.database) {
            ch.nokillswit.goals.GoalEventService.GoalEvents.selectAll()
                .where { ch.nokillswit.goals.GoalEventService.GoalEvents.goalId eq created.id }
                .map { it[ch.nokillswit.goals.GoalEventService.GoalEvents.params] }
                .toList()
        }
        assertTrue(rawEventParams.isNotEmpty())
        rawEventParams.forEach { assertFalse("Confidential" in it) }
    }

    @Test
    fun `progress-update comments are ciphertext in the DB but plaintext over the API`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("goal-cenc-manager")
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("goal-cenc-sub"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "goal-cenc-${UUID.randomUUID()}", managerId = managerId))
        TestServices.teams.addMember(teamId, subordinateId)
        val manager = authedClient(managerEmail, "pw")

        val secretComment = "Confidential comment: struggled with the vendor outage"
        val created = manager.post("/api/v1/goals") {
            contentType(ContentType.Application.Json)
            setBody(
                GoalCreateRequest(
                    subordinateId = subordinateId,
                    title = "Commented goal",
                    description = "d",
                    type = GoalType.NUMBER,
                    targetValue = 10.0,
                    dueDate = "2099-12-31",
                ),
            )
        }.body<GoalResponse>()
        manager.post("/api/v1/goals/${created.id}/activate")
        manager.put("/api/v1/goals/${created.id}/progress") {
            contentType(ContentType.Application.Json)
            setBody(ch.nokillswit.goals.GoalProgressUpdate(currentValue = 2.0, comment = secretComment))
        }

        // Raw column: an envelope, never the plaintext — and params stay comment-free.
        val rawRows = suspendTransaction(TestServices.goals.database) {
            ch.nokillswit.goals.GoalEventService.GoalEvents.selectAll()
                .where { ch.nokillswit.goals.GoalEventService.GoalEvents.goalId eq created.id }
                .map {
                    it[ch.nokillswit.goals.GoalEventService.GoalEvents.params] to
                        it[ch.nokillswit.goals.GoalEventService.GoalEvents.comment]
                }
                .toList()
        }
        val rawComment = rawRows.mapNotNull { it.second }.single()
        assertTrue(rawComment.startsWith(FieldCipher.PREFIX))
        assertFalse("Confidential" in rawComment)
        rawRows.forEach { (params, _) -> assertFalse("Confidential" in params) }

        // The API decrypts transparently.
        val events = manager.get("/api/v1/goals/${created.id}/events")
            .body<ch.nokillswit.goals.GoalEventListResponse>()
        assertEquals(secretComment, events.items.single { it.comment != null }.comment)
    }

    @Test
    fun `legacy plaintext event comments are encrypted by the startup backfill and rotation`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(uniqueEmail("goal-clegacy-manager"), "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("goal-clegacy-sub"), "pw", roles = emptySet())

        // A goal plus a pre-encryption event row with a plaintext comment.
        val goalId = TestServices.goals.create(
            managerId,
            GoalCreateRequest(
                subordinateId = subordinateId,
                title = "Legacy comment goal",
                description = "d",
                type = GoalType.NUMBER,
                targetValue = 5.0,
                dueDate = "2099-12-31",
            ),
        )
        val events = ch.nokillswit.goals.GoalEventService.GoalEvents
        val legacyEventId = suspendTransaction(TestServices.goals.database) {
            events.insert {
                it[events.goalId] = goalId
                it[events.userId] = managerId
                it[events.timestamp] = System.currentTimeMillis()
                it[events.eventType] = "PROGRESS_COMMENTED"
                it[events.params] = "{}"
                it[events.comment] = "legacy plain comment"
            }[events.id].value
        }

        suspend fun rawComment(): String = suspendTransaction(TestServices.goals.database) {
            events.selectAll().where { events.id eq legacyEventId }
                .map { it[events.comment]!! }
                .toList()
                .single()
        }

        assertTrue(TestGoalEvents.service.encryptLegacyRows() >= 1)
        assertTrue(rawComment().startsWith(FieldCipher.PREFIX))
        assertEquals(
            "legacy plain comment",
            TestGoalEvents.service.listForGoal(goalId).single { it.id == legacyEventId }.comment,
        )
        // Idempotent second pass finds nothing legacy.
        assertEquals(0, TestGoalEvents.service.encryptLegacyRows())

        // Rotation: with (new, previous=old) every commented row is rewritten under the new key.
        val newKey = "0000000000000000000000000000000000000000000000000000000000000009"
        val rotatingService = ch.nokillswit.goals.GoalEventService(
            TestServices.goals.database,
            FieldCipher(newKey, previousKeyHex = DEV_DATA_ENCRYPTION_KEY),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 1)
        assertEquals("legacy plain comment", FieldCipher(newKey).decrypt(rawComment()))
    }

    @Test
    fun `legacy plaintext rows are encrypted by the startup backfill`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(uniqueEmail("goal-legacy-manager"), "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("goal-legacy-sub"), "pw", roles = emptySet())

        // A pre-encryption row, as a legacy deployment would have written it.
        val now = System.currentTimeMillis()
        val legacyId = suspendTransaction(TestServices.goals.database) {
            GoalService.Goals.insert {
                it[GoalService.Goals.managerId] = managerId
                it[GoalService.Goals.subordinateId] = subordinateId
                it[GoalService.Goals.createdAt] = now
                it[GoalService.Goals.dueDate] = "2099-12-31"
                it[GoalService.Goals.title] = "Legacy goal"
                it[GoalService.Goals.description] = "legacy plain description"
                it[GoalService.Goals.type] = GoalType.NUMBER
                it[GoalService.Goals.targetValue] = 5.0
                it[GoalService.Goals.currentValue] = 0.0
                it[GoalService.Goals.status] = GoalStatus.ARCHIVED
                it[GoalService.Goals.summary] = "legacy plain summary"
                it[GoalService.Goals.lastModified] = now
            }[GoalService.Goals.id].value
        }

        assertTrue(TestServices.goals.encryptLegacyRows() >= 1)
        val raw = rawGoal(legacyId)
        assertTrue(raw.description.startsWith(FieldCipher.PREFIX))
        assertTrue(raw.summary!!.startsWith(FieldCipher.PREFIX))
        // The plaintext survives the wrap.
        assertEquals("legacy plain description", TestServices.goals.read(legacyId)!!.description)
        assertEquals("legacy plain summary", TestServices.goals.read(legacyId)!!.summary)
        // Idempotent: a second pass finds nothing legacy.
        assertEquals(0, TestServices.goals.encryptLegacyRows())
    }

    @Test
    fun `rotation - encryptLegacyRows rewrites description and summary under the current key`() = testApplication {
        usePostgresTestcontainer()
        val managerId = TestUsers.seed(uniqueEmail("goal-rot-manager"), "pw", roles = emptySet())
        val subordinateId = TestUsers.seed(uniqueEmail("goal-rot-sub"), "pw", roles = emptySet())
        val oldKey = DEV_DATA_ENCRYPTION_KEY
        val newKey = "0000000000000000000000000000000000000000000000000000000000000009"

        // A row encrypted under the old key (as the whole DB is before a rotation), written at
        // the service level with the dev-default cipher, then closed to give it a summary.
        val id = TestServices.goals.create(
            managerId,
            GoalCreateRequest(
                subordinateId = subordinateId,
                title = "Rotate me",
                description = "rotate this description",
                type = GoalType.NUMBER,
                targetValue = 3.0,
                dueDate = "2099-12-31",
            ),
        )
        TestServices.goals.transition(id, GoalStatus.DRAFT, GoalStatus.ACTIVE)
        TestServices.goals.transition(id, GoalStatus.ACTIVE, GoalStatus.ARCHIVED, summary = "rotate this summary")

        // Boot-time state during rotation: current = new key, previous = old key.
        val rotatingService = GoalService(
            TestServices.goals.database,
            FieldCipher(newKey, previousKeyHex = oldKey),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 1)

        // After the backfill the new key ALONE decrypts both columns — the old key can be retired.
        val raw = rawGoal(id)
        assertEquals("rotate this description", FieldCipher(newKey).decrypt(raw.description))
        assertEquals("rotate this summary", FieldCipher(newKey).decrypt(raw.summary!!))
        // Idempotent second pass without rotation finds nothing legacy.
        assertEquals(0, rotatingService.encryptLegacyRows())
    }
}
