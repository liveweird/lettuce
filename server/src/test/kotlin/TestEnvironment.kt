package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.auth.TokenBlocklistService
import ch.nokillswit.auth.hashPassword
import ch.nokillswit.infra.db.DEMO_SEED_EMAILS
import ch.nokillswit.infra.db.SEED_ADMIN_EMAIL
import ch.nokillswit.infra.db.SEED_PASSWORD_HASH
import ch.nokillswit.users.User
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserService
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.plugins.DefaultRequest
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.config.ApplicationConfig
import io.ktor.server.config.MapApplicationConfig
import io.ktor.server.config.mergeWith
import io.ktor.server.testing.ApplicationTestBuilder
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update

/**
 * Points the app at the shared Testcontainers Postgres (with CSRF off) WITHOUT starting it —
 * callers that assert startup behavior (fail-closed checks) add their own overrides and call
 * `startApplication()` themselves. Later duplicate keys win in [MapApplicationConfig], so
 * [overrides] may replace the defaults listed first.
 */
fun ApplicationTestBuilder.configureApp(vararg overrides: Pair<String, String>) {
    environment {
        config = ApplicationConfig("application.yaml").mergeWith(
            MapApplicationConfig(
                "postgres.jdbcUrl" to PostgresTestSupport.jdbcUrl,
                "postgres.r2dbcUrl" to PostgresTestSupport.r2dbcUrl,
                "postgres.user" to PostgresTestSupport.user,
                "postgres.password" to PostgresTestSupport.password,
                "security.csrf.enabled" to "false",
                *overrides,
            )
        )
    }
}

suspend fun ApplicationTestBuilder.usePostgresTestcontainer() {
    configureApp()
    startApplication()
}

fun ApplicationTestBuilder.jsonClient(): HttpClient = createClient {
    install(ContentNegotiation) { json(); json(contentType = ContentType.parse("application/problem+json")) }
}

/** A unique throwaway email so tests never collide on the partial-unique active-email index. */
fun uniqueEmail(prefix: String) = "$prefix-${java.util.UUID.randomUUID()}@test"

/**
 * A strong (random, non-burned) 64-hex-char data-encryption key. Production-mode boot tests
 * override `security.encryption.key` with this, since the application.yaml dev default is on
 * the burned list and refuses to start outside development.
 */
fun strongEncryptionKey(): String =
    (java.util.UUID.randomUUID().toString() + java.util.UUID.randomUUID().toString()).replace("-", "")

/** Logs in as [email] and returns a client that sends the bearer token on every request. */
suspend fun ApplicationTestBuilder.authedClient(email: String, password: String): HttpClient {
    val client = jsonClient()
    val token = client.post("/api/v1/login") {
        contentType(ContentType.Application.Json)
        setBody(LoginRequest(email, password))
    }.body<LoginResponse>().token
    return createClient {
        install(ContentNegotiation) { json(); json(contentType = ContentType.parse("application/problem+json")) }
        install(DefaultRequest) {
            header(HttpHeaders.Authorization, "Bearer $token")
        }
    }
}

/**
 * Captures a logger's events with a Logback ListAppender (the audit trail on
 * `ch.nokillswit.audit`, delivered email on the `ch.nokillswit.mail` log transport).
 * Use in a try/finally with [detach]; [awaitEvent] polls for asynchronously produced events.
 */
class LogCapture(loggerName: String) {
    private val logger = org.slf4j.LoggerFactory.getLogger(loggerName) as ch.qos.logback.classic.Logger
    private val appender = ch.qos.logback.core.read.ListAppender<ch.qos.logback.classic.spi.ILoggingEvent>()

    init {
        appender.start()
        logger.addAppender(appender)
    }

    val events: List<ch.qos.logback.classic.spi.ILoggingEvent> get() = appender.list

    fun detach() = logger.detachAppender(appender)

    suspend fun awaitEvent(
        predicate: (ch.qos.logback.classic.spi.ILoggingEvent) -> Boolean,
    ): ch.qos.logback.classic.spi.ILoggingEvent? {
        repeat(100) {
            events.firstOrNull(predicate)?.let { return it }
            kotlinx.coroutines.delay(50)
        }
        return null
    }
}

/** audit() fields travel as SLF4J key/values, not in the message text. */
fun ch.qos.logback.classic.spi.ILoggingEvent.hasKeyValue(key: String, value: String) =
    keyValuePairs?.any { it.key == key && it.value == value } == true

private val sharedTestDatabase: R2dbcDatabase by lazy {
    R2dbcDatabase.connect(
        url = PostgresTestSupport.r2dbcUrl,
        user = PostgresTestSupport.user,
        password = PostgresTestSupport.password,
    )
}

object TestUsers {
    private val service: UserService by lazy { UserService(sharedTestDatabase) }

    suspend fun seed(
        email: String,
        password: String,
        name: String = "Test",
        role: UserRole = UserRole.ADMIN,
    ): UInt = service.create(
        User(
            name = name,
            email = email,
            passwordHash = hashPassword(password, cost = 4),
            role = role,
        )
    )
}

object TestBlocklist {
    val service: TokenBlocklistService by lazy { TokenBlocklistService(sharedTestDatabase) }
}

// Bootstrap tests (and prod-mode boot tests) rotate the seed admin password and soft-delete the
// demo users in the SHARED container. Call this afterwards to put the V6/V9 seed state back so
// later tests (and re-runs) see the pristine seeds.
object TestSeedState {
    suspend fun restoreSeedAccounts() {
        suspendTransaction(sharedTestDatabase) {
            UserService.Users.update({
                UserService.Users.email inList (DEMO_SEED_EMAILS + SEED_ADMIN_EMAIL)
            }) {
                it[UserService.Users.passwordHash] = SEED_PASSWORD_HASH
                it[UserService.Users.markedAsDeleted] = false
                it[UserService.Users.passwordChangedAt] = 0
            }
        }
    }
}

// Reads the feedback_events audit table directly (e.g. to assert ON DELETE CASCADE).
object TestFeedbackEvents {
    val service: ch.nokillswit.feedbacks.FeedbackEventService by lazy {
        ch.nokillswit.feedbacks.FeedbackEventService(sharedTestDatabase)
    }
}

// Direct service access for service-level contracts the routes cannot exercise — e.g. blank
// filter strings are stripped by optionalString before a service ever sees them, and the
// routes 404 on a missing row before calling editContent/transition/addMember.
object TestServices {
    // Same dev-default key the booted test app uses (application.yaml), so service-level writes
    // and route-level reads interoperate.
    val cipher: ch.nokillswit.infra.crypto.FieldCipher by lazy {
        ch.nokillswit.infra.crypto.FieldCipher(ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY)
    }
    val feedbacks: ch.nokillswit.feedbacks.FeedbackService by lazy {
        ch.nokillswit.feedbacks.FeedbackService(sharedTestDatabase, cipher)
    }
    val teams: ch.nokillswit.teams.TeamService by lazy {
        ch.nokillswit.teams.TeamService(sharedTestDatabase)
    }
    val users: UserService by lazy { UserService(sharedTestDatabase) }
    val alerts: ch.nokillswit.alerts.AlertService by lazy {
        ch.nokillswit.alerts.AlertService(sharedTestDatabase)
    }
    val oneOnOnes: ch.nokillswit.oneonones.OneOnOneService by lazy {
        ch.nokillswit.oneonones.OneOnOneService(sharedTestDatabase, cipher)
    }
}

// Soft-deletes a 1:1 meeting directly, bypassing the latest-only-delete guard (v1.14). A soft-deleted
// meeting inside a surviving copy-chain is unreachable via the API — only the pair's tail meeting can
// be deleted, and carry-over re-parents onto the latest surviving one — so this is the only way to
// exercise the history walker's skip-but-traverse-through-a-deleted-meeting branch.
object TestOneOnOneMaintenance {
    suspend fun softDeleteMeeting(id: UInt) {
        suspendTransaction(sharedTestDatabase) {
            ch.nokillswit.oneonones.OneOnOneService.Meetings.update({
                ch.nokillswit.oneonones.OneOnOneService.Meetings.id eq id
            }) {
                it[ch.nokillswit.oneonones.OneOnOneService.Meetings.markedAsDeleted] = true
            }
        }
    }
}

// Reads the one_on_one_events audit table directly (e.g. to assert events outlive a soft delete).
object TestOneOnOneEvents {
    val service: ch.nokillswit.oneonones.OneOnOneEventService by lazy {
        ch.nokillswit.oneonones.OneOnOneEventService(sharedTestDatabase)
    }
}

// There is no create endpoint for notifications (they are minted as a side-effect of
// other activities), so tests seed rows by calling the service directly.
object TestNotifications {
    val service: ch.nokillswit.notifications.NotificationService by lazy {
        ch.nokillswit.notifications.NotificationService(sharedTestDatabase)
    }

    // Notifications are now typed + structured; tests only need distinguishable rows, so a fixed
    // type carries the caller's [label] as a param.
    suspend fun seed(recipientId: UInt, label: String = "Hello", link: String? = "/somewhere"): UInt =
        service.create(
            ch.nokillswit.notifications.Notification(
                recipientId = recipientId,
                type = ch.nokillswit.notifications.NotificationType.FEEDBACK_SENT_TO_SUBJECT,
                params = mapOf("subject" to label),
                link = link,
            )
        )
}
