package ch.nokillswit

import ch.nokillswit.alerts.Alert
import ch.nokillswit.alerts.AlertResponse
import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.teams.Team
import ch.nokillswit.teams.TeamResponse
import ch.nokillswit.templates.Template
import ch.nokillswit.templates.TemplateResponse
import ch.nokillswit.users.UserRole
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import java.util.UUID
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

    @Test
    fun `team mutations emit audit events`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw")
        val managerId = TestUsers.seed(email = uniqueEmail("mgr"), password = "pw", role = UserRole.USER)
        val newManagerId = TestUsers.seed(email = uniqueEmail("mgr2"), password = "pw", role = UserRole.USER)
        val memberId = TestUsers.seed(email = uniqueEmail("member"), password = "pw", role = UserRole.USER)
        val (logger, appender) = attachAppender()
        try {
            val client = authedClient(adminEmail, "pw")
            val teamId = client.post("/api/v1/teams") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "Audited", managerId = managerId, memberIds = emptyList()))
            }.body<TeamResponse>().id

            client.put("/api/v1/teams/$teamId") {
                contentType(ContentType.Application.Json)
                setBody(Team(name = "Audited", managerId = newManagerId, memberIds = listOf(memberId)))
            }
            client.put("/api/v1/teams/$teamId/members/$managerId")
            client.delete("/api/v1/teams/$teamId/members/$managerId")
            client.delete("/api/v1/teams/$teamId")

            val created = appender.list.find { it.message == "team.created" }
            assertNotNull(created, "expected a team.created audit event")
            assertEquals(adminId.toLong(), created.keyValuePairs.first { it.key == "byUserId" }.value)
            assertEquals(managerId.toLong(), created.keyValuePairs.first { it.key == "managerId" }.value)

            val updated = appender.list.find { it.message == "team.updated" }
            assertNotNull(updated, "expected a team.updated audit event")
            assertEquals(managerId.toLong(), updated.keyValuePairs.first { it.key == "managerFrom" }.value)
            assertEquals(newManagerId.toLong(), updated.keyValuePairs.first { it.key == "managerTo" }.value)
            assertEquals(memberId.toString(), updated.keyValuePairs.first { it.key == "membersAdded" }.value)

            val memberAdded = appender.list.find { it.message == "team.member_added" }
            assertNotNull(memberAdded, "expected a team.member_added audit event")
            assertEquals(managerId.toLong(), memberAdded.keyValuePairs.first { it.key == "memberUserId" }.value)

            assertNotNull(appender.list.find { it.message == "team.member_removed" })
            val deleted = appender.list.find { it.message == "team.deleted" }
            assertNotNull(deleted, "expected a team.deleted audit event")
            assertEquals(teamId.toLong(), deleted.keyValuePairs.first { it.key == "teamId" }.value)
        } finally {
            logger.detachAppender(appender)
        }
    }

    @Test
    fun `alert and template mutations emit audit events`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("admin")
        val adminId = TestUsers.seed(email = adminEmail, password = "pw")
        val (logger, appender) = attachAppender()
        try {
            val client = authedClient(adminEmail, "pw")

            val alertId = client.post("/api/v1/alerts") {
                contentType(ContentType.Application.Json)
                setBody(Alert(title = "audit-${UUID.randomUUID()}", content = "trail"))
            }.body<AlertResponse>().id
            client.delete("/api/v1/alerts/$alertId")

            val templateName = "audit-${UUID.randomUUID()}"
            val templateId = client.post("/api/v1/templates") {
                contentType(ContentType.Application.Json)
                setBody(Template(name = templateName, content = "c"))
            }.body<TemplateResponse>().id
            client.put("/api/v1/templates/$templateId") {
                contentType(ContentType.Application.Json)
                setBody(Template(name = templateName, content = "c2"))
            }
            client.delete("/api/v1/templates/$templateId")

            for (event in listOf("alert.created", "alert.deleted", "template.created", "template.updated", "template.deleted")) {
                val hit = appender.list.find { it.message == event }
                assertNotNull(hit, "expected a $event audit event")
                assertEquals(adminId.toLong(), hit.keyValuePairs.first { it.key == "byUserId" }.value)
            }
            assertEquals(
                alertId.toLong(),
                appender.list.first { it.message == "alert.created" }.keyValuePairs.first { it.key == "alertId" }.value,
            )
        } finally {
            logger.detachAppender(appender)
        }
    }
}
