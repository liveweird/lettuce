package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffBudgetList
import ch.nokillswit.daysoff.DaysOffCalendarResponse
import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffPageResponse
import ch.nokillswit.daysoff.DaysOffResponse
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.daysoff.PublicHolidayCreateRequest
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The days-off feature end to end (v3.9.0 — no request/approval lifecycle: every entry is
 * created active and exists until soft-deleted): creation rules (overlap + budget 409s), the
 * full authz matrix (owner / direct manager / grand-manager / teammate / unrelated / ADMIN /
 * HR) for reads and deletes, list views + filters + sort, the calendar payload, the budgets
 * endpoint, and the create/delete notification fan-out. Tests pin their date windows to
 * distinct years (the holiday registry and budget years are per-user or per-year state in the
 * shared container).
 */
class DaysOffRoutesTest {

    /** The first Monday of (year, month) — weekday-stable periods without hardcoded dates. */
    private fun monday(year: Int, month: Int = 6): LocalDate =
        LocalDate.of(year, month, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))

    private suspend fun HttpClient.deleteDaysOff(id: UInt): HttpResponse = delete("/api/v1/days-off/$id")

    private suspend fun HttpClient.createDaysOff(
        start: String,
        end: String = start,
        type: DaysOffType = DaysOffType.PAID,
        startHalf: Boolean = false,
        endHalf: Boolean = false,
        forUserId: UInt? = null,
    ): HttpResponse = post("/api/v1/days-off") {
        contentType(ContentType.Application.Json)
        setBody(DaysOffCreateRequest(type, start, end, startHalf, endHalf, forUserId))
    }

    @Test
    fun `create validates shape, computes the frozen cost, and returns the document`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("do-create")
        val ownerId = TestUsers.seed(ownerEmail, "pw", name = "Create Owner", roles = emptySet())
        TestDaysOff.setAllowance(ownerId, 20)
        val owner = authedClient(ownerEmail, "pw")

        val mon = monday(2030, 3)
        // A Wednesday holiday inside the week reduces the cost.
        TestDaysOff.holidays.create(PublicHolidayCreateRequest(mon.plusDays(2).toString(), "Midweek 2030"))

        // Mon..next Mon with a half first day: 5 working days + Mon, minus the holiday Wed,
        // minus the half = 4.5 days.
        val response = owner.createDaysOff(mon.toString(), mon.plusDays(7).toString(), startHalf = true)
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<DaysOffResponse>()
        assertEquals("/api/v1/days-off/${created.id}", response.headers["Location"])
        assertEquals(ownerId, created.userId)
        assertEquals(4.5, created.days)

        // The cost is FROZEN: deleting the holiday does not reprice the stored entry.
        val holidays = TestDaysOff.holidays.list().first { it.date == mon.plusDays(2).toString() }
        TestDaysOff.holidays.delete(holidays.id)
        assertEquals(4.5, owner.get("/api/v1/days-off/${created.id}").body<DaysOffResponse>().days)

        // Shape 400s.
        assertEquals(HttpStatusCode.BadRequest, owner.createDaysOff("2030-3-04").status)
        assertEquals(HttpStatusCode.BadRequest, owner.createDaysOff("2030-08-08", "2030-08-04").status)
        assertEquals(HttpStatusCode.BadRequest, owner.createDaysOff("2030-12-30", "2031-01-02").status)
        assertEquals(HttpStatusCode.BadRequest, owner.createDaysOff("2030-08-05", "2030-08-05", endHalf = true).status)
        // A weekend-only period has no working days.
        val sat = mon.plusDays(12) // the Saturday after next
        assertEquals(DayOfWeek.SATURDAY, sat.dayOfWeek)
        assertEquals(HttpStatusCode.BadRequest, owner.createDaysOff(sat.toString(), sat.plusDays(1).toString()).status)

        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/days-off").status)
    }

    @Test
    fun `a period may not overlap the owner's active entries`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("do-overlap")
        val ownerId = TestUsers.seed(ownerEmail, "pw", roles = emptySet())
        TestDaysOff.setAllowance(ownerId, 30)
        val owner = authedClient(ownerEmail, "pw")
        val mon = monday(2031, 3)

        val first = owner.createDaysOff(mon.toString(), mon.plusDays(4).toString()).body<DaysOffResponse>()
        // Touching the existing period (same last day) is an overlap; the instance points at it.
        val overlap = owner.createDaysOff(mon.plusDays(4).toString(), mon.plusDays(8).toString())
        assertEquals(HttpStatusCode.Conflict, overlap.status)
        assertEquals("/api/v1/days-off/${first.id}", overlap.body<ProblemDetail>().instance)
        // The week after is free.
        assertEquals(
            HttpStatusCode.Created,
            owner.createDaysOff(mon.plusDays(7).toString(), mon.plusDays(8).toString()).status,
        )
        // Deleting frees the slot: delete the first, then re-book the same days.
        assertEquals(HttpStatusCode.NoContent, owner.deleteDaysOff(first.id).status)
        assertEquals(HttpStatusCode.Created, owner.createDaysOff(mon.toString(), mon.plusDays(4).toString()).status)
    }

    @Test
    fun `PAID requests are budget-gated and UNPAID requests are not`() = testApplication {
        usePostgresTestcontainer()
        val noneEmail = uniqueEmail("do-budget-none")
        TestUsers.seed(noneEmail, "pw", roles = emptySet())
        val noAllowance = authedClient(noneEmail, "pw")
        val mon32 = monday(2032, 3)

        // Null allowance = zero budget: any PAID request is 409, UNPAID sails through.
        assertEquals(HttpStatusCode.Conflict, noAllowance.createDaysOff(mon32.toString()).status)
        assertEquals(
            HttpStatusCode.Created,
            noAllowance.createDaysOff(mon32.toString(), type = DaysOffType.UNPAID).status,
        )

        val ownerEmail = uniqueEmail("do-budget")
        val ownerId = TestUsers.seed(ownerEmail, "pw", roles = emptySet())
        TestDaysOff.setAllowance(ownerId, 2)
        val owner = authedClient(ownerEmail, "pw")

        // 2 of 2 days used; the next half day is over budget; UNPAID is unlimited.
        assertEquals(HttpStatusCode.Created, owner.createDaysOff(mon32.toString(), mon32.plusDays(1).toString()).status)
        assertEquals(HttpStatusCode.Conflict, owner.createDaysOff(mon32.plusDays(2).toString(), startHalf = true).status)
        assertEquals(
            HttpStatusCode.Created,
            owner.createDaysOff(mon32.plusDays(2).toString(), mon32.plusDays(4).toString(), type = DaysOffType.UNPAID).status,
        )
    }

    @Test
    fun `unused budget carries over and never phantom-accumulates`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("do-carry")
        val ownerId = TestUsers.seed(ownerEmail, "pw", roles = emptySet())
        TestDaysOff.setAllowance(ownerId, 2)
        val owner = authedClient(ownerEmail, "pw")

        // First-ever request over the annual allowance: NO carry from empty earlier years.
        assertEquals(
            HttpStatusCode.Conflict,
            owner.createDaysOff(monday(2040).toString(), monday(2040).plusDays(2).toString()).status,
        )
        // Use 1 of 2 days in 2041; 2042 then holds 2 + 1 carried = 3 days.
        assertEquals(HttpStatusCode.Created, owner.createDaysOff(monday(2041).toString()).status)
        assertEquals(
            HttpStatusCode.Created,
            owner.createDaysOff(monday(2042).toString(), monday(2042).plusDays(2).toString()).status,
        )
        // The carry is spent — nothing left in 2042.
        assertEquals(HttpStatusCode.Conflict, owner.createDaysOff(monday(2042, 7).toString(), startHalf = true).status)
    }

    @Test
    fun `a retroactive create may not break a later carry-over-funded year`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("do-retro")
        val ownerId = TestUsers.seed(ownerEmail, "pw", roles = emptySet())
        TestDaysOff.setAllowance(ownerId, 1)
        val owner = authedClient(ownerEmail, "pw")

        // 2045: half of the 1-day allowance used; 2046: 1.5 days = own 1 + carried 0.5.
        assertEquals(HttpStatusCode.Created, owner.createDaysOff(monday(2045).toString(), startHalf = true).status)
        assertEquals(
            HttpStatusCode.Created,
            owner.createDaysOff(monday(2046).toString(), monday(2046).plusDays(1).toString(), startHalf = true).status,
        )
        // Retroactively booking the other 2045 half would leave 2046 over-spent — the sweep
        // covers every later year, so this is 409 …
        val retro = monday(2045, 7)
        assertEquals(HttpStatusCode.Conflict, owner.createDaysOff(retro.toString(), startHalf = true).status)
        // … while the same period UNPAID is fine.
        assertEquals(
            HttpStatusCode.Created,
            owner.createDaysOff(retro.toString(), startHalf = true, type = DaysOffType.UNPAID).status,
        )
    }

    @Test
    fun `delete rights are owner-or-chain, free the budget and overlap slot, and 404 on a second delete`() =
        testApplication {
            usePostgresTestcontainer()
            // G manages Y {M}; M manages X {S, T}. U unrelated, A admin, H HR.
            val gEmail = uniqueEmail("do-del-g")
            val mEmail = uniqueEmail("do-del-m")
            val sEmail = uniqueEmail("do-del-s")
            val tEmail = uniqueEmail("do-del-t")
            val uEmail = uniqueEmail("do-del-u")
            val aEmail = uniqueEmail("do-del-a")
            val hEmail = uniqueEmail("do-del-h")
            val gId = TestUsers.seed(gEmail, "pw", roles = emptySet())
            val mId = TestUsers.seed(mEmail, "pw", roles = emptySet())
            val sId = TestUsers.seed(sEmail, "pw", roles = emptySet())
            val tId = TestUsers.seed(tEmail, "pw", roles = emptySet())
            TestUsers.seed(uEmail, "pw", roles = emptySet())
            TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
            TestUsers.seed(hEmail, "pw", roles = setOf(UserRole.HR))
            val teamY = TestServices.teams.create(Team(name = "delY-${java.util.UUID.randomUUID()}", managerId = gId))
            TestServices.teams.addMember(teamY, mId)
            val teamX = TestServices.teams.create(Team(name = "delX-${java.util.UUID.randomUUID()}", managerId = mId))
            TestServices.teams.addMember(teamX, sId)
            TestServices.teams.addMember(teamX, tId)
            TestDaysOff.setAllowance(sId, 30)

            val g = authedClient(gEmail, "pw")
            val m = authedClient(mEmail, "pw")
            val s = authedClient(sEmail, "pw")
            val t = authedClient(tEmail, "pw")
            val u = authedClient(uEmail, "pw")
            val a = authedClient(aEmail, "pw")
            val h = authedClient(hEmail, "pw")

            val mon = monday(2056, 3)

            // Teammate, unrelated, ADMIN, HR — none may delete.
            val guarded = s.createDaysOff(mon.toString(), mon.plusDays(1).toString()).body<DaysOffResponse>()
            for (denied in listOf(t, u, a, h)) {
                assertEquals(HttpStatusCode.Forbidden, denied.deleteDaysOff(guarded.id).status)
            }

            // The direct manager may delete — frees the overlap slot and the budget. Audited
            // as days_off.deleted, byUserId the acting manager, targetUserId the owner.
            val deleteCapture = LogCapture("ch.nokillswit.audit")
            try {
                assertEquals(HttpStatusCode.NoContent, m.deleteDaysOff(guarded.id).status)
                assertNotNull(
                    deleteCapture.awaitEvent { event ->
                        event.message == "days_off.deleted" &&
                            event.keyValuePairs?.any { it.key == "byUserId" && it.value == mId.toLong() } == true &&
                            event.keyValuePairs?.any { it.key == "targetUserId" && it.value == sId.toLong() } == true &&
                            event.keyValuePairs?.any { it.key == "requestId" && it.value == guarded.id.toLong() } == true
                    },
                )
            } finally {
                deleteCapture.detach()
            }
            assertEquals(HttpStatusCode.Created, s.createDaysOff(mon.toString(), mon.plusDays(1).toString()).status)
            // A second delete of the same (now already-deleted) id is 404.
            assertEquals(HttpStatusCode.NotFound, m.deleteDaysOff(guarded.id).status)

            // The grand-manager (chain, v2.33.0) may delete too.
            val forChain = s.createDaysOff(mon.plusDays(7).toString()).body<DaysOffResponse>()
            assertEquals(HttpStatusCode.NoContent, g.deleteDaysOff(forChain.id).status)

            // The owner may delete their own.
            val forOwner = s.createDaysOff(mon.plusDays(14).toString()).body<DaysOffResponse>()
            assertEquals(HttpStatusCode.NoContent, s.deleteDaysOff(forOwner.id).status)

            // Unknown id is 404 everywhere.
            assertEquals(HttpStatusCode.NotFound, s.deleteDaysOff(999999u).status)
        }

    @Test
    fun `the authz matrix gates reads`() = testApplication {
        usePostgresTestcontainer()
        // G manages Y {M}; M manages X {S, T}. U unrelated, A admin, H HR.
        val gEmail = uniqueEmail("do-az-g")
        val mEmail = uniqueEmail("do-az-m")
        val sEmail = uniqueEmail("do-az-s")
        val tEmail = uniqueEmail("do-az-t")
        val uEmail = uniqueEmail("do-az-u")
        val aEmail = uniqueEmail("do-az-a")
        val hEmail = uniqueEmail("do-az-h")
        val gId = TestUsers.seed(gEmail, "pw", roles = emptySet())
        val mId = TestUsers.seed(mEmail, "pw", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", roles = emptySet())
        val tId = TestUsers.seed(tEmail, "pw", roles = emptySet())
        TestUsers.seed(uEmail, "pw", roles = emptySet())
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        TestUsers.seed(hEmail, "pw", roles = setOf(UserRole.HR))
        val teamY = TestServices.teams.create(Team(name = "azY-${java.util.UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamY, mId)
        val teamX = TestServices.teams.create(Team(name = "azX-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamX, sId)
        TestServices.teams.addMember(teamX, tId)
        TestDaysOff.setAllowance(sId, 30)

        val g = authedClient(gEmail, "pw")
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val t = authedClient(tEmail, "pw")
        val u = authedClient(uEmail, "pw")
        val a = authedClient(aEmail, "pw")
        val h = authedClient(hEmail, "pw")

        val mon = monday(2055, 3)
        val request = s.createDaysOff(mon.toString(), mon.plusDays(1).toString()).body<DaysOffResponse>()
        val url = "/api/v1/days-off/${request.id}"

        // Reads (v3.9.0 — no lifecycle left to gate on): owner, direct manager, grand-manager
        // (chain), teammate.
        assertEquals(HttpStatusCode.OK, s.get(url).status)
        assertEquals(HttpStatusCode.OK, m.get(url).status)
        assertEquals(HttpStatusCode.OK, g.get(url).status)
        assertEquals(HttpStatusCode.OK, t.get(url).status)
        // Unrelated and non-party ADMIN get nothing.
        assertEquals(HttpStatusCode.Forbidden, u.get(url).status)
        assertEquals(HttpStatusCode.Forbidden, a.get(url).status)

        // HR reads with an audit event.
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            assertEquals(HttpStatusCode.OK, h.get(url).status)
            assertNotNull(
                capture.awaitEvent {
                    it.message == "hr.read" && it.hasKeyValue("resource", "daysOff") &&
                        it.keyValuePairs?.any { kv -> kv.key == "resourceId" && kv.value == request.id.toLong() } == true
                },
            )
        } finally {
            capture.detach()
        }

        // Once deleted, the entry is gone for everyone — owner, chain, and HR included.
        assertEquals(HttpStatusCode.NoContent, m.deleteDaysOff(request.id).status)
        assertEquals(HttpStatusCode.NotFound, s.get(url).status)
        assertEquals(HttpStatusCode.NotFound, g.get(url).status)
        assertEquals(HttpStatusCode.NotFound, h.get(url).status)

        // The HR auditor list view: HR only, userId required.
        assertEquals(HttpStatusCode.OK, h.get("/api/v1/days-off?view=user&userId=$sId").status)
        assertEquals(HttpStatusCode.Forbidden, a.get("/api/v1/days-off?view=user&userId=$sId").status)
        assertEquals(HttpStatusCode.BadRequest, h.get("/api/v1/days-off?view=user").status)
        assertEquals(HttpStatusCode.BadRequest, s.get("/api/v1/days-off?view=own&userId=$sId").status)
        assertEquals(HttpStatusCode.BadRequest, s.get("/api/v1/days-off?view=bogus").status)
    }

    @Test
    fun `list views scope and the filters and sorts compose`() = testApplication {
        usePostgresTestcontainer()
        val mEmail = uniqueEmail("do-list-m")
        val aliceEmail = uniqueEmail("do-list-alice")
        val zaraEmail = uniqueEmail("do-list-zara")
        val subSubEmail = uniqueEmail("do-list-subsub")
        val mId = TestUsers.seed(mEmail, "pw", name = "List Mgr", roles = emptySet())
        val aliceId = TestUsers.seed(aliceEmail, "pw", name = "Alice Lister", roles = emptySet())
        val zaraId = TestUsers.seed(zaraEmail, "pw", name = "Zara Lister", roles = emptySet())
        val subSubId = TestUsers.seed(subSubEmail, "pw", name = "Deep Report", roles = emptySet())
        val teamTop = TestServices.teams.create(Team(name = "list-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamTop, aliceId)
        TestServices.teams.addMember(teamTop, zaraId)
        // Alice manages her own team — its member is OUTSIDE M's managed list scope (direct only).
        val teamSub = TestServices.teams.create(Team(name = "list2-${java.util.UUID.randomUUID()}", managerId = aliceId))
        TestServices.teams.addMember(teamSub, subSubId)
        listOf(aliceId, zaraId, subSubId).forEach { TestDaysOff.setAllowance(it, 30) }
        val m = authedClient(mEmail, "pw")
        val alice = authedClient(aliceEmail, "pw")
        val zara = authedClient(zaraEmail, "pw")
        val subSub = authedClient(subSubEmail, "pw")

        val mon = monday(2057, 3)
        val short = alice.createDaysOff(mon.toString(), type = DaysOffType.UNPAID).body<DaysOffResponse>()
        val long = alice.createDaysOff(mon.plusDays(7).toString(), mon.plusDays(11).toString()).body<DaysOffResponse>()
        val zaras = zara.createDaysOff(mon.plusDays(1).toString(), mon.plusDays(2).toString()).body<DaysOffResponse>()
        subSub.createDaysOff(mon.toString(), type = DaysOffType.UNPAID)

        // view=own: only the caller's rows, default sort -startDate.
        val own = alice.get("/api/v1/days-off").body<DaysOffPageResponse>()
        assertEquals(listOf(long.id, short.id), own.items.map { it.id })
        assertEquals(2, own.total)

        // view=managed: DIRECT reports only — Alice + Zara, never the sub-report.
        val managed = m.get("/api/v1/days-off?view=managed&pageSize=100").body<DaysOffPageResponse>()
        assertEquals(setOf(short.id, long.id, zaras.id), managed.items.map { it.id }.toSet())
        // userName substring + userId pin + type/date-window filters.
        val byName = m.get("/api/v1/days-off?view=managed&userName=zara").body<DaysOffPageResponse>()
        assertEquals(listOf(zaras.id), byName.items.map { it.id })
        val byUser = m.get("/api/v1/days-off?view=managed&userId=$aliceId").body<DaysOffPageResponse>()
        assertEquals(setOf(short.id, long.id), byUser.items.map { it.id }.toSet())
        val paidOnly = m.get("/api/v1/days-off?view=managed&type=PAID&userId=$aliceId").body<DaysOffPageResponse>()
        assertEquals(listOf(long.id), paidOnly.items.map { it.id })
        val window = m.get(
            "/api/v1/days-off?view=managed&startDate[gte]=${mon.plusDays(3)}&startDate[lte]=${mon.plusDays(9)}",
        ).body<DaysOffPageResponse>()
        assertEquals(listOf(long.id), window.items.map { it.id })
        assertEquals(HttpStatusCode.BadRequest, m.get("/api/v1/days-off?view=managed&startDate[gte]=garbage").status)

        // The days sort orders by the stored cost.
        val byDays = alice.get("/api/v1/days-off?sort=days").body<DaysOffPageResponse>()
        assertEquals(listOf(short.id, long.id), byDays.items.map { it.id })
        assertEquals(1.0, byDays.items.first().days)
        assertEquals(HttpStatusCode.BadRequest, alice.get("/api/v1/days-off?sort=bogus").status)

        // A managerless caller's managed view is empty, not an error.
        assertEquals(0, zara.get("/api/v1/days-off?view=managed").body<DaysOffPageResponse>().total)

        // canDelete: the owner and their chain manager see it true; a non-owning teammate row
        // does not exist here, but the field itself round-trips on every row.
        assertTrue(own.items.all { it.canDelete })
        assertTrue(managed.items.all { it.canDelete })
    }

    @Test
    fun `the calendar expands periods, clips to the month, and embeds holidays`() = testApplication {
        usePostgresTestcontainer()
        val mEmail = uniqueEmail("do-cal-m")
        val sEmail = uniqueEmail("do-cal-s")
        val tEmail = uniqueEmail("do-cal-t")
        val loneEmail = uniqueEmail("do-cal-lone")
        val mId = TestUsers.seed(mEmail, "pw", name = "Cal Mgr", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "Cal Sub", roles = emptySet())
        val tId = TestUsers.seed(tEmail, "pw", name = "Cal Mate", roles = emptySet())
        TestUsers.seed(loneEmail, "pw", name = "Cal Loner", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "cal-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamId, sId)
        TestServices.teams.addMember(teamId, tId)
        TestDaysOff.setAllowance(sId, 30)
        TestDaysOff.setAllowance(tId, 30)
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val t = authedClient(tEmail, "pw")
        val lone = authedClient(loneEmail, "pw")

        // S: Mar 28 .. Apr 3 2058 with a half first day — spans the month boundary.
        val request = s.createDaysOff("2058-03-28", "2058-04-03", startHalf = true).body<DaysOffResponse>()
        // T: an entry in the same window that gets DELETED must never appear.
        val deletedEntry = t.createDaysOff("2058-04-07", "2058-04-08").body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, t.deleteDaysOff(deletedEntry.id).status)
        TestDaysOff.holidays.create(PublicHolidayCreateRequest("2058-04-01", "April Fools 2058"))

        val march = t.get("/api/v1/days-off/calendar?month=2058-03").body<DaysOffCalendarResponse>()
        assertEquals("2058-03", march.month)
        // Scope member: every teammate appears, entries or not, sorted by name (Mate < Sub).
        assertEquals(listOf(tId, sId), march.users.map { it.userId }.filter { it in setOf(sId, tId) })
        val sMarch = march.users.first { it.userId == sId }
        // Scope teams (v3.13.0): the member scope names the team shared with the caller (T).
        assertEquals(listOf(teamId), sMarch.teams.map { it.id })
        // Clipped to the month: 28..31 (weekends included — the bar renders continuously).
        assertEquals(listOf("2058-03-28", "2058-03-29", "2058-03-30", "2058-03-31"), sMarch.entries.map { it.date })
        assertTrue(sMarch.entries.first().half) // the half start day
        assertTrue(sMarch.entries.drop(1).none { it.half })
        assertEquals(request.id, sMarch.entries.first().requestId)

        val april = t.get("/api/v1/days-off/calendar?month=2058-04").body<DaysOffCalendarResponse>()
        val sApril = april.users.first { it.userId == sId }
        assertEquals(listOf("2058-04-01", "2058-04-02", "2058-04-03"), sApril.entries.map { it.date })
        assertEquals(listOf("April Fools 2058"), april.holidays.map { it.name })
        // The deleted entry is invisible; T still has a row.
        assertTrue(april.users.first { it.userId == tId }.entries.isEmpty())

        // Scope managed: the manager sees the team members (the manager is not a member here).
        val managed = m.get("/api/v1/days-off/calendar?month=2058-03&scope=managed").body<DaysOffCalendarResponse>()
        assertEquals(setOf(sId, tId), managed.users.map { it.userId }.toSet())
        assertTrue(m.get("/api/v1/days-off/calendar?month=2058-03").body<DaysOffCalendarResponse>()
            .users.none { it.userId == sId }) // member scope for a non-member manager

        // A team-less caller sees just themselves; month validation is strict.
        val loneCal = lone.get("/api/v1/days-off/calendar?month=2058-03").body<DaysOffCalendarResponse>()
        assertEquals(1, loneCal.users.size)
        assertEquals(HttpStatusCode.BadRequest, lone.get("/api/v1/days-off/calendar?month=2058-3").status)
        assertEquals(HttpStatusCode.BadRequest, lone.get("/api/v1/days-off/calendar").status)
        assertEquals(HttpStatusCode.BadRequest, lone.get("/api/v1/days-off/calendar?month=2058-03&scope=bogus").status)
    }

    @Test
    fun `the calendar widens to the subtree with includeIndirect and names the scope teams`() = testApplication {
        usePostgresTestcontainer()
        // G manages team Y {M}; M manages team X {S, T}.
        val gEmail = uniqueEmail("do-cal-ii-g")
        val mEmail = uniqueEmail("do-cal-ii-m")
        val sEmail = uniqueEmail("do-cal-ii-s")
        val tEmail = uniqueEmail("do-cal-ii-t")
        val gId = TestUsers.seed(gEmail, "pw", name = "CalII Grand", roles = emptySet())
        val mId = TestUsers.seed(mEmail, "pw", name = "CalII Mgr", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "CalII Sub", roles = emptySet())
        val tId = TestUsers.seed(tEmail, "pw", name = "CalII Mate", roles = emptySet())
        val teamY = TestServices.teams.create(Team(name = "cal-ii-Y-${java.util.UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamY, mId)
        val teamX = TestServices.teams.create(Team(name = "cal-ii-X-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamX, sId)
        TestServices.teams.addMember(teamX, tId)
        // S also sits in team Z, managed by U who is NOWHERE in G's chain: Z must never be
        // named as a scope team, in any scope (the `teamId inList` predicate's negative pin).
        val uId = TestUsers.seed(uniqueEmail("do-cal-ii-u"), "pw", name = "CalII Outsider", roles = emptySet())
        val teamZ = TestServices.teams.create(Team(name = "cal-ii-Z-${java.util.UUID.randomUUID()}", managerId = uId))
        TestServices.teams.addMember(teamZ, sId)
        val g = authedClient(gEmail, "pw")
        val s = authedClient(sEmail, "pw")

        val month = "2064-05"

        // Direct managed scope: G sees only M, whose scope team is Y (the team G manages).
        val direct = g.get("/api/v1/days-off/calendar?month=$month&scope=managed").body<DaysOffCalendarResponse>()
        assertEquals(setOf(mId), direct.users.map { it.userId }.toSet())
        assertEquals(listOf(teamY), direct.users.single { it.userId == mId }.teams.map { it.id })

        // includeIndirect widens to the whole subtree; each row names the team through which
        // the person sits in G's chain — S/T via X (managed by M, in the subtree), M via Y.
        val widened = g.get("/api/v1/days-off/calendar?month=$month&scope=managed&includeIndirect=true")
            .body<DaysOffCalendarResponse>()
        assertEquals(setOf(mId, sId, tId), widened.users.map { it.userId }.toSet())
        assertEquals(listOf(teamX), widened.users.single { it.userId == sId }.teams.map { it.id })
        assertEquals(listOf(teamX), widened.users.single { it.userId == tId }.teams.map { it.id })
        assertEquals(listOf(teamY), widened.users.single { it.userId == mId }.teams.map { it.id })
        assertTrue(widened.users.flatMap { it.teams }.none { it.id == teamZ }, "out-of-chain team Z leaked")

        // Member scope (S's default view): rows name the caller's member teams the person
        // shares. S sits in X and Z, so S's own row names both; T shares only X with S.
        val member = s.get("/api/v1/days-off/calendar?month=$month").body<DaysOffCalendarResponse>()
        assertEquals(setOf(teamX, teamZ), member.users.single { it.userId == sId }.teams.map { it.id }.toSet())
        assertEquals(listOf(teamX), member.users.single { it.userId == tId }.teams.map { it.id })

        // The strict-boolean shape rule: includeIndirect only with scope=managed.
        assertEquals(
            HttpStatusCode.BadRequest,
            s.get("/api/v1/days-off/calendar?month=$month&includeIndirect=true").status,
        )
        assertEquals(
            HttpStatusCode.BadRequest,
            g.get("/api/v1/days-off/calendar?month=$month&scope=managed&includeIndirect=maybe").status,
        )
    }

    @Test
    fun `budgets report allowance, carry-over, and used per user`() = testApplication {
        usePostgresTestcontainer()
        val mEmail = uniqueEmail("do-bud-m")
        val sEmail = uniqueEmail("do-bud-s")
        val mId = TestUsers.seed(mEmail, "pw", name = "Budget Mgr", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "Budget Sub", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "bud-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamId, sId)
        TestDaysOff.setAllowance(sId, 10)
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")

        val mon = monday(2059, 3)
        s.createDaysOff(mon.toString(), mon.plusDays(1).toString()) // 2.0 days
        s.createDaysOff(mon.plusDays(7).toString(), startHalf = true) // 0.5 days

        val own = s.get("/api/v1/days-off/budgets?year=2059").body<DaysOffBudgetList>()
        val mine = own.items.single()
        assertEquals(sId, mine.userId)
        assertEquals(2059, mine.year)
        assertEquals(10, mine.allowance)
        assertEquals(0.0, mine.carriedOver)
        // v3.9.0: every active PAID entry counts as used — no reserved/used split.
        assertEquals(2.5, mine.used)
        assertEquals(7.5, mine.remaining)
        // The next year sees the remainder carried over.
        val nextYear = s.get("/api/v1/days-off/budgets?year=2060").body<DaysOffBudgetList>().items.single()
        assertEquals(7.5, nextYear.carriedOver)
        assertEquals(17.5, nextYear.remaining)

        // The manager's overview covers the direct reports (never the manager themselves).
        val managed = m.get("/api/v1/days-off/budgets?view=managed&year=2059").body<DaysOffBudgetList>()
        assertEquals(listOf(sId), managed.items.map { it.userId })
        // A manager-less budget view of a manager without a configured allowance still rows up.
        val mOwn = m.get("/api/v1/days-off/budgets?year=2059").body<DaysOffBudgetList>().items.single()
        assertNull(mOwn.allowance)
        assertEquals(0.0, mOwn.remaining)

        assertEquals(HttpStatusCode.BadRequest, s.get("/api/v1/days-off/budgets?year=1999").status)
        assertEquals(HttpStatusCode.BadRequest, s.get("/api/v1/days-off/budgets?year=abc").status)
        assertEquals(HttpStatusCode.BadRequest, s.get("/api/v1/days-off/budgets?view=bogus").status)
    }

    @Test
    fun `budgets view=user is the HR auditor's read-only view of one person, 403 for anyone else`() = testApplication {
        usePostgresTestcontainer()
        val mEmail = uniqueEmail("do-bud-user-m")
        val sEmail = uniqueEmail("do-bud-user-s")
        val hEmail = uniqueEmail("do-bud-user-h")
        val mId = TestUsers.seed(mEmail, "pw", name = "Audited Mgr", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "Audited Sub", roles = emptySet())
        TestUsers.seed(hEmail, "pw", roles = setOf(UserRole.HR))
        val teamId = TestServices.teams.create(Team(name = "bud-u-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamId, sId)
        TestDaysOff.setAllowance(sId, 10)
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val h = authedClient(hEmail, "pw")
        val a = authedClient("admin@lettuce.local", "changeme")

        val mon = monday(2059, 4)
        s.createDaysOff(mon.toString(), mon.plusDays(1).toString()) // 2.0 days

        val audited = h.get("/api/v1/days-off/budgets?view=user&userId=$sId&year=2059").body<DaysOffBudgetList>()
        val row = audited.items.single()
        assertEquals(sId, row.userId)
        assertEquals(10, row.allowance)
        assertEquals(2.0, row.used)
        // A read-only audit view — never correctable, even though HR could otherwise read the
        // corrections.
        assertFalse(row.canCorrect)

        // 403 for a manager (chain rights don't carry the auditor scope) and for ADMIN.
        assertEquals(
            HttpStatusCode.Forbidden,
            m.get("/api/v1/days-off/budgets?view=user&userId=$sId").status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            a.get("/api/v1/days-off/budgets?view=user&userId=$sId").status,
        )

        // 400 without userId.
        assertEquals(HttpStatusCode.BadRequest, h.get("/api/v1/days-off/budgets?view=user").status)

        // 400 when userId rides own/managed — budgets has no pin-filter there.
        assertEquals(HttpStatusCode.BadRequest, s.get("/api/v1/days-off/budgets?view=own&userId=$sId").status)
        assertEquals(HttpStatusCode.BadRequest, m.get("/api/v1/days-off/budgets?view=managed&userId=$sId").status)
    }

    @Test
    fun `create and delete notify every teammate plus each team's direct manager, minus the actor`() =
        testApplication {
            usePostgresTestcontainer()
            // S is a member of two teams: M1's (with P1) and M2's (with P2) — the multi-team union.
            val m1Email = uniqueEmail("do-not-m1")
            val m2Email = uniqueEmail("do-not-m2")
            val sEmail = uniqueEmail("do-not-s")
            val p1Email = uniqueEmail("do-not-p1")
            val p2Email = uniqueEmail("do-not-p2")
            val m1Id = TestUsers.seed(m1Email, "pw", name = "Notif Mgr One", roles = emptySet())
            val m2Id = TestUsers.seed(m2Email, "pw", name = "Notif Mgr Two", roles = emptySet())
            val sId = TestUsers.seed(sEmail, "pw", name = "Notif Sub", roles = emptySet())
            val p1Id = TestUsers.seed(p1Email, "pw", roles = emptySet())
            val p2Id = TestUsers.seed(p2Email, "pw", roles = emptySet())
            val team1 = TestServices.teams.create(Team(name = "not1-${java.util.UUID.randomUUID()}", managerId = m1Id))
            TestServices.teams.addMember(team1, sId)
            TestServices.teams.addMember(team1, p1Id)
            val team2 = TestServices.teams.create(Team(name = "not2-${java.util.UUID.randomUUID()}", managerId = m2Id))
            TestServices.teams.addMember(team2, sId)
            TestServices.teams.addMember(team2, p2Id)
            TestDaysOff.setAllowance(sId, 30)
            val m1 = authedClient(m1Email, "pw")
            val m2 = authedClient(m2Email, "pw")
            val s = authedClient(sEmail, "pw")
            val p1 = authedClient(p1Email, "pw")
            val p2 = authedClient(p2Email, "pw")

            suspend fun HttpClient.notificationsOf(type: NotificationType) =
                get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
                    .items.filter { it.type == type }

            val mon = monday(2060, 3)
            val created = s.createDaysOff(mon.toString(), mon.plusDays(1).toString(), startHalf = true).body<DaysOffResponse>()

            // Create fan-out: the union of both teams' membership + both teams' direct manager,
            // minus S (the actor) — M1, M2, P1, P2 each get exactly one; S gets none.
            for (client in listOf(m1, m2, p1, p2)) {
                val note = client.notificationsOf(NotificationType.DAYS_OFF_CREATED).single()
                assertEquals("Notif Sub", note.params["person"])
                assertEquals(mon.toString(), note.params["startDate"])
                assertEquals("/days-off?tab=team", note.link)
            }
            assertEquals(0, s.notificationsOf(NotificationType.DAYS_OFF_CREATED).size)

            // Delete fan-out is the same set — minus the acting deleter this time (M1, who
            // deletes here, so S/M2/P1/P2 hear about it and M1 doesn't).
            assertEquals(HttpStatusCode.NoContent, m1.deleteDaysOff(created.id).status)
            for (client in listOf(s, m2, p1, p2)) {
                assertEquals(1, client.notificationsOf(NotificationType.DAYS_OFF_DELETED).size)
            }
            assertEquals(0, m1.notificationsOf(NotificationType.DAYS_OFF_DELETED).size)
        }

    @Test
    fun `a manager in the chain records days off on behalf of a report`() = testApplication {
        usePostgresTestcontainer()
        // G manages Y {M}; M manages X {S, T}. U unrelated, A admin, H HR.
        val gEmail = uniqueEmail("do-ob-g")
        val mEmail = uniqueEmail("do-ob-m")
        val sEmail = uniqueEmail("do-ob-s")
        val tEmail = uniqueEmail("do-ob-t")
        val uEmail = uniqueEmail("do-ob-u")
        val aEmail = uniqueEmail("do-ob-a")
        val hEmail = uniqueEmail("do-ob-h")
        val gId = TestUsers.seed(gEmail, "pw", roles = emptySet())
        val mId = TestUsers.seed(mEmail, "pw", name = "OnBehalf Mgr", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "OnBehalf Sub", roles = emptySet())
        val tId = TestUsers.seed(tEmail, "pw", roles = emptySet())
        TestUsers.seed(uEmail, "pw", roles = emptySet())
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        TestUsers.seed(hEmail, "pw", roles = setOf(UserRole.HR))
        val teamY = TestServices.teams.create(Team(name = "obY-${java.util.UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamY, mId)
        val teamX = TestServices.teams.create(Team(name = "obX-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamX, sId)
        TestServices.teams.addMember(teamX, tId)
        TestDaysOff.setAllowance(sId, 30)

        val g = authedClient(gEmail, "pw")
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val t = authedClient(tEmail, "pw")
        val u = authedClient(uEmail, "pw")
        val a = authedClient(aEmail, "pw")
        val h = authedClient(hEmail, "pw")

        suspend fun HttpClient.notificationsOf(type: NotificationType) =
            get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
                .items.filter { it.type == type }

        // Retroactive on purpose (a past-decade year, unused by other tests) — the
        // history-population use case.
        val mon = monday(2002, 3)

        // Any manager in the target's chain (v2.33.0): not the target themselves,
        // a teammate, an unrelated user, ADMIN, or HR — uniform 403 before validation.
        for (denied in listOf(s, t, u, a, h)) {
            assertEquals(HttpStatusCode.Forbidden, denied.createDaysOff(mon.toString(), forUserId = sId).status)
        }
        // Pin the ordering itself: the guard runs BEFORE payload validation, so an outsider's
        // MALFORMED on-behalf request is still the uniform 403, never a 400.
        assertEquals(HttpStatusCode.Forbidden, u.createDaysOff("not-a-date", forUserId = sId).status)

        // The recorded entry, audited as days_off.recorded — no lifecycle stamp (v3.9.0).
        val capture = LogCapture("ch.nokillswit.audit")
        val created = try {
            val response = m.createDaysOff(mon.toString(), mon.plusDays(1).toString(), forUserId = sId)
            assertEquals(HttpStatusCode.Created, response.status)
            val created = response.body<DaysOffResponse>()
            assertNotNull(
                capture.awaitEvent { event ->
                    event.message == "days_off.recorded" &&
                        event.keyValuePairs?.any { it.key == "byUserId" && it.value == mId.toLong() } == true &&
                        event.keyValuePairs?.any { it.key == "targetUserId" && it.value == sId.toLong() } == true &&
                        event.keyValuePairs?.any { it.key == "requestId" && it.value == created.id.toLong() } == true
                },
            )
            created
        } finally {
            capture.detach()
        }
        assertEquals(sId, created.userId)
        assertEquals(2.0, created.days)

        // The create fan-out reaches the owner (a teamX member) and T (a teammate), but not M —
        // the acting manager is excluded from their own receipt.
        val ownerNote = s.notificationsOf(NotificationType.DAYS_OFF_CREATED).single()
        assertEquals("OnBehalf Sub", ownerNote.params["person"])
        assertEquals(mon.toString(), ownerNote.params["startDate"])
        assertEquals(1, t.notificationsOf(NotificationType.DAYS_OFF_CREATED).size)
        assertEquals(0, m.notificationsOf(NotificationType.DAYS_OFF_CREATED).size)

        // The state rules bite unchanged, keyed on the TARGET: overlap 409 (instance points
        // at the recorded entry) and the paid-budget gate (T has no allowance; UNPAID passes).
        val overlap = m.createDaysOff(mon.plusDays(1).toString(), mon.plusDays(2).toString(), forUserId = sId)
        assertEquals(HttpStatusCode.Conflict, overlap.status)
        assertEquals("/api/v1/days-off/${created.id}", overlap.body<ProblemDetail>().instance)
        assertEquals(HttpStatusCode.Conflict, m.createDaysOff(mon.toString(), forUserId = tId).status)
        assertEquals(
            HttpStatusCode.Created,
            m.createDaysOff(mon.toString(), type = DaysOffType.UNPAID, forUserId = tId).status,
        )

        // The chain rule (v2.33.0): the grand-manager records for the skip-level report too —
        // this time M is NOT the actor, so M is back in the fan-out (a teamX direct manager).
        val chainRecorded = g.createDaysOff(mon.plusDays(14).toString(), forUserId = sId)
        assertEquals(HttpStatusCode.Created, chainRecorded.status)
        val chainCreated = chainRecorded.body<DaysOffResponse>()
        assertEquals(sId, chainCreated.userId)
        assertEquals(1, m.notificationsOf(NotificationType.DAYS_OFF_CREATED).size)

        // A deactivated report cannot receive NEW entries (the house rule) — 400 after the guard.
        assertEquals(HttpStatusCode.NoContent, a.post("/api/v1/users/$tId/deactivate").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            m.createDaysOff(mon.plusDays(7).toString(), forUserId = tId).status,
        )
    }
}
