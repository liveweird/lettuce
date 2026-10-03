package ch.nokillswit

import ch.nokillswit.activity.AccountEventService
import ch.nokillswit.activity.AccountEventService.AccountEvents
import ch.nokillswit.activity.AccountEventServiceKey
import ch.nokillswit.activity.AccountEventType
import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.auth.MfaChallengeResponse
import ch.nokillswit.auth.MfaVerifyRequest
import ch.nokillswit.auth.RefreshRequest
import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.db.encodeParams
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
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

/**
 * The sign-in history (V90, v4.9.0): a COMPLETED sign-in (non-MFA and MFA success) mints
 * `SIGNED_IN {mfa}`, a logout `SIGNED_OUT` — and nothing else mints anything (refresh, wrong
 * password, lockout, deactivated, the MFA challenge, a wrong code). A failing write or purge never
 * fails the request; the retention purge is boundary-tested with a direct service. Every test keys
 * on its own freshly seeded account (the table lives in the shared container).
 */
class AccountEventTest {

    private val password = "pw-123456789"

    private class Row(val actor: UInt?, val type: String, val params: Map<String, String>, val at: Long)

    private suspend fun rowsOf(userId: UInt): List<Row> = suspendTransaction(TestServices.database) {
        AccountEvents.selectAll()
            .where { AccountEvents.ownerId eq userId }
            .orderBy(AccountEvents.id to SortOrder.ASC)
            .map {
                Row(
                    it[AccountEvents.userId]?.value, it[AccountEvents.eventType],
                    decodeParams(it[AccountEvents.params]), it[AccountEvents.timestamp],
                )
            }
            .toList()
    }

    private suspend fun HttpClient.login(email: String, pw: String = password): HttpResponse =
        post("/api/v1/login") {
            contentType(ContentType.Application.Json)
            setBody(LoginRequest(email, pw))
        }

    private suspend fun ApplicationTestBuilder.seed(prefix: String): Pair<UInt, String> {
        val email = uniqueEmail(prefix)
        return TestUsers.seed(email = email, password = password, roles = emptySet()) to email
    }

    @Test
    fun `a non-MFA login mints SIGNED_IN mfa=false, owner and actor the account, and a logout mints SIGNED_OUT`() =
        testApplication {
            usePostgresTestcontainer()
            val (id, email) = seed("acct")
            val client = jsonClient()
            val tokens = client.login(email).body<LoginResponse>()
            val signedIn = rowsOf(id).single()
            assertEquals("SIGNED_IN", signedIn.type)
            assertEquals(id, signedIn.actor)
            assertEquals(mapOf("mfa" to "false"), signedIn.params)

            val logout = client.post("/api/v1/logout") {
                header(HttpHeaders.Authorization, "Bearer ${tokens.token}")
                contentType(ContentType.Application.Json)
                setBody("{}")
            }
            assertEquals(HttpStatusCode.NoContent, logout.status)
            val rows = rowsOf(id)
            assertEquals(listOf("SIGNED_IN", "SIGNED_OUT"), rows.map { it.type })
            assertEquals(id, rows[1].actor)
            assertEquals(emptyMap(), rows[1].params)
        }

    @Test
    fun `an MFA login mints SIGNED_IN mfa=true only after the code exchange`() = testApplication {
        usePostgresTestcontainer()
        val adminEmail = uniqueEmail("acct-admin")
        TestUsers.seed(email = adminEmail, password = password)
        val admin = authedClient(adminEmail, password)
        val (id, email) = seed("acct-mfa")
        assertEquals(
            HttpStatusCode.NoContent,
            admin.put("/api/v1/users/$id/features") {
                contentType(ContentType.Application.Json)
                setBody(UserFeaturesUpdateRequest(emptyList()))
            }.status,
        )
        val mail = LogCapture("ch.nokillswit.mail")
        try {
            val client = jsonClient()
            val challenge = client.login(email).body<MfaChallengeResponse>()
            assertTrue(rowsOf(id).isEmpty(), "the password step is not a completed sign-in")
            // A wrong code (a uniform 401) mints nothing either.
            val wrong = client.post("/api/v1/login/mfa") {
                contentType(ContentType.Application.Json)
                setBody(MfaVerifyRequest(challenge.challengeId, "000000"))
            }
            assertEquals(HttpStatusCode.Unauthorized, wrong.status)
            assertTrue(rowsOf(id).isEmpty())

            val message = mail.awaitEvent { "To: $email" in it.formattedMessage }?.formattedMessage
            val code = Regex("""(?m)^\d{6}$""").find(assertNotNull(message))!!.value
            val ok = client.post("/api/v1/login/mfa") {
                contentType(ContentType.Application.Json)
                setBody(MfaVerifyRequest(challenge.challengeId, code))
            }
            assertEquals(HttpStatusCode.OK, ok.status)
            assertEquals(mapOf("mfa" to "true"), rowsOf(id).single().params)
        } finally {
            mail.detach()
        }
    }

    @Test
    fun `refresh, a wrong password, a lockout and a deactivated account mint nothing`() = testApplication {
        usePostgresTestcontainer()
        val (id, email) = seed("acct-none")
        val client = jsonClient()
        val tokens = client.login(email).body<LoginResponse>()
        assertEquals(1, rowsOf(id).size)

        // /refresh is not a sign-in.
        val refreshed = client.post("/api/v1/refresh") {
            contentType(ContentType.Application.Json)
            setBody(RefreshRequest(tokens.refreshToken))
        }
        assertEquals(HttpStatusCode.OK, refreshed.status)
        assertEquals(1, rowsOf(id).size)

        // Wrong passwords (a 401 each) until the lockout trips (429): nothing minted.
        repeat(5) { assertEquals(HttpStatusCode.Unauthorized, client.login(email, "wrong-password-$it").status) }
        assertEquals(HttpStatusCode.TooManyRequests, client.login(email).status)
        assertEquals(1, rowsOf(id).size)

        // A deactivated account with correct credentials answers 403 and mints nothing.
        val (deactivatedId, deactivatedEmail) = seed("acct-deact")
        TestServices.users.setDeactivated(deactivatedId, true)
        assertEquals(HttpStatusCode.Forbidden, client.login(deactivatedEmail).status)
        assertTrue(rowsOf(deactivatedId).isEmpty())
    }

    @Test
    fun `a failing history write never fails the login or the logout`() = testApplication {
        usePostgresTestcontainer()
        val failing = object : AccountEventService(TestServices.database) {
            override suspend fun insert(userId: UInt, type: AccountEventType, params: Map<String, String>) =
                error("the history table is on fire")
        }
        application.attributes.put(AccountEventServiceKey, failing)
        val (id, email) = seed("acct-fail")
        val client = jsonClient()
        val login = client.login(email)
        assertEquals(HttpStatusCode.OK, login.status)
        val logout = client.post("/api/v1/logout") {
            header(HttpHeaders.Authorization, "Bearer ${login.body<LoginResponse>().token}")
            contentType(ContentType.Application.Json)
            setBody("{}")
        }
        assertEquals(HttpStatusCode.NoContent, logout.status)
        assertTrue(rowsOf(id).isEmpty(), "nothing was written, and nothing failed")
    }

    @Test
    fun `a failing purge (here a throwing clock) neither fails record nor loses the row`() = runBlocking {
        val id = TestUsers.seed(email = uniqueEmail("acct-purge-fail"), password = password, roles = emptySet())
        val service = AccountEventService(TestServices.database, retentionMillis(1), 0, clock = { error("clock down") })
        service.record(id, AccountEventType.SIGNED_IN, mapOf("mfa" to "false"))
        assertEquals(1, rowsOf(id).size)
    }

    private fun retentionMillis(days: Long) = days * 24 * 60 * 60 * 1000

    @Test
    fun `the purge removes rows older than the retention and keeps newer ones, retention 0 keeps everything`() =
        runBlocking {
            val now = System.currentTimeMillis()
            val id = TestUsers.seed(email = uniqueEmail("acct-purge"), password = password, roles = emptySet())
            suspend fun insertAt(at: Long) = suspendTransaction(TestServices.database) {
                AccountEvents.insert {
                    it[ownerId] = id
                    it[userId] = id
                    it[timestamp] = at
                    it[eventType] = "SIGNED_IN"
                    it[params] = encodeParams(mapOf("mfa" to "false"))
                }
            }
            val day = retentionMillis(1)
            insertAt(now - 3 * day) // stale at a 2-day retention
            insertAt(now - day) // inside the window
            insertAt(now - 2 * day - 60_000) // just past the boundary
            insertAt(now - 2 * day + 60_000) // just inside it

            // Retention 0 never purges.
            AccountEventService(TestServices.database, 0, 0, clock = { now })
                .record(id, AccountEventType.SIGNED_OUT)
            assertEquals(5, rowsOf(id).size)

            // A 2-day retention with interval 0 purges on every record: exactly the two stale rows go.
            AccountEventService(TestServices.database, retentionMillis(2), 0, clock = { now })
                .record(id, AccountEventType.SIGNED_IN, mapOf("mfa" to "true"))
            val left = rowsOf(id)
            assertEquals(4, left.size)
            assertTrue(left.all { it.at >= now - 2 * day })
            // A positive interval gates the DELETE: the second record inside the window purges nothing more.
            insertAt(now - 5 * day)
            val gated = AccountEventService(TestServices.database, retentionMillis(2), 3_600_000, clock = { now })
            gated.record(id, AccountEventType.SIGNED_OUT) // first run: purges the new stale row
            assertEquals(5, rowsOf(id).size)
            insertAt(now - 6 * day)
            gated.record(id, AccountEventType.SIGNED_OUT) // inside the interval: no purge
            assertEquals(7, rowsOf(id).size)
        }

    @Test
    fun `the purge deletes in bounded batches until nothing stale is left`() = runBlocking {
        val now = System.currentTimeMillis()
        val id = TestUsers.seed(email = uniqueEmail("acct-purge-batch"), password = password, roles = emptySet())
        suspend fun insertAt(at: Long) = suspendTransaction(TestServices.database) {
            AccountEvents.insert {
                it[ownerId] = id
                it[userId] = id
                it[timestamp] = at
                it[eventType] = "SIGNED_IN"
                it[params] = encodeParams(mapOf("mfa" to "false"))
            }
        }
        val day = retentionMillis(1)
        repeat(5) { insertAt(now - (10 + it) * day) } // stale at a 2-day retention
        insertAt(now - day / 2) // fresh
        assertEquals(6, rowsOf(id).size)

        // Batch size 2 over 5 stale rows = three non-empty batches plus the empty one that ends the loop.
        AccountEventService(TestServices.database, retentionMillis(2), 0, clock = { now }, purgeBatchSize = 2)
            .record(id, AccountEventType.SIGNED_OUT)
        val left = rowsOf(id)
        // The 5 stale rows are gone; the fresh row and the SIGNED_OUT just recorded stay.
        assertEquals(2, left.size)
        assertTrue(left.all { it.at >= now - 2 * day })
    }

    @Test
    fun `a non-positive purge batch size is refused`() {
        assertFailsWith<IllegalArgumentException> {
            AccountEventService(TestServices.database, purgeBatchSize = 0)
        }
    }

    @Test
    fun `the MFA pending-challenge cap (429), a deactivation between the steps and a revoked-token logout mint nothing`() =
        testApplication {
            usePostgresTestcontainer()
            val adminEmail = uniqueEmail("acct-admin2")
            TestUsers.seed(email = adminEmail, password = password)
            val admin = authedClient(adminEmail, password)
            val (id, email) = seed("acct-cap")
            assertEquals(
                HttpStatusCode.NoContent,
                admin.put("/api/v1/users/$id/features") {
                    contentType(ContentType.Application.Json)
                    setBody(UserFeaturesUpdateRequest(emptyList()))
                }.status,
            )
            val client = jsonClient()
            val mail = LogCapture("ch.nokillswit.mail")
            try {
                // Five live challenges is the cap (security.mfa.maxPendingChallenges): the sixth correct-password
                // login is the uniform 429 — and no sign-in is recorded at any step.
                val challenges = (1..5).map { client.login(email).body<MfaChallengeResponse>() }
                assertEquals(HttpStatusCode.TooManyRequests, client.login(email).status)
                assertTrue(rowsOf(id).isEmpty())

                // Deactivated between the password step and the code exchange: the correct code (of the last
                // emailed challenge) still answers 403 and signs nobody in.
                repeat(100) {
                    if (mail.events.count { "To: $email" in it.formattedMessage } < 5) kotlinx.coroutines.delay(50)
                }
                val lastMail = mail.events.last { "To: $email" in it.formattedMessage }.formattedMessage
                val code = Regex("""(?m)^\d{6}$""").find(lastMail)!!.value
                TestServices.users.setDeactivated(id, true)
                val exchange = client.post("/api/v1/login/mfa") {
                    contentType(ContentType.Application.Json)
                    setBody(MfaVerifyRequest(challenges.last().challengeId, code))
                }
                assertEquals(HttpStatusCode.Forbidden, exchange.status)
                assertTrue(rowsOf(id).isEmpty())
            } finally {
                mail.detach()
            }

            // A logout whose token is already revoked is a 401 and mints nothing more.
            val (loginId, loginEmail) = seed("acct-revoked")
            val token = client.login(loginEmail).body<LoginResponse>().token
            suspend fun logout() = client.post("/api/v1/logout") {
                header(HttpHeaders.Authorization, "Bearer $token")
                contentType(ContentType.Application.Json)
                setBody("{}")
            }
            assertEquals(HttpStatusCode.NoContent, logout().status)
            assertEquals(HttpStatusCode.Unauthorized, logout().status)
            assertEquals(listOf("SIGNED_IN", "SIGNED_OUT"), rowsOf(loginId).map { it.type })
        }

    @Test
    fun `a mail-less deployment answers the MFA login 503 and records nothing`() = testApplication {
        configureApp("mail.transport" to "disabled")
        startApplication()
        val adminEmail = uniqueEmail("acct-admin3")
        TestUsers.seed(email = adminEmail, password = password)
        val admin = authedClient(adminEmail, password)
        val (id, email) = seed("acct-503")
        assertEquals(
            HttpStatusCode.NoContent,
            admin.put("/api/v1/users/$id/features") {
                contentType(ContentType.Application.Json)
                setBody(UserFeaturesUpdateRequest(emptyList()))
            }.status,
        )
        assertEquals(HttpStatusCode.ServiceUnavailable, jsonClient().login(email).status)
        assertTrue(rowsOf(id).isEmpty())
    }
}
