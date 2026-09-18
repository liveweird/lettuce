package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.auth.MfaChallengeResponse
import ch.nokillswit.auth.MfaVerifyRequest
import ch.nokillswit.auth.PasswordResetRequest
import ch.nokillswit.users.UserFeaturesUpdateRequest
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.TestApplication
import kotlinx.coroutines.runBlocking
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull

/**
 * V81 moved the login lockout, the password-reset throttle, and the MFA challenge store from
 * per-instance in-memory maps into Postgres — the whole point being that replicas SHARE the
 * state. These tests prove that directly: two independent [TestApplication] instances are
 * booted over the same shared Testcontainers Postgres (simulating two replicas behind a load
 * balancer, the way `k8s/templates/app-deployment.yaml` could one day run more than one pod),
 * and state written through instance A must be visible through instance B. The single-instance
 * behavior of each store is already pinned by LoginLockoutTest/MfaLoginTest/PasswordResetTest —
 * this file only adds the cross-instance dimension those cannot express.
 */
class AuthStateAcrossInstancesTest {

    private suspend fun HttpClient.login(email: String, password: String): HttpResponse =
        post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, password))
        }

    @Test
    fun `a lockout tripped via one instance is enforced via another`(): Unit = runBlocking {
        val appA = TestApplication {
            configureApp("security.lockout.threshold" to "3", "security.lockout.durationSeconds" to "60")
        }
        val appB = TestApplication {
            configureApp("security.lockout.threshold" to "3", "security.lockout.durationSeconds" to "60")
        }
        try {
            appA.start()
            appB.start()
            val clientA = appA.createClient { lettuceTestClientDefaults() }
            val clientB = appB.createClient { lettuceTestClientDefaults() }
            val email = uniqueEmail("cross-lockout")
            TestUsers.seed(email = email, password = "pw-123456789")

            repeat(3) { assertEquals(HttpStatusCode.Unauthorized, clientA.login(email, "wrong").status) }
            // The lockout was recorded via A; B must see it too — even with the CORRECT password.
            assertEquals(HttpStatusCode.TooManyRequests, clientB.login(email, "pw-123456789").status)
        } finally {
            appA.stop()
            appB.stop()
        }
    }

    @Test
    fun `an mfa challenge issued via one instance is exchanged via another`(): Unit = runBlocking {
        val appA = TestApplication { configureApp() }
        val appB = TestApplication { configureApp() }
        try {
            appA.start()
            appB.start()
            val clientA = appA.createClient { lettuceTestClientDefaults() }
            val clientB = appB.createClient { lettuceTestClientDefaults() }

            val adminEmail = uniqueEmail("cross-mfa-admin")
            TestUsers.seed(email = adminEmail, password = "pw-123456789")
            val adminToken = clientA.login(adminEmail, "pw-123456789").body<LoginResponse>().token
            val email = uniqueEmail("cross-mfa")
            val userId = TestUsers.seed(email = email, password = "pw-123456789", roles = emptySet())
            val enableRes = clientA.put("/api/v1/users/$userId/features") {
                contentType(ContentType.Application.Json)
                header(HttpHeaders.Authorization, "Bearer $adminToken")
                setBody(UserFeaturesUpdateRequest(emptyList()))
            }
            assertEquals(HttpStatusCode.NoContent, enableRes.status)

            val mail = LogCapture("ch.nokillswit.mail")
            try {
                // Challenge minted via A.
                val challengeRes = clientA.login(email, "pw-123456789")
                assertEquals(HttpStatusCode.OK, challengeRes.status)
                val challenge = challengeRes.body<MfaChallengeResponse>()
                val message = mail.awaitEvent { "To: $email" in it.formattedMessage }?.formattedMessage
                assertNotNull(message, "the sign-in code email should have been delivered (log transport)")
                val code = Regex("""(?m)^\d{6}$""").find(message)?.value
                assertNotNull(code, "email should contain the 6-digit code on its own line")

                // Exchanged via B.
                val verifyRes = clientB.post("/api/v1/login/mfa") {
                    contentType(ContentType.Application.Json)
                    setBody(MfaVerifyRequest(challenge.challengeId, code))
                }
                assertEquals(HttpStatusCode.OK, verifyRes.status)
                val tokens = verifyRes.body<LoginResponse>()
                assertEquals(userId, tokens.userId)

                // Replaying the now-consumed challenge via A: single-use, gone everywhere.
                val replay = clientA.post("/api/v1/login/mfa") {
                    contentType(ContentType.Application.Json)
                    setBody(MfaVerifyRequest(challenge.challengeId, code))
                }
                assertEquals(HttpStatusCode.Unauthorized, replay.status)
            } finally {
                mail.detach()
            }
        } finally {
            appA.stop()
            appB.stop()
        }
    }

    @Test
    fun `a password-reset request throttled via one instance is enforced via another`(): Unit = runBlocking {
        val appA = TestApplication { configureApp() }
        val appB = TestApplication { configureApp() }
        try {
            appA.start()
            appB.start()
            val clientA = appA.createClient { lettuceTestClientDefaults() }
            val clientB = appB.createClient { lettuceTestClientDefaults() }
            val email = uniqueEmail("cross-reset")
            TestUsers.seed(email = email, password = "pw-123456789")

            val first = clientA.post("/api/v1/password-reset") {
                contentType(ContentType.Application.Json)
                setBody(PasswordResetRequest(email))
            }
            assertEquals(HttpStatusCode.Accepted, first.status)
            val second = clientB.post("/api/v1/password-reset") {
                contentType(ContentType.Application.Json)
                setBody(PasswordResetRequest(email))
            }
            assertEquals(HttpStatusCode.TooManyRequests, second.status)
        } finally {
            appA.stop()
            appB.stop()
        }
    }
}
