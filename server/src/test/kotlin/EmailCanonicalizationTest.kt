package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.users.UserImportRequest
import ch.nokillswit.users.UserImportResponse
import ch.nokillswit.users.UserImportStatus
import ch.nokillswit.users.UserRequest
import ch.nokillswit.users.UserResponse
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Canonical email identity (v2.35.0, monkey-test MT-001): every entry point folds the email
 * to lower(trim(...)) — create, update, import, login, password reset, lookup — so one
 * mailbox is one account. Before this, `ADMIN@x` created a second active account beside
 * `admin@x` and a padded/case-variant login answered "unknown email" while still feeding the
 * (already-folded) lockout bucket.
 */
class EmailCanonicalizationTest {

    private suspend fun ApplicationTestBuilder.adminClient(): HttpClient {
        val email = uniqueEmail("admin")
        TestUsers.seed(email = email, password = "pw-123456789", roles = setOf(UserRole.ADMIN))
        val base = jsonClient()
        val token = base.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "pw-123456789"))
        }.body<LoginResponse>().token
        return createClient {
            lettuceTestClientDefaults()
            install(DefaultRequest) { header(HttpHeaders.Authorization, "Bearer $token") }
        }
    }

    @Test
    fun `create folds the email and a case-variant duplicate is a 409`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        val local = "canon-${java.util.UUID.randomUUID()}"

        val created = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Canon One", email = "  ${local.uppercase()}@Test  ", password = "pw-123456789"))
        }
        assertEquals(HttpStatusCode.Created, created.status)
        assertEquals("$local@test", created.body<UserResponse>().email)

        // The SAME mailbox in different casing is the same identity now — 409, not a second
        // active account (the pre-v2.35.0 behavior the monkey test demonstrated).
        val duplicate = client.post("/api/v1/users") {
            contentType(ContentType.Application.Json)
            setBody(UserRequest(name = "Canon Two", email = "${local.uppercase()}@TEST", password = "pw-123456789"))
        }
        assertEquals(HttpStatusCode.Conflict, duplicate.status)
    }

    @Test
    fun `login folds the submitted email to its account`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("fold")
        TestUsers.seed(email = email, password = "pw-123456789")

        val login = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest("  ${email.uppercase()}  ", "pw-123456789"))
        }
        assertEquals(HttpStatusCode.OK, login.status)
    }

    @Test
    fun `the CSV import stores the folded email`() = testApplication {
        usePostgresTestcontainer()
        val client = adminClient()
        val local = "import-canon-${java.util.UUID.randomUUID()}"

        val response = client.post("/api/v1/users/import") {
            contentType(ContentType.Application.Json)
            setBody(UserImportRequest(csv = "Import Canon, ${local.uppercase()}@Test "))
        }
        assertEquals(HttpStatusCode.OK, response.status)
        val row = response.body<UserImportResponse>().rows.single()
        assertEquals(UserImportStatus.CREATED, row.status)
        assertEquals("$local@test", row.email)

        // The imported account is reachable under the canonical identity.
        val login = jsonClient().post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest("$local@test", row.password!!))
        }
        assertEquals(HttpStatusCode.OK, login.status)
    }
}
