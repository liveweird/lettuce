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
import kotlin.test.assertTrue

class TemplateTest {

    private fun uniqueEmail(prefix: String) = "$prefix-${UUID.randomUUID()}@test"
    private fun uniqueName(prefix: String) = "$prefix-${UUID.randomUUID()}"

    private suspend fun ApplicationTestBuilder.authedClient(email: String, password: String): HttpClient {
        val client = jsonClient()
        val token = client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body<LoginResponse>().token
        return createClient {
            install(ContentNegotiation) { json(); json(contentType = ContentType.parse("application/problem+json")) }
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
        val created = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "Line one\nLine two"))
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val body = created.body<TemplateResponse>()
        assertEquals(name, body.name)
        assertEquals("Line one\nLine two", body.content)

        val fetched = client.get("/api/v1/templates/${body.id}")
        assertEquals(HttpStatusCode.OK, fetched.status)
        assertEquals(name, fetched.body<TemplateResponse>().name)

        val listed = client.get("/api/v1/templates?name=$name").body<TemplatePageResponse>()
        assertEquals(1, listed.items.count { it.id == body.id })

        val updated = client.put("/api/v1/templates/${body.id}") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "Updated"))
        }
        assertEquals(HttpStatusCode.NoContent, updated.status)
        assertEquals("Updated", client.get("/api/v1/templates/${body.id}").body<TemplateResponse>().content)

        val deleted = client.delete("/api/v1/templates/${body.id}")
        assertEquals(HttpStatusCode.NoContent, deleted.status)
        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/templates/${body.id}").status)
    }

    @Test
    fun `duplicate name returns 409`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val name = uniqueName("dupe")
        val first = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "first"))
        }
        assertEquals(HttpStatusCode.Created, first.status)

        val second = client.post("/api/v1/templates") {
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

        val response = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = "   ", content = "x"))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `unauthenticated requests return 401`() = testApplication {
        usePostgresTestcontainer()
        assertEquals(HttpStatusCode.Unauthorized, jsonClient().get("/api/v1/templates").status)
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
        val created = adminClient.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "body"))
        }.body<TemplateResponse>()

        // Reads are allowed for any authenticated user.
        assertEquals(HttpStatusCode.OK, userClient.get("/api/v1/templates").status)
        assertEquals(HttpStatusCode.OK, userClient.get("/api/v1/templates/${created.id}").status)

        // Writes are ADMIN-only.
        assertEquals(
            HttpStatusCode.Forbidden,
            userClient.post("/api/v1/templates") {
                contentType(ContentType.Application.Json)
                setBody(Template(name = uniqueName("sneaky"), content = "x"))
            }.status,
        )
        assertEquals(
            HttpStatusCode.Forbidden,
            userClient.put("/api/v1/templates/${created.id}") {
                contentType(ContentType.Application.Json)
                setBody(Template(name = name, content = "hijack"))
            }.status,
        )
        assertEquals(HttpStatusCode.Forbidden, userClient.delete("/api/v1/templates/${created.id}").status)
    }

    // The test DB is shared across tests, so list assertions scope themselves to a
    // unique name prefix and always filter by it — that isolates a test's own rows
    // and doubles as coverage of the name filter.
    private suspend fun HttpClient.createTemplate(name: String, content: String = "") {
        val res = post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = content))
        }
        assertEquals(HttpStatusCode.Created, res.status, "seed create '$name'")
    }

    @Test
    fun `list filters by name and paginates with a stable envelope`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val prefix = uniqueName("page")
        client.createTemplate("$prefix-a")
        client.createTemplate("$prefix-b")
        client.createTemplate("$prefix-c")

        val first = client.get("/api/v1/templates?name=$prefix&sort=name&page=1&pageSize=2")
            .body<TemplatePageResponse>()
        assertEquals(1, first.page)
        assertEquals(2, first.pageSize)
        assertEquals(3, first.total)
        assertEquals(listOf("$prefix-a", "$prefix-b"), first.items.map { it.name })

        val second = client.get("/api/v1/templates?name=$prefix&sort=name&page=2&pageSize=2")
            .body<TemplatePageResponse>()
        assertEquals(3, second.total)
        assertEquals(listOf("$prefix-c"), second.items.map { it.name })

        // Pages do not overlap.
        val firstIds = first.items.map { it.id }.toSet()
        assertTrue(second.items.none { it.id in firstIds })
    }

    @Test
    fun `list sorts by name descending`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val prefix = uniqueName("sort")
        client.createTemplate("$prefix-a")
        client.createTemplate("$prefix-b")
        client.createTemplate("$prefix-c")

        val desc = client.get("/api/v1/templates?name=$prefix&sort=-name").body<TemplatePageResponse>()
        assertEquals(listOf("$prefix-c", "$prefix-b", "$prefix-a"), desc.items.map { it.name })
    }

    @Test
    fun `list name filter is case-insensitive substring and escapes wildcards`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val prefix = uniqueName("ci")
        client.createTemplate("$prefix-WELCOME")

        // Lowercase substring of an uppercase name matches (case-insensitive contains).
        val ci = client.get("/api/v1/templates?name=$prefix-wel").body<TemplatePageResponse>()
        assertEquals(listOf("$prefix-WELCOME"), ci.items.map { it.name })

        // `_` is a SQL LIKE wildcard but must be escaped to a literal: a query with `_`
        // matches only the literal underscore name, not the same string with another char.
        client.createTemplate("$prefix-a_b")
        client.createTemplate("$prefix-axb")
        val literal = client.get("/api/v1/templates?name=$prefix-a_b").body<TemplatePageResponse>()
        assertEquals(listOf("$prefix-a_b"), literal.items.map { it.name })
    }

    @Test
    fun `list caps contentPreview at 200 characters`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val longName = uniqueName("long")
        client.createTemplate(longName, content = "x".repeat(250))
        val longItem = client.get("/api/v1/templates?name=$longName").body<TemplatePageResponse>().items.single()
        assertEquals(200, longItem.contentPreview.length)

        val shortName = uniqueName("short")
        client.createTemplate(shortName, content = "hello")
        val shortItem = client.get("/api/v1/templates?name=$shortName").body<TemplatePageResponse>().items.single()
        assertEquals("hello", shortItem.contentPreview)
    }

    @Test
    fun `list rejects malformed query parameters`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/templates?page=0").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/templates?pageSize=101").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/templates?pageSize=abc").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/templates?sort=content").status)
        // Paging boundary: pageSize must be >= 1, and an empty comma-segment in sort is rejected.
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/templates?pageSize=0").status)
        assertEquals(HttpStatusCode.BadRequest, client.get("/api/v1/templates?sort=,name").status)
    }

    @Test
    fun `update to a name already used by another template returns 409`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val nameA = uniqueName("a")
        val nameB = uniqueName("b")
        client.createTemplate(nameA)
        val b = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = nameB, content = "x"))
        }.body<TemplateResponse>()

        val response = client.put("/api/v1/templates/${b.id}") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = nameA, content = "x"))
        }
        assertEquals(HttpStatusCode.Conflict, response.status)
    }

    @Test
    fun `update to a blank name returns 400`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val created = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = uniqueName("ok"), content = "x"))
        }.body<TemplateResponse>()

        val response = client.put("/api/v1/templates/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = "   ", content = "x"))
        }
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `delete of a non-existent template returns 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        // Deleting a row that does not exist reports 404 (consistent across resources).
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/templates/999999").status)
    }

    @Test
    fun `list returns an empty envelope when nothing matches`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val page = client.get("/api/v1/templates?name=${uniqueName("none")}").body<TemplatePageResponse>()
        assertEquals(0, page.total)
        assertTrue(page.items.isEmpty())
    }

    @Test
    fun `update of a non-existent template returns 404`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val response = client.put("/api/v1/templates/999999") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = uniqueName("ghost"), content = "x"))
        }
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `soft-deleted template is invisible to read, update, delete and list`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val name = uniqueName("doomed")
        val created = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "body"))
        }.body<TemplateResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/templates/${created.id}").status)

        // Every access path now treats the soft-deleted row as gone.
        assertEquals(HttpStatusCode.NotFound, client.get("/api/v1/templates/${created.id}").status)
        val put = client.put("/api/v1/templates/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "edited"))
        }
        assertEquals(HttpStatusCode.NotFound, put.status)
        // Idempotent: a second delete finds no active row → 404.
        assertEquals(HttpStatusCode.NotFound, client.delete("/api/v1/templates/${created.id}").status)
        // The list (filtered to this unique name) no longer returns it.
        val page = client.get("/api/v1/templates?name=$name").body<TemplatePageResponse>()
        assertEquals(0, page.total)
        assertTrue(page.items.isEmpty())
    }

    @Test
    fun `a soft-deleted template's name can be reused`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val name = uniqueName("reusable")
        val first = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "first"))
        }.body<TemplateResponse>()

        assertEquals(HttpStatusCode.NoContent, client.delete("/api/v1/templates/${first.id}").status)

        // The partial unique index only constrains active rows, so the name is free again.
        val second = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = name, content = "second"))
        }
        assertEquals(HttpStatusCode.Created, second.status)
        val recreated = second.body<TemplateResponse>()
        assertTrue(recreated.id != first.id)
        assertEquals("second", client.get("/api/v1/templates/${recreated.id}").body<TemplateResponse>().content)
    }

    @Test
    fun `create sets a Location header pointing at the new template`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "pw", role = UserRole.ADMIN)
        val client = authedClient(adminEmail, "pw")

        val created = client.post("/api/v1/templates") {
            contentType(ContentType.Application.Json)
            setBody(Template(name = uniqueName("loc"), content = "x"))
        }
        assertEquals(HttpStatusCode.Created, created.status)
        val id = created.body<TemplateResponse>().id
        assertEquals("/api/v1/templates/$id", created.headers[HttpHeaders.Location])
    }
}
