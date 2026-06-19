package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.templates.Template
import ch.nokillswit.templates.TemplatePageResponse
import ch.nokillswit.templates.TemplateResponse
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

class TemplateTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"
    private fun uniqueName(prefix: String) = "$prefix-${UUID.randomUUID()}"

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
    fun `admin can create, read, list, update and delete a template`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val name = uniqueName("welcome")
        val created = client.post("/api/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "Line one\nLine two"))
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val body = created.body<TemplateResponse>()
        assertEquals(name, body.name)
        assertEquals("Line one\nLine two", body.content)

        val fetched = client.get("/api/templates/${body.id}")
        assertEquals(HttpStatusCode.OK, fetched.status)
        assertEquals(name, fetched.body<TemplateResponse>().name)

        val listed = client.get("/api/templates?name=$name").body<TemplatePageResponse>()
        assertEquals(1, listed.items.count { it.id == body.id })

        val updated = client.put("/api/templates/${body.id}") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "Updated"))
        }
        assertEquals(HttpStatusCode.NoContent, updated.status)
        assertEquals("Updated", client.get("/api/templates/${body.id}").body<TemplateResponse>().content)

        val deleted = client.delete("/api/templates/${body.id}")
        assertEquals(HttpStatusCode.NoContent, deleted.status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/templates/${body.id}").status)
    }

    @Test
    fun `duplicate name returns 409`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val name = uniqueName("dupe")
        val first = client.post("/api/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "first"))
        }
        assertEquals(HttpStatusCode.Created, first.status)

        val second = client.post("/api/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "second"))
        }
        assertEquals(HttpStatusCode.Conflict, second.status)
    }

    @Test
    fun `blank name returns 400`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val response = client.post("/api/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = "   ", content = "x"))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `unauthenticated requests return 401`() = testApplication {
        usePostgresTestcontainer()
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/templates").status)
    }

    @Test
    fun `non-admin may read and list but not write`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val userEmail = uniqueEmail("user")
        TestUsers.seed(email = userEmail, password = "pw", role = UserRole.USER)

        val adminClient = authedClient(adminEmail, "pw")
        val userClient = authedClient(userEmail, "pw")

        val name = uniqueName("shared")
        val created = adminClient.post("/api/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "body"))
        }.body<TemplateResponse>()

        // Reads are allowed for any authenticated user.
        assertEquals(HttpStatusCode.OK, userClient.get("/api/templates").status)
        assertEquals(HttpStatusCode.OK, userClient.get("/api/templates/${created.id}").status)

        // Writes are ADMIN-only.
        assertEquals(
            HttpStatusCode.Forbidden,
            userClient.post("/api/templates") {
                contentType(ContentType.Application.Json)
                setBody(Template(name = uniqueName("sneaky"), content = "x"))
            }.status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            userClient.put("/api/templates/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(Template(name = name, content = "hijack"))
            }.status,
        )
        assertEquals(HttpStatusCode.Forbidden, userClient.delete("/api/templates/${created.id}").status)
    }
}
