package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.PasswordResetRequest
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
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
import kotlinx.coroutines.delay
import org.slf4j.LoggerFactory

/**
 * POST /api/v1/password-reset. The test app uses the dev-default `log` mail transport, so
 * delivered email is captured with a ListAppender on the `ch.nokillswit.mail` logger (the
 * AuditTest pattern); the endpoint's work is asynchronous, so assertions poll briefly.
 */
class PasswordResetTest {

    private fun attachAppender(loggerName: String): Pair<Logger, ListAppender<ILoggingEvent>> {
        val logger = LoggerFactory.getLogger(loggerName) as Logger
        val appender = ListAppender<ILoggingEvent>()
        appender.start()
        logger.addAppender(appender)
        return logger to appender
    }

    private suspend fun awaitEvent(
        appender: ListAppender<ILoggingEvent>,
        predicate: (ILoggingEvent) -> Boolean,
    ): ILoggingEvent? {
        repeat(100) {
            appender.list.firstOrNull(predicate)?.let { return it }
            delay(50)
        }
        return null
    }

    /** audit() fields travel as SLF4J key/values, not in the message text. */
    private fun ILoggingEvent.hasKeyValue(key: String, value: String) =
        keyValuePairs?.any { it.key == key && it.value == value } == true

    @Test
    fun `existing account gets a working new password by email and the old one stops working`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("reset")
        TestUsers.seed(email = email, password = "old-password-123", name = "Reset Tester")
        val (mailLogger, mail) = attachAppender("ch.nokillswit.mail")
        val (auditLogger, auditEvents) = attachAppender("ch.nokillswit.audit")
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
                awaitEvent(auditEvents) {
                    it.message == "password_reset.completed" && it.hasKeyValue("email", email)
                },
                "the reset should complete",
            )
            val message = awaitEvent(mail) { "To: $email" in it.formattedMessage }?.formattedMessage
            assertNotNull(message, "the reset email should have been delivered (log transport)")
            assertTrue("Nowe hasło" in message, "email should carry the bilingual body")
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
        } finally {
            mailLogger.detachAppender(mail)
            auditLogger.detachAppender(auditEvents)
        }
    }

    @Test
    fun `unknown email answers 202 identically and sends nothing`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("reset-nobody")
        val (mailLogger, mail) = attachAppender("ch.nokillswit.mail")
        val (auditLogger, auditEvents) = attachAppender("ch.nokillswit.audit")
        try {
            val response = jsonClient().post("/api/v1/password-reset") {
                contentType(ContentType.Application.Json)
                setBody(PasswordResetRequest(email))
            }
            assertEquals(HttpStatusCode.Accepted, response.status)
            // The async branch signals completion via the audit trail — wait for it, then
            // assert no email went out.
            val audited = awaitEvent(auditEvents) {
                it.message == "password_reset.unknown_email" && it.hasKeyValue("email", email)
            }
            assertNotNull(audited, "the unknown-email branch should be audited")
            assertNull(mail.list.firstOrNull { "To: $email" in it.formattedMessage })
        } finally {
            mailLogger.detachAppender(mail)
            auditLogger.detachAppender(auditEvents)
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
