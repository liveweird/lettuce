package ch.nokillswit

import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamListFilter
import ch.nokillswit.teams.TeamMemberListFilter
import ch.nokillswit.teams.TeamMemberListView
import ch.nokillswit.teams.directManagerIds
import ch.nokillswit.teams.directSubordinateIds
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.teams.teamMembershipsByUserIds
import ch.nokillswit.teams.transitiveSubordinateIds
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.SortField
import ch.nokillswit.teamkpis.TeamKpiCreateRequest
import ch.nokillswit.teamkpis.TeamKpiResponse
import ch.nokillswit.teamkpis.TeamKpiType
import ch.nokillswit.users.UserPageResponse
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * The V93 rule that rights stay "today only": rows of the dated base tables whose period ended
 * before today or starts after it are INVISIBLE to every today-reader, because they all read the
 * `team_members` / `teams_current` views. The fixture inserts such rows directly into the base
 * tables (the service API only ever writes today-relative rows) and then asks each family of
 * readers — the management chain, the roster/manager lists, the users-list enrichment, the pulse
 * scopes and the team-KPI manager — for the answer.
 */
class TeamStructureTodayTest {

    // Read once per test: the fixture's service and every expectation share this "today".
    private val today: java.time.LocalDate = java.time.LocalDate.now()
    private fun iso(days: Long) = today.plusDays(days).toString()
    private val fixtureService = ch.nokillswit.teams.TeamService(TestServices.database, clock = { today })

    private val paging = PageRequest(page = 1, pageSize = 100, sort = listOf(SortField("id", descending = false)))

    private class Fixture(
        val teamId: UInt,
        val grandTeamId: UInt,
        val grand: UInt,
        val manager: UInt,
        val oldManager: UInt,
        val futureManager: UInt,
        val a: UInt,
        val b: UInt,
        val past: UInt,
        val future: UInt,
        val managerEmail: String,
        val oldManagerEmail: String,
    )

    /**
     * Team X: manager M since today; members A and B now; P ended yesterday; F starts tomorrow.
     * Manager line: OLD (until yesterday) -> M (today only) -> FUT (from tomorrow). Team Y (managed
     * by G) has M as a member, so G sits above M in the chain.
     */
    private suspend fun fixture(): Fixture {
        suspend fun seed(prefix: String): Pair<UInt, String> {
            val email = uniqueEmail(prefix)
            return TestUsers.seed(email, "pw", roles = emptySet()) to email
        }
        val (grand, _) = seed("grand")
        val (manager, managerEmail) = seed("mgr")
        val (oldManager, oldManagerEmail) = seed("oldmgr")
        val (futureManager, _) = seed("futmgr")
        val (a, _) = seed("a")
        val (b, _) = seed("b")
        val (past, _) = seed("past")
        val (future, _) = seed("future")
        val grandTeamId = fixtureService.create(
            Team(name = "tst-y-${UUID.randomUUID()}", managerId = grand, memberIds = listOf(manager)),
        )
        val teamId = fixtureService.create(
            Team(name = "tst-x-${UUID.randomUUID()}", managerId = manager, memberIds = listOf(a, b)),
        )
        insertMembershipRow(teamId, past, iso(-30), iso(-1))
        insertMembershipRow(teamId, future, iso(1), null)
        val managerPeriod = periodRecords(teamId).single()
        setPeriodEnd(managerPeriod.id, iso(0))
        insertPeriodRow(teamId, oldManager, iso(-30), iso(-1))
        insertPeriodRow(teamId, futureManager, iso(1), null)
        return Fixture(
            teamId, grandTeamId, grand, manager, oldManager, futureManager, a, b, past, future,
            managerEmail, oldManagerEmail,
        )
    }

    @Test
    fun `the management chain ignores ended and not-yet-started memberships and manager periods`() = testApplication {
        usePostgresTestcontainer()
        val fx = fixture()
        suspendTransaction(TestServices.database) {
            assertEquals(setOf(fx.a, fx.b), directSubordinateIds(fx.manager))
            assertEquals(emptySet(), directSubordinateIds(fx.oldManager), "a past manager period grants nothing")
            assertEquals(emptySet(), directSubordinateIds(fx.futureManager), "a future manager period grants nothing yet")
            assertEquals(setOf(fx.manager, fx.a, fx.b), transitiveSubordinateIds(fx.grand))

            assertEquals(setOf(fx.manager), directManagerIds(fx.a))
            assertEquals(emptySet(), directManagerIds(fx.past), "an ended member has no manager through the team")
            assertEquals(emptySet(), directManagerIds(fx.future), "a not-yet-started member has none yet")

            assertTrue(isInManagementChain(fx.manager, fx.a))
            assertTrue(isInManagementChain(fx.grand, fx.a))
            assertTrue(!isInManagementChain(fx.manager, fx.past))
            assertTrue(!isInManagementChain(fx.manager, fx.future))
            assertTrue(!isInManagementChain(fx.oldManager, fx.a))
            assertTrue(!isInManagementChain(fx.futureManager, fx.a))
        }
    }

    @Test
    fun `team reads and lists show only today's roster and today's manager`() = testApplication {
        usePostgresTestcontainer()
        val fx = fixture()

        val team = assertNotNull(TestServices.teams.read(fx.teamId))
        assertEquals(fx.manager, team.managerId)
        assertEquals(listOf(fx.a, fx.b), team.memberIds.sorted())
        assertEquals(fx.manager, assertNotNull(TestServices.teams.readDetail(fx.teamId)).team.managerId)

        val byOld = TestServices.teams.list(TeamListFilter(managerId = fx.oldManager), paging)
        val byFuture = TestServices.teams.list(TeamListFilter(managerId = fx.futureManager), paging)
        assertTrue(byOld.items.none { it.id == fx.teamId } && byFuture.items.none { it.id == fx.teamId })
        assertEquals(listOf(fx.teamId), TestServices.teams.list(TeamListFilter(managerId = fx.manager), paging).items.map { it.id })
        assertEquals(emptyList(), TestServices.teams.list(TeamListFilter(memberId = fx.past), paging).items)
        assertEquals(emptyList(), TestServices.teams.list(TeamListFilter(memberId = fx.future), paging).items)
        assertEquals(listOf(fx.teamId), TestServices.teams.list(TeamListFilter(memberId = fx.a), paging).items.map { it.id })

        suspend fun members(view: TeamMemberListView, caller: UInt) =
            TestServices.teams.listMembers(view, caller, TeamMemberListFilter(), paging).items.map { it.userId }
        assertEquals(listOf(fx.a, fx.b), members(TeamMemberListView.MANAGED, fx.manager).sorted())
        assertEquals(emptyList(), members(TeamMemberListView.MANAGED, fx.oldManager))
        assertEquals(emptyList(), members(TeamMemberListView.MANAGED, fx.futureManager))
        assertEquals(listOf(fx.b), members(TeamMemberListView.MEMBER, fx.a))
        assertEquals(emptyList(), members(TeamMemberListView.MEMBER, fx.past))
        assertEquals(emptyList(), members(TeamMemberListView.MEMBER, fx.future))
        assertEquals(listOf(fx.manager), members(TeamMemberListView.MANAGERS, fx.a))
        assertEquals(emptyList(), members(TeamMemberListView.MANAGERS, fx.past))
        assertEquals(emptyList(), members(TeamMemberListView.MANAGERS, fx.future))

        assertEquals(setOf(fx.teamId), TestServices.teams.teamRefs(setOf(fx.teamId)).map { it.id }.toSet())
        assertEquals(
            setOf(fx.a, fx.b),
            TestServices.teams.membersWithNamesByTeamIds(setOf(fx.teamId)).getValue(fx.teamId).map { it.first }.toSet(),
        )
    }

    @Test
    fun `the users list enrichment and teamId filter use today's roster`() = testApplication {
        usePostgresTestcontainer()
        val fx = fixture()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(adminEmail, "pw")
        val client = authedClient(adminEmail, "pw")

        val filtered = client.get("/api/v1/users?teamId=${fx.teamId}&pageSize=100").body<UserPageResponse>()
        assertEquals(setOf(fx.a, fx.b), filtered.items.map { it.id }.toSet())

        for (id in listOf(fx.past, fx.future)) {
            val row = client.get("/api/v1/users?id=$id&pageSize=1").body<UserPageResponse>().items.single()
            assertEquals(emptyList(), row.teams, "user $id is not (yet / any longer) on the roster")
        }
        val aRow = client.get("/api/v1/users?id=${fx.a}&pageSize=1").body<UserPageResponse>().items.single()
        assertEquals(listOf(fx.teamId), aRow.teams?.map { it.id })

        suspendTransaction(TestServices.database) {
            val byUser = teamMembershipsByUserIds(setOf(fx.a, fx.past, fx.future))
            assertEquals(setOf(fx.a), byUser.keys)
            assertEquals(fx.manager, byUser.getValue(fx.a).single().managerId)
        }
    }

    @Test
    fun `pulse team scopes follow today's roster and today's manager`() = testApplication {
        usePostgresTestcontainer()
        val fx = fixture()
        assertEquals(setOf(fx.a, fx.b), TestServices.teams.teamScopeMembers(fx.teamId, subtree = false))
        assertEquals(setOf(fx.a, fx.b), TestServices.teams.teamScopeMembers(fx.teamId, subtree = true))
        assertTrue(fx.teamId in TestServices.teams.visibleTeamTreeIds(fx.a))
        assertTrue(fx.teamId !in TestServices.teams.visibleTeamTreeIds(fx.past))
        assertTrue(fx.teamId !in TestServices.teams.visibleTeamTreeIds(fx.future))
        assertTrue(fx.teamId in TestServices.teams.managedTeamTreeIds(fx.manager))
        assertTrue(fx.teamId !in TestServices.teams.managedTeamTreeIds(fx.oldManager))
        assertTrue(fx.teamId !in TestServices.teams.managedTeamTreeIds(fx.futureManager))
        assertEquals(setOf(fx.teamId), TestServices.teams.membershipTeamIds(fx.a))
        assertEquals(emptySet(), TestServices.teams.membershipTeamIds(fx.past))
        assertTrue(TestServices.teams.managesTeamOrChain(fx.grand, fx.teamId))
        assertTrue(!TestServices.teams.managesTeamOrChain(fx.oldManager, fx.teamId))
    }

    @Test
    fun `a team KPI belongs to today's manager - past and future managers neither see nor manage it`() = testApplication {
        usePostgresTestcontainer()
        val fx = fixture()
        val manager = authedClient(fx.managerEmail, "pw")
        val oldManager = authedClient(fx.oldManagerEmail, "pw")

        val created = manager.post("/api/v1/team-kpis") {
            contentType(ContentType.Application.Json)
            setBody(
                TeamKpiCreateRequest(
                    teamId = fx.teamId,
                    title = "Deploys",
                    description = "weekly",
                    type = TeamKpiType.NUMBER,
                    targetValue = 10.0,
                ),
            )
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val kpi = created.body<TeamKpiResponse>()
        assertEquals(fx.manager, kpi.managerId)

        assertEquals(HttpStatusCode.OK, manager.get("/api/v1/team-kpis/${kpi.id}").status)
        assertEquals(HttpStatusCode.Forbidden, oldManager.get("/api/v1/team-kpis/${kpi.id}").status)
        val managedByOld = oldManager.get("/api/v1/team-kpis?view=managed&teamId=${fx.teamId}").bodyAsTeamKpiIds()
        assertTrue(kpi.id !in managedByOld)

        // A deleted team still names the manager of its last period (the managed list needs it).
        assertNotNull(TestServices.teams.deleteTeam(fx.teamId))
        val afterDelete = manager.get("/api/v1/team-kpis/${kpi.id}").body<TeamKpiResponse>()
        assertEquals(fx.manager, afterDelete.managerId)
        assertTrue(afterDelete.teamDeleted)
    }

    @Test
    fun `a team deleted on an earlier day still resolves its last manager through teams_current`() = testApplication {
        usePostgresTestcontainer()
        val manager = TestUsers.seed(uniqueEmail("gone-mgr"), "pw", roles = emptySet())
        val teamId = fixtureService.create(Team(name = "tst-gone-${UUID.randomUUID()}", managerId = manager))
        // Deleted three days ago: the line ran iso(-10)..iso(-3), the flag was set long before today.
        val period = periodRecords(teamId).single()
        setPeriodStart(period.id, iso(-10))
        setPeriodEnd(period.id, iso(-3))
        softDeleteTeamRow(teamId)

        val row = suspendTransaction(TestServices.database) {
            ch.nokillswit.teams.TeamService.Teams.selectAll()
                .where { ch.nokillswit.teams.TeamService.Teams.id eq teamId }
                .toList().single()
        }
        assertEquals(manager, row[ch.nokillswit.teams.TeamService.Teams.managerId].value)
        assertTrue(row[ch.nokillswit.teams.TeamService.Teams.markedAsDeleted])
        assertEquals(emptySet(), TestServices.teams.teamScopeMembers(teamId, subtree = false))
    }

    private suspend fun io.ktor.client.statement.HttpResponse.bodyAsTeamKpiIds(): Set<UInt> =
        body<ch.nokillswit.teamkpis.TeamKpiPageResponse>().items.map { it.id }.toSet()
}
