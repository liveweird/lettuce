package ch.nokillswit

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.ForbiddenException
import ch.nokillswit.daysoff.DaysOffCalendarResponse
import ch.nokillswit.daysoff.DaysOffCalendarScope
import ch.nokillswit.daysoff.DaysOffCalendarShareable
import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.sharing.ReadVia
import ch.nokillswit.sharing.ShareAccess
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.teams.Team
import ch.nokillswit.users.Feature
import ch.nokillswit.users.OPT_IN_FEATURES
import ch.nokillswit.users.UserRole
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The days-off calendar's `scope=shared` ("Shared with me", v4.11.0). The scope evaluates the
 * caller's active shares SET-AT-A-TIME inside `DaysOffService.calendar`; the per-document
 * mechanism it must never drift from is `ShareAccess.readOrShared` over the real adapter guard
 * (`DaysOffCalendarShareable` -> `requireDaysOffCalendarRead`). The parity test below builds a
 * relationship matrix, asks `readOrShared` about every person, and demands the scope list exactly
 * that set — with the same granting sharer — in both directions.
 */
class DaysOffCalendarSharedScopeTest {

    private val password = "pw-123456789"
    private val type = ShareableResourceType.DAYS_OFF_CALENDAR
    private val month = "2071-03"
    private val shares = ShareService(TestServices.database)
    private val adapter = DaysOffCalendarShareable(TestServices.users, TestDaysOff.service)
    private val access = ShareAccess(shares, TestServices.users)

    private suspend fun seed(prefix: String): UInt {
        val email = uniqueEmail(prefix)
        return TestUsers.seed(email = email, password = password, name = "$prefix-${email.substringAfter('-').take(8)}", roles = emptySet())
    }

    private suspend fun nameOf(id: UInt): String = checkNotNull(TestServices.users.read(id)).name

    private fun firstMonday(): LocalDate = LocalDate.of(2071, 3, 1).with(TemporalAdjusters.firstInMonth(DayOfWeek.MONDAY))

    /** One PAID entry on the extra pool [poolTypeId] (Mon-Tue of the month's first week); returns its id. */
    private suspend fun entry(userId: UInt, poolTypeId: UInt): UInt {
        TestDaysOff.setAllowance(userId, 30, poolTypeId)
        val monday = firstMonday()
        return TestDaysOff.service.create(
            userId,
            DaysOffCreateRequest(DaysOffType.PAID, monday.toString(), monday.plusDays(1).toString(), poolTypeId = poolTypeId),
        ).first
    }

    private suspend fun team(manager: UInt, vararg members: UInt): UInt =
        TestServices.teams.create(Team("SharedScope-${java.util.UUID.randomUUID()}", manager, members.toList()))

    private class Case(
        val label: String,
        val person: UInt,
        /** What the case is DESIGNED to show — asserted against the readOrShared oracle, so a wrong design fails loudly. */
        val admitted: Boolean,
    )

    private class World(
        val sharee: UInt,
        val cases: List<Case>,
        val entryIds: Map<UInt, UInt>,
        val poolName: String,
        val teamsByPerson: Map<UInt, UInt>,
        val deactivatedPerson: UInt,
    )

    /** The relationship matrix: one person per case, each shared with [World.sharee] by the case's sharer(s). */
    private suspend fun buildWorld(): World {
        val pool = TestDaysOff.createPoolType("Sabbatical")
        val poolName = TestDaysOff.service.listPoolTypes().first { it.id == pool }.name
        val sharee = seed("sc-sharee")
        val cases = mutableListOf<Case>()
        val entryIds = mutableMapOf<UInt, UInt>()
        val teamsByPerson = mutableMapOf<UInt, UInt>()

        suspend fun person(label: String): UInt = seed("sc-$label").also { entryIds[it] = entry(it, pool) }

        suspend fun share(person: UInt, sharer: UInt, expiresOn: String? = null): UInt {
            val outcome = shares.create(type, person, sharer, sharee, expiresOn, mapOf("person" to nameOf(person)))
            return (outcome as ch.nokillswit.sharing.ShareCreateOutcome.Created).id
        }

        fun case(label: String, person: UInt, admitted: Boolean) {
            cases += Case(label, person, admitted)
        }

        // 1. the person shares their own calendar
        person("self").let { p -> share(p, p); case("self", p, true) }
        // 2. a direct manager
        person("direct").let { p ->
            val m = seed("sc-direct-mgr")
            teamsByPerson[p] = team(m, p)
            share(p, m)
            case("direct manager", p, true)
        }
        // 3. a skip-level manager
        person("skip").let { p ->
            val m = seed("sc-skip-mgr")
            val g = seed("sc-skip-grand")
            teamsByPerson[p] = team(m, p)
            team(g, m)
            share(p, g)
            case("skip-level manager", p, true)
        }
        // 4. a teammate (calendar-parity reader, never an own-right sharer — the store would still hold the row)
        person("mate").let { p ->
            val m = seed("sc-mate-mgr")
            val mate = seed("sc-mate-peer")
            team(m, p, mate)
            share(p, mate)
            case("teammate only", p, false)
        }
        // 5. an outsider
        person("outsider").let { p -> share(p, seed("sc-outsider-sharer")); case("outsider", p, false) }
        // 5b. an HR-role sharer OUTSIDE the chain: the role strip means HR grants a sharer nothing
        person("hr-sharer").let { p ->
            val hr = TestUsers.seed(uniqueEmail("sc-hr-sharer"), password, name = "sc-hr-sharer", roles = setOf(UserRole.HR))
            share(p, hr)
            case("HR-role sharer outside the chain", p, false)
        }
        // 6. a deactivated sharer
        person("deact-sharer").let { p ->
            val m = seed("sc-deact-mgr")
            team(m, p)
            share(p, m)
            TestServices.users.setDeactivated(m, true)
            case("deactivated sharer", p, false)
        }
        // 7. a sharer with DAYS_OFF disabled
        person("flag-off").let { p ->
            val m = seed("sc-flag-mgr")
            team(m, p)
            share(p, m)
            TestServices.users.setDisabledFeatures(m, setOf(Feature.DAYS_OFF) + OPT_IN_FEATURES)
            case("sharer with DAYS_OFF disabled", p, false)
        }
        // 8. a soft-deleted sharer
        person("del-sharer").let { p ->
            val m = seed("sc-delsh-mgr")
            team(m, p)
            share(p, m)
            TestServices.users.delete(m)
            case("soft-deleted sharer", p, false)
        }
        // 9. a soft-deleted person
        person("del-person").let { p ->
            val m = seed("sc-delp-mgr")
            team(m, p)
            share(p, m)
            TestServices.users.delete(p)
            case("soft-deleted person", p, false)
        }
        // 10. expired (yesterday) and expiring today (inclusive)
        person("expired").let { p ->
            val m = seed("sc-exp-mgr")
            team(m, p)
            share(p, m, expiresOn = shares.today().minusDays(1).toString())
            case("expired share", p, false)
        }
        person("today").let { p ->
            val m = seed("sc-today-mgr")
            team(m, p)
            share(p, m, expiresOn = shares.today().toString())
            case("share expiring today", p, true)
        }
        // 11. withdrawn
        person("withdrawn").let { p ->
            val m = seed("sc-wd-mgr")
            team(m, p)
            val id = share(p, m)
            shares.withdraw(id, m)
            case("withdrawn share", p, false)
        }
        // 12. the sharer left the chain
        person("left-chain").let { p ->
            val m = seed("sc-left-mgr")
            val t = team(m, p)
            share(p, m)
            TestServices.teams.removeMember(t, p)
            case("sharer no longer in the chain", p, false)
        }
        // 13. two sharers, the OLDER one no longer passes: the newer passing one grants
        person("older-fails").let { p ->
            val m = seed("sc-of-mgr")
            teamsByPerson[p] = team(m, p)
            share(p, seed("sc-of-outsider"))
            share(p, m)
            case("older share fails, newer passes", p, true)
        }
        // 14. two passing sharers: the OLDEST wins
        person("both-pass").let { p ->
            val m = seed("sc-bp-mgr")
            val g = seed("sc-bp-grand")
            teamsByPerson[p] = team(m, p)
            team(g, m)
            share(p, g)
            share(p, m)
            case("two passing sharers", p, true)
        }
        // 15. a deactivated PERSON stays listed (historical data reads like an active user's)
        val deactivatedPerson = person("deact-person")
        run {
            val m = seed("sc-dp-mgr")
            team(m, deactivatedPerson)
            share(deactivatedPerson, m)
            TestServices.users.setDeactivated(deactivatedPerson, true)
            case("deactivated person", deactivatedPerson, true)
        }
        // 16. the person (self-sharer) deactivated: the SHARER is no longer live
        person("self-deact").let { p ->
            share(p, p)
            TestServices.users.setDeactivated(p, true)
            case("deactivated self-sharer", p, false)
        }
        return World(sharee, cases, entryIds, poolName, teamsByPerson, deactivatedPerson)
    }

    @Test
    fun `scope=shared lists exactly the people ShareAccess readOrShared admits, with the same granting sharer`() = testApplication {
        usePostgresTestcontainer()
        val w = buildWorld()
        val shareeEmail = TestServices.users.read(w.sharee)!!.email
        val client = authedClient(shareeEmail, password)

        // The oracle: the per-document mechanism, through the REAL adapter guard.
        val principal = CallerPrincipal(w.sharee, shareeEmail, emptySet(), emptySet())
        val expected = linkedMapOf<UInt, String>()
        for (case in w.cases) {
            val doc = adapter.read(case.person) ?: continue // soft-deleted person: the route answers 404
            val via = try {
                access.readOrShared<Unit>(principal, type, case.person) { adapter.guard(it, doc) }
            } catch (_: ForbiddenException) {
                null
            }
            if (via != null) {
                assertIs<ReadVia.Shared<Unit>>(via, case.label)
                expected[case.person] = via.sharerName
            }
            // The designed outcome of every case matches the oracle (a wrong matrix fails here).
            assertEquals(case.admitted, via != null, "designed outcome of '${case.label}'")
        }
        assertTrue(expected.isNotEmpty() && expected.size < w.cases.size, "the matrix is non-vacuous both ways")

        val shared = client.get("/api/v1/days-off/calendar?month=$month&scope=shared").body<DaysOffCalendarResponse>()
        // Set equality in BOTH directions, and the granting sharer per person.
        assertEquals(expected.keys, shared.users.map { it.userId }.toSet())
        assertEquals(expected.size, shared.users.size, "no person listed twice")
        shared.users.forEach { assertEquals(expected[it.userId], it.sharedBy, "sharedBy of ${it.userName}") }
        // Every excluded person is absent by name too (guards against an id/lookup mix-up).
        assertTrue(w.cases.filter { !it.admitted }.none { c -> shared.users.any { it.userId == c.person } })
    }

    @Test
    fun `scope=shared rows - pool identity redacted on every entry, own teams, name order, capability false`() = testApplication {
        usePostgresTestcontainer()
        val w = buildWorld()
        val client = authedClient(TestServices.users.read(w.sharee)!!.email, password)
        val shared = client.get("/api/v1/days-off/calendar?month=$month&scope=shared").body<DaysOffCalendarResponse>()
        assertTrue(shared.users.isNotEmpty())

        // Teammate parity: the paid pool's identity is withheld on EVERY row — including the
        // person's own share (the sharer is the person) — while type and half-day survive.
        val entries = shared.users.flatMap { it.entries }
        assertTrue(entries.isNotEmpty(), "future-month entries are visible (the share is live)")
        assertTrue(entries.all { it.poolName == null }, "poolName must be null on every shared entry")
        assertTrue(entries.all { it.type == DaysOffType.PAID })
        assertEquals(2, shared.users.first().entries.size)
        // Non-vacuous: the same entries DO carry the pool name where nothing redacts it.
        val own = TestDaysOff.service.calendar(DaysOffCalendarScope.MEMBER, w.entryIds.keys.first(), month)
        assertNotNull(own.users.first { it.userId == w.entryIds.keys.first() }.entries.first().poolName)
        assertTrue(w.poolName.isNotBlank())

        // teams = the person's OWN teams (the ORG idiom), not caller-relative (the sharee has none).
        w.teamsByPerson.forEach { (person, teamId) ->
            shared.users.firstOrNull { it.userId == person }?.let { row ->
                assertEquals(listOf(teamId), row.teams.map { it.id }, row.userName)
            }
        }
        // Sorted by name (ties by id); nobody deleted; the capability is false everywhere.
        assertEquals(shared.users.sortedWith(compareBy({ it.userName }, { it.userId })).map { it.userId }, shared.users.map { it.userId })
        assertTrue(shared.users.none { it.userDeleted })
        assertTrue(shared.users.none { it.canShareCalendar })
        // A deactivated person is listed.
        assertTrue(shared.users.any { it.userId == w.deactivatedPerson })

        // The rows render even in a month where nobody is off.
        val quiet = client.get("/api/v1/days-off/calendar?month=2071-07&scope=shared").body<DaysOffCalendarResponse>()
        assertEquals(shared.users.map { it.userId }, quiet.users.map { it.userId })
        assertTrue(quiet.users.all { it.entries.isEmpty() })
    }

    @Test
    fun `scope=shared shape - no shares is an empty list, includeIndirect and teamId are 400, a DAYS_OFF-disabled caller is 403`() =
        testApplication {
            usePostgresTestcontainer()
            val lonelyEmail = uniqueEmail("sc-lonely")
            TestUsers.seed(lonelyEmail, password, name = "Lonely", roles = emptySet())
            val lonely = authedClient(lonelyEmail, password)
            val empty = lonely.get("/api/v1/days-off/calendar?month=$month&scope=shared")
            assertEquals(HttpStatusCode.OK, empty.status)
            assertEquals(emptyList(), empty.body<DaysOffCalendarResponse>().users)

            val base = "/api/v1/days-off/calendar?scope=shared"
            assertEquals(HttpStatusCode.BadRequest, lonely.get("$base&month=$month&includeIndirect=true").status)
            assertEquals(HttpStatusCode.BadRequest, lonely.get("$base&month=$month&includeIndirect=false").status)
            assertEquals(HttpStatusCode.BadRequest, lonely.get("$base&month=$month&teamId=1").status)
            assertEquals(HttpStatusCode.BadRequest, lonely.get(base).status)

            val offEmail = uniqueEmail("sc-flag-off-caller")
            val offId = TestUsers.seed(offEmail, password, name = "FlagOff", roles = emptySet())
            TestServices.users.setDisabledFeatures(offId, setOf(Feature.DAYS_OFF) + OPT_IN_FEATURES)
            val off = authedClient(offEmail, password)
            assertEquals(HttpStatusCode.Forbidden, off.get("/api/v1/days-off/calendar?month=$month&scope=shared").status)
        }

    @Test
    fun `a share grants the calendar scope only - the entry GET and the budgets stay own-right`() = testApplication {
        usePostgresTestcontainer()
        val pool = TestDaysOff.createPoolType("Sabbatical")
        val sharee = seed("sc-only-sharee")
        val person = seed("sc-only-person")
        val manager = seed("sc-only-mgr")
        team(manager, person)
        val entryId = entry(person, pool)
        shares.create(type, person, manager, sharee, null)
        val client = authedClient(TestServices.users.read(sharee)!!.email, password)

        val shared = client.get("/api/v1/days-off/calendar?month=$month&scope=shared").body<DaysOffCalendarResponse>()
        assertEquals(listOf(person), shared.users.map { it.userId })
        assertEquals(nameOf(manager), shared.users.single().sharedBy)

        assertEquals(HttpStatusCode.Forbidden, client.get("/api/v1/days-off/$entryId").status)
        assertEquals(HttpStatusCode.Forbidden, client.get("/api/v1/days-off/corrections?userId=$person").status)
        // The share-holder is not in the person's scope on any other scope either.
        val member = client.get("/api/v1/days-off/calendar?month=$month").body<DaysOffCalendarResponse>()
        assertFalse(member.users.any { it.userId == person })
        assertNull(member.users.firstOrNull { it.sharedBy != null }, "sharedBy is null on every other scope")
    }

    @Test
    fun `a sharee who is also the person's manager sees the person via the share - redacted, never more than own right`() =
        testApplication {
            usePostgresTestcontainer()
            val pool = TestDaysOff.createPoolType("Sabbatical")
            val manager = seed("sc-own-mgr")
            val person = seed("sc-own-person")
            val grand = seed("sc-own-grand")
            team(manager, person)
            team(grand, manager)
            entry(person, pool)
            // readOrShared would answer Own for the manager; the shared scope still lists the person
            // for the share, at teammate parity (poolName redacted) with the sharer named.
            shares.create(type, person, grand, manager, null)
            val client = authedClient(TestServices.users.read(manager)!!.email, password)
            val shared = client.get("/api/v1/days-off/calendar?month=$month&scope=shared").body<DaysOffCalendarResponse>()
            val row = shared.users.single()
            assertEquals(person, row.userId)
            assertEquals(nameOf(grand), row.sharedBy)
            assertTrue(row.entries.isNotEmpty() && row.entries.all { it.poolName == null })
            assertFalse(row.canShareCalendar)
            // The manager's own-right view (managed scope) is the one that keeps the pool name.
            val managed = client.get("/api/v1/days-off/calendar?month=$month&scope=managed").body<DaysOffCalendarResponse>()
            assertNotNull(managed.users.single { it.userId == person }.entries.first().poolName)
        }
}
