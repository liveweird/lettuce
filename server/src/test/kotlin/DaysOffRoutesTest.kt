package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffBudgetList
import ch.nokillswit.daysoff.DaysOffCancelRequest
import ch.nokillswit.daysoff.DaysOffCalendarResponse
import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.daysoff.DaysOffPageResponse
import ch.nokillswit.daysoff.DaysOffResponse
import ch.nokillswit.daysoff.DaysOffStatus
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.daysoff.PublicHolidayCreateRequest
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.update
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The days-off feature end to end: creation rules (overlap + budget 409s), the status machine,
 * the full authz matrix (owner / direct manager / grand-manager / teammate / unrelated / ADMIN /
 * HR), list views + filters + sort, the calendar payload, the budgets endpoint, and the
 * notification fan-out. Tests pin their date windows to distinct years (the holiday registry and
 * budget years are per-user or per-year state in the shared container).
 */
class DaysOffRoutesTest {

    /** The first Monday of (year, month) — weekday-stable periods without hardcoded dates. */
    private fun monday(year: Int, month: Int = 6): LocalDate =
        LocalDate.of(year, month, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))

    /** The mandatory-reason cancel POST (v2.31.0). */
    private suspend fun HttpClient.cancelDaysOff(id: UInt, reason: String = "test cancel reason"): HttpResponse =
        post("/api/v1/days-off/$id/cancel") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCancelRequest(reason))
        }

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
        assertEquals(DaysOffStatus.REQUESTED, created.status)
        assertEquals(4.5, created.days)
        assertNull(created.resolvedById)
        assertNull(created.cancelledAt)

        // The cost is FROZEN: deleting the holiday does not reprice the stored request.
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
    fun `a period may not overlap the owner's REQUESTED or ACCEPTED requests`() = testApplication {
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
        // CANCELLED frees the slot: cancel the first, then re-book the same days.
        assertEquals(HttpStatusCode.NoContent, owner.cancelDaysOff(first.id).status)
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
        // covers every later counting year, so this is 409 …
        val retro = monday(2045, 7)
        assertEquals(HttpStatusCode.Conflict, owner.createDaysOff(retro.toString(), startHalf = true).status)
        // … while the same period UNPAID is fine.
        assertEquals(
            HttpStatusCode.Created,
            owner.createDaysOff(retro.toString(), startHalf = true, type = DaysOffType.UNPAID).status,
        )
    }

    @Test
    fun `the status machine resolves, cancels, and 409s invalid edges`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("do-m")
        val subEmail = uniqueEmail("do-s")
        val mgrId = TestUsers.seed(mgrEmail, "pw", name = "Machine Mgr", roles = emptySet())
        val subId = TestUsers.seed(subEmail, "pw", name = "Machine Sub", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "machine-${java.util.UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        TestDaysOff.setAllowance(subId, 30)
        val manager = authedClient(mgrEmail, "pw")
        val sub = authedClient(subEmail, "pw")

        // Accept stamps the resolver.
        val mon = monday(2050, 3)
        val accepted = sub.createDaysOff(mon.toString(), mon.plusDays(1).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/days-off/${accepted.id}/accept").status)
        val afterAccept = sub.get("/api/v1/days-off/${accepted.id}").body<DaysOffResponse>()
        assertEquals(DaysOffStatus.ACCEPTED, afterAccept.status)
        assertEquals(mgrId, afterAccept.resolvedById)
        assertEquals("Machine Mgr", afterAccept.resolvedByName)
        assertNotNull(afterAccept.resolvedAt)
        // Double-resolution and rejecting an accepted request are 409.
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/days-off/${accepted.id}/accept").status)
        assertEquals(HttpStatusCode.Conflict, manager.post("/api/v1/days-off/${accepted.id}/reject").status)

        // Reject is terminal: cancel afterwards is 409.
        val rejected = sub.createDaysOff(mon.plusDays(7).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/days-off/${rejected.id}/reject").status)
        assertEquals(DaysOffStatus.REJECTED, sub.get("/api/v1/days-off/${rejected.id}").body<DaysOffResponse>().status)
        assertEquals(HttpStatusCode.Conflict, sub.cancelDaysOff(rejected.id).status)

        // An ACCEPTED request cancels; the stamps + the mandatory reason land, and the act
        // is audited (never the reason itself).
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            assertEquals(HttpStatusCode.NoContent, sub.cancelDaysOff(accepted.id, reason = "Plans changed").status)
            assertNotNull(
                capture.awaitEvent {
                    it.message == "days_off.cancelled" &&
                        it.hasKeyValue("fromStatus", "ACCEPTED") &&
                        it.keyValuePairs?.any { kv -> kv.key == "requestId" && kv.value == accepted.id.toLong() } == true &&
                        it.keyValuePairs?.none { kv -> kv.value == "Plans changed" } == true
                },
            )
        } finally {
            capture.detach()
        }
        val cancelled = sub.get("/api/v1/days-off/${accepted.id}").body<DaysOffResponse>()
        assertEquals(DaysOffStatus.CANCELLED, cancelled.status)
        assertNotNull(cancelled.cancelledAt)
        assertEquals(subId, cancelled.cancelledById)
        assertEquals("Machine Sub", cancelled.cancelledByName)
        assertEquals("Plans changed", cancelled.cancelReason)

        // A started/past ACCEPTED request is cancellable too (v2.31.0 — the date gate is gone).
        val past = monday(2001, 3)
        val started = sub.createDaysOff(past.toString(), past.plusDays(4).toString(), type = DaysOffType.UNPAID)
            .body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, manager.post("/api/v1/days-off/${started.id}/accept").status)
        assertEquals(HttpStatusCode.NoContent, sub.cancelDaysOff(started.id).status)

        // The reason is obligatory: blank, oversized, or missing-body cancels are 400.
        val forValidation = sub.createDaysOff(mon.plusDays(14).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.BadRequest, sub.cancelDaysOff(forValidation.id, reason = "  ").status)
        assertEquals(HttpStatusCode.BadRequest, sub.cancelDaysOff(forValidation.id, reason = "x".repeat(1001)).status)
        assertEquals(HttpStatusCode.NoContent, sub.cancelDaysOff(forValidation.id).status)

        // Unknown ids are 404 everywhere.
        assertEquals(HttpStatusCode.NotFound, sub.get("/api/v1/days-off/999999").status)
        assertEquals(HttpStatusCode.NotFound, manager.post("/api/v1/days-off/999999/accept").status)
    }

    @Test
    fun `the authz matrix gates reads, resolution, and cancellation`() = testApplication {
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

        // Reads on a REQUESTED request: owner, direct manager, grand-manager (chain), teammate.
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

        // Resolution: any manager in the owner's chain (v2.33.0) — not the owner, teammate,
        // unrelated, or ADMIN.
        assertEquals(HttpStatusCode.Forbidden, s.post("$url/accept").status)
        assertEquals(HttpStatusCode.Forbidden, t.post("$url/accept").status)
        assertEquals(HttpStatusCode.Forbidden, u.post("$url/reject").status)
        assertEquals(HttpStatusCode.Forbidden, a.post("$url/accept").status)
        // Cancellation (v2.31.0): the owner or ANY manager in the owner's chain — never a
        // teammate, unrelated user, non-chain ADMIN, or HR. 403 wins over 400: the outsider
        // probes carry no body and still get the uniform denial.
        assertEquals(HttpStatusCode.Forbidden, t.post("$url/cancel").status)
        assertEquals(HttpStatusCode.Forbidden, u.post("$url/cancel").status)
        assertEquals(HttpStatusCode.Forbidden, a.post("$url/cancel").status)
        assertEquals(HttpStatusCode.Forbidden, h.post("$url/cancel").status)

        // The managers may cancel (v2.31.0): the grand-manager (chain) and the direct
        // manager each cancel one of the owner's requests; the actor is recorded.
        val forChain = s.createDaysOff(mon.plusDays(7).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, g.cancelDaysOff(forChain.id, reason = "Coverage gap").status)
        val chainCancelled = s.get("/api/v1/days-off/${forChain.id}").body<DaysOffResponse>()
        assertEquals(gId, chainCancelled.cancelledById)
        assertEquals("Coverage gap", chainCancelled.cancelReason)
        val forDirect = s.createDaysOff(mon.plusDays(14).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, m.cancelDaysOff(forDirect.id).status)

        // The chain rule (v2.33.0): the grand-manager resolves too — stamped as the resolver.
        val forChainAccept = s.createDaysOff(mon.plusDays(21).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, g.post("/api/v1/days-off/${forChainAccept.id}/accept").status)
        val chainAccepted = s.get("/api/v1/days-off/${forChainAccept.id}").body<DaysOffResponse>()
        assertEquals("ACCEPTED", chainAccepted.status.name)
        assertEquals(gId, chainAccepted.resolvedById)

        // A REJECTED request drops off the teammate's radar (calendar parity) but stays
        // readable to the owner, the chain, and HR.
        assertEquals(HttpStatusCode.NoContent, m.post("$url/reject").status)
        assertEquals(HttpStatusCode.Forbidden, t.get(url).status)
        assertEquals(HttpStatusCode.OK, s.get(url).status)
        assertEquals(HttpStatusCode.OK, g.get(url).status)
        assertEquals(HttpStatusCode.OK, h.get(url).status)

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
        // userName substring + userId pin + type/status/date-window filters.
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
        // T: a REJECTED request in the same window must never appear.
        val rejected = t.createDaysOff("2058-04-07", "2058-04-08").body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, m.post("/api/v1/days-off/${rejected.id}/reject").status)
        TestDaysOff.holidays.create(PublicHolidayCreateRequest("2058-04-01", "April Fools 2058"))

        val march = t.get("/api/v1/days-off/calendar?month=2058-03").body<DaysOffCalendarResponse>()
        assertEquals("2058-03", march.month)
        // Scope member: every teammate appears, entries or not, sorted by name (Mate < Sub).
        assertEquals(listOf(tId, sId), march.users.map { it.userId }.filter { it in setOf(sId, tId) })
        val sMarch = march.users.first { it.userId == sId }
        // Clipped to the month: 28..31 (weekends included — the bar renders continuously).
        assertEquals(listOf("2058-03-28", "2058-03-29", "2058-03-30", "2058-03-31"), sMarch.entries.map { it.date })
        assertTrue(sMarch.entries.first().half) // the half start day
        assertTrue(sMarch.entries.drop(1).none { it.half })
        assertEquals(request.id, sMarch.entries.first().requestId)

        val april = t.get("/api/v1/days-off/calendar?month=2058-04").body<DaysOffCalendarResponse>()
        val sApril = april.users.first { it.userId == sId }
        assertEquals(listOf("2058-04-01", "2058-04-02", "2058-04-03"), sApril.entries.map { it.date })
        assertEquals(listOf("April Fools 2058"), april.holidays.map { it.name })
        // The rejected request is invisible; T still has a row.
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
    fun `budgets report allowance, carry-over, reserved, and used per user`() = testApplication {
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
        val toAccept = s.createDaysOff(mon.toString(), mon.plusDays(1).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, m.post("/api/v1/days-off/${toAccept.id}/accept").status)
        s.createDaysOff(mon.plusDays(7).toString(), startHalf = true) // 0.5 reserved

        val own = s.get("/api/v1/days-off/budgets?year=2059").body<DaysOffBudgetList>()
        val mine = own.items.single()
        assertEquals(sId, mine.userId)
        assertEquals(2059, mine.year)
        assertEquals(10, mine.allowance)
        assertEquals(0.0, mine.carriedOver)
        assertEquals(0.5, mine.reserved)
        assertEquals(2.0, mine.used)
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
    fun `the notification fan-out follows the lifecycle`() = testApplication {
        usePostgresTestcontainer()
        // S is a member of two teams: M1's and M2's.
        val m1Email = uniqueEmail("do-not-m1")
        val m2Email = uniqueEmail("do-not-m2")
        val sEmail = uniqueEmail("do-not-s")
        val m1Id = TestUsers.seed(m1Email, "pw", name = "Notif Mgr One", roles = emptySet())
        val m2Id = TestUsers.seed(m2Email, "pw", name = "Notif Mgr Two", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "Notif Sub", roles = emptySet())
        val team1 = TestServices.teams.create(Team(name = "not1-${java.util.UUID.randomUUID()}", managerId = m1Id))
        TestServices.teams.addMember(team1, sId)
        val team2 = TestServices.teams.create(Team(name = "not2-${java.util.UUID.randomUUID()}", managerId = m2Id))
        TestServices.teams.addMember(team2, sId)
        TestDaysOff.setAllowance(sId, 30)
        val m1 = authedClient(m1Email, "pw")
        val m2 = authedClient(m2Email, "pw")
        val s = authedClient(sEmail, "pw")

        suspend fun HttpClient.notificationsOf(type: NotificationType) =
            get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
                .items.filter { it.type == type }

        val mon = monday(2060, 3)
        val created = s.createDaysOff(mon.toString(), mon.plusDays(1).toString(), startHalf = true).body<DaysOffResponse>()

        // Creation: every direct manager, with the request facts.
        for (managerClient in listOf(m1, m2)) {
            val note = managerClient.notificationsOf(NotificationType.DAYS_OFF_REQUESTED_TO_MANAGER)
                .single { it.params["startDate"] == mon.toString() }
            assertEquals("Notif Sub", note.params["requester"])
            assertEquals("PAID", note.params["type"])
            assertEquals("1.5", note.params["days"])
            assertEquals("/days-off?tab=team", note.link)
        }

        // Acceptance: the owner hears from the resolving manager.
        assertEquals(HttpStatusCode.NoContent, m1.post("/api/v1/days-off/${created.id}/accept").status)
        val acceptedNote = s.notificationsOf(NotificationType.DAYS_OFF_ACCEPTED_TO_OWNER).single()
        assertEquals("Notif Mgr One", acceptedNote.params["manager"])
        assertEquals("/days-off?tab=requests", acceptedNote.link)

        // An owner-cancel notifies EVERY current direct manager uniformly (v2.31.0 — the
        // resolver-only-for-ACCEPTED subtlety is gone) plus the owner's own receipt.
        assertEquals(HttpStatusCode.NoContent, s.cancelDaysOff(created.id).status)
        assertEquals(1, m1.notificationsOf(NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER).size)
        assertEquals(1, m2.notificationsOf(NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER).size)
        val ownReceipt = s.notificationsOf(NotificationType.DAYS_OFF_CANCELLED_TO_OWNER).single()
        assertEquals("OWNER", ownReceipt.params["by"])
        assertEquals("Notif Sub", ownReceipt.params["manager"]) // the actor IS the owner here
        assertEquals("/days-off?tab=requests", ownReceipt.link)

        // Same rule from REQUESTED.
        val second = s.createDaysOff(mon.plusDays(7).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, s.cancelDaysOff(second.id).status)
        assertEquals(2, m1.notificationsOf(NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER).size)
        assertEquals(2, m2.notificationsOf(NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER).size)

        // A manager-cancel (v2.31.0): the owner is told who cancelled; the acting manager
        // keeps a receipt and the OTHER manager deliberately hears nothing.
        val byManager = s.createDaysOff(mon.plusDays(21).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, m1.cancelDaysOff(byManager.id, reason = "Release week").status)
        val ownerNote = s.notificationsOf(NotificationType.DAYS_OFF_CANCELLED_TO_OWNER)
            .single { it.params["by"] == "MANAGER" }
        assertEquals("Notif Mgr One", ownerNote.params["manager"])
        val receipt = m1.notificationsOf(NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER)
            .single { it.params["by"] == "MANAGER" }
        assertEquals("Notif Sub", receipt.params["requester"])
        assertEquals(3, m1.notificationsOf(NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER).size)
        assertEquals(2, m2.notificationsOf(NotificationType.DAYS_OFF_CANCELLED_TO_MANAGER).size)

        // Rejection notifies the owner.
        val third = s.createDaysOff(mon.plusDays(14).toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, m2.post("/api/v1/days-off/${third.id}/reject").status)
        assertEquals("Notif Mgr Two", s.notificationsOf(NotificationType.DAYS_OFF_REJECTED_TO_OWNER).single().params["manager"])
    }

    @Test
    fun `a direct manager records days off on behalf of a report, born ACCEPTED`() = testApplication {
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

        // The recorded entry: born ACCEPTED with the acting manager stamped as resolver,
        // and audited as days_off.recorded.
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
        assertEquals(DaysOffStatus.ACCEPTED, created.status)
        assertEquals(2.0, created.days)
        assertEquals(mId, created.resolvedById)
        assertEquals("OnBehalf Mgr", created.resolvedByName)
        assertNotNull(created.resolvedAt)

        // Notifications: exactly the recorded pair — owner + acting manager; no REQUESTED
        // fan-out happened.
        val ownerNote = s.notificationsOf(NotificationType.DAYS_OFF_RECORDED_TO_OWNER).single()
        assertEquals("OnBehalf Mgr", ownerNote.params["manager"])
        assertEquals("PAID", ownerNote.params["type"])
        assertEquals("2", ownerNote.params["days"])
        assertEquals(mon.toString(), ownerNote.params["startDate"])
        assertEquals("/days-off?tab=requests", ownerNote.link)
        val managerNote = m.notificationsOf(NotificationType.DAYS_OFF_RECORDED_TO_MANAGER).single()
        assertEquals("OnBehalf Sub", managerNote.params["requester"])
        assertEquals("/days-off?tab=team", managerNote.link)
        assertEquals(0, m.notificationsOf(NotificationType.DAYS_OFF_REQUESTED_TO_MANAGER).size)

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

        // The chain rule (v2.33.0): the grand-manager records for the skip-level report too,
        // born ACCEPTED with G as the resolver.
        val chainRecorded = g.createDaysOff(mon.plusDays(14).toString(), forUserId = sId)
        assertEquals(HttpStatusCode.Created, chainRecorded.status)
        val chainCreated = chainRecorded.body<DaysOffResponse>()
        assertEquals(sId, chainCreated.userId)
        assertEquals(DaysOffStatus.ACCEPTED, chainCreated.status)
        assertEquals(gId, chainCreated.resolvedById)

        // A deactivated report cannot receive NEW entries (the house rule) — 400 after the guard.
        assertEquals(HttpStatusCode.NoContent, a.post("/api/v1/users/$tId/deactivate").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            m.createDaysOff(mon.plusDays(7).toString(), forUserId = tId).status,
        )
    }

    @Test
    fun `cancel reasons are encrypted at rest and the startup backfill sweeps plaintext`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("do-enc")
        val ownerId = TestUsers.seed(ownerEmail, "pw", roles = emptySet())
        TestDaysOff.setAllowance(ownerId, 20)
        val owner = authedClient(ownerEmail, "pw")

        val secret = "Secret cancellation reasoning ${java.util.UUID.randomUUID()}"
        val mon = monday(2085, 3)
        val created = owner.createDaysOff(mon.toString()).body<DaysOffResponse>()
        assertEquals(HttpStatusCode.NoContent, owner.cancelDaysOff(created.id, reason = secret).status)
        assertEquals(secret, owner.get("/api/v1/days-off/${created.id}").body<DaysOffResponse>().cancelReason)

        // The raw column holds the envelope, not the plaintext (the correction-comment rule).
        suspend fun raw(): String = suspendTransaction(TestDaysOff.service.database) {
            ch.nokillswit.daysoff.DaysOffService.Requests
                .selectAll()
                .where { ch.nokillswit.daysoff.DaysOffService.Requests.id eq created.id }
                .map { it[ch.nokillswit.daysoff.DaysOffService.Requests.cancelReason] }
                .toList()
                .single()!!
        }
        val encrypted = raw()
        assertTrue(encrypted.startsWith(FieldCipher.PREFIX), "expected an envelope, got: ${encrypted.take(20)}")
        assertTrue(!encrypted.contains(secret))

        // The legacy backfill (the two-table encryptLegacyRows): a plaintext reason planted
        // raw in the column is enveloped once, idempotently — the envelope-marker predicate
        // keeps already-encrypted rows (and other tests' key-rotation residue) untouched.
        val planted = "planted plaintext reason"
        suspendTransaction(TestDaysOff.service.database) {
            ch.nokillswit.daysoff.DaysOffService.Requests
                .update({ ch.nokillswit.daysoff.DaysOffService.Requests.id eq created.id }) {
                    it[ch.nokillswit.daysoff.DaysOffService.Requests.cancelReason] = planted
                }
        }
        assertTrue(TestDaysOff.service.encryptLegacyRows(reencryptAll = false) >= 1)
        val swept = raw()
        assertTrue(swept.startsWith(FieldCipher.PREFIX))
        assertEquals(planted, owner.get("/api/v1/days-off/${created.id}").body<DaysOffResponse>().cancelReason)
    }
}
