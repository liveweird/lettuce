package ch.nokillswit

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.teams.Team
import ch.nokillswit.users.CareerPositionEventService.CareerPositionEvents
import ch.nokillswit.users.CareerPositionResponse
import ch.nokillswit.users.CareerPositionWrite
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The route side of the career-position action trail (V89): create / update / delete each append ONE
 * event after the commit — keyed on the person, the chain manager as actor, display names frozen —
 * while refused writes, no-op updates and the ADMIN deactivation stamp mint nothing. The pure
 * descriptors are in `CareerPositionEventsTest`; the log on top is in `ActivityLogTest`.
 */
class CareerPositionEventMintingTest {

    private val password = "pw-123456789"

    private class Person(val id: UInt, val client: HttpClient)

    private class Event(val actor: UInt?, val type: String, val params: Map<String, String>)

    private suspend fun ApplicationTestBuilder.person(prefix: String, roles: Set<UserRole> = emptySet()): Person {
        val email = uniqueEmail(prefix)
        val id = TestUsers.seed(email = email, password = password, name = prefix, roles = roles)
        return Person(id, authedClient(email, password))
    }

    private suspend fun eventsOf(owner: UInt): List<Event> = suspendTransaction(TestServices.database) {
        CareerPositionEvents.selectAll()
            .where { CareerPositionEvents.ownerId eq owner }
            .orderBy(CareerPositionEvents.id to SortOrder.ASC)
            .map {
                Event(
                    it[CareerPositionEvents.userId]?.value,
                    it[CareerPositionEvents.eventType],
                    decodeParams(it[CareerPositionEvents.params]),
                )
            }
            .toList()
    }

    private suspend fun HttpClient.write(userId: UInt, start: String, path: UInt?, spec: UInt?, level: UInt?): HttpResponse =
        post("/api/v1/users/$userId/career-positions") {
            contentType(ContentType.Application.Json)
            setBody(CareerPositionWrite(start, path, spec, level))
        }

    private suspend fun HttpClient.rewrite(userId: UInt, positionId: UInt, w: CareerPositionWrite): HttpResponse =
        put("/api/v1/users/$userId/career-positions/$positionId") {
            contentType(ContentType.Application.Json)
            setBody(w)
        }

    @Test
    fun `create, update and delete each mint one event - names are frozen, no-ops and refused writes mint nothing`() =
        testApplication {
            usePostgresTestcontainer()
            val manager = person("cpm")
            val report = person("cpr")
            val peer = person("cpp")
            TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(report.id)))
            val marker = UUID.randomUUID().toString().take(8)
            val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "EvPath $marker")
            val (specId) = TestDictionaries.append(Dictionary.CAREER_SPECIALIZATION, "EvSpec $marker")
            val (levelId, level2) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "EvLevel $marker", "EvLevel2 $marker")

            val created = manager.client.write(report.id, "2019-02-01", pathId, specId, levelId)
            assertEquals(HttpStatusCode.Created, created.status)
            val position = created.body<CareerPositionResponse>()
            val first = eventsOf(report.id).single()
            assertEquals(manager.id, first.actor)
            assertEquals("POSITION_CREATED", first.type)
            assertEquals(position.id.toString(), first.params["positionId"])
            assertEquals("EvLevel $marker", first.params["seniorityLevelName"])

            // Names are FROZEN: renaming the entry later does not touch the stored event.
            TestDictionaries.rename(Dictionary.SENIORITY_LEVEL, levelId, "Renamed $marker")
            assertEquals("EvLevel $marker", eventsOf(report.id).single().params["seniorityLevelName"])

            // Refused writes mint nothing: a peer (403 on create/update/delete) and a start-date clash (409).
            assertEquals(HttpStatusCode.Forbidden, peer.client.write(report.id, "2020-01-01", pathId, specId, levelId).status)
            assertEquals(
                HttpStatusCode.Forbidden,
                peer.client.rewrite(report.id, position.id, CareerPositionWrite("2019-02-01", pathId, specId, level2)).status,
            )
            val positionPath = "/api/v1/users/${report.id}/career-positions/${position.id}"
            assertEquals(HttpStatusCode.Forbidden, peer.client.delete(positionPath).status)
            assertEquals(HttpStatusCode.Conflict, manager.client.write(report.id, "2019-02-01", pathId, specId, level2).status)
            // A malformed write (400 — a start date in the future) mints nothing either.
            assertEquals(HttpStatusCode.BadRequest, manager.client.write(report.id, "2999-01-01", pathId, specId, levelId).status)
            assertEquals(1, eventsOf(report.id).size)

            // The ADMIN deactivation stamps the final position's end and reactivation reopens it: an account
            // action, not a manager's career write — no event either way.
            val admin = person("cpa", roles = setOf(UserRole.ADMIN))
            assertEquals(HttpStatusCode.NoContent, admin.client.post("/api/v1/users/${report.id}/deactivate").status)
            assertEquals(HttpStatusCode.NoContent, admin.client.post("/api/v1/users/${report.id}/activate").status)
            assertEquals(1, eventsOf(report.id).size)

            // A no-op PUT (the very same values) mints nothing; a real change mints one POSITION_UPDATED with deltas.
            assertEquals(
                HttpStatusCode.NoContent,
                manager.client.rewrite(report.id, position.id, CareerPositionWrite("2019-02-01", pathId, specId, levelId)).status,
            )
            assertEquals(1, eventsOf(report.id).size)
            assertEquals(
                HttpStatusCode.NoContent,
                manager.client.rewrite(report.id, position.id, CareerPositionWrite("2018-12-01", pathId, specId, level2)).status,
            )
            val updated = eventsOf(report.id).last()
            assertEquals("POSITION_UPDATED", updated.type)
            assertEquals(manager.id, updated.actor)
            assertEquals("2019-02-01", updated.params["startDateFrom"])
            assertEquals("2018-12-01", updated.params["startDateTo"])
            assertEquals(levelId.toString(), updated.params["seniorityLevelFrom"])
            assertEquals(level2.toString(), updated.params["seniorityLevelTo"])
            assertEquals("EvLevel2 $marker", updated.params["seniorityLevelToName"])
            assertNull(updated.params["careerPathFrom"], "unchanged refs carry no delta")

            assertEquals(HttpStatusCode.NoContent, manager.client.delete(positionPath).status)
            val deleted = eventsOf(report.id).last()
            assertEquals("POSITION_DELETED", deleted.type)
            assertEquals(position.id.toString(), deleted.params["positionId"])
            assertEquals(listOf("POSITION_CREATED", "POSITION_UPDATED", "POSITION_DELETED"), eventsOf(report.id).map { it.type })
            // A repeated delete is 404 and mints nothing; nothing is keyed on the manager or the peer.
            assertEquals(HttpStatusCode.NotFound, manager.client.delete(positionPath).status)
            assertEquals(3, eventsOf(report.id).size)
            assertTrue(eventsOf(manager.id).isEmpty() && eventsOf(peer.id).isEmpty())
        }
}
