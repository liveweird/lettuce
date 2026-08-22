package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffAllowanceWrite
import ch.nokillswit.daysoff.DaysOffBudgetList
import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffPageResponse
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
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
import kotlin.test.assertTrue

/**
 * PUT /days-off/allowance (v2.32.0 — the allowance moved off the ADMIN users PUT to the
 * target's transitive management chain) plus the includeIndirect widening of the budgets and
 * requests-list managed views with their `canCorrect`/`canResolve` capability flags.
 */
class DaysOffAllowanceTest {

    private fun monday(year: Int, month: Int = 6): LocalDate =
        LocalDate.of(year, month, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))

    private suspend fun HttpClient.putAllowance(userId: UInt, allowance: Int): HttpResponse =
        put("/api/v1/days-off/allowance") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffAllowanceWrite(userId = userId, allowance = allowance))
        }

    @Test
    fun `the allowance is chain-writable, ranged, idempotent, audited, and notifies the owner`() = testApplication {
        usePostgresTestcontainer()
        // G manages Y {M}; M manages X {S, T}. U unrelated, A admin, H HR.
        val gEmail = uniqueEmail("do-al-g")
        val mEmail = uniqueEmail("do-al-m")
        val sEmail = uniqueEmail("do-al-s")
        val tEmail = uniqueEmail("do-al-t")
        val uEmail = uniqueEmail("do-al-u")
        val aEmail = uniqueEmail("do-al-a")
        val hEmail = uniqueEmail("do-al-h")
        val gId = TestUsers.seed(gEmail, "pw", name = "Allowance Grand", roles = emptySet())
        val mId = TestUsers.seed(mEmail, "pw", name = "Allowance Mgr", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "Allowance Sub", roles = emptySet())
        val tId = TestUsers.seed(tEmail, "pw", roles = emptySet())
        TestUsers.seed(uEmail, "pw", roles = emptySet())
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        TestUsers.seed(hEmail, "pw", roles = setOf(UserRole.HR))
        val teamY = TestServices.teams.create(Team(name = "alY-${java.util.UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamY, mId)
        val teamX = TestServices.teams.create(Team(name = "alX-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamX, sId)
        TestServices.teams.addMember(teamX, tId)

        val g = authedClient(gEmail, "pw")
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val t = authedClient(tEmail, "pw")
        val u = authedClient(uEmail, "pw")
        val a = authedClient(aEmail, "pw")
        val h = authedClient(hEmail, "pw")

        val appender = LogCapture("ch.nokillswit.audit")
        try {
            // Nobody outside the chain — the owner, a teammate, an unrelated user, ADMIN, and
            // HR all get the uniform 403, as does an unknown target and a self-target (the
            // guard runs before any read).
            for (denied in listOf(s, t, u, a, h)) {
                assertEquals(HttpStatusCode.Forbidden, denied.putAllowance(sId, 20).status)
            }
            assertEquals(HttpStatusCode.Forbidden, m.putAllowance(999_999_999u, 20).status)
            assertEquals(HttpStatusCode.Forbidden, m.putAllowance(mId, 20).status)
            // Guard before validation: an outsider's out-of-range value is still 403.
            assertEquals(HttpStatusCode.Forbidden, u.putAllowance(sId, -1).status)
            // Range rule for a legitimate writer.
            assertEquals(HttpStatusCode.BadRequest, m.putAllowance(sId, -1).status)
            assertEquals(HttpStatusCode.BadRequest, m.putAllowance(sId, 366).status)
            assertTrue(appender.events.none { it.message == "days_off.allowance_changed" })

            // First assignment by the DIRECT manager: budgets reflect it, the audit event
            // carries To only, and the owner is notified (From absent).
            assertEquals(HttpStatusCode.NoContent, m.putAllowance(sId, 20).status)
            val own = s.get("/api/v1/days-off/budgets").body<DaysOffBudgetList>().items.single()
            assertEquals(20, own.allowance)
            val assigned = appender.events.single { it.message == "days_off.allowance_changed" }
            assertEquals(mId.toLong(), assigned.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals(sId.toLong(), assigned.keyValuePairs.first { it.key == "targetUserId" }.value)
            assertEquals(20L, assigned.keyValuePairs.first { it.key == "allowanceTo" }.value)
            assertTrue(assigned.keyValuePairs.none { it.key == "allowanceFrom" })
            val firstNote = s.get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
                .items.single { it.type == NotificationType.DAYS_OFF_ALLOWANCE_CHANGED }
            assertEquals("Allowance Mgr", firstNote.params["manager"])
            assertEquals("20", firstNote.params["to"])
            assertEquals(null, firstNote.params["from"])
            assertEquals("/days-off?tab=requests", firstNote.link)

            // An idempotent re-PUT: 204, no new audit event, no new notification.
            assertEquals(HttpStatusCode.NoContent, m.putAllowance(sId, 20).status)
            assertEquals(1, appender.events.count { it.message == "days_off.allowance_changed" })

            // The GRAND-manager (transitive chain) changes it: From and To both present.
            assertEquals(HttpStatusCode.NoContent, g.putAllowance(sId, 25).status)
            val changed = appender.events.last { it.message == "days_off.allowance_changed" }
            assertEquals(20L, changed.keyValuePairs.first { it.key == "allowanceFrom" }.value)
            assertEquals(25L, changed.keyValuePairs.first { it.key == "allowanceTo" }.value)
            val notes = s.get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
                .items.filter { it.type == NotificationType.DAYS_OFF_ALLOWANCE_CHANGED }
            assertEquals(2, notes.size)
            val changeNote = notes.single { it.params["from"] != null }
            assertEquals("Allowance Grand", changeNote.params["manager"])
            assertEquals("20", changeNote.params["from"])
            assertEquals("25", changeNote.params["to"])
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `includeIndirect widens the managed budgets and list to the subtree with honest flags`() = testApplication {
        usePostgresTestcontainer()
        // G manages Y {M}; M manages X {S}.
        val gEmail = uniqueEmail("do-ii-g")
        val mEmail = uniqueEmail("do-ii-m")
        val sEmail = uniqueEmail("do-ii-s")
        val gId = TestUsers.seed(gEmail, "pw", roles = emptySet())
        val mId = TestUsers.seed(mEmail, "pw", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", roles = emptySet())
        val teamY = TestServices.teams.create(Team(name = "iiY-${java.util.UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamY, mId)
        val teamX = TestServices.teams.create(Team(name = "iiX-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamX, sId)
        TestDaysOff.setAllowance(sId, 30)
        val g = authedClient(gEmail, "pw")
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")

        val mon = monday(2061, 3)
        val request = s.post("/api/v1/days-off") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCreateRequest(DaysOffType.PAID, mon.toString(), mon.plusDays(1).toString()))
        }
        assertEquals(HttpStatusCode.Created, request.status)

        // Budgets: G's direct view holds only M; includeIndirect adds S. canCorrect is
        // chain-wide since v2.33.0, so every managed-view row carries it — S's included.
        val direct = g.get("/api/v1/days-off/budgets?view=managed&year=2061").body<DaysOffBudgetList>()
        assertEquals(listOf(mId), direct.items.map { it.userId })
        assertTrue(direct.items.single().canCorrect)
        val widened = g.get("/api/v1/days-off/budgets?view=managed&year=2061&includeIndirect=true")
            .body<DaysOffBudgetList>()
        assertEquals(setOf(mId, sId), widened.items.map { it.userId }.toSet())
        assertTrue(widened.items.single { it.userId == mId }.canCorrect)
        assertTrue(widened.items.single { it.userId == sId }.canCorrect)
        assertEquals(30, widened.items.single { it.userId == sId }.allowance)
        // Own rows never carry the pen.
        assertFalse(s.get("/api/v1/days-off/budgets?year=2061").body<DaysOffBudgetList>().items.single().canCorrect)

        // Requests list: G's direct managed view is empty of S's rows; includeIndirect
        // surfaces them with BOTH capability flags set — resolve is chain-wide since
        // v2.33.0, like cancel. M sees the same row with the same flags.
        val gDirect = g.get("/api/v1/days-off?view=managed&userId=$sId").body<DaysOffPageResponse>()
        assertEquals(0, gDirect.total)
        val gWide = g.get("/api/v1/days-off?view=managed&userId=$sId&includeIndirect=true")
            .body<DaysOffPageResponse>()
        val chainRow = gWide.items.single()
        assertTrue(chainRow.canResolve)
        assertTrue(chainRow.canCancel)
        val directRow = m.get("/api/v1/days-off?view=managed&userId=$sId").body<DaysOffPageResponse>().items.single()
        assertTrue(directRow.canResolve)
        assertTrue(directRow.canCancel)
        // The owner's own REQUESTED row: cancellable, never resolvable.
        val ownRow = s.get("/api/v1/days-off").body<DaysOffPageResponse>().items.single()
        assertTrue(ownRow.canCancel)
        assertFalse(ownRow.canResolve)

        // The strict-boolean shape rule on both endpoints.
        assertEquals(HttpStatusCode.BadRequest, g.get("/api/v1/days-off/budgets?includeIndirect=true").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            g.get("/api/v1/days-off/budgets?view=managed&includeIndirect=maybe").status,
        )
        assertEquals(HttpStatusCode.BadRequest, s.get("/api/v1/days-off?includeIndirect=true").status)
        assertEquals(
            HttpStatusCode.BadRequest,
            g.get("/api/v1/days-off?view=managed&includeIndirect=maybe").status,
        )
    }
}
