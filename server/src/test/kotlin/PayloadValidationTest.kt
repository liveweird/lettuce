package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.teams.Team
import ch.nokillswit.templates.Template
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserUpdateRequest
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Up-front payload validation (400 + ProblemDetail) instead of DB-level failures (500):
 * blank/oversized names and emails, and the password minimum on user creation.
 */
class PayloadValidationTest {


    private suspend fun ApplicationTestBuilder.adminClient(): HttpClient {
        val email = uniqueEmail("admin")
        TestUsers.seed(email = email, password = "pw-123456789", role = UserRole.ADMIN)
        val base = jsonClient()
        val token = base.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw-123456789"))
        }.body<LoginResponse>().token
        return createClient {
            install(ContentNegotiation) { json(); json(contentType = ContentType.parse("application/problem+json")) }
            install(DefaultRequest) { header(HttpHeaders.Authorization, "Bearer $token") }
        }
    }

    @Test
    fun `user create rejects blank and oversized fields and short passwords with 400`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()

        suspend fun createStatus(name: String, email: String, password: String): HttpStatusCode =
            client.post("/api/v1/users") {
                contentType(ContentType.Application.Json)
                setBody(UserRequest(name = name, email = email, password = password))
            }.status

        assertEquals(HttpStatusCode.BadRequest, createStatus("  ", uniqueEmail("u"), "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("x".repeat(51), uniqueEmail("u"), "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", " ", "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", "a".repeat(255) + "@x", "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", "no-at-sign.example", "pw-123456789"))
        assertEquals(HttpStatusCode.BadRequest, createStatus("Ok", uniqueEmail("u"), "short"))
        // Control: a valid payload passes.
        assertEquals(HttpStatusCode.Created, createStatus("Ok", uniqueEmail("u"), "pw-123456789"))
    }

    @Test
    fun `user update applies the same name and email checks`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        val id = TestUsers.seed(email = uniqueEmail("target"), password = "pw-123456789")

        val response = client.put("/api/v1/users/$id") {
            contentType(ContentType.Application.Json)
            setBody(UserUpdateRequest(name = "x".repeat(51), email = uniqueEmail("t"), role = UserRole.USER))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `team create and update reject blank or oversized names with 400`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw-123456789")

        val blank = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "  ", managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, blank.status)

        val oversized = client.post("/api/v1/teams") {
            contentType(ContentType.Application.Json)
            setBody(Team(name = "x".repeat(101), managerId = managerId, memberIds = emptyList()))
        }
        assertEquals(HttpStatusCode.BadRequest, oversized.status)
    }

    @Test
    fun `template create rejects blank or oversized names with 400`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()

        val blank = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = " ", content = "body"))
        }
        assertEquals(HttpStatusCode.BadRequest, blank.status)

        val oversized = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = "x".repeat(101), content = "body"))
        }
        assertEquals(HttpStatusCode.BadRequest, oversized.status)
    }
}
