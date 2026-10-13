package ch.nokillswit

import ch.nokillswit.teams.TeamManagerPeriodWrite
import ch.nokillswit.teams.TeamMembershipCreate
import ch.nokillswit.teams.TeamMembershipList
import ch.nokillswit.teams.TeamMembershipWrite
import ch.nokillswit.teams.TeamPageResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject

/**
 * `GET /api/v1/teams?asOf=` — the org chart's read of any day: manager and roster of THAT day from the
 * dated base tables, soft-deleted teams while their line covers the day, pre-V93 residue hidden, and the
 * `members`/`deleted` fields (`members` only in as-of mode).
 */
class TeamAsOfTest {

    private fun tag() = "asof" + UUID.randomUUID().toString().take(8)

    private suspend fun HttpClient.asOf(tag: String, day: Long, extra: String = ""): TeamPageResponse =
        get("/api/v1/teams?name=$tag&asOf=${dayIso(day)}$extra").body()

    @Test
    fun `a past date shows the old manager and roster and a future membership appears only on its days`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val (_, adminEmail) = seedPerson("asof-admin", setOf(UserRole.ADMIN))
        val (m, _) = seedPerson("asof-m", name = "Mia")
        val (a, _) = seedPerson("asof-a", name = "Alice")
        val (b, _) = seedPerson("asof-b", name = "Bob")
        val (c, _) = seedPerson("asof-c", name = "Cleo")
        val (n, _) = seedPerson("asof-n", name = "Nora")
        val admin = authedClient(adminEmail, "pw")
        val teamId = backdatedTeam(10, m, listOf(a, b), name = "$tag-main")
        val team = "/api/v1/teams/$teamId"
        admin.postJson("$team/managers", TeamManagerPeriodWrite(n, dayIso(-3)))
        val bRow = admin.get("$team/memberships").body<TeamMembershipList>().items.single { it.userId == b }
        admin.putJson("$team/memberships/${bRow.id}", TeamMembershipWrite(dayIso(-10), dayIso(-5)))
        admin.postJson("$team/memberships", TeamMembershipCreate(c, dayIso(3), dayIso(5)))

        fun TeamPageResponse.single() = items.single()
        val past = admin.asOf(tag, -7).single()
        assertEquals(m, past.managerId)
        assertEquals("Mia", past.managerName)
        assertEquals(listOf("Alice", "Bob"), past.members!!.map { it.name })
        assertEquals(listOf(a, b).sorted(), past.memberIds)
        assertEquals(false, past.deleted)

        val dayBeforeHandover = admin.asOf(tag, -4).single()
        assertEquals(m, dayBeforeHandover.managerId)
        assertEquals(listOf(a), dayBeforeHandover.memberIds)

        val today = admin.asOf(tag, 0).single()
        assertEquals(n, today.managerId)
        assertEquals("Nora", today.managerName)
        assertEquals(listOf(a), today.memberIds)
        // As-of today equals today's plain list on the shared fields.
        val plain = admin.get("/api/v1/teams?name=$tag").body<TeamPageResponse>().single()
        assertEquals(today.copy(members = null), plain)

        assertEquals(listOf(a, c).sorted(), admin.asOf(tag, 4).single().memberIds)
        assertEquals(listOf(a), admin.asOf(tag, 6).single().memberIds)
        assertEquals(listOf("Alice", "Cleo"), admin.asOf(tag, 4).single().members!!.map { it.name })
        // Before the team had a manager line there is nothing to show.
        assertEquals(0L, admin.asOf(tag, -11).total)

        // Filters compose as-of.
        assertEquals(1L, admin.asOf(tag, 0, "&managerId=$n").total)
        assertEquals(0L, admin.asOf(tag, 0, "&managerId=$m").total)
        assertEquals(1L, admin.asOf(tag, -7, "&managerId=$m").total)
        assertEquals(1L, admin.asOf(tag, 4, "&memberId=$c").total)
        assertEquals(0L, admin.asOf(tag, 6, "&memberId=$c").total)
        assertEquals(1L, admin.asOf(tag, -7, "&memberId=$b").total)
        assertEquals(0L, admin.asOf(tag, 0, "&memberId=$b").total)

        // Sorting and paging compose too.
        backdatedTeam(10, m, name = "$tag-other")
        val second = admin.get("/api/v1/teams?name=$tag&asOf=${dayIso(0)}&sort=-name&pageSize=1&page=2").body<TeamPageResponse>()
        assertEquals(2L, second.total)
        assertEquals("$tag-main", second.items.single().name)
    }

    @Test
    fun `members is present only in as-of mode and deleted is always present`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val (_, adminEmail) = seedPerson("asof-shape-admin", setOf(UserRole.ADMIN))
        val (m, _) = seedPerson("asof-shape-m")
        val (a, _) = seedPerson("asof-shape-a")
        val admin = authedClient(adminEmail, "pw")
        backdatedTeam(2, m, listOf(a), name = "$tag-shape")

        fun JsonObject.firstItem() = getValue("items").jsonArray.single().jsonObject
        val plain = Json.parseToJsonElement(admin.get("/api/v1/teams?name=$tag").bodyAsText()).jsonObject.firstItem()
        assertFalse("members" in plain, "a plain list must not carry members")
        assertEquals("false", plain.getValue("deleted").toString())
        val asOf = Json.parseToJsonElement(admin.get("/api/v1/teams?name=$tag&asOf=${dayIso(0)}").bodyAsText()).jsonObject.firstItem()
        assertTrue(asOf.getValue("members") is JsonArray)
        assertEquals("false", asOf.getValue("deleted").toString())
    }

    @Test
    fun `a deleted team shows up to its deletion day and a pre-history deleted team never does`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val (_, adminEmail) = seedPerson("asof-del-admin", setOf(UserRole.ADMIN))
        val (m, _) = seedPerson("asof-del-m", name = "Mia")
        val (a, _) = seedPerson("asof-del-a", name = "Alice")
        val (gone, _) = seedPerson("asof-del-gone", name = "Gerald")
        val admin = authedClient(adminEmail, "pw")
        val deletedTeam = backdatedTeam(10, m, listOf(a, gone), name = "$tag-del")
        val residue = backdatedTeam(10, m, listOf(a), name = "$tag-residue")
        softDeleteTeamRow(residue)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$gone").status)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/teams/$deletedTeam").status)

        // Today (the deletion day) and any earlier day it covered: present, flagged deleted, roster intact.
        for (day in listOf(0L, -5L)) {
            val items = admin.asOf(tag, day).items
            assertEquals(listOf("$tag-del"), items.map { it.name }, "day $day")
            val item = items.single()
            assertTrue(item.deleted)
            assertEquals(m, item.managerId)
            // A since-deleted person is still named, flagged deleted.
            val gerald = item.members!!.single { it.id == gone }
            assertTrue(gerald.deleted)
            assertEquals("Gerald", gerald.name)
            assertEquals(listOf(a, gone).sorted(), item.memberIds)
        }
        // The day after the deletion, and before the team started: gone. The residue team is never listed.
        assertEquals(0L, admin.asOf(tag, 1).total)
        assertEquals(0L, admin.asOf(tag, -11).total)
        // And a plain list does not include a deleted team.
        assertEquals(0L, admin.get("/api/v1/teams?name=$tag").body<TeamPageResponse>().total)
    }

    @Test
    fun `a deleted team that had a handover shows each day's manager up to its deletion day`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val (_, adminEmail) = seedPerson("asof-ho-admin", setOf(UserRole.ADMIN))
        val (m, _) = seedPerson("asof-ho-m")
        val (n, _) = seedPerson("asof-ho-n")
        val admin = authedClient(adminEmail, "pw")
        val teamId = backdatedTeam(10, m, name = "$tag-ho")
        admin.postJson("/api/v1/teams/$teamId/managers", TeamManagerPeriodWrite(n, dayIso(-3)))
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/teams/$teamId").status)
        assertEquals(m, admin.asOf(tag, -5).items.single().managerId)
        val onDeletionDay = admin.asOf(tag, 0).items.single()
        assertEquals(n, onDeletionDay.managerId)
        assertTrue(onDeletionDay.deleted)
        assertEquals(0L, admin.asOf(tag, 1).total)
    }

    @Test
    fun `a deactivated member is flagged and the as-of parameter is validated`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val (_, adminEmail) = seedPerson("asof-val-admin", setOf(UserRole.ADMIN))
        val (m, _) = seedPerson("asof-val-m")
        val (d, _) = seedPerson("asof-val-d", name = "Dora")
        val admin = authedClient(adminEmail, "pw")
        backdatedTeam(2, m, listOf(d), name = "$tag-val")
        TestServices.users.setDeactivated(d, true)

        val member = admin.asOf(tag, 0).items.single().members!!.single()
        assertTrue(member.deactivated)
        assertFalse(member.deleted)

        for (bad in listOf("2026-1-1", "tomorrow", "2026-02-30")) {
            assertEquals(HttpStatusCode.BadRequest, admin.get("/api/v1/teams?asOf=$bad").status, bad)
        }
        assertEquals(HttpStatusCode.BadRequest, admin.get("/api/v1/teams?asOf=${dayIso(0)}&includeIndirect=false").status)
        assertEquals(HttpStatusCode.BadRequest, admin.get("/api/v1/teams?asOf=${dayIso(0)}&managerId=$m&includeIndirect=true").status)
        // A future day is allowed.
        assertEquals(HttpStatusCode.OK, admin.get("/api/v1/teams?asOf=${dayIso(400)}").status)
    }
}
