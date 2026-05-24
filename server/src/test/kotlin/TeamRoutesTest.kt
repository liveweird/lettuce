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
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class TeamRoutesTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"

    private suspend fun ApplicationTestBuilder.authedClient(email: String, password: String): HttpClient {
        val client = jsonClient()
        val token = client.post("/login") {
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
        val createResponse = client.post("/teams") {
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
        assertTrue(location.endsWith("/teams/${created.id}"), "Location was $location")

        val readResponse = client.get("/teams/${created.id}")
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
        val response = client.post("/teams") {
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
        val response = client.post("/teams") {
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
        val team = client.post("/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA, memberB)))
        }.body<TeamResponse>()

        val addResponse = client.put("/teams/${team.id}/members/$memberC")
        assertEquals(HttpStatusCode.NoContent, addResponse.status)
        val afterAdd = client.get("/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberA, memberB, memberC).sorted(), afterAdd.memberIds.sorted())

        val removeResponse = client.delete("/teams/${team.id}/members/$memberA")
        assertEquals(HttpStatusCode.NoContent, removeResponse.status)
        val afterRemove = client.get("/teams/${team.id}").body<TeamResponse>()
        assertEquals(listOf(memberB, memberC).sorted(), afterRemove.memberIds.sorted())

        client.delete("/teams/${team.id}/members/$memberB")
        val lastRemoveResponse = client.delete("/teams/${team.id}/members/$memberC")
        assertEquals(HttpStatusCode.BadRequest, lastRemoveResponse.status)
    }

    @Test
    fun `adding manager as member via sub-resource is rejected`() = testApplication {
        usePostgresTestcontainer()
        val managerEmail = uniqueEmail("mgr")
        val managerId = TestUsers.seed(email = managerEmail, password = "pw")
        val memberA = TestUsers.seed(email = uniqueEmail("a"), password = "pw")

        val client = authedClient(managerEmail, "pw")
        val team = client.post("/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "T", managerId = managerId, memberIds = listOf(memberA)))
        }.body<TeamResponse>()

        val response = client.put("/teams/${team.id}/members/$managerId")
        assertEquals(HttpStatusCode.BadRequest, response.status, response.bodyAsText())
    }
}
