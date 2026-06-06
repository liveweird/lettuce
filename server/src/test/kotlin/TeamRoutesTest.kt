package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamResponse
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
import kotlin.test.assertNotEquals
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
    fun `empty member list is rejected`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = email, password = "pw")

        val client = authedClient(email, "pw")
        val response = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "Empty", managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
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
        assertEquals(HttpStatusCode.BadRequest, lastRemoveResponse.status)
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
    fun `update with empty members is rejected`() = testApplication {
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
        assertEquals(HttpStatusCode.BadRequest, response.status)
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
    fun `deleting a member user cascades the membership row`() = testApplication {
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
        assertEquals(listOf(memberB), after.memberIds)
    }

    @Test
    fun `deleting a user who manages a team is rejected`() = testApplication {
        usePostgresTestcontainer()
        val ownerEmail = uniqueEmail("owner")
        val managerId = TestUsers.seed(email = ownerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(ownerEmail, "pw")
        val team = client.post("/api/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val blocked = client.delete("/api/users/$managerId")
        assertNotEquals(HttpStatusCode.NoContent, blocked.status)

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/teams/${team.id}").status)
        assertEquals(HttpStatusCode.NoContent, client.delete("/api/users/$managerId").status)
    }
}
