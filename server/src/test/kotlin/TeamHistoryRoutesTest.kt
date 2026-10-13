package ch.nokillswit

import ch.nokillswit.teams.TeamManagerPeriodList
import ch.nokillswit.teams.TeamManagerPeriodResponse
import ch.nokillswit.teams.TeamManagerPeriodWrite
import ch.nokillswit.teams.TeamMembershipCreate
import ch.nokillswit.teams.TeamMembershipList
import ch.nokillswit.teams.TeamMembershipResponse
import ch.nokillswit.teams.TeamMembershipWrite
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.put
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The V93 membership-period and manager-line sub-resources (`/teams/{id}/memberships`, `/teams/{id}/managers`):
 * the authz matrix and 404 ordering, the 400/409 matrix, split / merge / contiguity of the line, the
 * deactivated-person rules, the manager-is-never-a-member rule and the interplay with today's reopen.
 */
class TeamHistoryRoutesTest {

    private class World(
        val adminEmail: String,
        val plainEmail: String,
        val teamId: UInt,
        val manager: UInt,
        val a: UInt,
    )

    /** Team created 10 days ago: manager M (admin and plain callers are unrelated to it), member A. */
    private suspend fun world(): World {
        val (_, adminEmail) = seedPerson("hist-admin", setOf(UserRole.ADMIN))
        val (_, plainEmail) = seedPerson("hist-plain")
        val (manager, _) = seedPerson("hist-mgr", name = "Manager")
        val (a, _) = seedPerson("hist-a", name = "Alice")
        return World(adminEmail, plainEmail, backdatedTeam(10, manager, listOf(a)), manager, a)
    }

    private suspend fun HttpClient.memberships(teamId: UInt) =
        get("/api/v1/teams/$teamId/memberships").body<TeamMembershipList>().items

    private suspend fun HttpClient.periods(teamId: UInt) =
        get("/api/v1/teams/$teamId/managers").body<TeamManagerPeriodList>().items

    private suspend fun HttpClient.addMembership(team: String, user: UInt, startDate: String? = null, endDate: String? = null) =
        postJson("$team/memberships", TeamMembershipCreate(user, startDate, endDate)).status

    private suspend fun HttpClient.editMembership(team: String, id: Any, startDate: String? = null, endDate: String? = null) =
        putJson("$team/memberships/$id", TeamMembershipWrite(startDate, endDate)).status

    private suspend fun HttpClient.addPeriod(team: String, manager: UInt, startDate: String?) =
        postJson("$team/managers", TeamManagerPeriodWrite(manager, startDate)).status

    private suspend fun HttpClient.editPeriod(team: String, id: Any, manager: UInt, startDate: String?) =
        putJson("$team/managers/$id", TeamManagerPeriodWrite(manager, startDate)).status

    private fun List<TeamManagerPeriodResponse>.shape() = map { Triple(it.managerId, it.startDate, it.endDate) }

    // ---- authz and 404 ordering ----

    @Test
    fun `reads are open to any authenticated caller, writes are admin only and the guard wins over 404 and 400`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val plain = authedClient(w.plainEmail, "pw")
        val admin = authedClient(w.adminEmail, "pw")
        val (other, _) = seedPerson("hist-other")
        val team = "/api/v1/teams/${w.teamId}"

        assertEquals(HttpStatusCode.OK, plain.get("$team/memberships").status)
        assertEquals(HttpStatusCode.OK, plain.get("$team/managers").status)
        // An unknown team is a 404 for a read, whoever asks.
        assertEquals(HttpStatusCode.NotFound, plain.get("/api/v1/teams/999999/memberships").status)
        assertEquals(HttpStatusCode.NotFound, plain.get("/api/v1/teams/999999/managers").status)

        // Writes: 403 first - for an unknown team, an unknown row and a malformed payload alike.
        assertEquals(HttpStatusCode.Forbidden, plain.addMembership(team, other))
        assertEquals(
            HttpStatusCode.Forbidden,
            plain.postJson("/api/v1/teams/999999/memberships", TeamMembershipCreate(other, startDate = "garbage")).status,
        )
        assertEquals(HttpStatusCode.Forbidden, plain.editMembership(team, "999999"))
        assertEquals(HttpStatusCode.Forbidden, plain.delete("$team/memberships/999999").status)
        assertEquals(HttpStatusCode.Forbidden, plain.postJson("$team/managers", TeamManagerPeriodWrite(other)).status)
        assertEquals(HttpStatusCode.Forbidden, plain.putJson("$team/managers/999999", TeamManagerPeriodWrite(other)).status)
        assertEquals(HttpStatusCode.Forbidden, plain.delete("$team/managers/999999").status)
        // The manager of the team has no write right either.
        val managerRow = admin.periods(w.teamId).single()
        assertEquals(HttpStatusCode.Forbidden, plain.delete("$team/managers/${managerRow.id}").status)

        // An admin gets the 404s: unknown team, unknown row, a row of ANOTHER team.
        assertEquals(HttpStatusCode.NotFound, admin.postJson("/api/v1/teams/999999/memberships", TeamMembershipCreate(other)).status)
        assertEquals(HttpStatusCode.NotFound, admin.postJson("/api/v1/teams/999999/managers", TeamManagerPeriodWrite(other)).status)
        assertEquals(HttpStatusCode.NotFound, admin.editMembership(team, "999999"))
        assertEquals(HttpStatusCode.NotFound, admin.delete("$team/memberships/999999").status)
        assertEquals(HttpStatusCode.NotFound, admin.putJson("$team/managers/999999", TeamManagerPeriodWrite(other)).status)
        assertEquals(HttpStatusCode.NotFound, admin.delete("$team/managers/999999").status)
        val (m2, _) = seedPerson("hist-m2")
        val (b2, _) = seedPerson("hist-b2")
        val team2 = backdatedTeam(5, m2, listOf(b2))
        val foreignMembership = membershipRecords(team2).single().id
        val foreignPeriod = periodRecords(team2).single().id
        assertEquals(HttpStatusCode.NotFound, admin.editMembership(team, foreignMembership))
        assertEquals(HttpStatusCode.NotFound, admin.delete("$team/memberships/$foreignMembership").status)
        assertEquals(HttpStatusCode.NotFound, admin.putJson("$team/managers/$foreignPeriod", TeamManagerPeriodWrite(other)).status)
        assertEquals(HttpStatusCode.NotFound, admin.delete("$team/managers/$foreignPeriod").status)
        // Malformed payload is a 400 only after the guard (and the team exists or not is irrelevant to it).
        assertEquals(
            HttpStatusCode.BadRequest,
            admin.postJson("$team/memberships", TeamMembershipCreate(other, startDate = "garbage")).status,
        )
    }

    @Test
    fun `a deleted team answers 404 on every sub-resource operation`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val team = "/api/v1/teams/${w.teamId}"
        val membershipId = admin.memberships(w.teamId).single().id
        val periodId = admin.periods(w.teamId).single().id
        val (other, _) = seedPerson("hist-del-other")
        assertEquals(HttpStatusCode.NoContent, admin.delete(team).status)
        assertEquals(HttpStatusCode.NotFound, admin.get("$team/memberships").status)
        assertEquals(HttpStatusCode.NotFound, admin.get("$team/managers").status)
        assertEquals(HttpStatusCode.NotFound, admin.addMembership(team, other))
        assertEquals(HttpStatusCode.NotFound, admin.editMembership(team, membershipId))
        assertEquals(HttpStatusCode.NotFound, admin.delete("$team/memberships/$membershipId").status)
        assertEquals(HttpStatusCode.NotFound, admin.postJson("$team/managers", TeamManagerPeriodWrite(other)).status)
        assertEquals(HttpStatusCode.NotFound, admin.putJson("$team/managers/$periodId", TeamManagerPeriodWrite(other)).status)
        assertEquals(HttpStatusCode.NotFound, admin.delete("$team/managers/$periodId").status)
    }

    // ---- membership periods ----

    @Test
    fun `membership periods list chronologically, create with a Location, correct and delete`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (b, _) = seedPerson("hist-b", name = "Bob")
        val team = "/api/v1/teams/${w.teamId}"

        val first = admin.memberships(w.teamId).single()
        assertEquals(w.a, first.userId)
        assertEquals("Alice", first.userName)
        assertEquals(dayIso(-10), first.startDate)
        assertEquals(null, first.endDate)
        assertTrue(first.current)

        val created = admin.postJson("$team/memberships", TeamMembershipCreate(b, dayIso(-5), dayIso(-1)))
        assertEquals(HttpStatusCode.Created, created.status)
        val pastRow = created.body<TeamMembershipResponse>()
        assertEquals(false, pastRow.current)
        val location = assertNotNull(created.headers[HttpHeaders.Location])
        assertTrue(location.endsWith("$team/memberships/${pastRow.id}"), "Location was $location")

        // Overlapping the same person's period is a 409; an adjacent one (starting today) and an earlier one are fine.
        assertEquals(HttpStatusCode.Conflict, admin.addMembership(team, b, dayIso(-3), null))
        assertEquals(HttpStatusCode.Created, admin.addMembership(team, b, dayIso(0), null))
        assertEquals(HttpStatusCode.Created, admin.addMembership(team, b, null, dayIso(-6)))
        // A null start sorts first, then chronological.
        assertEquals(
            listOf(null, dayIso(-10), dayIso(-5), dayIso(0)),
            admin.memberships(w.teamId).map { it.startDate },
        )

        // Correct: shorten; an overlap with the person's other period is a 409; unchanged is a quiet 204.
        assertEquals(HttpStatusCode.NoContent, admin.editMembership(team, pastRow.id, dayIso(-5), dayIso(-2)))
        assertEquals(dayIso(-2), admin.memberships(w.teamId).single { it.id == pastRow.id }.endDate)
        assertEquals(HttpStatusCode.Conflict, admin.editMembership(team, pastRow.id, dayIso(-5), dayIso(0)))
        assertEquals(HttpStatusCode.NoContent, admin.editMembership(team, pastRow.id, dayIso(-5), dayIso(-2)))

        assertEquals(HttpStatusCode.NoContent, admin.delete("$team/memberships/${pastRow.id}").status)
        assertTrue(admin.memberships(w.teamId).none { it.id == pastRow.id })
        assertEquals(HttpStatusCode.NotFound, admin.delete("$team/memberships/${pastRow.id}").status)
    }

    @Test
    fun `membership payload validation and deactivated or deleted people`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (b, _) = seedPerson("hist-val-b")
        val (deactivated, _) = seedPerson("hist-val-deact")
        val (gone, _) = seedPerson("hist-val-gone")
        TestServices.users.setDeactivated(deactivated, true)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$gone").status)
        val team = "/api/v1/teams/${w.teamId}"

        // Strict ISO dates, end not before start.
        for (bad in listOf("2026-1-5", "2026/01/05", "+12026-01-05", "tomorrow")) {
            assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, b, startDate = bad), bad)
            assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, b, endDate = bad), bad)
        }
        assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, b, dayIso(-1), dayIso(-2)))
        // The same day is a one-day period.
        assertEquals(HttpStatusCode.Created, admin.addMembership(team, b, dayIso(-4), dayIso(-4)))

        // Unknown and deleted people.
        assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, 999_999_999u))
        assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, gone, dayIso(-3), dayIso(-2)))

        // A deactivated person: purely past periods only.
        assertEquals(HttpStatusCode.Created, admin.addMembership(team, deactivated, dayIso(-9), dayIso(-2)))
        assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, deactivated, dayIso(-1), null))
        assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, deactivated, dayIso(-30), dayIso(0)))
        assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, deactivated, dayIso(5), dayIso(8)))
        // ... and an existing past period cannot be extended into today, but may be shortened or moved.
        val row = admin.memberships(w.teamId).single { it.userId == deactivated }
        assertTrue(row.deactivated)
        assertEquals(HttpStatusCode.BadRequest, admin.editMembership(team, row.id, dayIso(-9), null))
        assertEquals(HttpStatusCode.NoContent, admin.editMembership(team, row.id, dayIso(-9), dayIso(-3)))
        assertEquals(HttpStatusCode.NoContent, admin.editMembership(team, row.id, dayIso(-8), dayIso(-3)))
    }

    @Test
    fun `the manager is never a member on the same day - 400 when it includes today, 409 for a past or future day`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val team = "/api/v1/teams/${w.teamId}"
        // M has managed since 10 days ago.
        assertEquals(HttpStatusCode.Conflict, admin.addMembership(team, w.manager, dayIso(-5), dayIso(-3)))
        assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, w.manager, dayIso(-5), null))
        assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, w.manager, null, null))
        assertEquals(HttpStatusCode.Conflict, admin.addMembership(team, w.manager, dayIso(3), dayIso(5)))
        // Before the manager's period began, membership is fine.
        assertEquals(HttpStatusCode.Created, admin.addMembership(team, w.manager, dayIso(-30), dayIso(-11)))
        // Correcting that row into the manager period collides the same way.
        val row = admin.memberships(w.teamId).single { it.userId == w.manager }
        assertEquals(HttpStatusCode.Conflict, admin.editMembership(team, row.id, dayIso(-30), dayIso(-9)))
    }

    @Test
    fun `a membership ended yesterday through the sub-resource is reopened by today's join`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (b, _) = seedPerson("hist-reopen-b")
        val team = "/api/v1/teams/${w.teamId}"
        val created = admin.postJson("$team/memberships", TeamMembershipCreate(b, dayIso(-5), dayIso(-1))).body<TeamMembershipResponse>()
        // The same-day undo rule of step 1: the period ending yesterday is reopened, no second row.
        assertEquals(HttpStatusCode.NoContent, admin.put("$team/members/$b").status)
        val rows = admin.memberships(w.teamId).filter { it.userId == b }
        assertEquals(1, rows.size)
        assertEquals(created.id, rows.single().id)
        assertEquals(null, rows.single().endDate)
        assertTrue(rows.single().current)
        // A future period of the same pair blocks today's join (409), as in step 1.
        val (c, _) = seedPerson("hist-reopen-c")
        assertEquals(HttpStatusCode.Created, admin.addMembership(team, c, dayIso(4), null))
        assertEquals(HttpStatusCode.Conflict, admin.put("$team/members/$c").status)
    }

    // ---- the manager line ----

    @Test
    fun `the manager line splits, merges and stays contiguous`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (n, _) = seedPerson("hist-n", name = "Nora")
        val (o, _) = seedPerson("hist-o")
        val team = "/api/v1/teams/${w.teamId}"
        val m = w.manager

        val initial = admin.periods(w.teamId).single()
        assertEquals("Manager", initial.managerName)
        assertEquals(m, initial.managerId)
        assertEquals(dayIso(-10), initial.startDate)
        assertEquals(null, initial.endDate)
        assertTrue(initial.current)

        // POST N from -5: the current period is concluded the day before.
        val nRes = admin.postJson("$team/managers", TeamManagerPeriodWrite(n, dayIso(-5)))
        assertEquals(HttpStatusCode.Created, nRes.status)
        val nRow = nRes.body<TeamManagerPeriodResponse>()
        assertTrue(assertNotNull(nRes.headers[HttpHeaders.Location]).endsWith("$team/managers/${nRow.id}"))
        assertEquals(listOf(Triple(m, dayIso(-10), dayIso(-6)), Triple(n, dayIso(-5), null)), admin.periods(w.teamId).shape())

        // POST O from -8 splits M's period: O takes over until N begins.
        val oRow = admin.postJson("$team/managers", TeamManagerPeriodWrite(o, dayIso(-8))).body<TeamManagerPeriodResponse>()
        assertEquals(
            listOf(Triple(m, dayIso(-10), dayIso(-9)), Triple(o, dayIso(-8), dayIso(-6)), Triple(n, dayIso(-5), null)),
            admin.periods(w.teamId).shape(),
        )
        // A start collision and a no-op (the person already manages that day) are 409.
        assertEquals(HttpStatusCode.Conflict, admin.addPeriod(team, m, dayIso(-8)))
        assertEquals(HttpStatusCode.Conflict, admin.addPeriod(team, o, dayIso(-7)))

        // Deleting O: the predecessor absorbs its days.
        assertEquals(HttpStatusCode.NoContent, admin.delete("$team/managers/${oRow.id}").status)
        assertEquals(listOf(Triple(m, dayIso(-10), dayIso(-6)), Triple(n, dayIso(-5), null)), admin.periods(w.teamId).shape())

        // M again from -3 (a stint of N's period): three rows, still contiguous.
        assertEquals(HttpStatusCode.Created, admin.addPeriod(team, m, dayIso(-3)))
        assertEquals(
            listOf(Triple(m, dayIso(-10), dayIso(-6)), Triple(n, dayIso(-5), dayIso(-4)), Triple(m, dayIso(-3), null)),
            admin.periods(w.teamId).shape(),
        )
        // Re-assigning N's period to M merges all three into the earliest row.
        assertEquals(HttpStatusCode.NoContent, admin.editPeriod(team, nRow.id, m, dayIso(-5)))
        assertEquals(listOf(Triple(m, dayIso(-10), null)), admin.periods(w.teamId).shape())
        // The only period cannot be removed.
        assertEquals(HttpStatusCode.Conflict, admin.delete("$team/managers/${initial.id}").status)
    }

    @Test
    fun `deleting the first period hands its start to the successor, and corrections never reorder the line`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (n, _) = seedPerson("hist-corr-n")
        val team = "/api/v1/teams/${w.teamId}"
        val m = w.manager
        val first = admin.periods(w.teamId).single()
        admin.postJson("$team/managers", TeamManagerPeriodWrite(n, dayIso(-5)))

        // Reorder and collision attempts.
        val second = admin.periods(w.teamId).last()
        assertEquals(HttpStatusCode.Conflict, admin.editPeriod(team, second.id, n, dayIso(-12)))
        assertEquals(HttpStatusCode.Conflict, admin.editPeriod(team, second.id, n, dayIso(-10)))
        assertEquals(HttpStatusCode.Conflict, admin.editPeriod(team, first.id, m, dayIso(-5)))
        assertEquals(HttpStatusCode.Conflict, admin.editPeriod(team, first.id, m, dayIso(-2)))
        // In-between moves are fine; a null first start means "since before records".
        assertEquals(HttpStatusCode.NoContent, admin.editPeriod(team, second.id, n, dayIso(-7)))
        assertEquals(HttpStatusCode.NoContent, admin.editPeriod(team, first.id, m, null))
        assertEquals(listOf(Triple(m, null, dayIso(-8)), Triple(n, dayIso(-7), null)), admin.periods(w.teamId).shape())

        // Delete the first period: N inherits its (null) start.
        assertEquals(HttpStatusCode.NoContent, admin.delete("$team/managers/${first.id}").status)
        assertEquals(listOf(Triple(n, null, null)), admin.periods(w.teamId).shape())
    }

    @Test
    fun `a live team's line must start today or earlier`() = testApplication {
        usePostgresTestcontainer()
        val (_, adminEmail) = seedPerson("hist-live-admin", setOf(UserRole.ADMIN))
        val (m, _) = seedPerson("hist-live-m")
        val admin = authedClient(adminEmail, "pw")
        val teamId = backdatedTeam(0, m)
        val team = "/api/v1/teams/$teamId"
        val row = admin.periods(teamId).single()
        assertEquals(HttpStatusCode.Conflict, admin.editPeriod(team, row.id, m, dayIso(3)))
        // A start before the first row prepends a period that runs until the first row begins.
        val (earlier, _) = seedPerson("hist-live-earlier")
        assertEquals(HttpStatusCode.Created, admin.addPeriod(team, earlier, dayIso(-4)))
        assertEquals(
            listOf(Triple(earlier, dayIso(-4), dayIso(-1)), Triple(m, dayIso(0), null)),
            admin.periods(teamId).shape(),
        )
        // "Since before records" is a start of its own; a second null start collides.
        val head = admin.periods(teamId).first()
        assertEquals(HttpStatusCode.NoContent, admin.editPeriod(team, head.id, earlier, null))
        assertEquals(HttpStatusCode.Conflict, admin.addPeriod(team, m, null))
    }

    @Test
    fun `manager payload validation, unknown or deleted managers and deactivated managers`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (n, _) = seedPerson("hist-mv-n")
        val (deactivated, _) = seedPerson("hist-mv-deact")
        val (gone, _) = seedPerson("hist-mv-gone")
        TestServices.users.setDeactivated(deactivated, true)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$gone").status)
        val team = "/api/v1/teams/${w.teamId}"
        val m = w.manager

        assertEquals(HttpStatusCode.BadRequest, admin.addPeriod(team, n, "2026-1-5"))
        assertEquals(HttpStatusCode.BadRequest, admin.addPeriod(team, 999_999_999u, dayIso(-3)))
        assertEquals(HttpStatusCode.BadRequest, admin.addPeriod(team, gone, dayIso(-3)))

        admin.postJson("$team/managers", TeamManagerPeriodWrite(n, dayIso(-3)))
        // Reaching today or later: 400. A stint wholly in the past is allowed.
        assertEquals(HttpStatusCode.BadRequest, admin.addPeriod(team, deactivated, dayIso(-2)))
        assertEquals(HttpStatusCode.Created, admin.addPeriod(team, deactivated, dayIso(-8)))
        assertEquals(
            listOf(Triple(m, dayIso(-10), dayIso(-9)), Triple(deactivated, dayIso(-8), dayIso(-4)), Triple(n, dayIso(-3), null)),
            admin.periods(w.teamId).shape(),
        )
        // Newly assigning a deactivated manager to a current period is a 400; keeping them on a past one is not.
        val current = admin.periods(w.teamId).last()
        assertEquals(HttpStatusCode.BadRequest, admin.editPeriod(team, current.id, deactivated, dayIso(-3)))
        val past = admin.periods(w.teamId).single { it.managerId == deactivated }
        assertEquals(HttpStatusCode.NoContent, admin.editPeriod(team, past.id, deactivated, dayIso(-7)))
    }

    @Test
    fun `the manager line honours the manager-is-never-a-member rule in both directions`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (n, _) = seedPerson("hist-mm-n")
        val team = "/api/v1/teams/${w.teamId}"
        // Alice is a member since -10: making her the manager from the past that reaches today is a 400,
        // from a future day a 409.
        assertEquals(HttpStatusCode.BadRequest, admin.postJson("$team/managers", TeamManagerPeriodWrite(w.a, dayIso(-3))).status)
        assertEquals(HttpStatusCode.Conflict, admin.postJson("$team/managers", TeamManagerPeriodWrite(w.a, dayIso(2))).status)
        // A purely past overlap is a 409 too (history is not re-litigated, but an explicit edit never creates one).
        admin.postJson("$team/managers", TeamManagerPeriodWrite(n, dayIso(-3)))
        assertEquals(HttpStatusCode.Conflict, admin.postJson("$team/managers", TeamManagerPeriodWrite(w.a, dayIso(-8))).status)
        val first = admin.periods(w.teamId).first()
        assertEquals(HttpStatusCode.Conflict, admin.putJson("$team/managers/${first.id}", TeamManagerPeriodWrite(w.a, dayIso(-10))).status)
        // Nothing was written by the refused attempts.
        assertEquals(2, admin.periods(w.teamId).size)
    }

    @Test
    fun `payloads without the required keys are rejected`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val team = "/api/v1/teams/${w.teamId}"
        val raw = admin.postJson("$team/managers", mapOf("startDate" to dayIso(-2)))
        assertEquals(HttpStatusCode.BadRequest, raw.status, raw.bodyAsText())
        assertEquals(HttpStatusCode.BadRequest, admin.postJson("$team/memberships", mapOf("startDate" to dayIso(-2))).status)
    }

    @Test
    fun `an edit that lets a deactivated manager cover today or later is refused, whichever neighbour absorbs it`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (n, _) = seedPerson("hist-abs-n")
        val (d, _) = seedPerson("hist-abs-d")
        TestServices.users.setDeactivated(d, true)
        val team = "/api/v1/teams/${w.teamId}"
        val m = w.manager
        // M(-10..-9), D(-8..-4, wholly past, allowed), N(-3..).
        assertEquals(HttpStatusCode.Created, admin.addPeriod(team, n, dayIso(-3)))
        // D has to be added while it is active: flip the flag only afterwards would also work; here it is
        // already deactivated, so the past stint goes in directly.
        assertEquals(HttpStatusCode.Created, admin.addPeriod(team, d, dayIso(-8)))
        val expected = listOf(Triple(m, dayIso(-10), dayIso(-9)), Triple(d, dayIso(-8), dayIso(-4)), Triple(n, dayIso(-3), null))
        assertEquals(expected, admin.periods(w.teamId).shape())
        val nRow = admin.periods(w.teamId).last()
        // DELETE: D would absorb today.
        assertEquals(HttpStatusCode.BadRequest, admin.delete("$team/managers/${nRow.id}").status)
        // PUT start later: D's end moves to today.
        assertEquals(HttpStatusCode.BadRequest, admin.editPeriod(team, nRow.id, n, dayIso(2)))
        assertEquals(expected, admin.periods(w.teamId).shape(), "refused edits leave the line untouched")
        // Moving N's start earlier only shrinks D: fine.
        assertEquals(HttpStatusCode.NoContent, admin.editPeriod(team, nRow.id, n, dayIso(-5)))
    }

    @Test
    fun `moving a future period of a deactivated manager earlier is refused, later is fine`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (d, _) = seedPerson("hist-fut-d")
        val team = "/api/v1/teams/${w.teamId}"
        // A future handover to D recorded while D was active, then D was deactivated.
        val first = periodRecords(w.teamId).single()
        setPeriodEnd(first.id, dayIso(4))
        val futureRow = insertPeriodRow(w.teamId, d, dayIso(5), null)
        TestServices.users.setDeactivated(d, true)
        assertEquals(HttpStatusCode.BadRequest, admin.editPeriod(team, futureRow, d, dayIso(2)))
        assertEquals(HttpStatusCode.NoContent, admin.editPeriod(team, futureRow, d, dayIso(8)))
    }

    @Test
    fun `membership edits - a start moved earlier extends, and a deleted person cannot reach today`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (d, _) = seedPerson("hist-me-d")
        val (gone, _) = seedPerson("hist-me-gone")
        val team = "/api/v1/teams/${w.teamId}"
        val futureRow = insertMembershipRow(w.teamId, d, dayIso(2), dayIso(6))
        val openRow = insertMembershipRow(w.teamId, gone, dayIso(-9), null)
        TestServices.users.setDeactivated(d, true)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$gone").status)

        assertEquals(HttpStatusCode.BadRequest, admin.editMembership(team, futureRow, dayIso(1), dayIso(6)))
        assertEquals(HttpStatusCode.NoContent, admin.editMembership(team, futureRow, dayIso(2), dayIso(6)))
        assertEquals(HttpStatusCode.NoContent, admin.editMembership(team, futureRow, dayIso(3), dayIso(5)))

        assertEquals(HttpStatusCode.BadRequest, admin.editMembership(team, openRow, dayIso(-8), null))
        assertEquals(HttpStatusCode.BadRequest, admin.editMembership(team, openRow, dayIso(-9), dayIso(0)))
        assertEquals(HttpStatusCode.NoContent, admin.editMembership(team, openRow, dayIso(-9), dayIso(-3)))
    }

    @Test
    fun `period dates are limited to the years 1900 to 9999`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (b, _) = seedPerson("hist-year-b")
        val (n, _) = seedPerson("hist-year-n")
        val team = "/api/v1/teams/${w.teamId}"
        for (bad in listOf("0000-01-01", "1899-12-31")) {
            assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, b, startDate = bad), bad)
            assertEquals(HttpStatusCode.BadRequest, admin.addMembership(team, b, endDate = bad), bad)
            assertEquals(HttpStatusCode.BadRequest, admin.addPeriod(team, n, bad), bad)
        }
        assertEquals(HttpStatusCode.Created, admin.addMembership(team, b, "1900-01-01", dayIso(-11)))
        assertEquals(HttpStatusCode.Created, admin.addPeriod(team, n, "1900-01-01"))
    }

    @Test
    fun `deleting a middle period merges the equal neighbours and deleting the last one reopens the predecessor`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (n, _) = seedPerson("hist-del-n")
        val team = "/api/v1/teams/${w.teamId}"
        val m = w.manager
        admin.addPeriod(team, n, dayIso(-5))
        admin.addPeriod(team, m, dayIso(-3))
        // M, N, M: deleting N lets M absorb it and merges with the second M.
        val nRow = admin.periods(w.teamId).single { it.managerId == n }
        assertEquals(HttpStatusCode.NoContent, admin.delete("$team/managers/${nRow.id}").status)
        assertEquals(listOf(Triple(m, dayIso(-10), null)), admin.periods(w.teamId).shape())
        // [M, N]: deleting the last (open) period reopens its predecessor.
        admin.addPeriod(team, n, dayIso(-5))
        val last = admin.periods(w.teamId).last()
        assertEquals(HttpStatusCode.NoContent, admin.delete("$team/managers/${last.id}").status)
        assertEquals(listOf(Triple(m, dayIso(-10), null)), admin.periods(w.teamId).shape())
    }

    @Test
    fun `a new period followed by the same manager merges into the new row`() = testApplication {
        usePostgresTestcontainer()
        val w = world()
        val admin = authedClient(w.adminEmail, "pw")
        val (n, _) = seedPerson("hist-mrg-n")
        val team = "/api/v1/teams/${w.teamId}"
        admin.addPeriod(team, n, dayIso(-5))
        val oldN = admin.periods(w.teamId).last()
        val res = admin.postJson("$team/managers", TeamManagerPeriodWrite(n, dayIso(-8)))
        assertEquals(HttpStatusCode.Created, res.status)
        val created = res.body<TeamManagerPeriodResponse>()
        assertEquals(dayIso(-8), created.startDate)
        assertEquals(null, created.endDate)
        assertTrue(created.id != oldN.id)
        assertEquals(
            listOf(Triple(w.manager, dayIso(-10), dayIso(-9)), Triple(n, dayIso(-8), null)),
            admin.periods(w.teamId).shape(),
        )
    }
}
