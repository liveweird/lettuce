package ch.nokillswit

import io.ktor.server.testing.testApplication
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * infra/mail/Mail.kt: with a live transport, a blank `mail.appUrl` (MAIL_APP_URL) is a startup
 * WARN — the emails would deliver a password or a notification with nowhere to click (v3.6.2).
 * A disabled transport sends nothing, so it stays silent.
 */
class MailConfigTest {

    private fun LogCapture.appUrlWarnings() = events.filter {
        it.level == ch.qos.logback.classic.Level.WARN && it.formattedMessage.contains("MAIL_APP_URL")
    }

    @Test
    fun `a blank appUrl with a live transport warns at startup`() = testApplication {
        val log = LogCapture(org.slf4j.Logger.ROOT_LOGGER_NAME)
        try {
            configureApp("mail.transport" to "log", "mail.appUrl" to "")
            startApplication()
            assertEquals(1, log.appUrlWarnings().size, "expected exactly one MAIL_APP_URL warning")
        } finally {
            log.detach()
        }
    }

    @Test
    fun `a configured appUrl does not warn`() = testApplication {
        val log = LogCapture(org.slf4j.Logger.ROOT_LOGGER_NAME)
        try {
            configureApp("mail.transport" to "log", "mail.appUrl" to "https://lettuce.test")
            startApplication()
            assertEquals(emptyList(), log.appUrlWarnings().map { it.formattedMessage })
        } finally {
            log.detach()
        }
    }

    @Test
    fun `the disabled transport does not warn about a blank appUrl`() = testApplication {
        val log = LogCapture(org.slf4j.Logger.ROOT_LOGGER_NAME)
        try {
            configureApp("mail.transport" to "disabled", "mail.appUrl" to "")
            startApplication()
            assertEquals(emptyList(), log.appUrlWarnings().map { it.formattedMessage })
        } finally {
            log.detach()
        }
    }
}
