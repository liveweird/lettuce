package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffAllowanceWrite
import ch.nokillswit.daysoff.DaysOffBudgetList
import ch.nokillswit.daysoff.DaysOffCorrectionOperation
import ch.nokillswit.daysoff.DaysOffCorrectionResponse
import ch.nokillswit.daysoff.DaysOffCorrectionWrite
import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffEventService.DaysOffEvents
import ch.nokillswit.daysoff.DaysOffResponse
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.teams.Team
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
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
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The route side of the days-off action trail (V88): every mutation site appends ONE event after
 * the service commit, keyed on the person it concerns with the caller as actor — the self-create
 * included (not only the on-behalf recording the audit covers) — and never the encrypted comment.
 * The pure descriptors are in `DaysOffEventsTest`; the log built on top is in `ActivityLogTest`.
 */
class DaysOffEventMintingTest {

    private val password = "pw-123456789"

    private class Person(val id: UInt, val client: HttpClient)

    private class Event(val actor: UInt?, val type: String, val params: Map<String, String>)

    private suspend fun ApplicationTestBuilder.person(prefix: String): Person {
        val email = uniqueEmail(prefix)
        val id = TestUsers.seed(email = email, password = password, name = prefix, roles = emptySet())
        return Person(id, authedClient(email, password))
    }

    private suspend fun eventsOf(owner: UInt): List<Event> = suspendTransaction(TestServices.database) {
        DaysOffEvents.selectAll()
            .where { DaysOffEvents.ownerId eq owner }
            .orderBy(DaysOffEvents.id to SortOrder.ASC)
            .map { Event(it[DaysOffEvents.userId]?.value, it[DaysOffEvents.eventType], decodeParams(it[DaysOffEvents.params])) }
            .toList()
    }

    private fun monday(month: Int): LocalDate =
        LocalDate.of(2085, month, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))

    private suspend fun HttpClient.create(date: LocalDate, forUser: UInt? = null) = post("/api/v1/days-off") {
        contentType(ContentType.Application.Json)
        setBody(DaysOffCreateRequest(DaysOffType.UNPAID, date.toString(), date.toString(), userId = forUser))
    }.also { assertEquals(HttpStatusCode.Created, it.status) }.body<DaysOffResponse>()

    private suspend fun HttpClient.allowance(userId: UInt, days: Int, pool: UInt? = null) =
        put("/api/v1/days-off/allowance") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffAllowanceWrite(userId = userId, allowance = days, poolTypeId = pool))
        }.also { assertEquals(HttpStatusCode.NoContent, it.status) }

    private suspend fun ApplicationTestBuilder.pair(): Pair<Person, Person> {
        val manager = person("manager")
        val report = person("report")
        TestServices.teams.create(Team("Squad-${manager.id}", manager.id, listOf(report.id)))
        return manager to report
    }

    @Test
    fun `a self-create and a manager's on-behalf recording are both minted, with onBehalf telling them apart`() =
        testApplication {
            usePostgresTestcontainer()
            val (m, s) = pair()
            val own = s.client.create(monday(3))
            val recorded = m.client.create(monday(4), forUser = s.id)

            val events = eventsOf(s.id)
            assertEquals(listOf("ENTRY_RECORDED", "ENTRY_RECORDED"), events.map { it.type })
            assertEquals(s.id, events[0].actor)
            assertEquals("false", events[0].params["onBehalf"])
            assertEquals(own.id.toString(), events[0].params["requestId"])
            assertEquals(m.id, events[1].actor)
            assertEquals("true", events[1].params["onBehalf"])
            assertEquals(recorded.id.toString(), events[1].params["requestId"])
            assertEquals(
                mapOf("type" to "UNPAID", "startDate" to monday(4).toString(), "endDate" to monday(4).toString(), "days" to "1.0"),
                events[1].params.filterKeys { it in setOf("type", "startDate", "endDate", "days") },
            )
            assertFalse("poolTypeId" in events[1].params, "an UNPAID entry draws on no pool")
            // The manager's own log of events: nothing is keyed on the manager.
            assertTrue(eventsOf(m.id).isEmpty())
        }

    @Test
    fun `deleting an entry mints ENTRY_DELETED for the owner, by the owner or by a chain manager`() = testApplication {
        usePostgresTestcontainer()
        val (m, s) = pair()
        val ownDelete = s.client.create(monday(5))
        val managerDelete = s.client.create(monday(6))
        assertEquals(HttpStatusCode.NoContent, s.client.delete("/api/v1/days-off/${ownDelete.id}").status)
        assertEquals(HttpStatusCode.NoContent, m.client.delete("/api/v1/days-off/${managerDelete.id}").status)

        val deletions = eventsOf(s.id).filter { it.type == "ENTRY_DELETED" }
        assertEquals(listOf(s.id, m.id), deletions.map { it.actor })
        assertEquals(listOf("false", "true"), deletions.map { it.params["onBehalf"] })
        assertEquals(listOf(ownDelete.id, managerDelete.id).map { it.toString() }, deletions.map { it.params["requestId"] })
        // A refused delete (404 for the already-deleted id) mints nothing.
        assertEquals(HttpStatusCode.NotFound, s.client.delete("/api/v1/days-off/${ownDelete.id}").status)
        assertEquals(2, eventsOf(s.id).count { it.type == "ENTRY_DELETED" })
    }

    @Test
    fun `corrections mint created, updated with deltas and deleted — never the comment`() = testApplication {
        usePostgresTestcontainer()
        val (m, s) = pair()
        val created = m.client.post("/api/v1/days-off/corrections") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCorrectionWrite(s.id, 2085, DaysOffCorrectionOperation.ADD, 1.0, "PRIVATE-COMMENT"))
        }.also { assertEquals(HttpStatusCode.Created, it.status) }.body<DaysOffCorrectionResponse>()
        assertEquals(
            HttpStatusCode.NoContent,
            m.client.put("/api/v1/days-off/corrections/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCorrectionWrite(s.id, 2085, DaysOffCorrectionOperation.SUBTRACT, 2.0, "OTHER-PRIVATE"))
            }.status,
        )
        // A comment-only edit (the comment is encrypted, never an event param) and an idempotent re-PUT
        // change nothing the log could show: no event.
        assertEquals(
            HttpStatusCode.NoContent,
            m.client.put("/api/v1/days-off/corrections/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCorrectionWrite(s.id, 2085, DaysOffCorrectionOperation.SUBTRACT, 2.0, "ONLY-THE-COMMENT"))
            }.status,
        )
        assertEquals(HttpStatusCode.NoContent, m.client.delete("/api/v1/days-off/corrections/${created.id}").status)

        val events = eventsOf(s.id)
        assertEquals(listOf("CORRECTION_CREATED", "CORRECTION_UPDATED", "CORRECTION_DELETED"), events.map { it.type })
        assertTrue(events.all { it.actor == m.id })
        assertEquals("ADD", events[0].params["operation"])
        assertEquals("1.0", events[0].params["days"])
        assertEquals(mapOf("operationFrom" to "ADD", "operationTo" to "SUBTRACT", "daysFrom" to "1.0", "daysTo" to "2.0"),
            events[1].params.filterKeys { it.startsWith("operation") || it.startsWith("days") })
        assertEquals("SUBTRACT", events[2].params["operation"])
        assertTrue(events.none { e -> e.params.values.any { "PRIVATE" in it } }, "the encrypted comment never leaves the service")
        assertNotNull(events[0].params["poolTypeId"])
        assertEquals(created.poolName, events[0].params["poolName"])
        assertEquals(created.poolName, events[1].params["poolName"])
        assertEquals(created.poolName, events[2].params["poolName"])
    }

    @Test
    fun `an allowance change mints ALLOWANCE_CHANGED only on an actual change, and archiving a pool mints POOL_ARCHIVED`() =
        testApplication {
            usePostgresTestcontainer()
            val (m, s) = pair()
            m.client.allowance(s.id, 5)
            m.client.allowance(s.id, 5) // idempotent re-PUT: silent
            m.client.allowance(s.id, 7)
            val changes = eventsOf(s.id).filter { it.type == "ALLOWANCE_CHANGED" }
            assertEquals(2, changes.size)
            assertNull(changes[0].params["from"])
            assertEquals("5", changes[0].params["to"])
            assertEquals(mapOf("from" to "5", "to" to "7"), changes[1].params.filterKeys { it == "from" || it == "to" })
            assertTrue(changes.all { it.actor == m.id })

            val extra = TestDaysOff.createPoolType("Parental")
            m.client.allowance(s.id, 3, pool = extra)
            // A PAID entry in the extra pool freezes its name too.
            val paid = s.client.post("/api/v1/days-off") {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCreateRequest(DaysOffType.PAID, monday(9).toString(), monday(9).toString(), poolTypeId = extra))
            }.also { assertEquals(HttpStatusCode.Created, it.status) }.body<DaysOffResponse>()
            val recorded = eventsOf(s.id).single { it.type == "ENTRY_RECORDED" }
            assertEquals(extra.toString(), recorded.params["poolTypeId"])
            assertEquals(paid.poolName, recorded.params["poolName"])
            val budget = s.client.get("/api/v1/days-off/budgets?year=2085").body<DaysOffBudgetList>().items
                .first { it.poolTypeId == extra }
            assertEquals(HttpStatusCode.NoContent, m.client.delete("/api/v1/days-off/pools/${budget.poolId}").status)
            val archived = eventsOf(s.id).single { it.type == "POOL_ARCHIVED" }
            assertEquals(m.id, archived.actor)
            assertEquals(
                mapOf(
                    "poolId" to budget.poolId.toString(), "poolTypeId" to extra.toString(),
                    "poolName" to budget.poolName, "allowance" to "3",
                ),
                archived.params,
            )
            // The pool kind's name is FROZEN into every pool-related event at mint time (beside its id).
            val defaultName = s.client.get("/api/v1/days-off/budgets?year=2085").body<DaysOffBudgetList>().items
                .first { it.isDefault }.poolName
            assertTrue(changes.all { it.params["poolName"] == defaultName })
            val extraGrant = eventsOf(s.id).filter { it.type == "ALLOWANCE_CHANGED" }.last()
            assertEquals(budget.poolName, extraGrant.params["poolName"])
        }

    @Test
    fun `refused writes mint nothing - a peer's 403 delete, a 409 overlapping create`() = testApplication {
        usePostgresTestcontainer()
        val (m, s) = pair()
        val peer = person("peer")
        val entry = s.client.create(monday(10))
        assertEquals(1, eventsOf(s.id).size)

        // A peer is neither the owner nor in the chain: 403, and no ENTRY_DELETED anywhere.
        assertEquals(HttpStatusCode.Forbidden, peer.client.delete("/api/v1/days-off/${entry.id}").status)
        // An overlapping create is refused (409) — before any event is appended.
        val overlap = s.client.post("/api/v1/days-off") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCreateRequest(DaysOffType.UNPAID, monday(10).toString(), monday(10).toString()))
        }
        assertEquals(HttpStatusCode.Conflict, overlap.status)
        // A non-manager recording on someone's behalf is refused too (403).
        val onBehalf = peer.client.post("/api/v1/days-off") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCreateRequest(DaysOffType.UNPAID, monday(11).toString(), monday(11).toString(), userId = s.id))
        }
        assertEquals(HttpStatusCode.Forbidden, onBehalf.status)
        assertEquals(listOf("ENTRY_RECORDED"), eventsOf(s.id).map { it.type })
        assertTrue(eventsOf(peer.id).isEmpty() && eventsOf(m.id).isEmpty())
    }
}
