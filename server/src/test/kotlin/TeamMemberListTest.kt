package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.plugins.ApiError
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamMemberPageResponse
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.serialization.kotlinx.json.json
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TeamMemberListTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private suspend fun ApplicationTestBuilder.authedClient(email: String, password: String): HttpClient {
        val client = jsonClient()
        val token = client.post("/api/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body<LoginResponse>().token
        return createClient {
            install(ContentNegotiation) { json() }
            install(DefaultRequest) {
                header(HttpHeaders.Authorization, "Bearer $token")
            }
        }
    }

    private suspend fun HttpClient.createTeam(name: String, managerId: UInt, memberIds: List<UInt>): TeamResponse =
        post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = name, managerId = managerId, memberIds = memberIds))
        }.body<TeamResponse>()

    @Test
    fun `view=member returns co-members only, excluding caller and manager`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", name = "Caller", role = UserRole.USER)
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", name = "Manager")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw", name = "Xavier")
        val yId = TestUsers.seed(email = uniqueEmail("y"), password = "pw", name = "Yolanda")
        val zId = TestUsers.seed(email = uniqueEmail("z"), password = "pw", name = "Zoe")

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("shared", managerId, listOf(callerId, xId, yId))
        // A team the caller is not in — its members must not appear.
        admin.createTeam("unrelated", managerId, listOf(zId))

        val page = authedClient(callerEmail, "pw").get("/api/teams/members?view=member")
            .body<TeamMemberPageResponse>()
        assertEquals(2L, page.total)
        assertEquals(setOf(xId, yId), page.items.map { it.userId }.toSet())
        assertTrue(page.items.all { it.teamName == "shared" })
    }

    @Test
    fun `view=managed returns members of managed teams only`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val otherMgrId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw")
        val zId = TestUsers.seed(email = uniqueEmail("z"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("managed-by-caller", callerId, listOf(xId, zId))
        // Caller is merely a member here; it must not contribute to view=managed.
        admin.createTeam("membership-only", otherMgrId, listOf(callerId, xId))

        val page = authedClient(callerEmail, "pw").get("/api/teams/members?view=managed")
            .body<TeamMemberPageResponse>()
        assertEquals(2L, page.total)
        assertEquals(setOf(xId, zId), page.items.map { it.userId }.toSet())
        assertTrue(page.items.all { it.teamName == "managed-by-caller" })
    }

    @Test
    fun `view defaults to member`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw")

        authedClient(adminEmail, "pw").createTeam("default-view", managerId, listOf(callerId, xId))

        val page = authedClient(callerEmail, "pw").get("/api/teams/members")
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
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        val alpha = admin.createTeam("alpha", managerId, listOf(callerId, xId))
        val beta = admin.createTeam("beta", managerId, listOf(callerId, xId))

        val page = authedClient(callerEmail, "pw").get("/api/teams/members?sort=teamName")
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
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val keptId = TestUsers.seed(email = uniqueEmail("kept"), password = "pw")
        val doomedUserId = TestUsers.seed(email = uniqueEmail("doomed"), password = "pw")
        val ghostId = TestUsers.seed(email = uniqueEmail("ghost"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("kept-team", managerId, listOf(callerId, keptId, doomedUserId))
        val doomedTeam = admin.createTeam("doomed-team", managerId, listOf(callerId, ghostId))

        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/users/$doomedUserId").status)
        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/teams/${doomedTeam.id}").status)

        val page = authedClient(callerEmail, "pw").get("/api/teams/members?view=member")
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
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val aliceEmail = uniqueEmail("alice")
        val aliceId = TestUsers.seed(email = aliceEmail, password = "pw", name = "Alice")
        val bobId = TestUsers.seed(email = uniqueEmail("bob"), password = "pw", name = "Bob")

        val admin = authedClient(adminEmail, "pw")
        admin.createTeam("Platform", managerId, listOf(callerId, aliceId))
        val support = admin.createTeam("Support", managerId, listOf(callerId, bobId))

        val caller = authedClient(callerEmail, "pw")

        val byName = caller.get("/api/teams/members?name=ALIC").body<TeamMemberPageResponse>()
        assertEquals(listOf(aliceId), byName.items.map { it.userId })

        val byEmail = caller.get("/api/teams/members?email=${aliceEmail.uppercase()}")
            .body<TeamMemberPageResponse>()
        assertEquals(listOf(aliceId), byEmail.items.map { it.userId })

        val byTeam = caller.get("/api/teams/members?teamId=${support.id}").body<TeamMemberPageResponse>()
        assertEquals(listOf(bobId), byTeam.items.map { it.userId })
        assertEquals("Support", byTeam.items.single().teamName)
    }

    @Test
    fun `sort by teamName descending`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw")
        val xId = TestUsers.seed(email = uniqueEmail("x"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        listOf("bravo", "alpha", "charlie").forEach { name ->
            admin.createTeam(name, managerId, listOf(callerId, xId))
        }

        val page = authedClient(callerEmail, "pw").get("/api/teams/members?sort=-teamName")
            .body<TeamMemberPageResponse>()
        assertEquals(listOf("charlie", "bravo", "alpha"), page.items.map { it.teamName })
    }

    @Test
    fun `default sort pages stably with pageSize=1`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw")
        val callerEmail = uniqueEmail("caller")
        val callerId = TestUsers.seed(email = callerEmail, password = "pw", role = UserRole.USER)
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
            val body = caller.get("/api/teams/members?page=$page&pageSize=1").body<TeamMemberPageResponse>()
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

        val badView = client.get("/api/teams/members?view=bogus")
        assertEquals(HttpStatusCode.BadRequest, badView.status)
        assertEquals("bad_request", badView.body<ApiError>().error)

        val badSort = client.get("/api/teams/members?sort=teamId")
        assertEquals(HttpStatusCode.BadRequest, badSort.status)

        val badTeamId = client.get("/api/teams/members?teamId=abc")
        assertEquals(HttpStatusCode.BadRequest, badTeamId.status)
    }

    @Test
    fun `requires authentication`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().get("/api/teams/members")
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

        assertEquals(HttpStatusCode.OK, client.get("/api/teams/${team.id}").status)
        assertEquals(HttpStatusCode.OK, client.get("/api/teams/members").status)
    }
}
