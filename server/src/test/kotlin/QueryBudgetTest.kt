package ch.nokillswit

import ch.nokillswit.daysoff.DaysOffCreateRequest
import ch.nokillswit.daysoff.DaysOffType
import ch.nokillswit.feedbacks.Feedback
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalCreateRequest
import ch.nokillswit.goals.GoalEvent
import ch.nokillswit.goals.GoalEventType
import ch.nokillswit.goals.GoalMilestoneInput
import ch.nokillswit.goals.GoalType
import ch.nokillswit.impactlog.ImpactEntryRequest
import ch.nokillswit.oneonones.OneOnOneCreateRequest
import ch.nokillswit.pulse.PulseResponseSubmitRequest
import ch.nokillswit.pulse.PulseScaleAnswer
import ch.nokillswit.reviews.PerformanceReviewCreateRequest
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.succession.RetentionRisk
import ch.nokillswit.succession.RoleCriticality
import ch.nokillswit.succession.SuccessionPlanCreateRequest
import ch.nokillswit.teamkpis.TeamKpiCreateRequest
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.teams.Team
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.testApplication
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.YearMonth
import java.time.temporal.TemporalAdjusters
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Query budgets (`.claude/docs/performance.md`, "Query budgets"): for every list endpoint the performance
 * programme measured, the number of SQL statements (`stmt`) and transactions (`tx`) one request costs —
 * read from the `Server-Timing` header, which development mode (the tests') sends to every authenticated
 * response — must (a) not grow with the number of rows the page returns (1 row vs 50 rows, the same caller,
 * `pageSize` 100: `stmt(50) == stmt(1)`, same for `tx`) and (b) stay within [BUDGETS], the numbers measured
 * on the day the budget was written. A change that adds a per-row query fails here, in the Backend job.
 *
 * Endpoints that were ALREADY O(n) when the baseline was taken are not fixed by this programme; their
 * per-row slope is PINNED instead (`Budget.dStmt`/`dTx`, the measured `stmt(50) - stmt(1)`): a regression
 * and an improvement both fail, so whoever changes the code updates the pin (and `perf/baselines/FINDINGS.md`)
 * in the same PR. A deliberate optimisation lowers its budget row in the same PR.
 *
 * The suite shares one Testcontainer, so every test builds its own users (unique prefix per test) and each
 * probe's page is scoped to them (a name filter or a caller-relative view); the row count the response reports
 * is asserted too, so an empty page can never pass for "O(1)".
 */
class QueryBudgetTest {

    private data class Cost(val stmt: Int, val tx: Int)

    /**
     * [stmt]/[tx] = the budget at the small size (1 row); [dStmt]/[dTx] = the pinned growth from 1 to 50 rows
     * (0 = O(1) in rows, the rule; non-zero = an endpoint that was already O(n) at baseline).
     */
    private data class Budget(val stmt: Int, val tx: Int, val dStmt: Int = 0, val dTx: Int = 0)

    /** [rows] maps the grown size n to the `total` the page must report (null = unpaged response, not checked). */
    private class Probe(val name: String, val client: HttpClient, val path: String, val rows: ((Int) -> Int)? = { it })

    private class Person(val id: UInt, val email: String)

    private companion object {
        const val PASSWORD = "pw-budget-1234"
        const val SMALL = 1
        const val LARGE = 50

        val headerShape = Regex("""db;dur=(\d+\.\d);desc="stmt=(\d+) tx=(\d+)", app;dur=(\d+\.\d)""")

        /**
         * THE budget table — one line per endpoint, the measured value (stmt/tx at 1 row -> at 50 rows) in the
         * comment. Measured 2026-10-04 on the development-mode test application (so these include the JWT
         * blocklist read: 1 statement, 1 transaction, on every authenticated request).
         */
        val BUDGETS: Map<String, Budget> = mapOf(
            "users?name" to Budget(8, 2), // 8/2 -> 8/2
            "teams?name" to Budget(4, 2), // 4/2 -> 4/2 (v4.14.0: +1 grouped memberIds statement per page)
            "teams/{id}" to Budget(3, 3), // 3/3 -> 3/3 (O(1); the org chart reads memberIds from the teams list, F8)
            // F1/F10/F17, fixed in v4.14.0: one DISTINCT ON statement per enrichment (latest 1:1, latest review on
            // `managed`; latest 1:1 on `managers`) instead of one LIMIT 1 lookup per row.
            "teams/members?view=managed" to Budget(18, 11), // 18/11 -> 18/11
            "teams/members?view=managed&includeIndirect" to Budget(20, 11), // 20/11 -> 20/11
            "teams/members?view=managers" to Budget(8, 7), // 8/7 -> 8/7
            "teams/members?view=member" to Budget(9, 8), // 9/8 -> 9/8
            "dashboard/summary" to Budget(10, 8), // 10/8 -> 10/8 (F11)
            // F17, fixed in v4.14.0: `isLatest` is one DISTINCT ON statement over the page's pairs, not one per pair.
            "one-on-ones?view=managed" to Budget(6, 2), // 6/2 -> 6/2
            "one-on-ones?view=managed&latestOnly" to Budget(6, 2), // 6/2 -> 6/2
            "goals?view=managed" to Budget(4, 2), // 4/2 -> 4/2
            "performance-reviews?view=managed" to Budget(3, 2), // 3/2 -> 3/2
            "performance-reviews?view=all" to Budget(3, 2), // 3/2 -> 3/2
            "feedbacks?view=received" to Budget(5, 3), // 5/3 -> 5/3
            "feedbacks?view=provided" to Budget(5, 3), // 5/3 -> 5/3
            "feedbacks?view=team" to Budget(6, 3), // 6/3 -> 6/3
            "feedbacks?view=kudos" to Budget(4, 2), // 4/2 -> 4/2
            "team-kpis?view=managed" to Budget(5, 2), // 5/2 -> 5/2
            "team-kpis?view=all" to Budget(4, 2), // 4/2 -> 4/2
            "impact-log?view=own" to Budget(3, 2), // 3/2 -> 3/2
            "impact-log?view=managed" to Budget(4, 2), // 4/2 -> 4/2
            "succession-plans?view=own" to Budget(4, 2), // 4/2 -> 4/2
            "days-off?view=managed" to Budget(8, 2), // 8/2 -> 8/2
            "days-off/budgets?view=managed" to Budget(10, 3), // 10/3 -> 10/3 (F13: the cost grows with the chain, not the statement count)
            "days-off/budgets?view=managed&includeIndirect" to Budget(12, 3), // 12/3 -> 12/3
            "days-off/calendar?scope=managed" to Budget(7, 2), // 7/2 -> 7/2
            "days-off/calendar?scope=managed&includeIndirect" to Budget(9, 2), // 9/2 -> 9/2
            "days-off/calendar?scope=member" to Budget(8, 2), // 8/2 -> 8/2
            "notifications" to Budget(3, 2), // 3/2 -> 3/2 (F11: the bell is O(1))
            "shares?view=withMe" to Budget(3, 2), // 3/2 -> 3/2
            "shares?view=byMe" to Budget(3, 2), // 3/2 -> 3/2
            "users/{id}/activity" to Budget(10, 3), // 10/3 -> 10/3 (own log: 1 sign-in event + 2 rows per goal)
            // Measured before and after adding 9 closed cycles (not rows): F7 fixed in v4.14.0 — one transaction, two set-based statements.
            // v4.15.0 (F16): `readRef` — one statement, the unused memberIds select is gone — and the HR trend skips the share lookup.
            "pulse-surveys/trend" to Budget(6, 5), // 8/6 -> 6/5 (HR, direct; was 2 stmt + 2 tx per closed cycle before v4.14.0)
            "pulse-surveys/cycles/{id}/results" to Budget(9, 7), // 10/7 -> 9/7 (HR, direct; current + previous cycle in one tx)
            "pulse-surveys/cycles/{id}/comments" to Budget(6, 6), // 7/6 -> 6/6 (HR, direct; >= 3 responders so the comments read runs)
        )
    }

    // ---- fixtures ----

    private fun tag() = "qb" + UUID.randomUUID().toString().take(8)

    private suspend fun person(prefix: String, name: String = prefix, roles: Set<UserRole> = emptySet()): Person {
        val email = uniqueEmail(prefix)
        return Person(TestUsers.seed(email, PASSWORD, name, roles), email)
    }

    /** grand -> manager -> subs: the caller-relative views of every list read the same chain. */
    private class Org(val tag: String, val grand: Person, val manager: Person, val teamId: UInt) {
        val subs = mutableListOf<Person>()

        /** Makes sure there are [n] subordinates and runs [each] for every index below [n] that was not yet seeded. */
        suspend fun grow(n: Int, each: suspend (Int, Person) -> Unit = { _, _ -> }) {
            val from = subs.size
            while (subs.size < n) {
                val email = uniqueEmail("qb-sub")
                val sub = Person(TestUsers.seed(email, PASSWORD, "$tag-s${subs.size}", emptySet()), email)
                TestServices.teams.addMember(teamId, sub.id)
                subs += sub
            }
            for (i in from until n) each(i, subs[i])
        }
    }

    private suspend fun org(tag: String): Org {
        val grand = person("qb-grand", "Grand")
        val manager = person("qb-mgr", "Manager")
        TestServices.teams.create(Team(name = "$tag-g", managerId = grand.id, memberIds = listOf(manager.id)))
        val teamId = TestServices.teams.create(Team(name = "$tag-t", managerId = manager.id))
        return Org(tag, grand, manager, teamId)
    }

    private val today get() = LocalDate.now().toString()

    private fun goalRequest(subordinateId: UInt, title: String) = GoalCreateRequest(
        subordinateId = subordinateId, title = title, type = GoalType.PLAN,
        milestones = listOf(GoalMilestoneInput(description = "Done")), dueDate = "2099-12-31",
    )

    // ---- measuring ----

    private class Reading(val cost: Cost, val total: Int?)

    private suspend fun Probe.fetch(): Reading {
        val response = client.get(path)
        assertEquals(HttpStatusCode.OK, response.status, "$name: GET $path")
        val header = assertNotNull(response.headers["Server-Timing"], "$name: no Server-Timing header (dev mode, authenticated)")
        val match = assertNotNull(headerShape.matchEntire(header), "$name: unexpected Server-Timing shape: $header")
        val total = Json.parseToJsonElement(response.bodyAsText()).jsonObject["total"]?.jsonPrimitive?.int
        return Reading(Cost(match.groupValues[2].toInt(), match.groupValues[3].toInt()), total)
    }

    /** Two identical requests must cost the same (no hidden cache or sweep) — then the count is the endpoint's own. */
    private suspend fun Probe.measure(n: Int): Cost {
        // The warm-up absorbs one-off work that is not the endpoint's own cost: the feedback lists sweep overdue
        // REQUESTED rows left by other tests of the shared container on the first read (extra statements, once).
        fetch()
        val first = fetch()
        val second = fetch()
        assertEquals(first.cost, second.cost, "$name: two identical requests cost different statement counts")
        val expected = rows?.invoke(n)
        if (expected != null) assertEquals(expected, first.total, "$name: the page must report $expected rows at n=$n")
        return first.cost
    }

    private fun evaluate(name: String, small: Cost, large: Cost): String? {
        val line = "$name: stmt ${small.stmt} -> ${large.stmt}, tx ${small.tx} -> ${large.tx}"
        println("QUERY-BUDGET $line")
        val budget = BUDGETS[name] ?: return "no budget row for $line"
        val dStmt = large.stmt - small.stmt
        val dTx = large.tx - small.tx
        val problems = mutableListOf<String>()
        if (dStmt != budget.dStmt || dTx != budget.dTx) {
            val verdict = if (dStmt > budget.dStmt || dTx > budget.dTx) "REGRESSION" else "IMPROVEMENT - update the pin"
            problems += "slope 1 -> 50 rows is stmt +$dStmt / tx +$dTx, budget pins +${budget.dStmt} / +${budget.dTx} ($verdict)"
        }
        if (small.stmt > budget.stmt || small.tx > budget.tx) {
            problems += "at 1 row ${small.stmt}/${small.tx} exceeds the budget ${budget.stmt}/${budget.tx}"
        }
        if (large.stmt > budget.stmt + budget.dStmt || large.tx > budget.tx + budget.dTx) {
            problems += "at 50 rows ${large.stmt}/${large.tx} exceeds the budget ${budget.stmt + budget.dStmt}/${budget.tx + budget.dTx}"
        }
        return if (problems.isEmpty()) null else "$line - ${problems.joinToString("; ")}"
    }

    /**
     * Grows the fixture to [SMALL] rows, builds the probes (their callers exist by now), measures; grows to [LARGE],
     * measures again; asserts all budgets at once so one run reports every drifted endpoint.
     */
    private suspend fun budgets(grow: suspend (Int) -> Unit, probes: suspend () -> List<Probe>) {
        grow(SMALL)
        val built = probes()
        val small = built.map { it.measure(SMALL) }
        grow(LARGE)
        val large = built.map { it.measure(LARGE) }
        val failures = built.indices.mapNotNull { evaluate(built[it].name, small[it], large[it]) }
        assertTrue(
            failures.isEmpty(),
            "query budgets violated (lower a budget only when the code got cheaper on purpose, in the same PR):\n" +
                failures.joinToString("\n"),
        )
    }

    // ---- the tests ----

    @Test
    fun `users list and team reads`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val org = org(tag)
        val admin = person("qb-admin", roles = setOf(UserRole.ADMIN))
        val owner = person("qb-teams-owner", "Teams Owner")
        var teams = 0
        var firstTeam = 0u
        var membersOfFirst = 0
        budgets(
            grow = { n ->
                org.grow(n)
                while (teams < n) {
                    val id = TestServices.teams.create(Team(name = "$tag-x$teams", managerId = owner.id))
                    if (teams == 0) firstTeam = id
                    teams++
                }
                while (membersOfFirst < n) TestServices.teams.addMember(firstTeam, org.subs[membersOfFirst++].id)
            },
            probes = {
                val adminClient = authedClient(admin.email, PASSWORD)
                val ownerClient = authedClient(owner.email, PASSWORD)
                listOf(
                    Probe("users?name", adminClient, "/api/v1/users?name=$tag-s&pageSize=100"),
                    Probe("teams?name", ownerClient, "/api/v1/teams?name=$tag-x&pageSize=100"),
                    Probe("teams/{id}", ownerClient, "/api/v1/teams/$firstTeam", rows = null),
                )
            },
        )
    }

    @Test
    fun `teams members views and the dashboard summary`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val org = org(tag)
        val caller = person("qb-managers-caller", "Caller")
        // A teammate who is not one of the grown rows: view=member lists everyone ELSE on the caller's teams.
        val observer = person("qb-observer", "Observer")
        val observerTeam = TestServices.teams.create(Team(name = "$tag-o", managerId = caller.id, memberIds = listOf(observer.id)))
        var bosses = 0
        budgets(
            grow = { n ->
                org.grow(n) { _, sub ->
                    TestServices.oneOnOnes.create(org.manager.id, OneOnOneCreateRequest(sub.id, today))
                    TestServices.goals.create(org.manager.id, goalRequest(sub.id, "$tag goal"))
                    TestServices.teams.addMember(observerTeam, sub.id)
                }
                while (bosses < n) {
                    val boss = person("qb-boss", "Boss $bosses")
                    TestServices.teams.create(Team(name = "$tag-b$bosses", managerId = boss.id, memberIds = listOf(caller.id)))
                    bosses++
                }
            },
            probes = {
                val manager = authedClient(org.manager.email, PASSWORD)
                val grand = authedClient(org.grand.email, PASSWORD)
                val member = authedClient(observer.email, PASSWORD)
                listOf(
                    Probe("teams/members?view=managed", manager, "/api/v1/teams/members?view=managed&pageSize=100"),
                    Probe(
                        "teams/members?view=managed&includeIndirect", grand,
                        "/api/v1/teams/members?view=managed&includeIndirect=true&pageSize=100",
                    ) { it + 1 },
                    Probe("teams/members?view=member", member, "/api/v1/teams/members?view=member&pageSize=100"),
                    Probe(
                        "teams/members?view=managers", authedClient(caller.email, PASSWORD),
                        "/api/v1/teams/members?view=managers&pageSize=100",
                    ),
                    Probe("dashboard/summary", manager, "/api/v1/dashboard/summary", rows = null),
                )
            },
        )
    }

    @Test
    fun `one-on-ones goals and performance reviews`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val org = org(tag)
        val hr = person("qb-hr", "HR", roles = setOf(UserRole.HR))
        val period = TestServices.reviewPeriods.list().lastOrNull() ?: TestReviewPeriods.append()
        budgets(
            grow = { n ->
                org.grow(n) { _, sub ->
                    TestServices.oneOnOnes.create(org.manager.id, OneOnOneCreateRequest(sub.id, today))
                    TestServices.goals.create(org.manager.id, goalRequest(sub.id, "$tag goal"))
                    TestServices.performanceReviews.create(org.manager.id, PerformanceReviewCreateRequest(sub.id, period.id))
                }
            },
            probes = {
                val manager = authedClient(org.manager.email, PASSWORD)
                val hrClient = authedClient(hr.email, PASSWORD)
                listOf(
                    Probe("one-on-ones?view=managed", manager, "/api/v1/one-on-ones?view=managed&pageSize=100"),
                    Probe("one-on-ones?view=managed&latestOnly", manager, "/api/v1/one-on-ones?view=managed&latestOnly=true&pageSize=100"),
                    Probe("goals?view=managed", manager, "/api/v1/goals?view=managed&pageSize=100"),
                    Probe("performance-reviews?view=managed", manager, "/api/v1/performance-reviews?view=managed&pageSize=100"),
                    Probe(
                        "performance-reviews?view=all", hrClient,
                        "/api/v1/performance-reviews?view=all&periodId=${period.id}&subordinateName=$tag-s&pageSize=100",
                    ),
                )
            },
        )
    }

    @Test
    fun `feedback views`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val org = org(tag)
        val provider = person("qb-provider", "Provider")
        val receiver = person("qb-receiver", "Receiver")
        budgets(
            grow = { n ->
                org.grow(n) { _, sub ->
                    // provider -> sub, public: the provided, team and kudos rows; sub -> receiver: the received rows.
                    TestServices.feedbacks.create(
                        Feedback(
                            subjectId = sub.id, providerId = provider.id, visibility = FeedbackVisibility.PUBLIC,
                            status = FeedbackStatus.SENT, content = "kudos",
                        ),
                    )
                    TestServices.feedbacks.create(
                        Feedback(
                            subjectId = receiver.id, providerId = sub.id, visibility = FeedbackVisibility.PROVIDER_SUBJECT,
                            status = FeedbackStatus.SENT, content = "thanks",
                        ),
                    )
                }
            },
            probes = {
                val receiverClient = authedClient(receiver.email, PASSWORD)
                val providerClient = authedClient(provider.email, PASSWORD)
                val manager = authedClient(org.manager.email, PASSWORD)
                listOf(
                    Probe("feedbacks?view=received", receiverClient, "/api/v1/feedbacks?view=received&pageSize=100"),
                    Probe("feedbacks?view=provided", providerClient, "/api/v1/feedbacks?view=provided&pageSize=100"),
                    Probe("feedbacks?view=team", manager, "/api/v1/feedbacks?view=team&pageSize=100"),
                    Probe("feedbacks?view=kudos", providerClient, "/api/v1/feedbacks?view=kudos&subjectName=$tag-s&pageSize=100"),
                )
            },
        )
    }

    @Test
    fun `team KPIs impact log and succession plans`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val org = org(tag)
        val hr = person("qb-hr", "HR", roles = setOf(UserRole.HR))
        budgets(
            grow = { n ->
                org.grow(n) { i, sub ->
                    TestServices.teamKpis.create(
                        TeamKpiCreateRequest(teamId = org.teamId, title = "$tag kpi $i", type = TeamKpiType.NUMBER, targetValue = 10.0),
                        org.manager.id,
                    )
                    // every entry belongs to the first sub, so the owner's own list and the manager's managed list both grow
                    TestServices.impactLog.create(
                        org.subs.first().id,
                        ImpactEntryRequest(
                            "$tag entry $i", "2026-07-01", "2026-07-31", "What happened", "My part", "Why it mattered", "Evidence",
                        ),
                    )
                    TestServices.successionPlans.create(
                        org.manager.id,
                        SuccessionPlanCreateRequest(
                            sub.id, RoleCriticality.CRITICAL, RetentionRisk.HIGH, listOf("Client relationships"), 2,
                        ),
                    )
                }
            },
            probes = {
                val manager = authedClient(org.manager.email, PASSWORD)
                val owner = authedClient(org.subs.first().email, PASSWORD)
                val hrClient = authedClient(hr.email, PASSWORD)
                listOf(
                    Probe("team-kpis?view=managed", manager, "/api/v1/team-kpis?view=managed&pageSize=100"),
                    Probe("team-kpis?view=all", hrClient, "/api/v1/team-kpis?view=all&title=$tag&pageSize=100"),
                    Probe("impact-log?view=own", owner, "/api/v1/impact-log?view=own&pageSize=100"),
                    Probe("impact-log?view=managed", manager, "/api/v1/impact-log?view=managed&pageSize=100"),
                    Probe("succession-plans?view=own", manager, "/api/v1/succession-plans?view=own&pageSize=100"),
                )
            },
        )
    }

    @Test
    fun `days off entries budgets and calendar`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val org = org(tag)
        val monday = YearMonth.now().atDay(1).with(TemporalAdjusters.nextOrSame(DayOfWeek.MONDAY))
        val month = YearMonth.from(monday)
        budgets(
            grow = { n ->
                org.grow(n) { _, sub ->
                    TestDaysOff.setAllowance(sub.id, 25)
                    TestDaysOff.service.create(
                        sub.id,
                        DaysOffCreateRequest(DaysOffType.UNPAID, monday.toString(), monday.plusDays(1).toString()),
                        recordedBy = org.manager.id,
                    )
                }
            },
            probes = {
                val manager = authedClient(org.manager.email, PASSWORD)
                val grand = authedClient(org.grand.email, PASSWORD)
                val member = authedClient(org.subs.first().email, PASSWORD)
                listOf(
                    Probe("days-off?view=managed", manager, "/api/v1/days-off?view=managed&pageSize=100"),
                    Probe(
                        "days-off/budgets?view=managed", manager,
                        "/api/v1/days-off/budgets?view=managed&year=${monday.year}", rows = null,
                    ),
                    Probe(
                        "days-off/budgets?view=managed&includeIndirect", grand,
                        "/api/v1/days-off/budgets?view=managed&includeIndirect=true&year=${monday.year}", rows = null,
                    ),
                    Probe("days-off/calendar?scope=managed", manager, "/api/v1/days-off/calendar?month=$month&scope=managed", rows = null),
                    Probe(
                        "days-off/calendar?scope=managed&includeIndirect", grand,
                        "/api/v1/days-off/calendar?month=$month&scope=managed&includeIndirect=true", rows = null,
                    ),
                    Probe("days-off/calendar?scope=member", member, "/api/v1/days-off/calendar?month=$month&scope=member", rows = null),
                )
            },
        )
    }

    @Test
    fun `notifications shares and the activity log`() = testApplication {
        usePostgresTestcontainer()
        val tag = tag()
        val org = org(tag)
        val sharee = person("qb-sharee", "Sharee")
        val shares = ShareService(TestServices.database)
        budgets(
            grow = { n ->
                org.grow(n) { _, sub ->
                    TestNotifications.seed(sharee.id, "$tag note")
                    val goalId = TestServices.goals.create(org.manager.id, goalRequest(sub.id, "$tag shared goal"))
                    TestGoalEvents.service.create(GoalEvent(goalId, org.manager.id, GoalEventType.CREATED))
                    shares.create(ShareableResourceType.GOAL, goalId, org.manager.id, sharee.id, null)
                }
            },
            probes = {
                val shareeClient = authedClient(sharee.email, PASSWORD)
                val manager = authedClient(org.manager.email, PASSWORD)
                listOf(
                    Probe("notifications", shareeClient, "/api/v1/notifications?pageSize=100"),
                    Probe("shares?view=withMe", shareeClient, "/api/v1/shares?view=withMe&pageSize=100"),
                    Probe("shares?view=byMe", manager, "/api/v1/shares?view=byMe&pageSize=100"),
                    // one goal event + one share row per goal, both authored by the manager, plus the sign-in event
                    // of the probe's own login
                    Probe("users/{id}/activity", manager, "/api/v1/users/${org.manager.id}/activity?pageSize=100") { it * 2 + 1 },
                )
            },
        )
    }

    private fun answers(enps: Int) = PulseResponseSubmitRequest(
        enps = enps, q2 = PulseScaleAnswer.AGREE, q3 = PulseScaleAnswer.AGREE, q4 = PulseScaleAnswer.AGREE,
        q5 = PulseScaleAnswer.AGREE, rotating = PulseScaleAnswer.AGREE,
    )

    /**
     * The pulse trend and results (and, since v4.15.0, comments) reads. Trend and results read every visible
     * cycle in one transaction with two set-based statements (F7, fixed in v4.14.0), so the cost no longer
     * depends on how many closed cycles exist. The fixture adds 9 more closed cycles (3 respondents each, so
     * the point is computed, not skipped) between the two measurements: equal trend cost before and after is
     * the proof. The results and comments probes read one of those cycles (+ its previous cycle for results),
     * which is the same cycle at both measurements, so their pin is the absolute budget.
     */
    @Test
    fun `pulse trend, results and comments cost the same at any number of closed cycles`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        val tag = tag()
        val org = org(tag)
        org.grow(3)
        val hr = person("qb-hr", "HR", roles = setOf(UserRole.HR))

        suspend fun addCycles(count: Int): UInt {
            val base = TestPulse.closedAtAfterAll()
            var last = 0u
            repeat(count) { i ->
                last = TestPulse.closedCycleWith(
                    respondents = org.subs.take(3).associate { it.id to answers(9) },
                    closedAt = base + i * 10_000L,
                ).id
            }
            return last
        }

        val resultsCycle = addCycles(2)
        val client = authedClient(hr.email, PASSWORD)
        val probes = listOf(
            Probe(
                "pulse-surveys/trend", client,
                "/api/v1/pulse-surveys/trend?teamId=${org.teamId}&mode=direct", rows = null,
            ),
            Probe(
                "pulse-surveys/cycles/{id}/results", client,
                "/api/v1/pulse-surveys/cycles/$resultsCycle/results?teamId=${org.teamId}&mode=direct", rows = null,
            ),
            Probe(
                "pulse-surveys/cycles/{id}/comments", client,
                "/api/v1/pulse-surveys/cycles/$resultsCycle/comments?teamId=${org.teamId}&mode=direct", rows = null,
            ),
        )
        val small = probes.map { it.measure(SMALL) }
        addCycles(9)
        val large = probes.map { it.measure(SMALL + 9) }
        val failures = probes.indices.mapNotNull { evaluate(probes[it].name, small[it], large[it]) }
        assertTrue(failures.isEmpty(), "query budgets violated:\n" + failures.joinToString("\n"))
    }
}
