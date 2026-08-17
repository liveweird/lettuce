package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.PasswordResetRequest
import ch.nokillswit.notifications.NotificationPageResponse
import ch.nokillswit.notifications.NotificationType
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * POST /api/v1/password-reset. The test app uses the dev-default `log` mail transport, so
 * delivered email is captured with a ListAppender on the `ch.nokillswit.mail` logger (the
 * AuditTest pattern); the endpoint's work is asynchronous, so assertions poll briefly.
 */
class PasswordResetTest {

    @Test
    fun `a Polish-language account gets the Polish reset email`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("reset-pl")
        TestUsers.seed(email = email, password = "old-password-123", name = "Pola Reset", language = "pl")
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val response = jsonClient().post("/api/v1/password-reset") {
                contentType(ContentType.Application.Json)
                setBody(PasswordResetRequest(email))
            }
            assertEquals(HttpStatusCode.Accepted, response.status)
            val message = mail.awaitEvent { "To: $email" in it.formattedMessage }?.formattedMessage
            assertNotNull(message, "the reset email should have been delivered (log transport)")
            assertTrue("Cześć Pola Reset," in message)
            assertTrue("Nowe hasło" in message, "the PL body")
            assertTrue("Twoje nowe hasło Lettuce" in message, "the PL subject")
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `existing account gets a working new password by email and the old one stops working`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("reset")
        TestUsers.seed(email = email, password = "old-password-123", name = "Reset Tester")
        val mail = LogCapture("ch.nokillswit.mail")
        val auditEvents = LogCapture("ch.nokillswit.audit")
        try {
            val client = jsonClient()
            val response = client.post("/api/v1/password-reset") {
                contentType(ContentType.Application.Json)
                setBody(PasswordResetRequest(email))
            }
            assertEquals(HttpStatusCode.Accepted, response.status)

            // The email is logged BEFORE the new hash is stored — wait for the completion
            // audit event so the login below can't race the DB write.
            assertNotNull(
                auditEvents.awaitEvent {
                    it.message == "password_reset.completed" && it.hasKeyValue("email", email)
                },
                "the reset should complete",
            )
            val message = mail.awaitEvent { "To: $email" in it.formattedMessage }?.formattedMessage
            assertNotNull(message, "the reset email should have been delivered (log transport)")
            assertTrue("New password" in message, "email should carry the EN body (the seeded user defaults to English)")
            val newPassword = Regex("""(?m)^[A-Za-z0-9_-]{16}$""").find(message)?.value
            assertNotNull(newPassword, "email should contain the generated password on its own line")

            val newLogin = client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, newPassword))
            }
            assertEquals(HttpStatusCode.OK, newLogin.status, "the emailed password must work")

            val oldLogin = client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, "old-password-123"))
            }
            assertEquals(HttpStatusCode.Unauthorized, oldLogin.status, "the old password must be dead")

            // The owner finds a "password was reset via email" notification after signing in
            // (minted before the completion audit event awaited above, so no race here).
            val note = authedClient(email, newPassword)
                .get("/api/v1/notifications").body<NotificationPageResponse>().items.single()
            assertEquals(NotificationType.PASSWORD_CHANGED, note.type)
            assertEquals("reset", note.params["self"])
        } finally {
            mail.detach()
            auditEvents.detach()
        }
    }

    @Test
    fun `unknown email answers 202 identically and sends nothing`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("reset-nobody")
        val mail = LogCapture("ch.nokillswit.mail")
        val auditEvents = LogCapture("ch.nokillswit.audit")
        try {
            val response = jsonClient().post("/api/v1/password-reset") {
                contentType(ContentType.Application.Json)
                setBody(PasswordResetRequest(email))
            }
            assertEquals(HttpStatusCode.Accepted, response.status)
            // The async branch signals completion via the audit trail — wait for it, then
            // assert no email went out.
            val audited = auditEvents.awaitEvent {
                it.message == "password_reset.unknown_email" && it.hasKeyValue("email", email)
            }
            assertNotNull(audited, "the unknown-email branch should be audited")
            assertNull(mail.events.firstOrNull { "To: $email" in it.formattedMessage })
        } finally {
            mail.detach()
            auditEvents.detach()
        }
    }

    @Test
    fun `deactivated account answers 202 identically, sends nothing, and keeps the old password`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("reset-deactivated")
        val userId = TestUsers.seed(email = email, password = "pw-123456789")
        TestServices.users.setDeactivated(userId, true)
        val hashBefore = TestServices.users.read(userId)!!.passwordHash
        val mail = LogCapture("ch.nokillswit.mail")
        val auditEvents = LogCapture("ch.nokillswit.audit")
        try {
            val response = jsonClient().post("/api/v1/password-reset") {
                contentType(ContentType.Application.Json)
                setBody(PasswordResetRequest(email))
            }
            // Uniform 202 — deactivation is as unobservable here as nonexistence.
            assertEquals(HttpStatusCode.Accepted, response.status)
            val audited = auditEvents.awaitEvent {
                it.message == "password_reset.deactivated" && it.hasKeyValue("email", email)
            }
            assertNotNull(audited, "the deactivated branch should be audited")
            assertNull(mail.events.firstOrNull { "To: $email" in it.formattedMessage })
            // No password was minted — reactivation would restore the original credentials.
            assertEquals(hashBefore, TestServices.users.read(userId)!!.passwordHash)
        } finally {
            mail.detach()
            auditEvents.detach()
        }
    }

    @Test
    fun `a second request within the interval is 429, uniformly for unknown emails too`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        val email = uniqueEmail("reset-throttle") // does not exist — the throttle must not care
        suspend fun request() = client.post("/api/v1/password-reset") {
            contentType(ContentType.Application.Json)
            setBody(PasswordResetRequest(email))
        }
        assertEquals(HttpStatusCode.Accepted, request().status)
        assertEquals(HttpStatusCode.TooManyRequests, request().status)
    }

    @Test
    fun `malformed emails are 400`() = testApplication {
        usePostgresTestcontainer()
        val client = jsonClient()
        for (bad in listOf("", "   ", "no-at-sign", "x".repeat(255) + "@test")) {
            val response = client.post("/api/v1/password-reset") {
                contentType(ContentType.Application.Json)
                setBody(PasswordResetRequest(bad))
            }
            assertEquals(HttpStatusCode.BadRequest, response.status, "for input '${bad.take(20)}'")
        }
    }

    @Test
    fun `disabled mail transport answers 503`() = testApplication {
        configureApp("mail.transport" to "disabled")
        startApplication()
        val response = jsonClient().post("/api/v1/password-reset") {
            contentType(ContentType.Application.Json)
            setBody(PasswordResetRequest(uniqueEmail("reset-disabled")))
        }
        assertEquals(HttpStatusCode.ServiceUnavailable, response.status)
    }

    @Test
    fun `a delivery failure is audited and leaves the old password working`() = testApplication {
        // Real SMTP transport pointed at a closed port: send() throws AFTER the 202.
        configureApp(
            "mail.transport" to "smtp",
            "mail.smtp.host" to "localhost",
            "mail.smtp.port" to "1",
            "mail.smtp.startTls" to "false",
        )
        startApplication()
        val email = uniqueEmail("reset-sendfail")
        TestUsers.seed(email = email, password = "old-password-123")
        val auditEvents = LogCapture("ch.nokillswit.audit")
        try {
            val response = jsonClient().post("/api/v1/password-reset") {
                contentType(ContentType.Application.Json)
                setBody(PasswordResetRequest(email))
            }
            assertEquals(HttpStatusCode.Accepted, response.status, "delivery failure must stay unobservable")
            assertNotNull(
                auditEvents.awaitEvent {
                    it.message == "password_reset.send_failed" && it.hasKeyValue("email", email)
                },
                "the failed delivery should be audited",
            )
            // Send-before-store: the hash was never replaced, so the old password still works.
            val oldLogin = jsonClient().post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, "old-password-123"))
            }
            assertEquals(HttpStatusCode.OK, oldLogin.status, "old password must survive a failed delivery")
        } finally {
            auditEvents.detach()
        }
    }

    @Test
    fun `production mode refuses to start with the log transport`() = testApplication {
        // Strong JWT secret so the earlier configureSecurity check passes; configureMail runs
        // before the encryption/seed checks, so the failure below must be the mail one.
        configureApp("jwt.secret" to "strong-${UUID.randomUUID()}")
        serverConfig { developmentMode = false }
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on mail.transport=log in production")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("mail.transport" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `smtp transport without a host refuses to start in any mode`() = testApplication {
        configureApp("mail.transport" to "smtp", "mail.smtp.host" to "")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail on smtp without a host")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("SMTP_HOST" in messages, "unexpected startup failure: $messages")
    }
}
