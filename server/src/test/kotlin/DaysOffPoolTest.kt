package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffAllowanceWrite
import ch.nokillswit.daysoff.DaysOffBudgetList
import ch.nokillswit.daysoff.DaysOffCorrectionOperation
import ch.nokillswit.daysoff.DaysOffCorrectionResponse
import ch.nokillswit.daysoff.DaysOffCorrectionWrite
import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffPageResponse
import ch.nokillswit.daysoff.DaysOffPoolType
import ch.nokillswit.daysoff.DaysOffPoolTypeList
import ch.nokillswit.daysoff.DaysOffPoolTypeWrite
import ch.nokillswit.daysoff.DaysOffResponse
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamMemberPageResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.sql.DriverManager
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import java.util.UUID
import org.flywaydb.core.Flyway
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Multiple paid days-off pools (v3.2.0, V74): the ADMIN pool-kinds registry, the per-user
 * grants behind PUT /days-off/allowance + DELETE /days-off/pools/{id}, the per-pool budgets
 * rows and math (carry-over vs. reset), the pool-scoped create sweep with its 400 matrix,
 * per-pool corrections, the default-pool card stat, and the V74 backfill.
 */
class DaysOffPoolTest {

    private fun monday(year: Int, month: Int = 6): LocalDate =
        LocalDate.of(year, month, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))

    private suspend fun HttpClient.putAllowance(userId: UInt, allowance: Int, poolTypeId: UInt? = null): HttpResponse =
        put("/api/v1/days-off/allowance") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffAllowanceWrite(userId = userId, allowance = allowance, poolTypeId = poolTypeId))
        }

    private suspend fun HttpClient.createPoolType(name: String, carriesOver: Boolean): HttpResponse =
        post("/api/v1/days-off/pool-types") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffPoolTypeWrite(name = name, carriesOver = carriesOver))
        }

    private suspend fun HttpClient.createDaysOff(
        start: LocalDate,
        end: LocalDate = start,
        type: DaysOffType = DaysOffType.PAID,
        poolTypeId: UInt? = null,
        forUserId: UInt? = null,
    ): HttpResponse = post("/api/v1/days-off") {
        contentType(ContentType.Application.Json)
        setBody(DaysOffCreateRequest(type, start.toString(), end.toString(), userId = forUserId, poolTypeId = poolTypeId))
    }

    private suspend fun HttpClient.budgets(query: String = ""): List<ch.nokillswit.daysoff.DaysOffBudget> =
        get("/api/v1/days-off/budgets$query").body<DaysOffBudgetList>().items

    private suspend fun HttpClient.poolTypes(): List<DaysOffPoolType> =
        get("/api/v1/days-off/pool-types").body<DaysOffPoolTypeList>().items

    /** A fresh extra kind (unique name — the registry is shared by the suite). */
    private suspend fun HttpClient.freshKind(prefix: String, carriesOver: Boolean): DaysOffPoolType {
        val created = createPoolType("$prefix ${UUID.randomUUID().toString().take(8)}", carriesOver)
        assertEquals(HttpStatusCode.Created, created.status)
        return created.body<DaysOffPoolType>()
    }

    @Test
    fun `the pool kinds registry is admin-written, everyone-read, name-unique, and protects the default`() = testApplication {
        usePostgresTestcontainer()
        val aEmail = uniqueEmail("pool-reg-a")
        val uEmail = uniqueEmail("pool-reg-u")
        val hEmail = uniqueEmail("pool-reg-h")
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        TestUsers.seed(uEmail, "pw", roles = emptySet())
        TestUsers.seed(hEmail, "pw", roles = setOf(UserRole.HR))
        val a = authedClient(aEmail, "pw")
        val u = authedClient(uEmail, "pw")
        val h = authedClient(hEmail, "pw")
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            // The seeded default kind leads the registry, for every reader.
            val seeded = u.poolTypes()
            val default = seeded.first()
            assertTrue(default.isDefault)
            assertTrue(default.carriesOver)
            assertEquals(TestDaysOff.DEFAULT_POOL_TYPE_ID, default.id)
            assertEquals(1, seeded.count { it.isDefault })
            assertEquals(seeded, h.poolTypes())

            // Writes are ADMIN-only.
            assertEquals(HttpStatusCode.Forbidden, u.createPoolType("Nope", false).status)
            assertEquals(HttpStatusCode.Forbidden, h.createPoolType("Nope", false).status)
            // Shape: blank / oversized / control characters.
            assertEquals(HttpStatusCode.BadRequest, a.createPoolType("   ", false).status)
            assertEquals(HttpStatusCode.BadRequest, a.createPoolType("x".repeat(101), false).status)
            assertEquals(HttpStatusCode.BadRequest, a.createPoolType("badname", false).status)

            val name = "Sabbatical ${UUID.randomUUID().toString().take(8)}"
            val created = a.createPoolType("  $name  ", false)
            assertEquals(HttpStatusCode.Created, created.status)
            val kind = created.body<DaysOffPoolType>()
            assertEquals(name, kind.name) // trimmed
            assertFalse(kind.carriesOver)
            assertFalse(kind.isDefault)
            assertTrue(created.headers["Location"]!!.endsWith("/api/v1/days-off/pool-types/${kind.id}"))
            val createdEvent = appender.events.single { it.message == "days_off_pool_type.created" }
            assertEquals(name, createdEvent.keyValuePairs.first { it.key == "name" }.value)
            // A duplicate active name is 409 (the partial unique index).
            assertEquals(HttpStatusCode.Conflict, a.createPoolType(name, true).status)
            // Listed after the default, by name; the `carriesOver` flag rides along.
            val listed = u.poolTypes()
            assertTrue(listed.first().isDefault)
            assertEquals(kind, listed.single { it.id == kind.id })

            // Rename + re-flag (the default included); the audit carries the deltas only.
            val renamed = "$name renamed"
            assertEquals(
                HttpStatusCode.NoContent,
                a.put("/api/v1/days-off/pool-types/${kind.id}") {
                    contentType(ContentType.Application.Json)
                    setBody(DaysOffPoolTypeWrite(name = renamed, carriesOver = true))
                }.status,
            )
            val updated = appender.events.single { it.message == "days_off_pool_type.updated" }
            assertEquals(name, updated.keyValuePairs.first { it.key == "nameFrom" }.value)
            assertEquals(renamed, updated.keyValuePairs.first { it.key == "nameTo" }.value)
            assertEquals(true, updated.keyValuePairs.first { it.key == "carriesOverTo" }.value)
            assertTrue(u.poolTypes().single { it.id == kind.id }.carriesOver)
            assertEquals(
                HttpStatusCode.Forbidden,
                u.put("/api/v1/days-off/pool-types/${kind.id}") {
                    contentType(ContentType.Application.Json)
                    setBody(DaysOffPoolTypeWrite(name = "x", carriesOver = false))
                }.status,
            )
            // The default kind is renameable but never archivable; an unknown id is 404.
            assertEquals(HttpStatusCode.Conflict, a.delete("/api/v1/days-off/pool-types/${default.id}").status)
            assertEquals(HttpStatusCode.NotFound, a.delete("/api/v1/days-off/pool-types/999999999").status)
            assertEquals(HttpStatusCode.Forbidden, u.delete("/api/v1/days-off/pool-types/${kind.id}").status)
            // Archive: gone from the registry, the name is free again, a repeat is 404.
            assertEquals(HttpStatusCode.NoContent, a.delete("/api/v1/days-off/pool-types/${kind.id}").status)
            assertTrue(u.poolTypes().none { it.id == kind.id })
            assertEquals(HttpStatusCode.NotFound, a.delete("/api/v1/days-off/pool-types/${kind.id}").status)
            assertEquals(HttpStatusCode.Created, a.createPoolType(renamed, false).status)
            val archived = appender.events.single { it.message == "days_off_pool_type.archived" }
            assertEquals(0L, archived.keyValuePairs.first { it.key == "grantsArchived" }.value)
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `grants are upserted per pool, archived per pool, and budgets report one row per pool`() = testApplication {
        usePostgresTestcontainer()
        val aEmail = uniqueEmail("pool-gr-a")
        val mEmail = uniqueEmail("pool-gr-m")
        val sEmail = uniqueEmail("pool-gr-s")
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        val mId = TestUsers.seed(mEmail, "pw", name = "Pool Mgr", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "Pool Sub", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "pool-gr-${UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamId, sId)
        val a = authedClient(aEmail, "pw")
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val extra = a.freshKind("Maternal", carriesOver = false)
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            // An ungranted user: exactly the default row, allowance null, no grant id.
            val bare = s.budgets("?year=2080").single()
            assertTrue(bare.isDefault)
            assertNull(bare.allowance)
            assertNull(bare.poolId)
            assertFalse(bare.poolArchived)
            assertEquals(TestDaysOff.DEFAULT_POOL_TYPE_ID, bare.poolTypeId)

            // Unknown / archived kinds are 400 after the guard; an outsider stays 403.
            assertEquals(HttpStatusCode.BadRequest, m.putAllowance(sId, 3, poolTypeId = 999_999_999u).status)
            assertEquals(HttpStatusCode.Forbidden, s.putAllowance(sId, 3, poolTypeId = extra.id).status)

            // Grant the default (omitted kind) and the extra kind.
            assertEquals(HttpStatusCode.NoContent, m.putAllowance(sId, 26).status)
            assertEquals(HttpStatusCode.NoContent, m.putAllowance(sId, 3, poolTypeId = extra.id).status)
            val rows = s.budgets("?year=2080")
            assertEquals(listOf(true, false), rows.map { it.isDefault })
            val default = rows[0]
            val maternal = rows[1]
            assertEquals(26, default.allowance)
            assertEquals(3, maternal.allowance)
            assertEquals(extra.id, maternal.poolTypeId)
            assertEquals(extra.name, maternal.poolName)
            assertFalse(maternal.carriesOver)
            assertTrue(maternal.poolId != null)
            assertEquals(3.0, maternal.remaining)
            // The grant's audit + notification name the pool; the extra grant carries no From.
            val grants = appender.events.filter { it.message == "days_off.allowance_changed" }
            assertEquals(2, grants.size)
            assertEquals(extra.id.toLong(), grants[1].keyValuePairs.first { it.key == "poolTypeId" }.value)
            assertTrue(grants[1].keyValuePairs.none { it.key == "allowanceFrom" })
            val notes = s.get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
                .items.filter { it.type == NotificationType.DAYS_OFF_ALLOWANCE_CHANGED }
            assertEquals(setOf(rows[0].poolName, extra.name), notes.map { it.params["pool"] }.toSet())
            // Idempotent re-PUT per pool; a change on the extra pool carries From.
            assertEquals(HttpStatusCode.NoContent, m.putAllowance(sId, 3, poolTypeId = extra.id).status)
            assertEquals(2, appender.events.count { it.message == "days_off.allowance_changed" })
            assertEquals(HttpStatusCode.NoContent, m.putAllowance(sId, 4, poolTypeId = extra.id).status)
            val changed = appender.events.last { it.message == "days_off.allowance_changed" }
            assertEquals(3L, changed.keyValuePairs.first { it.key == "allowanceFrom" }.value)
            assertEquals(4, s.budgets("?year=2080")[1].allowance)

            // A request + a correction in the extra pool, then archive it: the row survives as
            // history (poolArchived) in that year, vanishes in an empty year, and the default
            // pool is untouched.
            val mon = monday(2080)
            val created = s.createDaysOff(mon, poolTypeId = extra.id)
            assertEquals(HttpStatusCode.Created, created.status)
            assertEquals(extra.name, created.body<DaysOffResponse>().poolName)
            val poolId = maternal.poolId!!
            // The owner, and an unknown id, can't archive; the default pool never can.
            assertEquals(HttpStatusCode.Forbidden, s.delete("/api/v1/days-off/pools/$poolId").status)
            assertEquals(HttpStatusCode.NotFound, m.delete("/api/v1/days-off/pools/999999999").status)
            assertEquals(HttpStatusCode.Conflict, m.delete("/api/v1/days-off/pools/${default.poolId}").status)
            assertEquals(HttpStatusCode.NoContent, m.delete("/api/v1/days-off/pools/$poolId").status)
            assertEquals(HttpStatusCode.NotFound, m.delete("/api/v1/days-off/pools/$poolId").status)
            val archivedEvent = appender.events.single { it.message == "days_off_pool.archived" }
            assertEquals(poolId.toLong(), archivedEvent.keyValuePairs.first { it.key == "poolId" }.value)
            val afterArchive = s.budgets("?year=2080")
            assertEquals(2, afterArchive.size)
            val history = afterArchive[1]
            assertTrue(history.poolArchived)
            assertNull(history.poolId)
            assertNull(history.allowance)
            assertEquals(1.0, history.reserved)
            assertEquals(-1.0, history.remaining)
            assertEquals(1, s.budgets("?year=2081").size)
            assertEquals(26, s.budgets("?year=2081").single().allowance)
            // No new requests in an archived pool; the history row still lists the request.
            assertEquals(HttpStatusCode.BadRequest, s.createDaysOff(mon.plusWeeks(1), poolTypeId = extra.id).status)
            val listed = s.get("/api/v1/days-off?poolTypeId=${extra.id}").body<DaysOffPageResponse>()
            assertEquals(1, listed.total)
            assertEquals(extra.name, listed.items.single().poolName)
            assertEquals(0, s.get("/api/v1/days-off?type=UNPAID").body<DaysOffPageResponse>().total)

            // Re-granting inserts a fresh grant whose history continues (the request still counts).
            assertEquals(HttpStatusCode.NoContent, m.putAllowance(sId, 5, poolTypeId = extra.id).status)
            val regranted = s.budgets("?year=2080")[1]
            assertFalse(regranted.poolArchived)
            assertTrue(regranted.poolId != null && regranted.poolId != poolId)
            assertEquals(5, regranted.allowance)
            assertEquals(1.0, regranted.reserved)
            assertEquals(4.0, regranted.remaining)

            // Archiving the KIND cascades to the grant; the request keeps its label.
            assertEquals(HttpStatusCode.NoContent, a.delete("/api/v1/days-off/pool-types/${extra.id}").status)
            assertEquals(
                1L,
                appender.events.single { it.message == "days_off_pool_type.archived" }
                    .keyValuePairs.first { it.key == "grantsArchived" }.value,
            )
            assertTrue(s.budgets("?year=2080")[1].poolArchived)
            assertEquals(extra.name, s.get("/api/v1/days-off/${created.body<DaysOffResponse>().id}").body<DaysOffResponse>().poolName)
            // A retired kind can't be granted or requested against.
            assertEquals(HttpStatusCode.BadRequest, m.putAllowance(sId, 1, poolTypeId = extra.id).status)
            assertEquals(HttpStatusCode.BadRequest, s.createDaysOff(mon.plusWeeks(2), poolTypeId = extra.id).status)
        } finally {
            appender.detach()
        }
    }

    @Test
    fun `the create sweep is pool-scoped and a non-carry-over pool resets every year`() = testApplication {
        usePostgresTestcontainer()
        val aEmail = uniqueEmail("pool-sw-a")
        val mEmail = uniqueEmail("pool-sw-m")
        val sEmail = uniqueEmail("pool-sw-s")
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        val mId = TestUsers.seed(mEmail, "pw", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "pool-sw-${UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamId, sId)
        val a = authedClient(aEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val reset = a.freshKind("Reset", carriesOver = false)
        val carry = a.freshKind("Carry", carriesOver = true)
        TestDaysOff.setAllowance(sId, 1)
        TestDaysOff.setAllowance(sId, 2, poolTypeId = reset.id)
        TestDaysOff.setAllowance(sId, 2, poolTypeId = carry.id)

        // The shape rules: UNPAID never names a pool; an unknown kind and an ungranted extra
        // kind are 400; the default kind needs no grant (its budget simply gates).
        val mon = monday(2084)
        assertEquals(HttpStatusCode.BadRequest, s.createDaysOff(mon, type = DaysOffType.UNPAID, poolTypeId = reset.id).status)
        assertEquals(HttpStatusCode.BadRequest, s.createDaysOff(mon, poolTypeId = 999_999_999u).status)
        val ungranted = a.freshKind("Ungranted", carriesOver = true)
        assertEquals(HttpStatusCode.BadRequest, s.createDaysOff(mon, poolTypeId = ungranted.id).status)

        // Each pool gates independently: 1 day default, 2 days in each extra pool.
        assertEquals(HttpStatusCode.Created, s.createDaysOff(mon).status) // default: 1/1
        assertEquals(HttpStatusCode.Conflict, s.createDaysOff(mon.plusWeeks(1)).status) // default exhausted
        val resetStart = mon.plusWeeks(1)
        assertEquals(
            HttpStatusCode.Created,
            s.createDaysOff(resetStart, end = resetStart.plusDays(1), poolTypeId = reset.id).status,
        )
        assertEquals(HttpStatusCode.Conflict, s.createDaysOff(mon.plusWeeks(2), poolTypeId = reset.id).status)
        assertEquals(HttpStatusCode.Created, s.createDaysOff(mon.plusWeeks(2), poolTypeId = carry.id).status) // carry: 1/2
        // UNPAID stays unlimited.
        assertEquals(HttpStatusCode.Created, s.createDaysOff(mon.plusWeeks(3), type = DaysOffType.UNPAID).status)

        val rows2084 = s.budgets("?year=2084")
        assertEquals(1.0, rows2084[0].used + rows2084[0].reserved)
        assertEquals(2.0, rows2084.single { it.poolTypeId == reset.id }.reserved)
        assertEquals(1.0, rows2084.single { it.poolTypeId == carry.id }.reserved)
        assertEquals(0.0, rows2084.single { it.poolTypeId == reset.id }.remaining)
        assertEquals(1.0, rows2084.single { it.poolTypeId == carry.id }.remaining)

        // Next year: the carry-over pool brings its unused day along; the reset pool starts
        // over at its allowance with nothing carried — and nothing owed.
        val rows2085 = s.budgets("?year=2085")
        val carryNext = rows2085.single { it.poolTypeId == carry.id }
        assertEquals(1.0, carryNext.carriedOver)
        assertEquals(3.0, carryNext.remaining)
        val resetNext = rows2085.single { it.poolTypeId == reset.id }
        assertEquals(0.0, resetNext.carriedOver)
        assertEquals(2.0, resetNext.remaining)
        // A 3-day ask in the reset pool next year is refused (no carry), in the carry pool it fits.
        val nextMon = monday(2085)
        assertEquals(HttpStatusCode.Conflict, s.createDaysOff(nextMon, end = nextMon.plusDays(2), poolTypeId = reset.id).status)
        assertEquals(HttpStatusCode.Created, s.createDaysOff(nextMon, end = nextMon.plusDays(2), poolTypeId = carry.id).status)
        // A retroactive over-ask in the reset pool's earlier year answers with that year.
        assertEquals(HttpStatusCode.Conflict, s.createDaysOff(monday(2084, 9), poolTypeId = reset.id).status)
    }

    @Test
    fun `corrections adjust one pool, and the card stat is the default pool`() = testApplication {
        usePostgresTestcontainer()
        val aEmail = uniqueEmail("pool-co-a")
        val mEmail = uniqueEmail("pool-co-m")
        val sEmail = uniqueEmail("pool-co-s")
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        val mId = TestUsers.seed(mEmail, "pw", name = "PoolCo Mgr", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "PoolCo Sub", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "pool-co-${UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamId, sId)
        val a = authedClient(aEmail, "pw")
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val extra = a.freshKind("Study", carriesOver = false)
        TestDaysOff.setAllowance(sId, 10)
        TestDaysOff.setAllowance(sId, 2, poolTypeId = extra.id)
        val year = LocalDate.now().year

        suspend fun correct(poolTypeId: UInt?, days: Double = 1.0, op: DaysOffCorrectionOperation = DaysOffCorrectionOperation.ADD) =
            m.post("/api/v1/days-off/corrections") {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCorrectionWrite(sId, year, op, days, "Pool correction", poolTypeId = poolTypeId))
            }
        // Unknown / archived / ungranted kinds are 400; the default (omitted) and the granted
        // extra kind take the correction.
        assertEquals(HttpStatusCode.BadRequest, correct(999_999_999u).status)
        val ungranted = a.freshKind("Nobody", carriesOver = true)
        assertEquals(HttpStatusCode.BadRequest, correct(ungranted.id).status)
        val onDefault = correct(null).body<DaysOffCorrectionResponse>()
        assertEquals(TestDaysOff.DEFAULT_POOL_TYPE_ID, onDefault.poolTypeId)
        val onExtra = correct(extra.id, days = 0.5, op = DaysOffCorrectionOperation.SUBTRACT).body<DaysOffCorrectionResponse>()
        assertEquals(extra.id, onExtra.poolTypeId)
        assertEquals(extra.name, onExtra.poolName)
        // The notification names the pool; the budgets attribute each correction to its pool.
        val notes = s.get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
            .items.filter { it.type == NotificationType.DAYS_OFF_CORRECTED_TO_OWNER }
        assertEquals(setOf(onDefault.poolName, extra.name), notes.map { it.params["pool"] }.toSet())
        val rows = s.budgets()
        assertEquals(1.0, rows[0].corrected)
        assertEquals(11.0, rows[0].remaining)
        assertEquals(-0.5, rows[1].corrected)
        assertEquals(1.5, rows[1].remaining)
        // The pool is immutable on PUT (ignored, like userId); the list shows the pool name.
        assertEquals(
            HttpStatusCode.NoContent,
            m.put("/api/v1/days-off/corrections/${onExtra.id}") {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCorrectionWrite(sId, year, DaysOffCorrectionOperation.ADD, 1.0, "Moved?", poolTypeId = null))
            }.status,
        )
        val listed = m.get("/api/v1/days-off/corrections?userId=$sId").body<ch.nokillswit.daysoff.DaysOffCorrectionList>().items
        assertEquals(extra.id, listed.single { it.id == onExtra.id }.poolTypeId)
        assertEquals(3.0, s.budgets()[1].remaining)

        // The managed card stat stays the DEFAULT pool's remaining, not a sum or the last row.
        val card = m.get("/api/v1/teams/members?view=managed&pageSize=100").body<TeamMemberPageResponse>()
            .items.single { it.userId == sId }
        assertEquals(11.0, card.daysOffRemaining)
    }

    @Test
    fun `checkup-32 rules - teammate redaction, archived-kind grants, immutable correction pools, and the 400s`() = testApplication {
        usePostgresTestcontainer()
        // G manages M; M manages S and T (teammates); A admin, H HR; F has DAYS_OFF disabled.
        val aEmail = uniqueEmail("pool-c32-a")
        val hEmail = uniqueEmail("pool-c32-h")
        val gEmail = uniqueEmail("pool-c32-g")
        val mEmail = uniqueEmail("pool-c32-m")
        val sEmail = uniqueEmail("pool-c32-s")
        val tEmail = uniqueEmail("pool-c32-t")
        val fEmail = uniqueEmail("pool-c32-f")
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        TestUsers.seed(hEmail, "pw", roles = setOf(UserRole.HR))
        val gId = TestUsers.seed(gEmail, "pw", name = "C32 Grand", roles = emptySet())
        val mId = TestUsers.seed(mEmail, "pw", name = "C32 Mgr", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", name = "C32 Sub", roles = emptySet())
        val tId = TestUsers.seed(tEmail, "pw", name = "C32 Mate", roles = emptySet())
        val fId = TestUsers.seed(fEmail, "pw", roles = emptySet())
        TestServices.users.setDisabledFeatures(fId, setOf(ch.nokillswit.users.Feature.DAYS_OFF, ch.nokillswit.users.Feature.MFA))
        val teamY = TestServices.teams.create(Team(name = "pool-c32-y-${UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamY, mId)
        val teamX = TestServices.teams.create(Team(name = "pool-c32-x-${UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamX, sId)
        TestServices.teams.addMember(teamX, tId)
        val a = authedClient(aEmail, "pw")
        val h = authedClient(hEmail, "pw")
        val g = authedClient(gEmail, "pw")
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val t = authedClient(tEmail, "pw")
        val f = authedClient(fEmail, "pw")
        val extra = a.freshKind("Maternal", carriesOver = false)
        TestDaysOff.setAllowance(sId, 20)
        TestDaysOff.setAllowance(tId, 5)
        val appender = LogCapture("ch.nokillswit.audit")
        try {
            // The registry read is feature-gated like every days-off route.
            assertEquals(HttpStatusCode.Forbidden, f.get("/api/v1/days-off/pool-types").status)
            // ADMIN and HR never write a grant, extra kind or not (the chain-only right).
            assertEquals(HttpStatusCode.Forbidden, a.putAllowance(sId, 3, poolTypeId = extra.id).status)
            assertEquals(HttpStatusCode.Forbidden, h.putAllowance(sId, 3, poolTypeId = extra.id).status)
            // The grand-manager (chain) grants the extra pool; the list filter rejects junk.
            assertEquals(HttpStatusCode.NoContent, g.putAllowance(sId, 3, poolTypeId = extra.id).status)
            assertEquals(HttpStatusCode.BadRequest, s.get("/api/v1/days-off?poolTypeId=abc").status)

            // A request in the extra pool: the owner, the chain, and HR see the pool; the
            // TEAMMATE (calendar parity) sees the absence with the pool REDACTED — on the
            // single GET and on the member-scope calendar (the caller's own bars keep it).
            val mon = monday(2086)
            val created = s.createDaysOff(mon, poolTypeId = extra.id).body<DaysOffResponse>()
            assertEquals(extra.name, created.poolName)
            for (reader in listOf(s, m, g, h)) {
                val seen = reader.get("/api/v1/days-off/${created.id}").body<DaysOffResponse>()
                assertEquals(extra.id, seen.poolTypeId)
                assertEquals(extra.name, seen.poolName)
            }
            val mateView = t.get("/api/v1/days-off/${created.id}").body<DaysOffResponse>()
            assertEquals(DaysOffType.PAID, mateView.type)
            assertNull(mateView.poolTypeId)
            assertNull(mateView.poolName)
            assertEquals(HttpStatusCode.Created, t.createDaysOff(mon.plusWeeks(1)).status)
            val month = mon.toString().substring(0, 7)
            val mateCalendar = t.get("/api/v1/days-off/calendar?month=$month&scope=member")
                .body<ch.nokillswit.daysoff.DaysOffCalendarResponse>()
            assertNull(mateCalendar.users.single { it.userId == sId }.entries.first().poolName)
            assertEquals("Paid days off", mateCalendar.users.single { it.userId == tId }.entries.first().poolName)
            val ownCalendar = s.get("/api/v1/days-off/calendar?month=$month&scope=member")
                .body<ch.nokillswit.daysoff.DaysOffCalendarResponse>()
            assertEquals(extra.name, ownCalendar.users.single { it.userId == sId }.entries.first().poolName)
            val managedCalendar = m.get("/api/v1/days-off/calendar?month=$month&scope=managed")
                .body<ch.nokillswit.daysoff.DaysOffCalendarResponse>()
            assertEquals(extra.name, managedCalendar.users.single { it.userId == sId }.entries.first().poolName)

            // The corrections' pool is immutable on PUT: null = unchanged, a differing kind = 400.
            val corr = m.post("/api/v1/days-off/corrections") {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCorrectionWrite(sId, 2086, DaysOffCorrectionOperation.ADD, 1.0, "c32", poolTypeId = extra.id))
            }.body<DaysOffCorrectionResponse>()
            suspend fun putCorrection(poolTypeId: UInt?) = m.put("/api/v1/days-off/corrections/${corr.id}") {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCorrectionWrite(sId, 2086, DaysOffCorrectionOperation.ADD, 2.0, "c32 edited", poolTypeId = poolTypeId))
            }.status
            assertEquals(HttpStatusCode.BadRequest, putCorrection(TestDaysOff.DEFAULT_POOL_TYPE_ID))
            assertEquals(HttpStatusCode.NoContent, putCorrection(null))
            assertEquals(HttpStatusCode.NoContent, putCorrection(extra.id))

            // A non-carry pool's correction in ANOTHER year never enters this year's row; a
            // correction alone (no request) keeps an archived pool's history row visible.
            assertEquals(HttpStatusCode.Created, m.post("/api/v1/days-off/corrections") {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCorrectionWrite(sId, 2085, DaysOffCorrectionOperation.ADD, 5.0, "c32 prior", poolTypeId = extra.id))
            }.status)
            val row2086 = s.budgets("?year=2086").single { it.poolTypeId == extra.id }
            assertEquals(2.0, row2086.corrected)
            assertEquals(0.0, row2086.carriedOver)
            assertEquals(4.0, row2086.remaining) // 3 + 2 − 1 reserved; 2085's +5 never flows in
            val row2085 = s.budgets("?year=2085").single { it.poolTypeId == extra.id }
            assertEquals(8.0, row2085.remaining)
            val grantId = row2086.poolId!!
            assertEquals(HttpStatusCode.NoContent, m.delete("/api/v1/days-off/pools/$grantId").status)
            assertTrue(s.budgets("?year=2085").single { it.poolTypeId == extra.id }.poolArchived)

            // A grant whose KIND was archived under it (the archive × upsert race, simulated
            // through the raw fixture) renders as history, never as a live pool.
            val raced = a.freshKind("Raced", carriesOver = true)
            assertEquals(HttpStatusCode.NoContent, a.delete("/api/v1/days-off/pool-types/${raced.id}").status)
            TestDaysOff.setAllowance(sId, 2, poolTypeId = raced.id)
            assertEquals(HttpStatusCode.BadRequest, s.createDaysOff(mon.plusWeeks(2), poolTypeId = raced.id).status)
            val racedRow = s.budgets("?year=2086").singleOrNull { it.poolTypeId == raced.id }
            assertTrue(racedRow == null || racedRow.poolArchived, "an archived kind's grant is never a live pool")

            // The audits: the on-behalf recording names the pool, and a carry-over flip on a
            // kind records how many active grants it moved.
            assertEquals(HttpStatusCode.Created, m.createDaysOff(mon.plusWeeks(3), forUserId = sId).status)
            val recorded = appender.events.last { it.message == "days_off.recorded" }
            assertEquals(TestDaysOff.DEFAULT_POOL_TYPE_ID.toLong(), recorded.keyValuePairs.first { it.key == "poolTypeId" }.value)
            val flipped = a.freshKind("Flip", carriesOver = true)
            TestDaysOff.setAllowance(sId, 1, poolTypeId = flipped.id)
            TestDaysOff.setAllowance(tId, 1, poolTypeId = flipped.id)
            assertEquals(
                HttpStatusCode.NoContent,
                a.put("/api/v1/days-off/pool-types/${flipped.id}") {
                    contentType(ContentType.Application.Json)
                    setBody(DaysOffPoolTypeWrite(name = flipped.name, carriesOver = false))
                }.status,
            )
            val flip = appender.events.last { it.message == "days_off_pool_type.updated" }
            assertEquals(2L, flip.keyValuePairs.first { it.key == "grantsAffected" }.value)
            assertTrue(flip.keyValuePairs.none { it.key == "nameFrom" })
        } finally {
            appender.detach()
        }
    }

    /** A pre-V74 request row (no pool column yet) for the backfill fixture. */
    private fun legacyRequest(type: String, date: String, email: String): String =
        "INSERT INTO days_off_requests " +
            "(user_id, type, status, start_date, end_date, cost_half_days, created_at, last_modified) " +
            "SELECT id, '$type', 'ACCEPTED', '$date', '$date', 2, 0, 0 FROM users WHERE email = '$email'"

    @Test
    fun `V74 backfills the allowance, the paid requests, and the corrections onto the default pool`() {
        val schema = "v74_check_" + UUID.randomUUID().toString().replace("-", "").take(8)
        fun flyway(target: String?) = Flyway.configure()
            .dataSource(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password)
            .locations("classpath:db/migration")
            .schemas(schema)
            .apply { if (target != null) target(target) }
            .load()
        // A throwaway schema migrated to V73 (the V72 precedent — `unaccent` is database-wide,
        // so the drop in `finally` never touches the suite's `public` schema).
        flyway("73").migrate()
        DriverManager.getConnection(PostgresTestSupport.jdbcUrl, PostgresTestSupport.user, PostgresTestSupport.password).use { conn ->
            try {
                conn.createStatement().use { it.execute("SET search_path TO $schema") }
                conn.createStatement().use {
                    it.execute(
                        "INSERT INTO users (name, email, password_hash, paid_days_off_allowance) VALUES " +
                            "('Legacy Granted', 'legacy-granted@x', 'h', 26), ('Legacy Bare', 'legacy-bare@x', 'h', NULL)",
                    )
                    it.execute(legacyRequest("PAID", "2070-06-01", "legacy-granted@x"))
                    it.execute(legacyRequest("UNPAID", "2070-07-01", "legacy-granted@x"))
                    it.execute(
                        "INSERT INTO days_off_corrections " +
                            "(user_id, author_id, year, amount_half_days, comment, created_at, last_modified) " +
                            "SELECT id, id, 2070, 2, 'c', 0, 0 FROM users WHERE email = 'legacy-granted@x'",
                    )
                }
                flyway(null).migrate()
                conn.createStatement().use { st ->
                    st.executeQuery("SELECT id, name, carries_over FROM days_off_pool_types WHERE is_default").use { rs ->
                        assertTrue(rs.next(), "the seeded default kind exists")
                        assertEquals("Paid days off", rs.getString("name"))
                        assertTrue(rs.getBoolean("carries_over"))
                        assertFalse(rs.next())
                    }
                    st.executeQuery(
                        "SELECT u.email, p.allowance, t.is_default FROM days_off_pools p " +
                            "JOIN users u ON u.id = p.user_id JOIN days_off_pool_types t ON t.id = p.pool_type_id",
                    ).use { rs ->
                        assertTrue(rs.next(), "the configured allowance became a default-kind grant")
                        assertEquals("legacy-granted@x", rs.getString("email"))
                        assertEquals(26, rs.getInt("allowance"))
                        assertTrue(rs.getBoolean("is_default"))
                        assertFalse(rs.next(), "a null allowance yields no grant")
                    }
                    st.executeQuery(
                        "SELECT r.type, r.pool_type_id IS NOT NULL AS pooled, t.is_default FROM days_off_requests r " +
                            "LEFT JOIN days_off_pool_types t ON t.id = r.pool_type_id ORDER BY r.start_date",
                    ).use { rs ->
                        assertTrue(rs.next())
                        assertEquals("PAID", rs.getString("type"))
                        assertTrue(rs.getBoolean("pooled") && rs.getBoolean("is_default"))
                        assertTrue(rs.next())
                        assertEquals("UNPAID", rs.getString("type"))
                        assertFalse(rs.getBoolean("pooled"))
                        assertFalse(rs.next())
                    }
                    st.executeQuery(
                        "SELECT t.is_default FROM days_off_corrections c JOIN days_off_pool_types t ON t.id = c.pool_type_id",
                    ).use { rs ->
                        assertTrue(rs.next())
                        assertTrue(rs.getBoolean("is_default"))
                    }
                    st.executeQuery(
                        "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = '$schema' " +
                            "AND table_name = 'users' AND column_name = 'paid_days_off_allowance'",
                    ).use { rs ->
                        rs.next()
                        assertEquals(0, rs.getInt(1), "the V38 column is gone")
                    }
                }
                // The DB-level guards: a PAID row without a pool, and an UNPAID row with one.
                assertTrue(
                    runCatching {
                        conn.createStatement().use { it.execute(legacyRequest("PAID", "2071-06-01", "legacy-bare@x")) }
                    }.isFailure,
                    "PAID without a pool violates the CHECK",
                )
                assertTrue(
                    runCatching {
                        conn.createStatement().use {
                            it.execute(
                                "UPDATE days_off_requests SET pool_type_id = (SELECT id FROM days_off_pool_types WHERE is_default) " +
                                    "WHERE type = 'UNPAID'",
                            )
                        }
                    }.isFailure,
                    "UNPAID with a pool violates the CHECK",
                )
                // The sequence advanced past the seed: a second kind gets id 2, not a clash.
                conn.createStatement().use { st ->
                    st.executeQuery(
                        "INSERT INTO days_off_pool_types (name, carries_over, created_at, last_modified) " +
                            "VALUES ('Second', false, 0, 0) RETURNING id",
                    ).use { rs ->
                        rs.next()
                        assertEquals(2L, rs.getLong("id"))
                    }
                }
            } finally {
                conn.createStatement().use { it.execute("DROP SCHEMA IF EXISTS $schema CASCADE") }
            }
        }
    }
}
