package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.auth.hashPassword
import ch.nokillswit.infra.db.DEMO_SEED_EMAILS
import ch.nokillswit.infra.db.HR_DEMO_EMAIL
import ch.nokillswit.infra.db.SEED_ADMIN_EMAIL
import ch.nokillswit.infra.db.SEED_PASSWORD_HASH
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserRole
import io.ktor.client.call.body
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * Startup bootstrap (infra/db/Bootstrap.kt): ADMIN_INITIAL_PASSWORD rotates the V6 seed admin
 * away from the well-known "changeme", outside development mode the V9 demo users AND the
 * dev-only HR demo account are purged and startup fails closed while any active account still
 * carries the seed password, and in development mode ONLY the HR demo account is seeded once.
 * Tests restore the shared container's seed state afterwards (TestSeedState).
 */
class BootstrapTest {

    @Test
    fun `ADMIN_INITIAL_PASSWORD rotates the seed admin so changeme stops working`() = testApplication {
        val newPassword = "rotated-${UUID.randomUUID()}"
        configureApp("bootstrap.adminInitialPassword" to newPassword)
        try {
            startApplication()
            val client = jsonClient()

            val withOld = client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(SEED_ADMIN_EMAIL, "changeme"))
            }
            assertEquals(HttpStatusCode.Unauthorized, withOld.status)

            val withNew = client.post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(SEED_ADMIN_EMAIL, newPassword))
            }
            assertEquals(HttpStatusCode.OK, withNew.status)
            assertTrue(withNew.body<LoginResponse>().token.isNotBlank())
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `rotation is idempotent - an admin-chosen password is never overwritten`() = testApplication {
        val chosen = "chosen-${UUID.randomUUID()}"
        // First boot rotates away from the seed hash…
        configureApp("bootstrap.adminInitialPassword" to chosen)
        try {
            startApplication()
            // …then simulate a later boot with a DIFFERENT initial password: the admin's password
            // no longer matches the seed hash, so nothing may change.
            val rotatedAgain = TestServices.users.rotatePasswordIfHashMatches(
                email = SEED_ADMIN_EMAIL,
                expectedHash = SEED_PASSWORD_HASH,
                newHash = "never-applied",
            )
            assertEquals(0, rotatedAgain)

            val stillChosen = jsonClient().post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(SEED_ADMIN_EMAIL, chosen))
            }
            assertEquals(HttpStatusCode.OK, stillChosen.status)
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `production mode refuses to start while seed passwords are active`() = testApplication {
        // No ADMIN_INITIAL_PASSWORD; strong JWT secret + encryption key so the failure is the seed check.
        configureApp(
            "jwt.secret" to "strong-${UUID.randomUUID()}",
            "security.encryption.key" to strongEncryptionKey(),
            // The dev-default `log` mail transport is refused in production (see infra/mail).
            "mail.transport" to "disabled",
        )
        serverConfig { developmentMode = false }
        try {
            val failure = runCatching { startApplication() }.exceptionOrNull()
            assertNotNull(failure, "startup must fail closed while seed passwords are active")
            val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
            assertTrue("seed password" in messages, "unexpected startup failure: $messages")
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `production mode boots once the admin is rotated and purges the demo users`() = testApplication {
        // Guarantees the HR demo account exists first (dev-mode Bootstrap is the only inserter,
        // and test order does not guarantee an earlier dev-mode boot already created it in this
        // JVM — TestSeedState.restoreSeedAccounts creates it on demand).
        TestSeedState.restoreSeedAccounts()

        val newPassword = "rotated-${UUID.randomUUID()}"
        configureApp(
            "bootstrap.adminInitialPassword" to newPassword,
            "jwt.secret" to "strong-${UUID.randomUUID()}",
            "security.encryption.key" to strongEncryptionKey(),
            // The dev-default `log` mail transport is refused in production (see infra/mail).
            "mail.transport" to "disabled",
            // Lets the explicit hr@lettuce.local login attempt below mark itself already-HTTPS
            // (the ProductionHttpTest proxy contract) instead of hitting the HTTPS redirect.
            "http.behindProxy" to "true",
        )
        serverConfig { developmentMode = false }
        try {
            startApplication() // must not throw: rotation happens before the fail-closed check

            // The V9 demo users are gone (soft-deleted): none of them may log in anymore, and
            // they are invisible to reads.
            for (email in DEMO_SEED_EMAILS) {
                val record = TestServices.users.findWithIdByEmail(email)
                assertEquals(null, record, "$email should be soft-deleted in production mode")
            }
            // The HR demo account (created by restoreSeedAccounts above, still carrying the
            // seed hash) is soft-deleted too, and cannot log in. Production mode redirects plain
            // HTTP, so mark the request as already-HTTPS (the proxy contract in
            // ProductionHttpTest) to reach the login handler itself.
            assertEquals(
                null,
                TestServices.users.findWithIdByEmail(HR_DEMO_EMAIL),
                "$HR_DEMO_EMAIL should be soft-deleted in production mode",
            )
            val hrLoginAttempt = jsonClient().post("/api/v1/login") {
                header("X-Forwarded-Proto", "https")
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(HR_DEMO_EMAIL, "changeme"))
            }
            assertEquals(HttpStatusCode.Unauthorized, hrLoginAttempt.status)
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `development mode seeds the HR demo account with exactly the HR role`() = testApplication {
        // restoreSeedAccounts also creates the row on demand, so move any existing one out of the
        // way first — the boot below must be what creates it (a fresh id), or this proves nothing.
        TestSeedState.restoreSeedAccounts()
        val moved = TestSeedState.moveHrDemoAccountAside()
        try {
            usePostgresTestcontainer()
            val record = TestServices.users.findWithIdByEmail(HR_DEMO_EMAIL)
            assertNotNull(record, "$HR_DEMO_EMAIL should be seeded by a development-mode boot")
            val (seededId, hr) = record
            assertTrue(seededId !in moved, "the boot must create a NEW row")
            assertEquals(setOf(UserRole.HR), hr.roles)
            assertFalse(hr.deactivated)
            // The V52/v4.5.0 pristine state: MFA and TEAMS_NOTIFICATIONS both start disabled like
            // every other user (the two inverted-default flags), so the demo login below answers
            // tokens directly instead of an MFA challenge.
            assertEquals(setOf(Feature.MFA, Feature.TEAMS_NOTIFICATIONS), hr.disabledFeatures)

            val login = jsonClient().post("/api/v1/login") {
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(HR_DEMO_EMAIL, "changeme"))
            }
            assertEquals(HttpStatusCode.OK, login.status)
            assertEquals(listOf(UserRole.HR), login.body<LoginResponse>().roles)
        } finally {
            TestSeedState.restoreHrDemoAccount(moved)
        }
    }

    @Test
    fun `development mode never seeds the HR demo account into a database that booted in production`() =
        testApplication {
            TestSeedState.restoreSeedAccounts()
            val moved = TestSeedState.moveHrDemoAccountAside()
            try {
                // What a production boot leaves behind: every V9 demo account soft-deleted.
                TestServices.users.softDeleteByEmails(DEMO_SEED_EMAILS)
                usePostgresTestcontainer() // a dev-mode boot mis-pointed at that database
                assertEquals(
                    null,
                    TestServices.users.findWithIdByEmail(HR_DEMO_EMAIL),
                    "a database whose demo accounts are gone must not receive the HR reader",
                )
                assertFalse(TestServices.users.existsWithEmailAnyState(HR_DEMO_EMAIL))
            } finally {
                TestSeedState.restoreHrDemoAccount(moved)
            }
        }

    @Test
    fun `development mode does not resurrect a soft-deleted HR demo account`() = testApplication {
        TestSeedState.restoreSeedAccounts()
        val (hrId, _) = checkNotNull(TestServices.users.findWithIdByEmail(HR_DEMO_EMAIL))
        try {
            TestServices.users.delete(hrId) // a developer deliberately removed the demo account

            usePostgresTestcontainer() // a FRESH dev-mode boot must not re-seed it
            assertEquals(
                null,
                TestServices.users.findWithIdByEmail(HR_DEMO_EMAIL),
                "a deliberately deleted HR demo account must not be resurrected by a later boot",
            )
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }

    @Test
    fun `a real pre-existing hr account with its own password survives production boot`() = testApplication {
        // Guarantees exactly one row at hr@lettuce.local, in the pristine dev-seed shape.
        TestSeedState.restoreSeedAccounts()
        val (hrId, _) = checkNotNull(TestServices.users.findWithIdByEmail(HR_DEMO_EMAIL))
        val realPassword = "hr-real-password-${UUID.randomUUID()}"
        // Simulate a REAL pre-existing account at this address (a genuine employee's mailbox
        // happens to collide with the demo address): same row, its OWN password — never the
        // well-known seed hash. updatePassword is the ordinary account-owned write path.
        TestServices.users.updatePassword(hrId, hashPassword(realPassword, cost = 4))

        val newPassword = "rotated-${UUID.randomUUID()}"
        configureApp(
            "bootstrap.adminInitialPassword" to newPassword,
            "jwt.secret" to "strong-${UUID.randomUUID()}",
            "security.encryption.key" to strongEncryptionKey(),
            "mail.transport" to "disabled",
            "http.behindProxy" to "true",
        )
        serverConfig { developmentMode = false }
        try {
            startApplication()

            val record = TestServices.users.findWithIdByEmail(HR_DEMO_EMAIL)
            assertNotNull(record, "a real hr@lettuce.local with its own password must survive production boot")

            val login = jsonClient().post("/api/v1/login") {
                header("X-Forwarded-Proto", "https")
                contentType(ContentType.Application.Json)
                setBody(LoginRequest(HR_DEMO_EMAIL, realPassword))
            }
            assertEquals(HttpStatusCode.OK, login.status)
        } finally {
            TestSeedState.restoreSeedAccounts()
        }
    }
}
