package ch.nokillswit

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.plugins.ProblemDetail
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamMemberPageResponse
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import io.ktor.client.request.post
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TeamMemberListTest {


    private suspend fun HttpClient.createTeam(name: String, managerId: UInt, memberIds: List<UInt>): TeamResponse =
        post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = name, managerId = managerId, memberIds = memberIds))
        }.body<TeamResponse>()

    @Test
    fun `every view's rows carry the career profile - seniority only on managed - renames propagate`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", roles = emptySet())
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Career Mgr")
        val peerId = TestUsers.seed(email = uniqueEmail("peer"), password = "pw", name = "Career Peer")
        val reportId = TestUsers.seed(email = uniqueEmail("rep"), password = "pw", name = "Career Report")

        val marker = java.util.UUID.randomUUID().toString().take(8)
        val (pathId) = TestDictionaries.append(Dictionary.CAREER_PATH, "Members $marker")
        val (levelId) = TestDictionaries.append(Dictionary.SENIORITY_LEVEL, "MembersLvl $marker")

        // Manager gets a career path, the peer path + seniority, the report a seniority.
        // Since v2.15.0 the triple derives from the person's CURRENT career position.
        TestServices.careerPositions.create(
            managerId, managerId,
            ch.nokillswit.users.CareerPositionWrite("2020-01-01", careerPathId = pathId),
        )
        TestServices.careerPositions.create(
            peerId, peerId,
            ch.nokillswit.users.CareerPositionWrite("2020-01-01", careerPathId = pathId, seniorityLevelId = levelId),
        )
        TestServices.careerPositions.create(
            reportId, reportId,
            ch.nokillswit.users.CareerPositionWrite("2020-01-01", seniorityLevelId = levelId),
        )

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("career-shared-$marker", managerId, listOf(callerId, peerId))
        admin.createTeam("career-managed-$marker", callerId, listOf(reportId))

        val client = authedClient(callerEmail, "pw")

        val managers = client.get("/api/v1/teams/members?view=managers").body<TeamMemberPageResponse>()
        val mgrRow = managers.items.single { it.userId == managerId }
        assertEquals(DictionaryEntry(pathId, mapOf("en" to "Members $marker")), mgrRow.careerPath)
        assertEquals(null, mgrRow.careerSpecialization)

        // A peer's seniority is PRIVATE (v2.25.0): the path rides the member view, the
        // seniority is blanked — while the managed view (chain rows) keeps it.
        val member = client.get("/api/v1/teams/members?view=member").body<TeamMemberPageResponse>()
        val peerRow = member.items.single { it.userId == peerId }
        assertEquals(DictionaryEntry(pathId, mapOf("en" to "Members $marker")), peerRow.careerPath)
        assertEquals(null, peerRow.seniorityLevel)

        val managed = client.get("/api/v1/teams/members?view=managed").body<TeamMemberPageResponse>()
        val repRow = managed.items.single { it.userId == reportId }
        assertEquals(null, repRow.careerPath)
        assertEquals(null, repRow.careerSpecialization)
        assertEquals(DictionaryEntry(levelId, mapOf("en" to "MembersLvl $marker")), repRow.seniorityLevel)

        // A dictionary rename shows up on the next list read — the rows resolve by id.
        TestDictionaries.rename(Dictionary.CAREER_PATH, pathId, "Members2 $marker")
        val renamed = client.get("/api/v1/teams/members?view=managers").body<TeamMemberPageResponse>()
        assertEquals("Members2 $marker", renamed.items.single { it.userId == managerId }.careerPath?.values?.get("en"))
    }

    @Test
    fun `view=member returns co-members only, excluding caller and manager`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", roles = emptySet())
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Manager")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw", name = "Xavier")
        val yId = TestUsers.seed(email = uniqueEmail("y"), password = "pw", name = "Yolanda")
        val zId = TestUsers.seed(email = uniqueEmail("z"), password = "pw", name = "Zoe")

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("shared", managerId, listOf(callerId, xId, yId))
        // A team the caller is not in — its members must not appear.
        admin.createTeam("unrelated", managerId, listOf(zId))

        val page = authedClient(callerEmail, "pw").get("/api/v1/teams/members?view=member")
            .body<TeamMemberPageResponse>()
        assertEquals(2L, page.total)
        assertEquals(setOf(xId, yId), page.items.map { it.userId }.toSet())
        assertTrue(page.items.all { it.teamName == "shared" })
    }

    @Test
    fun `view=managers returns the managers of teams the caller is a member of`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", roles = emptySet())
        val m1Id = TestUsers.seed(email = uniqueEmail("m1"), password = "pw", name = "Manager One")
        val m2Id = TestUsers.seed(email = uniqueEmail("m2"), password = "pw", name = "Manager Two")
        val m3Id = TestUsers.seed(email = uniqueEmail("m3"), password = "pw", name = "Manager Three")
        val otherId = TestUsers.seed(email = uniqueEmail("other"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("alpha", m1Id, listOf(callerId, otherId))
        admin.createTeam("beta", m2Id, listOf(callerId))
        // A team the caller is not in — its manager must not appear.
        admin.createTeam("gamma", m3Id, listOf(otherId))

        val page = authedClient(callerEmail, "pw").get("/api/v1/teams/members?view=managers")
            .body<TeamMemberPageResponse>()
        assertEquals(2L, page.total)
        assertEquals(setOf(m1Id, m2Id), page.items.map { it.userId }.toSet())
        assertEquals(
            setOf("alpha" to m1Id, "beta" to m2Id),
            page.items.map { it.teamName to it.userId }.toSet(),
        )
    }

    @Test
    fun `view=managed returns members of managed teams only`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", roles = emptySet())
        val otherMgrId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw")
        val zId = TestUsers.seed(email = uniqueEmail("z"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("managed-by-caller", callerId, listOf(xId, zId))
        // Caller is merely a member here; it must not contribute to view=managed.
        admin.createTeam("membership-only", otherMgrId, listOf(callerId, xId))

        val page = authedClient(callerEmail, "pw").get("/api/v1/teams/members?view=managed")
            .body<TeamMemberPageResponse>()
        assertEquals(2L, page.total)
        assertEquals(setOf(xId, zId), page.items.map { it.userId }.toSet())
        assertTrue(page.items.all { it.teamName == "managed-by-caller" })
    }

    @Test
    fun `view=managed with includeIndirect returns the whole management chain`() = testApplication {
        usePostgresTestcontainer()
        val grandEmail = uniqueEmail("grand")
        val grandId = TestUsers.seed(email = grandEmail, password = "pw", roles = emptySet())
        val midEmail = uniqueEmail("mid")
        val midId = TestUsers.seed(email = midEmail, password = "pw", name = "Mia Mid", roles = emptySet())
        val subId = TestUsers.seed(email = uniqueEmail("sub"), password = "pw", name = "Sam Sub", roles = emptySet())

        val grandClient = authedClient(grandEmail, "pw")
        val midClient = authedClient(midEmail, "pw")
        grandClient.createTeam("leads", grandId, listOf(midId))
        midClient.createTeam("squad", midId, listOf(subId))

        // Default (and explicit false): direct reports only.
        val direct = grandClient.get("/api/v1/teams/members?view=managed")
            .body<TeamMemberPageResponse>()
        assertEquals(setOf(midId), direct.items.map { it.userId }.toSet())
        val explicitFalse = grandClient.get("/api/v1/teams/members?view=managed&includeIndirect=false")
            .body<TeamMemberPageResponse>()
        assertEquals(setOf(midId), explicitFalse.items.map { it.userId }.toSet())

        // includeIndirect=true: the indirect report appears, carrying the team held under
        // their own manager.
        val all = grandClient.get("/api/v1/teams/members?view=managed&includeIndirect=true")
            .body<TeamMemberPageResponse>()
        assertEquals(setOf(midId, subId), all.items.map { it.userId }.toSet())
        assertEquals("squad", all.items.single { it.userId == subId }.teamName)
    }

    @Test
    fun `includeIndirect tolerates a management cycle and never lists the caller`() = testApplication {
        usePostgresTestcontainer()
        // A manages a team containing B; B manages a team containing A and C — a cycle A→B→A.
        val aEmail = uniqueEmail("cycle-a")
        val aId = TestUsers.seed(email = aEmail, password = "pw", roles = emptySet())
        val bEmail = uniqueEmail("cycle-b")
        val bId = TestUsers.seed(email = bEmail, password = "pw", roles = emptySet())
        val cId = TestUsers.seed(email = uniqueEmail("cycle-c"), password = "pw", roles = emptySet())

        val aClient = authedClient(aEmail, "pw")
        val bClient = authedClient(bEmail, "pw")
        aClient.createTeam("loop-a", aId, listOf(bId))
        bClient.createTeam("loop-b", bId, listOf(aId, cId))

        val all = aClient.get("/api/v1/teams/members?view=managed&includeIndirect=true")
            .body<TeamMemberPageResponse>()
        // B directly, C via B; A's own membership row in loop-b is excluded (never the caller).
        assertEquals(setOf(bId, cId), all.items.map { it.userId }.toSet())
    }

    @Test
    fun `includeIndirect is rejected for non-managed views and non-boolean values`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("caller")
        TestUsers.seed(email = email, password = "pw")
        val client = authedClient(email, "pw")

        val wrongView = client.get("/api/v1/teams/members?view=member&includeIndirect=true")
        assertEquals(HttpStatusCode.BadRequest, wrongView.status)
        assertEquals(HttpStatusCode.BadRequest.value, wrongView.body<ProblemDetail>().status)

        val badValue = client.get("/api/v1/teams/members?view=managed&includeIndirect=banana")
        assertEquals(HttpStatusCode.BadRequest, badValue.status)
    }

    @Test
    fun `view defaults to member`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", roles = emptySet())
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw")

        authedClient(adminEmail, "pw").createTeam("default-view", managerId, listOf(callerId, xId))

        val page = authedClient(callerEmail, "pw").get("/api/v1/teams/members")
            .body<TeamMemberPageResponse>()
        assertEquals(1L, page.total)
        assertEquals(xId, page.items.single().userId)
    }

    @Test
    fun `a user sharing two teams with the caller appears once per team`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", roles = emptySet())
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        val alpha = admin.createTeam("alpha", managerId, listOf(callerId, xId))
        val beta = admin.createTeam("beta", managerId, listOf(callerId, xId))

        val page = authedClient(callerEmail, "pw").get("/api/v1/teams/members?sort=teamName")
            .body<TeamMemberPageResponse>()
        assertEquals(2L, page.total)
        assertEquals(listOf(xId, xId), page.items.map { it.userId })
        assertEquals(listOf(alpha.id, beta.id), page.items.map { it.teamId })
        assertEquals(listOf("alpha", "beta"), page.items.map { it.teamName })
    }

    @Test
    fun `soft-deleted users and teams are excluded`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", roles = emptySet())
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val keptId = TestUsers.seed(email = uniqueEmail("kept"), password = "pw")
        val doomedUserId = TestUsers.seed(email = uniqueEmail("doomed"), password = "pw")
        val ghostId = TestUsers.seed(email = uniqueEmail("ghost"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("kept-team", managerId, listOf(callerId, keptId, doomedUserId))
        val doomedTeam = admin.createTeam("doomed-team", managerId, listOf(callerId, ghostId))

        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/users/$doomedUserId").status)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/v1/teams/${doomedTeam.id}").status)

        val page = authedClient(callerEmail, "pw").get("/api/v1/teams/members?view=member")
            .body<TeamMemberPageResponse>()
        assertEquals(1L, page.total)
        assertEquals(keptId, page.items.single().userId)
    }

    @Test
    fun `filters match name and email case-insensitively, and teamId exactly`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", roles = emptySet())
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val aliceEmail = uniqueEmail("alice")
        val aliceId = TestUsers.seed(email = aliceEmail, password = "pw", name = "Alice")
        val bobId = TestUsers.seed(email = uniqueEmail("bob"), password = "pw", name = "Bob")

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("Platform", managerId, listOf(callerId, aliceId))
        val support = admin.createTeam("Support", managerId, listOf(callerId, bobId))

        val caller = authedClient(callerEmail, "pw")

        val byName = caller.get("/api/v1/teams/members?name=ALIC").body<TeamMemberPageResponse>()
        assertEquals(listOf(aliceId), byName.items.map { it.userId })

        val byEmail = caller.get("/api/v1/teams/members?email=${aliceEmail.uppercase()}")
            .body<TeamMemberPageResponse>()
        assertEquals(listOf(aliceId), byEmail.items.map { it.userId })

        val byTeam = caller.get("/api/v1/teams/members?teamId=${support.id}").body<TeamMemberPageResponse>()
        assertEquals(listOf(bobId), byTeam.items.map { it.userId })
        assertEquals("Support", byTeam.items.single().teamName)
    }

    @Test
    fun `sort by teamName descending`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", roles = emptySet())
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        listOf("bravo", "alpha", "charlie").forEach { name ->
            admin.createTeam(name, managerId, listOf(callerId, xId))
        }

        val page = authedClient(callerEmail, "pw").get("/api/v1/teams/members?sort=-teamName")
            .body<TeamMemberPageResponse>()
        assertEquals(listOf("charlie", "bravo", "alpha"), page.items.map { it.teamName })
    }

    @Test
    fun `default sort pages stably with pageSize=1`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", roles = emptySet())
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw")
        val yId = TestUsers.seed(email = uniqueEmail("y"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        // x appears twice (two shared teams) — only the teamId tiebreaker keeps its pages stable.
        val t1 = admin.createTeam("one", managerId, listOf(callerId, xId, yId))
        val t2 = admin.createTeam("two", managerId, listOf(callerId, xId))

        val caller = authedClient(callerEmail, "pw")
        val seen = mutableListOf<Pair<UInt, UInt>>()
        for (page in 1..3) {
            val body = caller.get("/api/v1/teams/members?page=$page&pageSize=1").body<TeamMemberPageResponse>()
            assertEquals(3L, body.total)
            assertEquals(page, body.page)
            assertEquals(1, body.pageSize)
            seen += body.items.map { it.userId to it.teamId }
        }
        assertEquals(
            setOf(xId to t1.id, xId to t2.id, yId to t1.id),
            seen.toSet(),
        )
        assertEquals(3, seen.size, "pages must not repeat rows")
    }

    @Test
    fun `unknown view, unknown sort field, and non-numeric teamId return 400`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("caller")
        TestUsers.seed(email = email, password = "pw")
        val client = authedClient(email, "pw")

        val badView = client.get("/api/v1/teams/members?view=bogus")
        assertEquals(HttpStatusCode.BadRequest, badView.status)
        assertEquals(HttpStatusCode.BadRequest.value, badView.body<ProblemDetail>().status)

        val badSort = client.get("/api/v1/teams/members?sort=teamId")
        assertEquals(HttpStatusCode.BadRequest, badSort.status)

        val badTeamId = client.get("/api/v1/teams/members?teamId=abc")
        assertEquals(HttpStatusCode.BadRequest, badTeamId.status)
    }

    @Test
    fun `requires authentication`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().get("/api/v1/teams/members")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `members route does not shadow GET teams by id`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = email, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val client = authedClient(email, "pw")
        val team = client.createTeam("precedence", managerId, listOf(memberA))

        assertEquals(HttpStatusCode.OK, client.get("/api/v1/teams/${team.id}").status)
        assertEquals(HttpStatusCode.OK, client.get("/api/v1/teams/members").status)
    }
}
