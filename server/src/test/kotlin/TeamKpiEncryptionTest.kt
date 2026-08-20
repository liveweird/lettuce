package ch.nokillswit

import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.teamkpis.TeamKpiArchiveRequest
import ch.nokillswit.teamkpis.TeamKpiCreateRequest
import ch.nokillswit.teamkpis.TeamKpiEventService
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiService
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teamkpis.TeamKpiType
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
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Encryption-at-rest of team-KPI content: what PostgreSQL stores in team_kpis.description and
 * team_kpis.summary is an `enc:v1:` AES-GCM envelope, while the API serves plaintext; the title
 * stays plaintext by design (lists sort/filter on it) and the plaintext event params never carry
 * the secret texts. Raw column state is asserted by selecting the Exposed table directly,
 * bypassing the service's decrypt layer.
 */
class TeamKpiEncryptionTest {

    private data class RawKpi(val title: String, val description: String, val summary: String?)

    private suspend fun rawKpi(id: UInt): RawKpi =
        suspendTransaction(TestServices.teamKpis.database) {
            TeamKpiService.TeamKpis.selectAll()
                .where { TeamKpiService.TeamKpis.id eq id }
                .map {
                    RawKpi(
                        title = it[TeamKpiService.TeamKpis.title],
                        description = it[TeamKpiService.TeamKpis.description],
                        summary = it[TeamKpiService.TeamKpis.summary],
                    )
                }
                .singleOrNull()!!
        }

    private suspend fun seedManagedTeam(prefix: String): Triple<String, UInt, UInt> {
        val managerEmail = uniqueEmail(prefix)
        val managerId = TestUsers.seed(managerEmail, "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "$prefix-${UUID.randomUUID()}", managerId = managerId))
        return Triple(managerEmail, managerId, teamId)
    }

    @Test
    fun `description and summary are ciphertext in the DB but plaintext over the API`() = testApplication {
        usePostgresTestcontainer()
        val (managerEmail, _, teamId) = seedManagedTeam("kpi-enc-manager")
        val manager = authedClient(managerEmail, "pw")

        val secretDescription = "Confidential description: velocity concerns"
        val secretSummary = "Confidential summary: KPI missed, replan next quarter"
        val created = manager.post("/api/v1/team-kpis") {
            contentType(ContentType.Application.Json)
            setBody(
                TeamKpiCreateRequest(
                    teamId = teamId,
                    title = "Public title",
                    description = secretDescription,
                    type = TeamKpiType.NUMBER,
                    targetValue = 10.0,
                ),
            )
        }.body<TeamKpiResponse>()
        manager.post("/api/v1/team-kpis/${created.id}/activate")
        assertEquals(
            HttpStatusCode.NoContent,
            manager.post("/api/v1/team-kpis/${created.id}/archive") {
                contentType(ContentType.Application.Json)
                setBody(TeamKpiArchiveRequest(summary = secretSummary))
            }.status,
        )

        // What the DB (a database-level attacker) sees: envelopes for the secret columns, the
        // title in plain view (deliberate — it is list-sortable/filterable).
        val raw = rawKpi(created.id)
        assertEquals("Public title", raw.title)
        assertTrue(raw.description.startsWith(FieldCipher.PREFIX))
        assertFalse("Confidential" in raw.description)
        assertTrue(raw.summary!!.startsWith(FieldCipher.PREFIX))
        assertFalse("Confidential" in raw.summary)

        // What the API serves: the plaintext, decrypted transparently.
        val fetched = manager.get("/api/v1/team-kpis/${created.id}").body<TeamKpiResponse>()
        assertEquals(secretDescription, fetched.description)
        assertEquals(secretSummary, fetched.summary)

        // The event trail is plaintext by design — so it must never carry the secret texts.
        val rawEventParams = suspendTransaction(TestServices.teamKpis.database) {
            TeamKpiEventService.TeamKpiEvents.selectAll()
                .where { TeamKpiEventService.TeamKpiEvents.kpiId eq created.id }
                .map { it[TeamKpiEventService.TeamKpiEvents.params] }
                .toList()
        }
        assertTrue(rawEventParams.isNotEmpty())
        rawEventParams.forEach { assertFalse("Confidential" in it) }
    }

    @Test
    fun `legacy plaintext rows are encrypted by the startup backfill`() = testApplication {
        usePostgresTestcontainer()
        val (_, managerId, teamId) = seedManagedTeam("kpi-legacy-manager")
        check(managerId > 0u)

        // A pre-encryption row, as a legacy deployment would have written it.
        val now = System.currentTimeMillis()
        val legacyId = suspendTransaction(TestServices.teamKpis.database) {
            TeamKpiService.TeamKpis.insert {
                it[TeamKpiService.TeamKpis.teamId] = teamId
                it[TeamKpiService.TeamKpis.createdBy] = 1u // the seed admin — any user works
                it[TeamKpiService.TeamKpis.createdAt] = now
                it[TeamKpiService.TeamKpis.title] = "Legacy KPI"
                it[TeamKpiService.TeamKpis.description] = "legacy plain description"
                it[TeamKpiService.TeamKpis.type] = TeamKpiType.NUMBER
                it[TeamKpiService.TeamKpis.targetValue] = 5.0
                it[TeamKpiService.TeamKpis.currentValue] = 0.0
                it[TeamKpiService.TeamKpis.status] = TeamKpiStatus.ARCHIVED
                it[TeamKpiService.TeamKpis.summary] = "legacy plain summary"
                it[TeamKpiService.TeamKpis.lastModified] = now
            }[TeamKpiService.TeamKpis.id].value
        }

        assertTrue(TestServices.teamKpis.encryptLegacyRows() >= 1)
        val raw = rawKpi(legacyId)
        assertTrue(raw.description.startsWith(FieldCipher.PREFIX))
        assertTrue(raw.summary!!.startsWith(FieldCipher.PREFIX))
        // The plaintext survives the wrap.
        assertEquals("legacy plain description", TestServices.teamKpis.read(legacyId)!!.description)
        assertEquals("legacy plain summary", TestServices.teamKpis.read(legacyId)!!.summary)
        // Idempotent: a second pass finds nothing legacy.
        assertEquals(0, TestServices.teamKpis.encryptLegacyRows())
    }

    @Test
    fun `rotation - encryptLegacyRows rewrites description and summary under the current key`() = testApplication {
        usePostgresTestcontainer()
        val (_, _, teamId) = seedManagedTeam("kpi-rot-manager")
        val oldKey = DEV_DATA_ENCRYPTION_KEY
        val newKey = "0000000000000000000000000000000000000000000000000000000000000009"

        // A row encrypted under the old key (as the whole DB is before a rotation), written at
        // the service level with the dev-default cipher, then closed to give it a summary.
        val id = TestServices.teamKpis.create(
            TeamKpiCreateRequest(
                teamId = teamId,
                title = "Rotate me",
                description = "rotate this description",
                type = TeamKpiType.NUMBER,
                targetValue = 3.0,
            ),
            creatorId = 1u,
        )
        TestServices.teamKpis.transition(id, TeamKpiStatus.DRAFT, TeamKpiStatus.ACTIVE, actorId = 1u)
        TestServices.teamKpis.transition(
            id, TeamKpiStatus.ACTIVE, TeamKpiStatus.ARCHIVED, actorId = 1u, summary = "rotate this summary",
        )

        // Boot-time state during rotation: current = new key, previous = old key.
        val rotatingService = TeamKpiService(
            TestServices.teamKpis.database,
            FieldCipher(newKey, previousKeyHex = oldKey),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 1)

        // After the backfill the new key ALONE decrypts both columns — the old key can be retired.
        val raw = rawKpi(id)
        assertEquals("rotate this description", FieldCipher(newKey).decrypt(raw.description))
        assertEquals("rotate this summary", FieldCipher(newKey).decrypt(raw.summary!!))
        // Idempotent second pass without rotation finds nothing legacy.
        assertEquals(0, rotatingService.encryptLegacyRows())
    }
}
