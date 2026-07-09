package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.auth.RefreshRequest
import ch.nokillswit.users.PasswordUpdateRequest
import ch.nokillswit.users.UserRole
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import io.ktor.client.call.body
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Hardened password change (users/UserRoutes.kt): minimum length, current-password verification
 * for self-changes, and refresh-token invalidation via users.password_changed_at (auth/AuthRoutes.kt).
 */
class PasswordChangeTest {


    private suspend fun login(client: HttpClient, email: String, password: String): LoginResponse =
        client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }.body()

    private suspend fun putPassword(
        client: HttpClient,
        token: String,
        userId: UInt,
        body: PasswordUpdateRequest,
    ) = client.put("/api/v1/users/$userId/password") {
        header(HttpHeaders.Authorization, "Bearer $token")
        contentType(ContentType.Application.Json)
        setBody(body)
    }

    @Test
    fun `wrong current password wins over a too-short new password`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("order")
        val userId = TestUsers.seed(email = email, password = "old-password", role = UserRole.USER)
        val client = jsonClient()
        val token = login(client, email, "old-password").token

        // Both violations at once: the 403 (wrong current password) must win over the 400
        // (too-short new password) — authz before validation, like everywhere else.
        val response = putPassword(
            client, token, userId,
            PasswordUpdateRequest(password = "short", currentPassword = "not-it"),
        )
        assertEquals(HttpStatusCode.Forbidden, response.status)
    }

    @Test
    fun `self-change without or with a wrong current password is 403 and changes nothing`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("self")
        val userId = TestUsers.seed(email = email, password = "old-password", role = UserRole.USER)
        val client = jsonClient()
        val token = login(client, email, "old-password").token

        val without = putPassword(client, token, userId, PasswordUpdateRequest(password = "new-password-1"))
        assertEquals(HttpStatusCode.Forbidden, without.status)

        val wrong = putPassword(
            client, token, userId,
            PasswordUpdateRequest(password = "new-password-1", currentPassword = "not-it"),
        )
        assertEquals(HttpStatusCode.Forbidden, wrong.status)

        // The old password still logs in — nothing was mutated.
        assertEquals(HttpStatusCode.OK, client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, "old-password"))
        }.status)
    }

    @Test
    fun `a new password shorter than 10 characters is rejected with 400`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("short")
        val userId = TestUsers.seed(email = email, password = "old-password", role = UserRole.USER)
        val client = jsonClient()
        val token = login(client, email, "old-password").token

        val response = putPassword(
            client, token, userId,
            PasswordUpdateRequest(password = "tiny", currentPassword = "old-password"),
        )
        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `a successful self-change invalidates outstanding refresh tokens`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("revoke")
        val userId = TestUsers.seed(email = email, password = "old-password", role = UserRole.USER)
        val client = jsonClient()
        val session = login(client, email, "old-password")

        // JWT iat has second precision, so the revocation cut-off is compared at second
        // granularity — step past the mint second to make the pre/post distinction deterministic.
        kotlinx.coroutines.delay(1100)

        val change = putPassword(
            client, session.token, userId,
            PasswordUpdateRequest(password = "brand-new-password", currentPassword = "old-password"),
        )
        assertEquals(HttpStatusCode.NoContent, change.status)

        // The pre-change refresh token is dead…
        val refreshed = client.post("/api/v1/refresh") {
            contentType(ContentType.Application.Json)
            setBody(RefreshRequest(session.refreshToken))
        }
        assertEquals(HttpStatusCode.Unauthorized, refreshed.status)

        // …the pre-change ACCESS token keeps working until its own (short) expiry — the
        // documented bounded window…
        val stillAuthed = client.get("/api/v1/users/$userId") {
            header(HttpHeaders.Authorization, "Bearer ${session.token}")
        }
        assertEquals(HttpStatusCode.OK, stillAuthed.status)

        // …and a fresh login with the new password mints a working new pair.
        val relogin = login(client, email, "brand-new-password")
        val newRefresh = client.post("/api/v1/refresh") {
            contentType(ContentType.Application.Json)
            setBody(RefreshRequest(relogin.refreshToken))
        }
        assertEquals(HttpStatusCode.OK, newRefresh.status)
    }

    @Test
    fun `an admin resets another user's password without the current one`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        TestUsers.seed(email = adminEmail, password = "admin-pw", role = UserRole.ADMIN)
        val targetEmail = uniqueEmail("target")
        val targetId = TestUsers.seed(email = targetEmail, password = "old-password", role = UserRole.USER)
        val client = jsonClient()
        val adminToken = login(client, adminEmail, "admin-pw").token

        val reset = putPassword(client, adminToken, targetId, PasswordUpdateRequest(password = "admin-set-pass-1"))
        assertEquals(HttpStatusCode.NoContent, reset.status)

        assertEquals(HttpStatusCode.OK, client.post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(targetEmail, "admin-set-pass-1"))
        }.status)
    }

    @Test
    fun `an admin changing their OWN password still needs the current one`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin-self")
        val adminId = TestUsers.seed(email = adminEmail, password = "admin-pw", role = UserRole.ADMIN)
        val client = jsonClient()
        val token = login(client, adminEmail, "admin-pw").token

        val without = putPassword(client, token, adminId, PasswordUpdateRequest(password = "new-admin-pass-1"))
        assertEquals(HttpStatusCode.Forbidden, without.status)

        val with = putPassword(
            client, token, adminId,
            PasswordUpdateRequest(password = "new-admin-pass-1", currentPassword = "admin-pw"),
        )
        assertEquals(HttpStatusCode.NoContent, with.status)
    }
}
