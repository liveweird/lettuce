package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.plugins.ApiError
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserResponse
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
            setBody(UserRequest(name = "Alice", age = 30, email = newEmail, password = "secret"))
        }

        assertEquals(HttpStatusCode.Created, response.status)
        val body = response.body<UserResponse>()
        assertEquals("Alice", body.name)
        assertEquals(30, body.age)
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
            setBody(UserRequest(name = "Bob", age = 25, email = newEmail, password = "pw"))
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
    fun `PUT users id updates name age and email`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val client = authedClient(callerEmail, "pw")
        val originalEmail = uniqueEmail("orig")
        val created = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Old", age = 20, email = originalEmail, password = "pw"))
        }.body<UserResponse>()

        val updatedEmail = uniqueEmail("upd")
        val put = client.put("/users/${created.id}") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "New", age = 40, email = updatedEmail, password = "pw"))
        }
        assertEquals(HttpStatusCode.NoContent, put.status)

        val read = client.get("/users/${created.id}").body<UserResponse>()
        assertEquals("New", read.name)
        assertEquals(40, read.age)
        assertEquals(updatedEmail, read.email)
    }

    @Test
    fun `PUT users id on nonexistent id returns 404`() = testApplication {
        usePostgresTestcontainer()
        val callerEmail = uniqueEmail("caller")
        TestUsers.seed(email = callerEmail, password = "pw")

        val response = authedClient(callerEmail, "pw").put("/users/999999") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Ghost", age = 99, email = uniqueEmail("ghost"), password = "pw"))
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
            setBody(UserRequest(name = "Doomed", age = 30, email = uniqueEmail("doomed"), password = "pw"))
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
            setBody(UserRequest(name = "First", age = 30, email = sharedEmail, password = "pw"))
        }
        assertEquals(HttpStatusCode.Created, first.status)

        val second = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Second", age = 30, email = sharedEmail, password = "pw"))
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
            setBody(UserRequest(name = "A", age = 30, email = emailA, password = "pw"))
        }
        val userB = client.post("/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "B", age = 30, email = emailB, password = "pw"))
        }.body<UserResponse>()

        val response = client.put("/users/${userB.id}") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "B", age = 30, email = emailA, password = "pw"))
        }
        assertEquals(HttpStatusCode.Conflict, response.status)
        assertEquals("conflict", response.body<ApiError>().error)
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
            setBody(UserRequest(name = "Eve", age = 33, email = newEmail, password = plainPassword))
        }

        val loginResponse = jsonClient().post("/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(newEmail, plainPassword))
        }
        assertEquals(HttpStatusCode.OK, loginResponse.status)
        assertTrue(loginResponse.body<LoginResponse>().token.isNotBlank())
    }
}
