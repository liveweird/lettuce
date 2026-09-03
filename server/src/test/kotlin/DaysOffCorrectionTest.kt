package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffBudgetList
import ch.nokillswit.daysoff.DaysOffCorrectionList
import ch.nokillswit.daysoff.DaysOffCorrectionOperation
import ch.nokillswit.daysoff.DaysOffCorrectionResponse
import ch.nokillswit.daysoff.DaysOffCorrectionWrite
import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import ch.nokillswit.teams.Team
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
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Paid-days budget corrections (v1.43.0): the guard matrix, CRUD + soft-delete, the immutable
 * target user, budget integration (the `corrected` field, carry-over, and the request-creation
 * sweep), the owner notification, and the encrypted comment column. Tests pin their budget
 * years to a distinct window (2070s) so the v1.42.0 suites' years never interfere.
 */
class DaysOffCorrectionTest {

    private fun monday(year: Int, month: Int = 6): LocalDate =
        LocalDate.of(year, month, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))

    private suspend fun HttpClient.createCorrection(
        userId: UInt,
        year: Int = 2070,
        operation: DaysOffCorrectionOperation = DaysOffCorrectionOperation.ADD,
        days: Double = 2.0,
        comment: String = "Overtime compensation",
    ): HttpResponse = post("/api/v1/days-off/corrections") {
        contentType(ContentType.Application.Json)
        setBody(DaysOffCorrectionWrite(userId, year, operation, days, comment))
    }

    @Test
    fun `corrections CRUD with the immutable target user and soft delete`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("corr-m")
        val subEmail = uniqueEmail("corr-s")
        val mgrId = TestUsers.seed(mgrEmail, "pw", name = "Corr Mgr", roles = emptySet())
        val subId = TestUsers.seed(subEmail, "pw", name = "Corr Sub", roles = emptySet())
        val otherId = TestUsers.seed(uniqueEmail("corr-o"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "corr-${java.util.UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        val manager = authedClient(mgrEmail, "pw")
        val sub = authedClient(subEmail, "pw")

        // Create returns the resolved document.
        val response = manager.createCorrection(subId, days = 4.5, comment = "Conference on-call")
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<DaysOffCorrectionResponse>()
        assertEquals("/api/v1/days-off/corrections/${created.id}", response.headers["Location"])
        assertEquals(subId, created.userId)
        assertEquals(mgrId, created.authorId)
        assertEquals("Corr Mgr", created.authorName)
        assertEquals(DaysOffCorrectionOperation.ADD, created.operation)
        assertEquals(4.5, created.days)
        assertEquals("Conference on-call", created.comment)

        // The subordinate lists it immediately.
        val listed = sub.get("/api/v1/days-off/corrections?userId=$subId").body<DaysOffCorrectionList>()
        assertEquals(listOf(created.id), listed.items.map { it.id })

        // PUT edits year/amount/comment; the payload's userId is IGNORED (target immutable).
        val put = manager.put("/api/v1/days-off/corrections/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCorrectionWrite(otherId, 2071, DaysOffCorrectionOperation.SUBTRACT, 1.5, "Corrected typo"))
        }
        assertEquals(HttpStatusCode.NoContent, put.status)
        val edited = sub.get("/api/v1/days-off/corrections?userId=$subId").body<DaysOffCorrectionList>().items.single()
        assertEquals(subId, edited.userId)
        assertEquals(2071, edited.year)
        assertEquals(DaysOffCorrectionOperation.SUBTRACT, edited.operation)
        assertEquals(1.5, edited.days)
        assertEquals("Corrected typo", edited.comment)
        // The year filter composes.
        assertEquals(
            0,
            sub.get("/api/v1/days-off/corrections?userId=$subId&year=2070").body<DaysOffCorrectionList>().items.size,
        )

        // Soft delete: the list hides it, mutations 404, the row survives raw.
        assertEquals(HttpStatusCode.NoContent, manager.delete("/api/v1/days-off/corrections/${created.id}").status)
        assertTrue(sub.get("/api/v1/days-off/corrections?userId=$subId").body<DaysOffCorrectionList>().items.isEmpty())
        assertEquals(HttpStatusCode.NotFound, manager.delete("/api/v1/days-off/corrections/${created.id}").status)
        assertEquals(HttpStatusCode.NotFound, manager.createCorrection(subId).let {
            manager.put("/api/v1/days-off/corrections/999999") {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCorrectionWrite(subId, 2070, DaysOffCorrectionOperation.ADD, 1.0, "x"))
            }.status
        })

        // Validation 400s (guarded caller, malformed payloads).
        assertEquals(HttpStatusCode.BadRequest, manager.createCorrection(subId, year = 1999).status)
        assertEquals(HttpStatusCode.BadRequest, manager.createCorrection(subId, days = 1.3).status)
        assertEquals(HttpStatusCode.BadRequest, manager.createCorrection(subId, comment = " ").status)
        assertEquals(HttpStatusCode.BadRequest, sub.get("/api/v1/days-off/corrections").status)
        assertEquals(HttpStatusCode.BadRequest, sub.get("/api/v1/days-off/corrections?userId=$subId&year=abc").status)
    }

    @Test
    fun `the guard matrix gates reads and writes`() = testApplication {
        usePostgresTestcontainer()
        // G manages Y {M}; M manages X {S, T}.
        val gEmail = uniqueEmail("corrz-g")
        val mEmail = uniqueEmail("corrz-m")
        val sEmail = uniqueEmail("corrz-s")
        val tEmail = uniqueEmail("corrz-t")
        val uEmail = uniqueEmail("corrz-u")
        val aEmail = uniqueEmail("corrz-a")
        val hEmail = uniqueEmail("corrz-h")
        val gId = TestUsers.seed(gEmail, "pw", roles = emptySet())
        val mId = TestUsers.seed(mEmail, "pw", roles = emptySet())
        val sId = TestUsers.seed(sEmail, "pw", roles = emptySet())
        val tId = TestUsers.seed(tEmail, "pw", roles = emptySet())
        TestUsers.seed(uEmail, "pw", roles = emptySet())
        TestUsers.seed(aEmail, "pw", roles = setOf(UserRole.ADMIN))
        TestUsers.seed(hEmail, "pw", roles = setOf(UserRole.HR))
        val teamY = TestServices.teams.create(Team(name = "corrzY-${java.util.UUID.randomUUID()}", managerId = gId))
        TestServices.teams.addMember(teamY, mId)
        val teamX = TestServices.teams.create(Team(name = "corrzX-${java.util.UUID.randomUUID()}", managerId = mId))
        TestServices.teams.addMember(teamX, sId)
        TestServices.teams.addMember(teamX, tId)

        val g = authedClient(gEmail, "pw")
        val m = authedClient(mEmail, "pw")
        val s = authedClient(sEmail, "pw")
        val t = authedClient(tEmail, "pw")
        val u = authedClient(uEmail, "pw")
        val a = authedClient(aEmail, "pw")
        val h = authedClient(hEmail, "pw")

        val correction = m.createCorrection(sId).body<DaysOffCorrectionResponse>()
        val listUrl = "/api/v1/days-off/corrections?userId=$sId"

        // Reads: self, the direct manager, the grand-manager (chain), HR (audited).
        assertEquals(HttpStatusCode.OK, s.get(listUrl).status)
        assertEquals(HttpStatusCode.OK, m.get(listUrl).status)
        assertEquals(HttpStatusCode.OK, g.get(listUrl).status)
        val capture = LogCapture("ch.nokillswit.audit")
        try {
            assertEquals(HttpStatusCode.OK, h.get(listUrl).status)
            assertNotNull(
                capture.awaitEvent {
                    it.message == "hr.read" && it.hasKeyValue("resource", "daysOffCorrections") &&
                        it.keyValuePairs?.any { kv -> kv.key == "resourceId" && kv.value == sId.toLong() } == true
                },
            )
        } finally {
            capture.detach()
        }
        // Teammates, unrelated users, and non-party ADMIN get nothing.
        assertEquals(HttpStatusCode.Forbidden, t.get(listUrl).status)
        assertEquals(HttpStatusCode.Forbidden, u.get(listUrl).status)
        assertEquals(HttpStatusCode.Forbidden, a.get(listUrl).status)

        // Writes: any manager in the subordinate's chain (v2.33.0) — not self, HR, ADMIN,
        // or a teammate.
        assertEquals(HttpStatusCode.Forbidden, s.createCorrection(sId).status)
        assertEquals(HttpStatusCode.Forbidden, h.createCorrection(sId).status)
        assertEquals(HttpStatusCode.Forbidden, a.createCorrection(sId).status)
        assertEquals(HttpStatusCode.Forbidden, t.createCorrection(sId).status)
        val editUrl = "/api/v1/days-off/corrections/${correction.id}"
        // The chain rule: the grand-manager edits the direct manager's correction (rights
        // follow the current chain, not the author) — and creates their own.
        assertEquals(
            HttpStatusCode.NoContent,
            g.put(editUrl) {
                contentType(ContentType.Application.Json)
                setBody(DaysOffCorrectionWrite(sId, 2070, DaysOffCorrectionOperation.ADD, 1.0, "chain edit"))
            }.status,
        )
        val chainCorrection = g.createCorrection(sId).body<DaysOffCorrectionResponse>()
        assertEquals(HttpStatusCode.Forbidden, s.delete(editUrl).status)
        // Rights follow the CURRENT chain: reassigning team X to G keeps G (now direct)
        // and drops M — who is no longer anywhere in S's chain.
        TestServices.teams.update(
            teamX,
            Team(name = "corrzX2-${java.util.UUID.randomUUID()}", managerId = gId, memberIds = listOf(sId, tId)),
        )
        assertEquals(HttpStatusCode.NoContent, g.delete(editUrl).status)
        assertEquals(HttpStatusCode.NoContent, g.delete("/api/v1/days-off/corrections/${chainCorrection.id}").status)
        assertEquals(HttpStatusCode.Forbidden, m.createCorrection(sId).status)
    }

    @Test
    fun `corrections enter the budgets and gate request creation`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("corrb-m")
        val subEmail = uniqueEmail("corrb-s")
        val mgrId = TestUsers.seed(mgrEmail, "pw", name = "CorrB Mgr", roles = emptySet())
        val subId = TestUsers.seed(subEmail, "pw", name = "CorrB Sub", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "corrb-${java.util.UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        TestDaysOff.setAllowance(subId, 1)
        val manager = authedClient(mgrEmail, "pw")
        val sub = authedClient(subEmail, "pw")

        // A 2-day PAID request over the 1-day allowance is blocked …
        val mon = monday(2072, 3)
        suspend fun request(): HttpStatusCode = sub.post("/api/v1/days-off") {
            contentType(ContentType.Application.Json)
            setBody(DaysOffCreateRequest(DaysOffType.PAID, mon.toString(), mon.plusDays(1).toString()))
        }.status
        assertEquals(HttpStatusCode.Conflict, request())
        // … an ADD correction makes it fit …
        val added = manager.createCorrection(subId, year = 2072, days = 1.0).body<DaysOffCorrectionResponse>()
        assertEquals(HttpStatusCode.Created, request())
        // … and the budget row reports the correction and the math.
        val budget = sub.get("/api/v1/days-off/budgets?year=2072").body<DaysOffBudgetList>().items.single()
        assertEquals(1.0, budget.corrected)
        assertEquals(2.0, budget.reserved)
        assertEquals(0.0, budget.remaining)
        // A prior-year correction flows in via carry-over.
        manager.createCorrection(subId, year = 2071, days = 3.0)
        val carried = sub.get("/api/v1/days-off/budgets?year=2072").body<DaysOffBudgetList>().items.single()
        assertEquals(4.0, carried.carriedOver) // 2071: allowance 1 + correction 3, unused
        assertEquals(4.0, carried.remaining)
        // A SUBTRACT correction pulls it back down; deleting one restores the math.
        val cut = manager.createCorrection(
            subId, year = 2072, operation = DaysOffCorrectionOperation.SUBTRACT, days = 4.0,
        ).body<DaysOffCorrectionResponse>()
        assertEquals(
            0.0,
            sub.get("/api/v1/days-off/budgets?year=2072").body<DaysOffBudgetList>().items.single().remaining,
        )
        manager.delete("/api/v1/days-off/corrections/${cut.id}")
        assertEquals(
            4.0,
            sub.get("/api/v1/days-off/budgets?year=2072").body<DaysOffBudgetList>().items.single().remaining,
        )

        // The owner heard about each creation (and nothing else).
        val notes = sub.get("/api/v1/notifications?pageSize=100").body<NotificationPageResponse>()
            .items.filter { it.type == NotificationType.DAYS_OFF_CORRECTED_TO_OWNER }
        assertEquals(3, notes.size)
        val addNote = notes.single { it.params["year"] == "2072" && it.params["operation"] == "ADD" }
        assertEquals("CorrB Mgr", addNote.params["manager"])
        assertEquals("1", addNote.params["days"])
        assertEquals("/days-off?tab=requests", addNote.link)
        assertTrue(added.id > 0u)
    }

    @Test
    fun `correction comments are encrypted at rest`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("corre-m")
        val subEmail = uniqueEmail("corre-s")
        val mgrId = TestUsers.seed(mgrEmail, "pw", roles = emptySet())
        val subId = TestUsers.seed(subEmail, "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "corre-${java.util.UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        val manager = authedClient(mgrEmail, "pw")

        val secret = "Secret reasoning ${java.util.UUID.randomUUID()}"
        val created = manager.createCorrection(subId, comment = secret).body<DaysOffCorrectionResponse>()
        assertEquals(secret, created.comment)

        // The raw column holds the envelope, not the plaintext.
        val raw = suspendTransaction(TestDaysOff.service.database) {
            ch.nokillswit.daysoff.DaysOffService.Corrections
                .selectAll()
                .where { ch.nokillswit.daysoff.DaysOffService.Corrections.id eq created.id }
                .map { it[ch.nokillswit.daysoff.DaysOffService.Corrections.comment] }
                .toList()
                .single()
        }
        assertTrue(raw.startsWith(FieldCipher.PREFIX), "expected an encrypted envelope, got: ${raw.take(20)}")
        assertTrue(!raw.contains(secret))
    }

    private suspend fun rawComment(id: UInt): String = suspendTransaction(TestDaysOff.service.database) {
        ch.nokillswit.daysoff.DaysOffService.Corrections
            .selectAll()
            .where { ch.nokillswit.daysoff.DaysOffService.Corrections.id eq id }
            .map { it[ch.nokillswit.daysoff.DaysOffService.Corrections.comment] }
            .toList()
            .single()
    }

    @Test
    fun `the startup backfill encrypts legacy plaintext correction comments`() = testApplication {
        usePostgresTestcontainer()
        val mgrId = TestUsers.seed(uniqueEmail("corrbf-m"), "pw", roles = emptySet())
        val subId = TestUsers.seed(uniqueEmail("corrbf-s"), "pw", roles = emptySet())

        // A row written before the cipher existed: raw plaintext, inserted below the service.
        val legacyId = suspendTransaction(TestDaysOff.service.database) {
            ch.nokillswit.daysoff.DaysOffService.Corrections.insert {
                it[ch.nokillswit.daysoff.DaysOffService.Corrections.userId] = subId
                it[ch.nokillswit.daysoff.DaysOffService.Corrections.authorId] = mgrId
                it[ch.nokillswit.daysoff.DaysOffService.Corrections.poolTypeId] = TestDaysOff.DEFAULT_POOL_TYPE_ID
                it[ch.nokillswit.daysoff.DaysOffService.Corrections.year] = 2078
                it[ch.nokillswit.daysoff.DaysOffService.Corrections.amountHalfDays] = 4
                it[ch.nokillswit.daysoff.DaysOffService.Corrections.comment] = "legacy plaintext comment"
                it[ch.nokillswit.daysoff.DaysOffService.Corrections.createdAt] = System.currentTimeMillis()
                it[ch.nokillswit.daysoff.DaysOffService.Corrections.lastModified] = System.currentTimeMillis()
            }[ch.nokillswit.daysoff.DaysOffService.Corrections.id].value
        }

        assertTrue(TestDaysOff.service.encryptLegacyRows() >= 1)
        val raw = rawComment(legacyId)
        assertTrue(raw.startsWith(FieldCipher.PREFIX))
        // The service reads it back decrypted, and a second pass leaves the row untouched.
        assertEquals("legacy plaintext comment", TestDaysOff.service.readCorrection(legacyId)?.comment)
        TestDaysOff.service.encryptLegacyRows()
        assertEquals(raw, rawComment(legacyId))
    }

    @Test
    fun `rotation - reencryptAll rewrites correction comments under the current key`() = testApplication {
        usePostgresTestcontainer()
        val mgrEmail = uniqueEmail("corrrot-m")
        val mgrId = TestUsers.seed(mgrEmail, "pw", roles = emptySet())
        val subId = TestUsers.seed(uniqueEmail("corrrot-s"), "pw", roles = emptySet())
        val teamId = TestServices.teams.create(Team(name = "corrrot-${java.util.UUID.randomUUID()}", managerId = mgrId))
        TestServices.teams.addMember(teamId, subId)
        val manager = authedClient(mgrEmail, "pw")
        val oldKey = DEV_DATA_ENCRYPTION_KEY
        val newKey = "0000000000000000000000000000000000000000000000000000000000000007"

        // A row encrypted under the old key (as the whole DB is before a rotation).
        val created = manager.createCorrection(subId, year = 2079, comment = "rotate me")
            .body<DaysOffCorrectionResponse>()

        // Boot-time state during rotation: current = new key, previous = old key.
        val rotatingService = ch.nokillswit.daysoff.DaysOffService(
            TestDaysOff.service.database,
            FieldCipher(newKey, previousKeyHex = oldKey),
        )
        assertTrue(rotatingService.encryptLegacyRows(reencryptAll = true) >= 1)

        // After the backfill the new key ALONE decrypts the row — the old key can be retired.
        assertEquals("rotate me", FieldCipher(newKey).decrypt(rawComment(created.id)))
    }
}
