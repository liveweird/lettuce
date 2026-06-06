package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.plugins.ApiError
import ch.nokillswit.users.UserPageResponse
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserResponse
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
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class UserRoutesTest {

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
    fun `POST users creates and returns 201 with Location`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val client = authedClient(callerEmail, "pw")
        val newEmail = uniqueEmail("created")
        val response = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Alice", email = newEmail, password = "secret"))
        }

        assertEquals(HttpStatusCode.Created, response.status)
        val body = response.body<UserResponse>()
        assertEquals("Alice", body.name)
        assertEquals(newEmail, body.email)
        val location = response.headers[HttpHeaders.Location]
        assertNotNull(location)
        assertTrue(location.endsWith("/users/${body.id}"), "Location was $location")
    }

    @Test
    fun `GET users id round-trips a freshly created user`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val client = authedClient(callerEmail, "pw")
        val newEmail = uniqueEmail("bob")
        val created = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Bob", email = newEmail, password = "pw"))
        }.body<UserResponse>()

        val read = client.get("/users/${created.id}")
        assertEquals(HttpStatusCode.OK, read.status)
        assertEquals(created, read.body<UserResponse>())
    }

    @Test
    fun `GET users id on nonexistent id returns 404`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val response = authedClient(callerEmail, "pw").get("/users/999999")
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `PUT users id updates name and email`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val client = authedClient(callerEmail, "pw")
        val originalEmail = uniqueEmail("orig")
        val created = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Old", email = originalEmail, password = "pw"))
        }.body<UserResponse>()

        val updatedEmail = uniqueEmail("upd")
        val put = client.put("/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "New", email = updatedEmail, password = "pw"))
        }
        assertEquals(HttpStatusCode.NoContent, put.status)

        val read = client.get("/users/${created.id}").body<UserResponse>()
        assertEquals("New", read.name)
        assertEquals(updatedEmail, read.email)
    }

    @Test
    fun `PUT users id on nonexistent id returns 404`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val response = authedClient(callerEmail, "pw").put("/users/999999") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Ghost", email = uniqueEmail("ghost"), password = "pw"))
        }
        assertEquals(HttpStatusCode.NotFound, response.status)
    }

    @Test
    fun `DELETE users id removes the user`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val client = authedClient(callerEmail, "pw")
        val created = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Doomed", email = uniqueEmail("doomed"), password = "pw"))
        }.body<UserResponse>()

        val delete = client.delete("/users/${created.id}")
        assertEquals(HttpStatusCode.NoContent, delete.status)

        val read = client.get("/users/${created.id}")
        assertEquals(HttpStatusCode.NotFound, read.status)
    }

    @Test
    fun `user endpoints require authentication`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val endpoints = listOf(
            HttpMethod.Post to "/users",
            HttpMethod.Get to "/users/1",
            HttpMethod.Put to "/users/1",
            HttpMethod.Delete to "/users/1",
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
    fun `POST users with duplicate email returns 409`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val client = authedClient(callerEmail, "pw")
        val sharedEmail = uniqueEmail("dup")
        val first = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "First", email = sharedEmail, password = "pw"))
        }
        assertEquals(HttpStatusCode.Created, first.status)

        val second = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Second", email = sharedEmail, password = "pw"))
        }
        assertEquals(HttpStatusCode.Conflict, second.status)
        assertEquals("conflict", second.body<ApiError>().error)
    }

    @Test
    fun `PUT users id with email already used by another user returns 409`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val client = authedClient(callerEmail, "pw")
        val emailA = uniqueEmail("a")
        val emailB = uniqueEmail("b")
        client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "A", email = emailA, password = "pw"))
        }
        val userB = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "B", email = emailB, password = "pw"))
        }.body<UserResponse>()

        val response = client.put("/users/${userB.id}") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "B", email = emailA, password = "pw"))
        }
        assertEquals(HttpStatusCode.Conflict, response.status)
        assertEquals("conflict", response.body<ApiError>().error)
    }

    @Test
    fun `GET users returns paginated envelope with defaults`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")
        val client = authedClient(callerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        repeat(3) { i ->
            client.post("/users") {
                contentType(ContentType.Application.Json)
                setBody(UserRequest(name = "list-$tag-$i", email = uniqueEmail("list-$tag-$i"), password = "pw"))
            }
        }

        val response = client.get("/users?name=list-$tag")
        assertEquals(HttpStatusCode.OK, response.status)
        val page = response.body<UserPageResponse>()
        assertEquals(1, page.page)
        assertEquals(20, page.pageSize)
        assertEquals(3L, page.total)
        assertEquals(3, page.items.size)
        assertEquals(listOf("list-$tag-0", "list-$tag-1", "list-$tag-2"), page.items.map { it.name })
    }

    @Test
    fun `GET users supports sort by name descending`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")
        val client = authedClient(callerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        listOf("bravo", "alpha", "charlie").forEach { stem ->
            client.post("/users") {
                contentType(ContentType.Application.Json)
                setBody(UserRequest(name = "sort-$tag-$stem", email = uniqueEmail("sort-$tag-$stem"), password = "pw"))
            }
        }

        val response = client.get("/users?name=sort-$tag&sort=-name")
        assertEquals(HttpStatusCode.OK, response.status)
        val page = response.body<UserPageResponse>()
        assertEquals(listOf("sort-$tag-charlie", "sort-$tag-bravo", "sort-$tag-alpha"), page.items.map { it.name })
    }

    @Test
    fun `GET users supports name substring filter case-insensitive`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")
        val client = authedClient(callerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Alicia-$tag", email = uniqueEmail("alicia-$tag"), password = "pw"))
        }
        client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Bob-$tag", email = uniqueEmail("bob-$tag"), password = "pw"))
        }

        val response = client.get("/users?name=ALICIA-$tag")
        val page = response.body<UserPageResponse>()
        assertEquals(1L, page.total)
        assertEquals("Alicia-$tag", page.items.single().name)
    }

    @Test
    fun `GET users supports email substring filter`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")
        val client = authedClient(callerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "X-$tag", email = "match-$tag@example.org", password = "pw"))
        }
        client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Y-$tag", email = "miss-$tag@other.org", password = "pw"))
        }

        val page = client.get("/users?email=match-$tag").body<UserPageResponse>()
        assertEquals(1L, page.total)
        assertEquals("match-$tag@example.org", page.items.single().email)
    }

    @Test
    fun `GET users supports role filter`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")
        val client = authedClient(callerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "role-$tag-admin", email = uniqueEmail("ra-$tag"), password = "pw", role = UserRole.ADMIN))
        }
        client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "role-$tag-user", email = uniqueEmail("ru-$tag"), password = "pw", role = UserRole.USER))
        }

        val admins = client.get("/users?name=role-$tag&role=ADMIN").body<UserPageResponse>()
        assertEquals(1L, admins.total)
        assertEquals(UserRole.ADMIN, admins.items.single().role)

        val users = client.get("/users?name=role-$tag&role=USER").body<UserPageResponse>()
        assertEquals(1L, users.total)
        assertEquals(UserRole.USER, users.items.single().role)
    }

    @Test
    fun `GET users paginates correctly`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")
        val client = authedClient(callerEmail, "pw")
        val tag = UUID.randomUUID().toString().substring(0, 8)
        repeat(5) { i ->
            client.post("/users") {
                contentType(ContentType.Application.Json)
                setBody(UserRequest(name = "page-$tag-$i", email = uniqueEmail("page-$tag-$i"), password = "pw"))
            }
        }

        val pageOne = client.get("/users?name=page-$tag&sort=name&page=1&pageSize=2").body<UserPageResponse>()
        assertEquals(5L, pageOne.total)
        assertEquals(2, pageOne.items.size)
        assertEquals(listOf("page-$tag-0", "page-$tag-1"), pageOne.items.map { it.name })

        val pageTwo = client.get("/users?name=page-$tag&sort=name&page=2&pageSize=2").body<UserPageResponse>()
        assertEquals(listOf("page-$tag-2", "page-$tag-3"), pageTwo.items.map { it.name })

        val pageThree = client.get("/users?name=page-$tag&sort=name&page=3&pageSize=2").body<UserPageResponse>()
        assertEquals(listOf("page-$tag-4"), pageThree.items.map { it.name })
    }

    @Test
    fun `GET users with unknown sort field returns 400`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")
        val response = authedClient(callerEmail, "pw").get("/users?sort=passwordHash")
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals("bad_request", response.body<ApiError>().error)
    }

    @Test
    fun `GET users with bogus role returns 400`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")
        val response = authedClient(callerEmail, "pw").get("/users?role=ROOT")
        assertEquals(HttpStatusCode.BadRequest, response.status)
        assertEquals("bad_request", response.body<ApiError>().error)
    }

    @Test
    fun `GET users with pageSize over max returns 400`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")
        val response = authedClient(callerEmail, "pw").get("/users?pageSize=200")
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `GET users without authentication returns 401`() = testApplication {
        usePostgresTestcontainer()
        val response = jsonClient().get("/users")
        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `POST users stores hashed password verifiable via login`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val client = authedClient(callerEmail, "pw")
        val newEmail = uniqueEmail("login-me")
        val plainPassword = "correct-horse-battery-staple"
        client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Eve", email = newEmail, password = plainPassword))
        }

        val loginResponse = jsonClient().post("/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(newEmail, plainPassword))
        }
        assertEquals(HttpStatusCode.OK, loginResponse.status)
        assertTrue(loginResponse.body<LoginResponse>().token.isNotBlank())
    }
}
