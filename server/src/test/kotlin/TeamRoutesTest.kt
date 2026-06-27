package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.plugins.ApiError
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamPageResponse
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
import io.ktor.client.request.put
import io.ktor.client.request.request
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TeamRoutesTest {

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

    @Test
    fun `create + read round-trip`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")

        val client = authedClient(managerEmail, "pw")
        val createResponse = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Platform", managerId = managerId, memberIds = listOf(memberA, memberB)))
        }
        assertEquals(HttpStatusCode.Created, createResponse.status)
        val created = createResponse.body<TeamResponse>()
        assertEquals("Platform", created.name)
        assertEquals(managerId, created.managerId)
        assertEquals(listOf(memberA, memberB), created.memberIds)
        val location = createResponse.headers[HttpHeaders.Location]
        assertNotNull(location)
        assertTrue(location.endsWith("/api/teams/${created.id}"), "Location was $location")

        val readResponse = client.get("/api/teams/${created.id}")
        assertEquals(HttpStatusCode.OK, readResponse.status)
        val read = readResponse.body<TeamResponse>()
        assertEquals(created, read)
    }

    @Test
    fun `manager cannot be a standard member`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = email, password = "pw")

        val client = authedClient(email, "pw")
        val response = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Bad", managerId = managerId, memberIds = listOf(managerId)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `POST teams accepts an empty member list`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = email, password = "pw")

        val client = authedClient(email, "pw")
        val response = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Empty", managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<TeamResponse>()
        assertTrue(created.memberIds.isEmpty())

        val read = client.get("/api/teams/${created.id}").body<TeamResponse>()
        assertTrue(read.memberIds.isEmpty())
    }

    @Test
    fun `POST teams with only name and managerId succeeds`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = email, password = "pw")

        val client = authedClient(email, "pw")
        // Body deliberately omits memberIds to exercise the Kotlin default.
        val response = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(buildJsonObject {
                put("name", "Minimal")
                put("managerId", managerId.toLong())
            })
        }
        assertEquals(HttpStatusCode.Created, response.status)
        val created = response.body<TeamResponse>()
        assertEquals("Minimal", created.name)
        assertEquals(managerId, created.managerId)
        assertTrue(created.memberIds.isEmpty())
    }

    @Test
    fun `member sub-resource adds and removes members`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")
        val memberC = TestUsers.seed(email = uniqueEmail("c"), password = "pw")

        val client = authedClient(managerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA, memberB)))
        }.body<TeamResponse>()

        val addResponse = client.put("/api/teams/${team.id}/members/$memberC")
        assertEquals(HttpStatusCode.NoContent, addResponse.status)
        val afterAdd = client.get("/api/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberA, memberB, memberC).sorted(), afterAdd.memberIds.sorted())

        val removeResponse = client.delete("/api/teams/${team.id}/members/$memberA")
        assertEquals(HttpStatusCode.NoContent, removeResponse.status)
        val afterRemove = client.get("/api/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberB, memberC).sorted(), afterRemove.memberIds.sorted())

        client.delete("/api/teams/${team.id}/members/$memberB")
        val lastRemoveResponse = client.delete("/api/teams/${team.id}/members/$memberC")
        assertEquals(HttpStatusCode.NoContent, lastRemoveResponse.status)
        val afterAll = client.get("/api/teams/${team.id}").body<TeamResponse>()
        assertTrue(afterAll.memberIds.isEmpty())
    }

    @Test
    fun `adding manager as member via sub-resource is rejected`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(managerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val response = client.put("/api/teams/${team.id}/members/$managerId")
        assertEquals(HttpStatusCode.BadRequest, response.status, response.bodyAsText())
    }

    @Test
    fun `update replaces name, manager, and members`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val mgr1 = TestUsers.seed(email = ownerEmail, password = "pw")
        val mgr2 = TestUsers.seed(email = uniqueEmail("mgr2"), password = "pw")
        val m1 = TestUsers.seed(email = uniqueEmail("m1"), password = "pw")
        val m2 = TestUsers.seed(email = uniqueEmail("m2"), password = "pw")
        val m3 = TestUsers.seed(email = uniqueEmail("m3"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Before", managerId = mgr1, memberIds = listOf(m1, m2)))
        }.body<TeamResponse>()

        val updateResponse = client.put("/api/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "After", managerId = mgr2, memberIds = listOf(m2, m3)))
        }
        assertEquals(HttpStatusCode.NoContent, updateResponse.status)

        val after = client.get("/api/teams/${team.id}").body<TeamResponse>()
        assertEquals("After", after.name)
        assertEquals(mgr2, after.managerId)
        assertEquals(listOf(m2, m3).sorted(), after.memberIds.sorted())
    }

    @Test
    fun `PUT teams accepts an empty member list`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val response = client.put("/api/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.NoContent, response.status)

        val after = client.get("/api/teams/${team.id}").body<TeamResponse>()
        assertTrue(after.memberIds.isEmpty())
    }

    @Test
    fun `update with manager in members is rejected`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val response = client.put("/api/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(managerId, memberA)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `update with duplicate members is rejected`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val response = client.put("/api/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA, memberA, memberB)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `delete removes the team and subsequent GET returns 404`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val deleteResponse = client.delete("/api/teams/${team.id}")
        assertEquals(HttpStatusCode.NoContent, deleteResponse.status)

        val getResponse = client.get("/api/teams/${team.id}")
        assertEquals(HttpStatusCode.NotFound, getResponse.status)
    }

    @Test
    fun `get for nonexistent team returns 404`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        TestUsers.seed(email = ownerEmail, password = "pw")
        val client = authedClient(ownerEmail, "pw")

        val response = client.get("/api/teams/999999")
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `delete of a non-existent team returns 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw") // ADMIN by default
        val client = authedClient(adminEmail, "pw")

        assertEquals(HttpStatusCode.NotFound, client.delete("/api/teams/999999").status)
    }

    @Test
    fun `create with duplicate memberIds is rejected`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val response = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Dup", managerId = managerId, memberIds = listOf(memberA, memberA)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `team endpoints require authentication`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val endpoints = listOf(
            HttpMethod.Post to "/api/teams",
            HttpMethod.Get to "/api/teams/1",
            HttpMethod.Put to "/api/teams/1",
            HttpMethod.Delete to "/api/teams/1",
            HttpMethod.Put to "/api/teams/1/members/2",
            HttpMethod.Delete to "/api/teams/1/members/2",
        )
        for ((verb, path) in endpoints) {
            val response = client.request(path) { method = verb }
            assertEquals(
                HttpStatusCode.Unauthorized,
                response.status,
                "$verb $path expected 401, got ${response.status}",
            )
        }
    }

    @Test
    fun `re-adding an existing member is a no-op`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val first = client.put("/api/teams/${team.id}/members/$memberA")
        assertEquals(HttpStatusCode.NoContent, first.status)
        val second = client.put("/api/teams/${team.id}/members/$memberA")
        assertEquals(HttpStatusCode.NoContent, second.status)

        val after = client.get("/api/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberA), after.memberIds)
    }

    @Test
    fun `soft-deleting a member user preserves the membership row`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA, memberB)))
        }.body<TeamResponse>()

        val deleteUser = client.delete("/api/users/$memberA")
        assertEquals(HttpStatusCode.NoContent, deleteUser.status)

        val after = client.get("/api/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberA, memberB).sorted(), after.memberIds.sorted())
    }

    @Test
    fun `soft-deleting a team manager preserves the team`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/users/$managerId").status)

        val after = client.get("/api/teams/${team.id}").body<TeamResponse>()
        assertEquals(managerId, after.managerId)
    }

    @Test
    fun `GET teams returns paginated envelope with manager names`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw", name = "Mona")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(managerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        repeat(3) { i ->
            client.post("/api/teams") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "list-$tag-$i", managerId = managerId, memberIds = listOf(memberA)))
            }
        }

        val response = client.get("/api/teams?name=list-$tag")
        assertEquals(HttpStatusCode.OK, response.status)
        val page = response.body<TeamPageResponse>()
        assertEquals(1, page.page)
        assertEquals(20, page.pageSize)
        assertEquals(3L, page.total)
        assertEquals(3, page.items.size)
        assertTrue(page.items.all { it.managerId == managerId })
        assertTrue(page.items.all { it.managerName == "Mona" })
        assertTrue(page.items.all { !it.managerDeleted })
    }

    @Test
    fun `GET teams marks managers that have been soft-deleted`() = testApplication {
        usePostgresTestcontainer()
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val adminEmail = uniqueEmail("admin-$tag")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN, name = "Admin-$tag")
        val doomedEmail = uniqueEmail("doomed-$tag")
        val doomedId = TestUsers.seed(email = doomedEmail, password = "pw", name = "Doomed-$tag")
        val survivorEmail = uniqueEmail("alive-$tag")
        val survivorId = TestUsers.seed(email = survivorEmail, password = "pw", name = "Alive-$tag")
        val memberA = TestUsers.seed(email = uniqueEmail("m-$tag"), password = "pw")

        val admin = authedClient(adminEmail, "pw")
        admin.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "team-doomed-$tag", managerId = doomedId, memberIds = listOf(memberA)))
        }
        admin.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "team-alive-$tag", managerId = survivorId, memberIds = listOf(memberA)))
        }

        assertEquals(HttpStatusCode.NoContent, admin.delete("/api/users/$doomedId").status)

        val page = admin.get("/api/teams?name=team-").body<TeamPageResponse>()
        val itemsByName = page.items.associateBy { it.name }
        val doomedTeam = itemsByName["team-doomed-$tag"]
        val aliveTeam = itemsByName["team-alive-$tag"]
        assertEquals("Doomed-$tag", doomedTeam?.managerName)
        assertEquals(true, doomedTeam?.managerDeleted)
        assertEquals("Alive-$tag", aliveTeam?.managerName)
        assertEquals(false, aliveTeam?.managerDeleted)
    }

    @Test
    fun `GET teams supports filter by managerId`() = testApplication {
        usePostgresTestcontainer()
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val ownerEmail = uniqueEmail("owner-$tag")
        val ownerId = TestUsers.seed(email = ownerEmail, password = "pw", name = "Owner-$tag")
        val otherMgrEmail = uniqueEmail("other-$tag")
        val otherMgrId = TestUsers.seed(email = otherMgrEmail, password = "pw", name = "Other-$tag")
        val memberA = TestUsers.seed(email = uniqueEmail("m-$tag"), password = "pw")

        val ownerClient = authedClient(ownerEmail, "pw")
        ownerClient.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "owned-$tag", managerId = ownerId, memberIds = listOf(memberA)))
        }
        val otherClient = authedClient(otherMgrEmail, "pw")
        otherClient.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "other-$tag", managerId = otherMgrId, memberIds = listOf(memberA)))
        }

        val page = ownerClient.get("/api/teams?name=$tag&managerId=$ownerId").body<TeamPageResponse>()
        assertEquals(1L, page.total)
        assertEquals("owned-$tag", page.items.single().name)
        assertEquals(ownerId, page.items.single().managerId)
    }

    @Test
    fun `GET teams supports filter by memberId`() = testApplication {
        usePostgresTestcontainer()
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val adminEmail = uniqueEmail("admin-$tag")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN, name = "Admin-$tag")
        val managerId = TestUsers.seed(email = uniqueEmail("mgr-$tag"), password = "pw", name = "Mgr-$tag")
        val target = TestUsers.seed(email = uniqueEmail("target-$tag"), password = "pw", name = "Target-$tag")
        val other = TestUsers.seed(email = uniqueEmail("other-$tag"), password = "pw", name = "Other-$tag")

        val admin = authedClient(adminEmail, "pw")
        // target IS a member here
        val memberTeam = admin.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "member-$tag", managerId = managerId, memberIds = listOf(target, other)))
        }.body<TeamResponse>()
        // target is NOT a member here
        admin.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "nonmember-$tag", managerId = managerId, memberIds = listOf(other)))
        }
        // target is the MANAGER here, not a member -> must be excluded by memberId filter
        admin.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "managed-$tag", managerId = target, memberIds = listOf(other)))
        }

        val page = admin.get("/api/teams?name=$tag&memberId=$target").body<TeamPageResponse>()
        assertEquals(1L, page.total)
        assertEquals("member-$tag", page.items.single().name)
        assertEquals(memberTeam.id, page.items.single().id)
    }

    @Test
    fun `GET teams with non-numeric memberId returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        TestUsers.seed(email = managerEmail, password = "pw")
        val response = authedClient(managerEmail, "pw").get("/api/teams?memberId=abc")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `GET teams supports sort by name descending`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        listOf("bravo", "alpha", "charlie").forEach { stem ->
            client.post("/api/teams") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "sort-$tag-$stem", managerId = managerId, memberIds = listOf(memberA)))
            }
        }

        val page = client.get("/api/teams?name=sort-$tag&sort=-name").body<TeamPageResponse>()
        assertEquals(
            listOf("sort-$tag-charlie", "sort-$tag-bravo", "sort-$tag-alpha"),
            page.items.map { it.name },
        )
    }

    @Test
    fun `GET teams paginates correctly`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        repeat(5) { i ->
            client.post("/api/teams") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "page-$tag-$i", managerId = managerId, memberIds = listOf(memberA)))
            }
        }

        val pageOne = client.get("/api/teams?name=page-$tag&sort=name&page=1&pageSize=2").body<TeamPageResponse>()
        assertEquals(5L, pageOne.total)
        assertEquals(listOf("page-$tag-0", "page-$tag-1"), pageOne.items.map { it.name })

        val pageTwo = client.get("/api/teams?name=page-$tag&sort=name&page=2&pageSize=2").body<TeamPageResponse>()
        assertEquals(listOf("page-$tag-2", "page-$tag-3"), pageTwo.items.map { it.name })

        val pageThree = client.get("/api/teams?name=page-$tag&sort=name&page=3&pageSize=2").body<TeamPageResponse>()
        assertEquals(listOf("page-$tag-4"), pageThree.items.map { it.name })
    }

    @Test
    fun `GET teams with unknown sort field returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        TestUsers.seed(email = managerEmail, password = "pw")
        val response = authedClient(managerEmail, "pw").get("/api/teams?sort=manager_id")
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals("bad_request", response.body<ApiError>().error)
    }

    @Test
    fun `GET teams with non-numeric managerId returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        TestUsers.seed(email = managerEmail, password = "pw")
        val response = authedClient(managerEmail, "pw").get("/api/teams?managerId=abc")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `GET teams without authentication returns 401`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().get("/api/teams")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `DELETE teams id hides the team from listings`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        val keeper = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "keep-$tag", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()
        val doomed = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "drop-$tag", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val before = client.get("/api/teams?name=$tag").body<TeamPageResponse>()
        assertEquals(2L, before.total)

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/teams/${doomed.id}").status)

        val after = client.get("/api/teams?name=$tag").body<TeamPageResponse>()
        assertEquals(1L, after.total)
        assertEquals(keeper.id, after.items.single().id)

        assertEquals(HttpStatusCode.NotFound, client.get("/api/teams/${doomed.id}").status)
    }

    @Test
    fun `PUT teams id on a soft-deleted team returns 404`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Ephemeral", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/teams/${team.id}").status)

        val put = client.put("/api/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Resurrected", managerId = managerId, memberIds = listOf(memberA)))
        }
        assertEquals(HttpStatusCode.NotFound, put.status)
    }

    @Test
    fun `Member sub-resource on a soft-deleted team returns 404`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")
        val memberB = TestUsers.seed(email = uniqueEmail("b"), password = "pw")
        val client = authedClient(managerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Ghost", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/teams/${team.id}").status)

        val addAfter = client.put("/api/teams/${team.id}/members/$memberB")
        assertEquals(HttpStatusCode.NotFound, addAfter.status)
    }

    @Test
    fun `POST teams with a non-existent manager returns 400`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw") // ADMIN may designate any manager
        val client = authedClient(adminEmail, "pw")

        val response = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Orphan", managerId = 999_999u, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals("bad_request", response.body<ApiError>().error)
    }

    @Test
    fun `POST teams with a non-existent member returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val client = authedClient(managerEmail, "pw")

        val response = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Ghosts", managerId = managerId, memberIds = listOf(999_999u)))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `PUT teams with a non-existent manager returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val client = authedClient(managerEmail, "pw")

        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Platform", managerId = managerId, memberIds = emptyList()))
        }.body<TeamResponse>()

        val response = client.put("/api/teams/${team.id}") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Platform", managerId = 999_999u, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `adding a non-existent user as a member returns 400`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val client = authedClient(managerEmail, "pw")

        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Platform", managerId = managerId, memberIds = emptyList()))
        }.body<TeamResponse>()

        val response = client.put("/api/teams/${team.id}/members/999999")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }
}
