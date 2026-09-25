package ch.nokillswit

import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Startup behavior of infra/teams/Teams.kt — the mail.transport fail-closed family applied to
 * the third notification channel (v4.5.0): blank botframework credentials, the log transport
 * refused in production, and production URL pinning (the client secret is posted to
 * teams.loginBaseUrl, so an overridden login URL in production would exfiltrate it).
 */
class TeamsConfigTest {

    /** The minimal config a production-mode boot needs to pass every OTHER fail-closed check
     *  (JWT secret, encryption key, seed passwords, mail transport) so a test can isolate the
     *  Teams-specific behavior — the SecurityConfigTest precedent. */
    private fun productionOverrides(vararg teamsOverrides: Pair<String, String>): Array<Pair<String, String>> =
        arrayOf(
            "jwt.secret" to "strong-${UUID.randomUUID()}",
            "bootstrap.adminInitialPassword" to "rotated-${UUID.randomUUID()}",
            "security.encryption.key" to strongEncryptionKey(),
            "mail.transport" to "disabled",
            *teamsOverrides,
        )

    @Test
    fun `the disabled transport is the default and boots cleanly in every mode`() = testApplication {
        configureApp()
        startApplication()
    }

    @Test
    fun `an unknown transport refuses to start in every mode`() = testApplication {
        configureApp("teams.transport" to "carrier-pigeon")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on an unknown teams.transport")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("Unknown teams.transport" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `botframework with a blank tenantId refuses to start in every mode`() = testApplication {
        configureApp(
            "teams.transport" to "botframework",
            "teams.tenantId" to "",
            "teams.appId" to "app",
            "teams.appSecret" to "secret",
        )
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a blank teams.tenantId")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("tenantId" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `botframework with a blank appId refuses to start in every mode`() = testApplication {
        configureApp(
            "teams.transport" to "botframework",
            "teams.tenantId" to "tenant",
            "teams.appId" to "",
            "teams.appSecret" to "secret",
        )
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a blank teams.appId")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("appId" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `botframework with a blank appSecret refuses to start in every mode`() = testApplication {
        configureApp(
            "teams.transport" to "botframework",
            "teams.tenantId" to "tenant",
            "teams.appId" to "app",
            "teams.appSecret" to "",
        )
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a blank teams.appSecret")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("appSecret" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `the log transport is tolerated in development`() = testApplication {
        configureApp("teams.transport" to "log")
        startApplication()
    }

    @Test
    fun `the log transport refuses to start outside development`() = testApplication {
        configureApp(*productionOverrides("teams.transport" to "log"))
        serverConfig { developmentMode = false }
        val failure = runCatching { startApplication() }.exceptionOrNull()
        try {
            assertNotNull(failure, "startup must fail closed on teams.transport=log outside development")
            val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
            assertTrue("teams.transport=log" in messages, "unexpected startup failure: $messages")
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `botframework with the Microsoft default URLs boots in production`() = testApplication {
        configureApp(
            *productionOverrides(
                "teams.transport" to "botframework",
                "teams.tenantId" to "tenant",
                "teams.appId" to "app",
                "teams.appSecret" to "secret",
            ),
        )
        serverConfig { developmentMode = false }
        try {
            // No fail-closed error — the application.yaml defaults for serviceUrl/loginBaseUrl/
            // graphBaseUrl already ARE the Microsoft defaults.
            startApplication()
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `botframework with an overridden serviceUrl refuses to start in production`() = testApplication {
        configureApp(
            *productionOverrides(
                "teams.transport" to "botframework",
                "teams.tenantId" to "tenant",
                "teams.appId" to "app",
                "teams.appSecret" to "secret",
                "teams.serviceUrl" to "http://teams-stub:8089/teams",
            ),
        )
        serverConfig { developmentMode = false }
        val failure = runCatching { startApplication() }.exceptionOrNull()
        try {
            assertNotNull(failure, "startup must fail closed on an overridden teams.serviceUrl in production")
            val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
            assertTrue("teams.serviceUrl" in messages, "unexpected startup failure: $messages")
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `botframework with an overridden loginBaseUrl refuses to start in production`() = testApplication {
        configureApp(
            *productionOverrides(
                "teams.transport" to "botframework",
                "teams.tenantId" to "tenant",
                "teams.appId" to "app",
                "teams.appSecret" to "secret",
                "teams.loginBaseUrl" to "http://teams-stub:8089/login",
            ),
        )
        serverConfig { developmentMode = false }
        val failure = runCatching { startApplication() }.exceptionOrNull()
        try {
            assertNotNull(failure, "startup must fail closed on an overridden teams.loginBaseUrl in production")
            val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
            assertTrue("teams.loginBaseUrl" in messages, "unexpected startup failure: $messages")
            // The rationale, not just the field name — the secret-exfiltration reasoning.
            assertTrue("secret" in messages, "expected the message to explain the secret-exfiltration risk")
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `botframework with an overridden graphBaseUrl refuses to start in production`() = testApplication {
        configureApp(
            *productionOverrides(
                "teams.transport" to "botframework",
                "teams.tenantId" to "tenant",
                "teams.appId" to "app",
                "teams.appSecret" to "secret",
                "teams.graphBaseUrl" to "http://teams-stub:8089/graph",
            ),
        )
        serverConfig { developmentMode = false }
        val failure = runCatching { startApplication() }.exceptionOrNull()
        try {
            assertNotNull(failure, "startup must fail closed on an overridden teams.graphBaseUrl in production")
            val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
            assertTrue("teams.graphBaseUrl" in messages, "unexpected startup failure: $messages")
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `botframework with a trailing-slash-only URL difference still boots in production`() = testApplication {
        // Normalization (trim + trailing slash) — a cosmetic difference from the documented
        // default must not be treated as an override.
        configureApp(
            *productionOverrides(
                "teams.transport" to "botframework",
                "teams.tenantId" to "tenant",
                "teams.appId" to "app",
                "teams.appSecret" to "secret",
                "teams.serviceUrl" to "https://smba.trafficmanager.net/teams",
                "teams.loginBaseUrl" to "https://login.microsoftonline.com/",
                "teams.graphBaseUrl" to "https://graph.microsoft.com/",
            ),
        )
        serverConfig { developmentMode = false }
        try {
            startApplication()
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `botframework with overridden URLs boots in development (the local stub)`() = testApplication {
        configureApp(
            "teams.transport" to "botframework",
            "teams.tenantId" to "tenant",
            "teams.appId" to "app",
            "teams.appSecret" to "secret",
            "teams.serviceUrl" to "http://localhost:8089/teams",
            "teams.loginBaseUrl" to "http://localhost:8089/login",
            "teams.graphBaseUrl" to "http://localhost:8089/graph",
        )
        startApplication()
    }

    @Test
    fun `a zero requestTimeoutSeconds refuses to start in every mode`() = testApplication {
        configureApp("teams.requestTimeoutSeconds" to "0")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a zero teams.requestTimeoutSeconds")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("teams.requestTimeoutSeconds" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `a requestTimeoutSeconds above 120 refuses to start in every mode`() = testApplication {
        configureApp("teams.requestTimeoutSeconds" to "121")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a teams.requestTimeoutSeconds above 120")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("teams.requestTimeoutSeconds" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `a zero unreachableRetryHours refuses to start in every mode`() = testApplication {
        configureApp("teams.unreachableRetryHours" to "0")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a zero teams.unreachableRetryHours")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("teams.unreachableRetryHours" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `an unreachableRetryHours above 720 refuses to start in every mode`() = testApplication {
        configureApp("teams.unreachableRetryHours" to "721")
        val failure = runCatching { startApplication() }.exceptionOrNull()
        assertNotNull(failure, "startup must fail closed on a teams.unreachableRetryHours above 720")
        val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
        assertTrue("teams.unreachableRetryHours" in messages, "unexpected startup failure: $messages")
    }

    @Test
    fun `boundary values for the teams numeric config boot cleanly`() = testApplication {
        configureApp(
            "teams.requestTimeoutSeconds" to "1",
            "teams.unreachableRetryHours" to "1",
        )
        startApplication()
    }

    // ---- production-pin spoof matrix (checkup review, v4.5.0) -------------------------------
    // configureTeams compares loginBaseUrl by EXACT string equality after normalization (trim +
    // trailing slash) — never a prefix/substring/host check. These variants would defeat a
    // looser comparison (a subdomain, userinfo, or path trick, a scheme/port downgrade) while
    // still "looking like" the real Microsoft login host to a casual reviewer of the config.

    @Test
    fun `production refuses a loginBaseUrl with an evil suffix domain`() = testApplication {
        assertRefusesLoginBaseUrl("https://login.microsoftonline.com.evil.tld")
    }

    @Test
    fun `production refuses a loginBaseUrl using the real host as userinfo`() = testApplication {
        assertRefusesLoginBaseUrl("https://login.microsoftonline.com@evil.tld")
    }

    @Test
    fun `production refuses a loginBaseUrl using the real host as a path segment`() = testApplication {
        assertRefusesLoginBaseUrl("https://evil.tld/login.microsoftonline.com")
    }

    @Test
    fun `production refuses a scheme-downgraded loginBaseUrl`() = testApplication {
        assertRefusesLoginBaseUrl("http://login.microsoftonline.com")
    }

    @Test
    fun `production refuses a loginBaseUrl with a non-default port`() = testApplication {
        assertRefusesLoginBaseUrl("https://login.microsoftonline.com:8443")
    }

    private suspend fun ApplicationTestBuilder.assertRefusesLoginBaseUrl(spoofedLoginBaseUrl: String) {
        configureApp(
            *productionOverrides(
                "teams.transport" to "botframework",
                "teams.tenantId" to "tenant",
                "teams.appId" to "app",
                "teams.appSecret" to "secret",
                "teams.loginBaseUrl" to spoofedLoginBaseUrl,
            ),
        )
        serverConfig { developmentMode = false }
        val failure = runCatching { startApplication() }.exceptionOrNull()
        try {
            assertNotNull(failure, "startup must refuse the spoofed teams.loginBaseUrl '$spoofedLoginBaseUrl'")
            val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
            assertTrue("teams.loginBaseUrl" in messages, "unexpected startup failure: $messages")
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }
}
