package ch.nokillswit

import ch.nokillswit.oneonones.ActionItemOwner
import ch.nokillswit.oneonones.OneOnOneActionItemInput
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.oneonones.OneOnOneItemInput
import ch.nokillswit.oneonones.OneOnOneOpenActionItem
import ch.nokillswit.oneonones.OneOnOneOpenActionItemPage
import ch.nokillswit.oneonones.OneOnOneResponse
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.oneonones.OneOnOneUpdateRequest
import ch.nokillswit.teams.Team
import ch.nokillswit.users.Feature
import ch.nokillswit.users.OPT_IN_FEATURES
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
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * `GET /api/v1/one-on-ones/action-items` — the manager's cross-report open action items: the
 * unresolved items of each of the caller's pairs' LATEST meeting. Every response is also validated
 * against the OpenAPI spec by the shared client's conformance plugin.
 */
class OneOnOneOpenActionItemsTest {

    private class Person(val id: UInt, val email: String)

    private suspend fun person(prefix: String, name: String): Person {
        val email = uniqueEmail(prefix)
        return Person(TestUsers.seed(email, "pw", name = name, roles = emptySet()), email)
    }

    /** A manager and one direct report per name in [reportNames] (one fresh team). */
    private suspend fun seedOrg(vararg reportNames: String): Pair<Person, List<Person>> {
        val manager = person("oai-mgr", "Mia Manager")
        val reports = reportNames.map { person("oai-sub", it) }
        TestServices.teams.create(
            Team(name = "oai-${UUID.randomUUID()}", managerId = manager.id, memberIds = reports.map { it.id }),
        )
        return manager to reports
    }

    private fun item(
        content: String,
        owner: ActionItemOwner = ActionItemOwner.MANAGER,
        dueDate: String? = null,
    ) = OneOnOneActionItemInput(content = content, owner = owner, dueDate = dueDate)

    private suspend fun HttpClient.createMeeting(
        subordinateId: UInt,
        meetingDate: String,
        actionItems: List<OneOnOneActionItemInput> = emptyList(),
    ): OneOnOneResponse {
        val response = post("/api/v1/one-on-ones") {
            contentType(ContentType.Application.Json)
            setBody(OneOnOneCreateRequest(subordinateId, meetingDate, emptyList(), emptyList(), actionItems))
        }
        assertEquals(HttpStatusCode.Created, response.status, "create failed")
        return response.body()
    }

    /** PUT the meeting back unchanged except [resolve] (item ids to flag resolved) and [extra] (new items). */
    private suspend fun HttpClient.edit(
        meeting: OneOnOneResponse,
        resolve: Set<UInt> = emptySet(),
        extra: List<OneOnOneActionItemInput> = emptyList(),
    ) {
        val response = put("/api/v1/one-on-ones/${meeting.id}") {
            contentType(ContentType.Application.Json)
            setBody(
                OneOnOneUpdateRequest(
                    meetingDate = meeting.meetingDate,
                    points = meeting.points.map { OneOnOneItemInput(it.id, it.content) },
                    decisions = meeting.decisions.map { OneOnOneItemInput(it.id, it.content) },
                    actionItems = meeting.actionItems.map {
                        OneOnOneActionItemInput(it.id, it.content, it.owner, it.dueDate, it.resolved || it.id in resolve)
                    } + extra,
                ),
            )
        }
        assertEquals(HttpStatusCode.NoContent, response.status, "edit failed")
    }

    private suspend fun HttpClient.openItems(query: String = ""): OneOnOneOpenActionItemPage {
        val response = get("/api/v1/one-on-ones/action-items$query")
        assertEquals(HttpStatusCode.OK, response.status, "list failed: $query")
        return response.body()
    }

    private suspend fun HttpClient.status(query: String) = get("/api/v1/one-on-ones/action-items$query").status

    private suspend fun HttpClient.read(meetingId: UInt) = get("/api/v1/one-on-ones/$meetingId").body<OneOnOneResponse>()

    @Test
    fun `lists only the unresolved items of each pair's latest meeting - carried copies appear once`() = testApplication {
        usePostgresTestcontainer()
        val (mgr, reports) = seedOrg("Sam Subordinate")
        val sub = reports.single()
        val manager = authedClient(mgr.email, "pw")

        val first = manager.createMeeting(
            sub.id, "2026-07-01",
            listOf(
                item("a", ActionItemOwner.SUBORDINATE, "2026-07-10"),
                item("b"),
                item("c", dueDate = "2026-07-05"),
            ),
        )
        // The second meeting carries a, b and c over; resolving c there removes it from the open set.
        val second = manager.createMeeting(sub.id, "2026-07-08", listOf(item("d")))
        assertEquals(listOf("a", "b", "c", "d"), second.actionItems.map { it.content })
        manager.edit(second, resolve = setOf(second.actionItems.first { it.content == "c" }.id))

        val page = manager.openItems("?sort=id")
        assertEquals(listOf("a", "b", "d"), page.items.map { it.content })
        assertEquals(3, page.total)
        assertTrue(page.items.all { it.meetingId == second.id && it.meetingDate == "2026-07-08" })
        assertTrue(page.items.all { it.subordinateId == sub.id && it.subordinateName == "Sam Subordinate" })
        // The ids are the latest meeting's own rows (the history route's key), never the first meeting's.
        assertEquals(second.actionItems.filter { it.content != "c" }.map { it.id }, page.items.map { it.id })
        val a = page.items.first { it.content == "a" }
        assertEquals(ActionItemOwner.SUBORDINATE, a.owner)
        assertEquals("2026-07-10", a.dueDate)
        assertEquals(first.meetingDate, a.firstAppearedOn)
        // "d" was authored in the latest meeting: no earlier appearance.
        assertNull(page.items.first { it.content == "d" }.dueDate)
        assertNull(page.items.first { it.content == "d" }.firstAppearedOn)
    }

    @Test
    fun `other managers' pairs and chain managers above the author see nothing`() = testApplication {
        usePostgresTestcontainer()
        val (mgr, reports) = seedOrg("Sam Subordinate")
        val manager = authedClient(mgr.email, "pw")
        manager.createMeeting(reports.single().id, "2026-07-01", listOf(item("mine")))

        // A grand-manager above the author (the chain rule would let them READ the meeting) has no rights here.
        val grand = person("oai-grand", "Grand Boss")
        TestServices.teams.create(
            Team(name = "oai-${UUID.randomUUID()}", managerId = grand.id, memberIds = listOf(mgr.id)),
        )
        assertEquals(0, authedClient(grand.email, "pw").openItems().total)

        // The report, an unrelated manager and an ADMIN are ordinary callers with no authored meetings.
        assertEquals(0, authedClient(reports.single().email, "pw").openItems().total)
        val (otherMgr, otherReports) = seedOrg("Other Report")
        val other = authedClient(otherMgr.email, "pw")
        assertEquals(0, other.openItems().total)
        other.createMeeting(otherReports.single().id, "2026-07-02", listOf(item("theirs")))
        assertEquals(listOf("theirs"), other.openItems().items.map { it.content })
        assertEquals(listOf("mine"), manager.openItems().items.map { it.content })
        val adminEmail = uniqueEmail("oai-admin")
        TestUsers.seed(adminEmail, "pw")
        assertEquals(0, authedClient(adminEmail, "pw").openItems().total)
    }

    @Test
    fun `a soft-deleted latest meeting promotes the previous one`() = testApplication {
        usePostgresTestcontainer()
        val (mgr, reports) = seedOrg("Sam Subordinate")
        val manager = authedClient(mgr.email, "pw")
        val first = manager.createMeeting(reports.single().id, "2026-07-01", listOf(item("x")))
        val second = manager.createMeeting(reports.single().id, "2026-07-08", listOf(item("y")))
        assertEquals(listOf("x", "y"), manager.openItems("?sort=id").items.map { it.content })
        assertTrue(manager.openItems().items.all { it.meetingId == second.id })

        assertEquals(HttpStatusCode.NoContent, manager.delete("/api/v1/one-on-ones/${second.id}").status)
        val promoted = manager.openItems()
        assertEquals(listOf("x"), promoted.items.map { it.content })
        assertEquals(first.id, promoted.items.single().meetingId)
        assertEquals(first.actionItems.single().id, promoted.items.single().id)
    }

    @Test
    fun `deactivated and deleted reports are excluded`() = testApplication {
        usePostgresTestcontainer()
        val (mgr, reports) = seedOrg("Active Ann", "Deactivated Dan", "Deleted Dee")
        val manager = authedClient(mgr.email, "pw")
        reports.forEachIndexed { i, r -> manager.createMeeting(r.id, "2026-07-0${i + 1}", listOf(item("for ${r.id}"))) }
        assertEquals(3, manager.openItems().total)

        TestServices.users.setDeactivated(reports[1].id, true)
        assertEquals(1, TestServices.users.delete(reports[2].id))
        val page = manager.openItems()
        assertEquals(1, page.total)
        assertEquals("Active Ann", page.items.single().subordinateName)

        // Reactivating brings the deactivated report's items back.
        TestServices.users.setDeactivated(reports[1].id, false)
        assertEquals(setOf("Active Ann", "Deactivated Dan"), manager.openItems().items.map { it.subordinateName }.toSet())
    }

    @Test
    fun `filters sorting undated-last and total across pages`() = testApplication {
        usePostgresTestcontainer()
        val (mgr, reports) = seedOrg("Alice Ärlich", "Bob Brown", "Cyd Clark")
        val (alice, bob, cyd) = reports
        val manager = authedClient(mgr.email, "pw")
        manager.createMeeting(alice.id, "2026-07-03", listOf(item("alice-sub", ActionItemOwner.SUBORDINATE, "2026-08-01")))
        manager.createMeeting(
            bob.id, "2026-07-02",
            listOf(item("bob-due", dueDate = "2026-07-01"), item("bob-undated", ActionItemOwner.SUBORDINATE)),
        )
        manager.createMeeting(cyd.id, "2026-07-01", listOf(item("cyd-undated"), item("cyd-due", dueDate = "2026-09-01")))

        fun OneOnOneOpenActionItemPage.contents() = items.map { it.content }
        // Default: dueDate ascending, undated LAST (ties by id = creation order).
        val byDue = manager.openItems()
        assertEquals(listOf("bob-due", "alice-sub", "cyd-due", "bob-undated", "cyd-undated"), byDue.contents())
        assertEquals(5, byDue.total)
        // Descending keeps undated last too.
        assertEquals(
            listOf("cyd-due", "alice-sub", "bob-due", "bob-undated", "cyd-undated"),
            manager.openItems("?sort=-dueDate").contents(),
        )
        assertEquals(
            listOf("cyd-undated", "cyd-due", "bob-due", "bob-undated", "alice-sub"),
            manager.openItems("?sort=meetingDate,id").contents(),
        )
        assertEquals(
            listOf("alice-sub", "bob-due", "bob-undated", "cyd-undated", "cyd-due"),
            manager.openItems("?sort=subordinateName").contents(),
        )
        assertEquals(
            listOf("cyd-due", "cyd-undated", "bob-undated", "bob-due", "alice-sub"),
            manager.openItems("?sort=-subordinateName,-id").contents(),
        )

        // Filters.
        assertEquals(
            listOf("bob-undated", "alice-sub"),
            manager.openItems("?owner=SUBORDINATE&sort=-id").contents(),
        )
        assertEquals(3, manager.openItems("?owner=MANAGER").total)
        assertEquals(listOf("bob-due", "bob-undated"), manager.openItems("?subordinateId=${bob.id}").contents())
        // Case- and accent-insensitive substring on the report's name.
        assertEquals(listOf("alice-sub"), manager.openItems("?subordinateName=arlich").contents())
        assertEquals(listOf("cyd-due", "cyd-undated"), manager.openItems("?subordinateName=CLARK&sort=-dueDate").contents())
        assertEquals(0, manager.openItems("?subordinateName=nobody").total)
        assertEquals(1, manager.openItems("?subordinateId=${bob.id}&owner=SUBORDINATE").total)

        // Paging: total stays the filtered count and the pages tile the sorted list.
        val p1 = manager.openItems("?pageSize=2&page=1")
        val p2 = manager.openItems("?pageSize=2&page=2")
        val p3 = manager.openItems("?pageSize=2&page=3")
        assertEquals(listOf(5L, 5L, 5L), listOf(p1.total, p2.total, p3.total))
        assertEquals(byDue.contents(), p1.contents() + p2.contents() + p3.contents())
        assertEquals(2, p1.pageSize)
        assertEquals(1, p3.items.size)
    }

    @Test
    fun `malformed parameters are 400 and a disabled feature is 403`() = testApplication {
        usePostgresTestcontainer()
        val (mgr, _) = seedOrg("Sam Subordinate")
        val manager = authedClient(mgr.email, "pw")
        for (bad in listOf(
            "?owner=BOSS", "?owner=manager", "?sort=bogus", "?sort=-content", "?subordinateId=abc", "?subordinateId=-1",
            "?owner=MANAGER&owner=SUBORDINATE", "?subordinateId=1&subordinateId=2", "?subordinateName=a&subordinateName=b",
            "?page=0", "?pageSize=101", "?pageSize=x", "?sort=dueDate&sort=id",
        )) {
            assertEquals(HttpStatusCode.BadRequest, manager.status(bad), bad)
        }
        // Blank filters are absent, not errors.
        assertEquals(HttpStatusCode.OK, manager.status("?owner=&subordinateId=&subordinateName="))

        // The flag set rides the JWT: a fresh login after the change carries it.
        TestServices.users.setDisabledFeatures(mgr.id, setOf(Feature.ONE_ON_ONES) + OPT_IN_FEATURES)
        val blocked = authedClient(mgr.email, "pw")
        assertEquals(HttpStatusCode.Forbidden, blocked.status(""))
        // The feature 403 precedes the shape 400.
        assertEquals(HttpStatusCode.Forbidden, blocked.status("?owner=BOSS"))
    }

    @Test
    fun `firstAppearedOn matches the meeting read - deleted ancestors skipped, broken chains null`() = testApplication {
        usePostgresTestcontainer()
        val (mgr, reports) = seedOrg("Sam Subordinate")
        val manager = authedClient(mgr.email, "pw")
        val subId = reports.single().id
        val m1 = manager.createMeeting(subId, "2026-07-01", listOf(item("runner")))
        val m2 = manager.createMeeting(subId, "2026-07-08", listOf(item("mid-born")))
        manager.createMeeting(subId, "2026-07-15")
        val m4 = manager.createMeeting(subId, "2026-07-22", listOf(item("fresh")))

        /** The list's firstAppearedOn per content must equal the oracle: GET /{id}'s value for the same item. */
        suspend fun assertMatchesRead(expected: Map<String, String?>) {
            val listed = manager.openItems().items
            assertEquals(expected.keys, listed.map { it.content }.toSet())
            val oracle = manager.read(m4.id).actionItems.associate { it.content to it.firstAppearedOn }
            for (row in listed) {
                assertEquals(oracle[row.content], row.firstAppearedOn, "oracle mismatch for ${row.content}")
                assertEquals(expected[row.content], row.firstAppearedOn, "expected value for ${row.content}")
            }
        }
        // Mixed chain depths in one page: 3 hops, 2 hops, none.
        assertMatchesRead(mapOf("runner" to "2026-07-01", "mid-born" to "2026-07-08", "fresh" to null))

        // A deleted MIDDLE ancestor is skipped but walked through.
        TestOneOnOneMaintenance.softDeleteMeeting(m2.id)
        assertMatchesRead(mapOf("runner" to "2026-07-01", "mid-born" to "2026-07-15", "fresh" to null))

        // Delete the root too: the earliest SURVIVING appearance moves forward to meeting 3.
        TestOneOnOneMaintenance.softDeleteMeeting(m1.id)
        assertMatchesRead(mapOf("runner" to "2026-07-15", "mid-born" to "2026-07-15", "fresh" to null))
    }

    @Test
    fun `a chain whose every ancestor meeting is deleted has no firstAppearedOn`() = testApplication {
        usePostgresTestcontainer()
        val (mgr, reports) = seedOrg("Sam Subordinate")
        val manager = authedClient(mgr.email, "pw")
        val subId = reports.single().id
        val m1 = manager.createMeeting(subId, "2026-07-01", listOf(item("runner")))
        val m2 = manager.createMeeting(subId, "2026-07-08")
        val m3 = manager.createMeeting(subId, "2026-07-15")
        TestOneOnOneMaintenance.softDeleteMeeting(m1.id)
        TestOneOnOneMaintenance.softDeleteMeeting(m2.id)
        val row = manager.openItems().items.single()
        assertEquals(m3.id, row.meetingId)
        assertNull(row.firstAppearedOn)
        assertNull(manager.read(m3.id).actionItems.single().firstAppearedOn)
    }

    @Test
    fun `content is decrypted while the stored column is ciphertext`() = testApplication {
        usePostgresTestcontainer()
        val (mgr, reports) = seedOrg("Sam Subordinate")
        val manager = authedClient(mgr.email, "pw")
        val secret = "send the confidential offer letter"
        val meeting = manager.createMeeting(reports.single().id, "2026-07-01", listOf(item(secret)))

        val row: OneOnOneOpenActionItem = manager.openItems().items.single()
        assertEquals(secret, row.content)
        val raw = suspendTransaction(TestServices.oneOnOnes.database) {
            OneOnOneService.ActionItems.selectAll()
                .where { OneOnOneService.ActionItems.meetingId eq meeting.id }
                .map { it[OneOnOneService.ActionItems.content] }
                .toList()
        }
        assertTrue(raw.single().startsWith("enc:v1:"), "the stored value must be an envelope")
    }
}
