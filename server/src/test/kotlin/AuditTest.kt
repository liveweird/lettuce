package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.users.UserRole
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue
import org.slf4j.LoggerFactory

/**
 * The audit trail (audit/Audit.kt) is structured SLF4J logging on the dedicated
 * `ch.nokillswit.audit` logger with the AUDIT marker — captured here with a Logback
 * ListAppender. The events themselves are emitted from the auth/user routes.
 */
class AuditTest {


    private fun attachAppender(): Pair<Logger, ListAppender<ILoggingEvent>> {
        val logger = LoggerFactory.getLogger("ch.nokillswit.audit") as Logger
        val appender = ListAppender<ILoggingEvent>()
        appender.start()
        logger.addAppender(appender)
        return logger to appender
    }

    @Test
    fun `login failure and success emit AUDIT-marked events with fields`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("audit")
        val userId = TestUsers.seed(email = email, password = "pw-123456789")
        val (logger, appender) = attachAppender()
        try {
            val client = jsonClient()
            client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, "wrong-password"))
            }
            client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, "pw-123456789"))
            }

            val failure = appender.list.find {
                it.message == "login.failure" && it.keyValuePairs.any { kv -> kv.key == "email" && kv.value == email }
            }
            assertNotNull(failure, "expected a login.failure audit event")
            assertTrue(failure.markerList.any { it.name == "AUDIT" })
            assertEquals("wrong_password", failure.keyValuePairs.first { it.key == "reason" }.value)

            val success = appender.list.find {
                it.message == "login.success" && it.keyValuePairs.any { kv -> kv.key == "email" && kv.value == email }
            }
            assertNotNull(success, "expected a login.success audit event")
            assertEquals(userId.toLong(), success.keyValuePairs.first { it.key == "userId" }.value)
        } finally {
            logger.detachAppender(appender)
        }
    }

    @Test
    fun `a forbidden request emits an authz denied event with the caller id`() = testApplication {
        usePostgresTestcontainer()
        val email = uniqueEmail("authz")
        val callerId = TestUsers.seed(email = email, password = "pw-123456789", role = UserRole.USER)
        val otherId = TestUsers.seed(email = uniqueEmail("other"), password = "pw-123456789")
        val (logger, appender) = attachAppender()
        try {
            val client = jsonClient()
            val token = client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(email, "pw-123456789"))
            }.body<LoginResponse>().token

            // A USER reading someone else's profile is a 403 → audited.
            client.get("/api/v1/users/$otherId") {
                header(HttpHeaders.Authorization, "Bearer $token")
            }

            val denied = appender.list.find { it.message == "authz.denied" }
            assertNotNull(denied, "expected an authz.denied audit event")
            assertEquals(callerId.toLong(), denied.keyValuePairs.first { it.key == "userId" }.value)
            assertEquals("GET", denied.keyValuePairs.first { it.key == "method" }.value)
        } finally {
            logger.detachAppender(appender)
        }
    }
}
