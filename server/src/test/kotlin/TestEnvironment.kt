package ch.nokillswit

import ch.nokillswit.auth.LoginRequest
import ch.nokillswit.auth.LoginResponse
import ch.nokillswit.auth.TokenBlocklistService
import ch.nokillswit.auth.hashPassword
import ch.nokillswit.infra.db.DEMO_SEED_EMAILS
import ch.nokillswit.infra.db.HR_DEMO_EMAIL
import ch.nokillswit.infra.db.SEED_ADMIN_EMAIL
import ch.nokillswit.infra.db.SEED_PASSWORD_HASH
import ch.nokillswit.users.User
import ch.nokillswit.users.UserRole
import ch.nokillswit.users.UserService
import io.ktor.client.HttpClient
import io.ktor.client.HttpClientConfig
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
import io.ktor.server.testing.TestApplicationBuilder
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.deleteWhere
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update

/**
 * Points the app at the shared Testcontainers Postgres (with CSRF off) WITHOUT starting it —
 * callers that assert startup behavior (fail-closed checks) add their own overrides and call
 * `startApplication()` themselves. Later duplicate keys win in [MapApplicationConfig], so
 * [overrides] may replace the defaults listed first.
 *
 * Receiver is the base [TestApplicationBuilder] (not [ApplicationTestBuilder]) so this also
 * works inside an explicit `TestApplication { … }` block — needed to boot two independent
 * app instances over the shared container (see `AuthStateAcrossInstancesTest`).
 */
fun TestApplicationBuilder.configureApp(vararg overrides: Pair<String, String>) {
    environment {
        config = ApplicationConfig("application.yaml").mergeWith(
            MapApplicationConfig(
                "postgres.jdbcUrl" to PostgresTestSupport.jdbcUrl,
                "postgres.r2dbcUrl" to PostgresTestSupport.r2dbcUrl,
                "postgres.user" to PostgresTestSupport.user,
                "postgres.password" to PostgresTestSupport.password,
                "security.csrf.enabled" to "false",
                // 0 = every GET sweeps (the pre-v3.11.0 semantics) — matches TestServices.feedbacks
                // above so route-level and service-level test assertions stay in lockstep; a test
                // exercising the gate itself overrides this explicitly.
                "feedbacks.expirySweepIntervalSeconds" to "0",
                // Same idiom as above for the v3.12.0 notification purge (retention stays the
                // 30-day default) — the gate test overrides this explicitly.
                "notifications.purgeIntervalSeconds" to "0",
                *overrides,
            )
        )
    }
}

suspend fun ApplicationTestBuilder.usePostgresTestcontainer() {
    configureApp()
    startApplication()
}

/**
 * Shared config for every test HTTP client: JSON (+ problem+json) negotiation and the
 * [OpenApiConformance] plugin, which validates each /api/ interaction against the OpenAPI spec.
 */
fun HttpClientConfig<*>.lettuceTestClientDefaults() {
    install(ContentNegotiation) { json(); json(contentType = ContentType.parse("application/problem+json")) }
    install(OpenApiConformance)
}

fun ApplicationTestBuilder.jsonClient(): HttpClient = createClient { lettuceTestClientDefaults() }

/** A unique throwaway email so tests never collide on the partial-unique active-email index. */
fun uniqueEmail(prefix: String) = "$prefix-${java.util.UUID.randomUUID()}@test"

/** Asserts the app refuses to start and that the failure cause chain mentions [messagePart]. */
suspend fun assertStartupFails(messagePart: String, start: suspend () -> Unit) {
    val failure = runCatching { start() }.exceptionOrNull()
    kotlin.test.assertNotNull(failure, "startup must fail closed")
    val messages = generateSequence(failure) { it.cause }.mapNotNull { it.message }.joinToString(" | ")
    kotlin.test.assertTrue(messagePart in messages, "unexpected startup failure: $messages")
}

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
        lettuceTestClientDefaults()
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
        // ListAppender's backing list is a plain ArrayList: a capture on a busy logger (ROOT —
        // the metrics reporter, OTel) throws ConcurrentModificationException when a test iterates
        // it while another thread appends. Copy-on-write makes reads safe (v3.6.2).
        appender.list = java.util.concurrent.CopyOnWriteArrayList()
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
    // Guarantees the schema exists even when no testApplication has booted yet in this JVM
    // (see the note on PostgresTestSupport.ensureMigrated).
    PostgresTestSupport.ensureMigrated()
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
        roles: Set<UserRole> = setOf(UserRole.ADMIN),
        language: String = "en",
    ): UInt = service.create(
        User(
            name = name,
            email = email,
            passwordHash = hashPassword(password, cost = 4),
            roles = roles,
            language = language,
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
    /**
     * The HR demo account (v4.1.0) is seeded only by a development-mode `configureBootstrap`
     * boot — never a migration — so unlike the V6/V9 accounts above, its existence in the
     * shared container is NOT guaranteed before the first `testApplication` boots in this JVM
     * (test class/method order is not otherwise controlled). Ensures the row exists — creating
     * it with the pristine dev-seed shape (the [SEED_PASSWORD_HASH], the `HR` role, the MFA
     * disabled-feature row) if this is the very first call in the run — and returns its id, so
     * [restoreSeedAccounts] never has to silently skip the row when it "should" be there.
     */
    private suspend fun ensureHrDemoAccountExists(): UInt = suspendTransaction(sharedTestDatabase) {
        UserService.Users.selectAll()
            .where { UserService.Users.email eq HR_DEMO_EMAIL }
            .map { it[UserService.Users.id].value }
            .toList()
            .also { ids ->
                // Two rows at one email (e.g. one soft-deleted, one active) would make the
                // email-keyed undelete below violate uq_users_email_active — fail loudly here.
                check(ids.size <= 1) { "expected at most one $HR_DEMO_EMAIL row, found ${ids.size}" }
            }
            .singleOrNull()
            ?: run {
                val newId = UserService.Users.insert {
                    it[name] = "HR Auditor"
                    it[email] = HR_DEMO_EMAIL
                    it[passwordHash] = SEED_PASSWORD_HASH
                }[UserService.Users.id].value
                UserService.UserRoles.insert {
                    it[UserService.UserRoles.userId] = newId
                    it[UserService.UserRoles.role] = UserRole.HR.name
                }
                UserService.UserDisabledFeatures.insert {
                    it[UserService.UserDisabledFeatures.userId] = newId
                    it[UserService.UserDisabledFeatures.feature] = ch.nokillswit.users.Feature.MFA.name
                }
                UserService.UserDisabledFeatures.insert {
                    it[UserService.UserDisabledFeatures.userId] = newId
                    it[UserService.UserDisabledFeatures.feature] = ch.nokillswit.users.Feature.TEAMS_NOTIFICATIONS.name
                }
                newId
            }
    }

    /**
     * Moves every row at [HR_DEMO_EMAIL] to a throwaway address, so a following dev-mode boot's
     * seed (or its absence) is observable; returns the moved ids for [restoreHrDemoAccount].
     */
    suspend fun moveHrDemoAccountAside(): Set<UInt> = suspendTransaction(sharedTestDatabase) {
        val ids = UserService.Users.selectAll()
            .where { UserService.Users.email eq HR_DEMO_EMAIL }
            .map { it[UserService.Users.id].value }
            .toList()
        ids.forEach { id ->
            UserService.Users.update({ UserService.Users.id eq id }) { it[email] = "hr-aside-$id@test" }
        }
        ids.toSet()
    }

    /**
     * Undoes [moveHrDemoAccountAside]: a row a boot seeded meanwhile is parked (renamed and
     * soft-deleted — user rows are never hard-deleted), the moved rows get their address back,
     * then the full seed reset runs.
     */
    suspend fun restoreHrDemoAccount(moved: Set<UInt>) {
        suspendTransaction(sharedTestDatabase) {
            UserService.Users.update({ UserService.Users.email eq HR_DEMO_EMAIL }) {
                it[email] = "hr-seeded-${java.util.UUID.randomUUID()}@test"
                it[markedAsDeleted] = true
            }
            moved.forEach { id ->
                UserService.Users.update({ UserService.Users.id eq id }) { it[email] = HR_DEMO_EMAIL }
            }
        }
        restoreSeedAccounts()
    }

    suspend fun restoreSeedAccounts() {
        // Guarantees the row exists (see KDoc above) BEFORE the shared reset below, so the HR
        // demo email can ride the exact same email-keyed queries as every other seed account.
        val hrId = ensureHrDemoAccountExists()
        suspendTransaction(sharedTestDatabase) {
            val seedEmails = DEMO_SEED_EMAILS + SEED_ADMIN_EMAIL + HR_DEMO_EMAIL
            UserService.Users.update({
                UserService.Users.email inList seedEmails
            }) {
                it[UserService.Users.passwordHash] = SEED_PASSWORD_HASH
                it[UserService.Users.markedAsDeleted] = false
                it[UserService.Users.deactivated] = false
                it[UserService.Users.passwordChangedAt] = 0
                // A test flipping a seed account's language (V61) must not leak into the
                // shared container — every seed account is English.
                it[UserService.Users.language] = "en"
            }
            // Also drop any feature flags a test left on the seed accounts (V46)…
            val seedIds = UserService.Users.selectAll()
                .where { UserService.Users.email inList seedEmails }
                .map { it[UserService.Users.id].value }
                .toList()
            UserService.UserDisabledFeatures.deleteWhere {
                UserService.UserDisabledFeatures.userId inList seedIds
            }
            // …but the pristine V52/V85 state INCLUDES the inverted-default MFA and
            // TEAMS_NOTIFICATIONS rows on every seed account — without the MFA one, seed-account
            // logins answer an MFA challenge and every later test decoding LoginResponse breaks.
            seedIds.forEach { id ->
                UserService.UserDisabledFeatures.insert {
                    it[UserService.UserDisabledFeatures.userId] = id
                    it[UserService.UserDisabledFeatures.feature] = ch.nokillswit.users.Feature.MFA.name
                }
                UserService.UserDisabledFeatures.insert {
                    it[UserService.UserDisabledFeatures.userId] = id
                    it[UserService.UserDisabledFeatures.feature] = ch.nokillswit.users.Feature.TEAMS_NOTIFICATIONS.name
                }
            }
            // Also drop any DB-backed auth state (V81) a test left on the seed accounts — a
            // lingering lockout/throttle/challenge row would otherwise leak into later tests
            // reusing the same seed email (e.g. BootstrapTest's deliberate 401 on
            // admin@lettuce.local).
            ch.nokillswit.auth.LoginThrottle.LoginLockouts.deleteWhere {
                ch.nokillswit.auth.LoginThrottle.LoginLockouts.email inList seedEmails
            }
            ch.nokillswit.auth.PasswordResetThrottle.PasswordResetRequests.deleteWhere {
                ch.nokillswit.auth.PasswordResetThrottle.PasswordResetRequests.email inList seedEmails
            }
            // …and any pending MFA challenges (v3.11.0/V81) a test left mid-flight on a seed
            // account — keyed by user id (not email, unlike the two throttle stores above), so
            // reuse the seedIds gathered for the feature-flag reset just above.
            ch.nokillswit.auth.MfaChallenges.Challenges.deleteWhere {
                ch.nokillswit.auth.MfaChallenges.Challenges.userId inList seedIds.map { it.toLong() }
            }
            // The HR demo account's roles: unlike the generic seed accounts above (never
            // role-reset — their role set is not something tests mutate), a test may add/remove
            // roles on the HR account (it's an ordinary user account otherwise) — restore to
            // exactly {HR} so the pristine seed state never leaks into a later test.
            UserService.UserRoles.deleteWhere { UserService.UserRoles.userId eq hrId }
            UserService.UserRoles.insert {
                it[UserService.UserRoles.userId] = hrId
                it[UserService.UserRoles.role] = UserRole.HR.name
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
    // The shared handle itself — e.g. for tests that assert directly against the DB-backed
    // auth-state tables (login_lockouts/password_reset_requests/mfa_challenges, V81).
    val database: R2dbcDatabase get() = sharedTestDatabase

    // Same dev-default key the booted test app uses (application.yaml), so service-level writes
    // and route-level reads interoperate.
    val cipher: ch.nokillswit.infra.crypto.FieldCipher by lazy {
        ch.nokillswit.infra.crypto.FieldCipher(ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY)
    }
    val feedbacks: ch.nokillswit.feedbacks.FeedbackService by lazy {
        // sweepIntervalMillis = 0: every call sweeps (the pre-v3.11.0 semantics), matching the
        // booted test app's config override below.
        ch.nokillswit.feedbacks.FeedbackService(sharedTestDatabase, cipher, sweepIntervalMillis = 0)
    }
    val teams: ch.nokillswit.teams.TeamService by lazy {
        ch.nokillswit.teams.TeamService(sharedTestDatabase)
    }
    val users: UserService by lazy { UserService(sharedTestDatabase) }
    val careerPositions: ch.nokillswit.users.CareerPositionService by lazy {
        ch.nokillswit.users.CareerPositionService(sharedTestDatabase)
    }
    val alerts: ch.nokillswit.alerts.AlertService by lazy {
        ch.nokillswit.alerts.AlertService(sharedTestDatabase)
    }
    val oneOnOnes: ch.nokillswit.oneonones.OneOnOneService by lazy {
        ch.nokillswit.oneonones.OneOnOneService(sharedTestDatabase, cipher)
    }
    val goals: ch.nokillswit.goals.GoalService by lazy {
        ch.nokillswit.goals.GoalService(sharedTestDatabase, cipher)
    }
    val teamKpis: ch.nokillswit.teamkpis.TeamKpiService by lazy {
        ch.nokillswit.teamkpis.TeamKpiService(sharedTestDatabase, cipher)
    }
    val reviewPeriods: ch.nokillswit.reviews.ReviewPeriodService by lazy {
        ch.nokillswit.reviews.ReviewPeriodService(sharedTestDatabase)
    }
    val performanceReviews: ch.nokillswit.reviews.PerformanceReviewService by lazy {
        ch.nokillswit.reviews.PerformanceReviewService(sharedTestDatabase, cipher)
    }
    val impactLog: ch.nokillswit.impactlog.ImpactLogService by lazy {
        ch.nokillswit.impactlog.ImpactLogService(sharedTestDatabase, cipher)
    }
    val successionPlans: ch.nokillswit.succession.SuccessionPlanService by lazy {
        ch.nokillswit.succession.SuccessionPlanService(sharedTestDatabase, cipher)
    }
    val notificationPreferences: ch.nokillswit.notifications.NotificationPreferenceService by lazy {
        ch.nokillswit.notifications.NotificationPreferenceService(sharedTestDatabase)
    }
}

// The review-period timeline is GLOBAL, append-only, and gapless — shared mutable state in the
// shared container, like the dictionaries. Tests must never hand-pick absolute months: always
// append after the current latest via this helper, and treat the returned period as theirs.
object TestReviewPeriods {
    /** Appends the next adjacent period ([months] long) and returns it. The first ever period
     *  starts at a fixed epoch far in the past, so the timeline never depends on wall time. */
    suspend fun append(months: Int = 6): ch.nokillswit.reviews.ReviewPeriod {
        val latest = TestServices.reviewPeriods.list().lastOrNull()
        val start = if (latest == null) {
            java.time.YearMonth.of(2000, 1)
        } else {
            java.time.YearMonth.parse(latest.endMonth).plusMonths(1)
        }
        val id = TestServices.reviewPeriods.create(
            ch.nokillswit.reviews.ReviewPeriodCreateRequest(
                startMonth = start.toString(),
                endMonth = start.plusMonths((months - 1).toLong()).toString(),
            ),
        )
        return checkNotNull(TestServices.reviewPeriods.read(id))
    }
}

// Reads dictionary_entries rows raw, soft-deleted included (the API read filters active), to
// assert that omitted entries are flagged rather than physically removed.
object TestDictionaries {
    data class RawEntry(
        val id: UInt,
        val valueEn: String,
        val translations: Map<String, String>,
        val markedAsDeleted: Boolean,
    )

    val service: ch.nokillswit.dictionaries.DictionaryService by lazy {
        ch.nokillswit.dictionaries.DictionaryService(sharedTestDatabase)
    }

    suspend fun rawRows(dict: ch.nokillswit.dictionaries.Dictionary): List<RawEntry> =
        suspendTransaction(sharedTestDatabase) {
            val t = ch.nokillswit.dictionaries.DictionaryService.Entries
            t.selectAll()
                .where { t.dictionary eq dict.name }
                .map {
                    RawEntry(
                        it[t.id].value,
                        it[t.valueEn],
                        kotlinx.serialization.json.Json.decodeFromString<Map<String, String>>(it[t.translations]),
                        it[t.markedAsDeleted],
                    )
                }
                .toList()
        }

    /**
     * Appends [values] to [dict] via whole-document replace, preserving the existing active
     * entries (dictionaries are shared global state — use unique values per test), and returns
     * the minted ids in [values] order. If a previous test left the dictionary at the 200-entry
     * cap (DictionaryTest's limit case does), enough head entries are dropped to make room —
     * every dictionary test starts by writing its own document, so that is safe by convention.
     */
    suspend fun append(dict: ch.nokillswit.dictionaries.Dictionary, vararg values: String): List<UInt> {
        val kept = service.read(dict).take(ch.nokillswit.dictionaries.MAX_DICTIONARY_ENTRIES - values.size)
        service.replace(
            dict,
            ch.nokillswit.dictionaries.DictionaryUpdateRequest(
                kept.map { ch.nokillswit.dictionaries.DictionaryEntryInput(it.id, it.values) } +
                    // N-language entries (V60): tests that don't care about translations
                    // write EN only — display falls back to English anyway.
                    values.map { ch.nokillswit.dictionaries.DictionaryEntryInput(values = mapOf("en" to it)) },
            ),
        )
        val byValue = service.read(dict).associate { it.values.getValue("en") to it.id }
        return values.map { byValue.getValue(it) }
    }

    /** Renames entry [id] in place (identity kept, EN only), leaving everything else untouched. */
    suspend fun rename(dict: ch.nokillswit.dictionaries.Dictionary, id: UInt, newValue: String) {
        service.replace(
            dict,
            ch.nokillswit.dictionaries.DictionaryUpdateRequest(
                service.read(dict).map {
                    if (it.id == id) {
                        ch.nokillswit.dictionaries.DictionaryEntryInput(it.id, mapOf("en" to newValue))
                    } else {
                        ch.nokillswit.dictionaries.DictionaryEntryInput(it.id, it.values)
                    }
                },
            ),
        )
    }

    /** Soft-deletes entry [id] by omitting it from a whole-document save. */
    suspend fun remove(dict: ch.nokillswit.dictionaries.Dictionary, id: UInt) {
        service.replace(
            dict,
            ch.nokillswit.dictionaries.DictionaryUpdateRequest(
                service.read(dict).filterNot { it.id == id }
                    .map { ch.nokillswit.dictionaries.DictionaryEntryInput(it.id, it.values) },
            ),
        )
    }
}

// Reads the team_kpi_events audit table directly (e.g. to assert events outlive a soft delete).
object TestTeamKpiEvents {
    val service: ch.nokillswit.teamkpis.TeamKpiEventService by lazy {
        ch.nokillswit.teamkpis.TeamKpiEventService(sharedTestDatabase)
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

// Backdates a goal's due date directly, bypassing the not-in-the-past validation — the only way
// to put a goal into the "stale due date" state (e.g. to exercise the activate gate or the SPA's
// overdue signal), since the API refuses past dates on every write.
object TestGoalMaintenance {
    suspend fun setDueDate(id: UInt, dueDate: String) {
        suspendTransaction(sharedTestDatabase) {
            ch.nokillswit.goals.GoalService.Goals.update({
                ch.nokillswit.goals.GoalService.Goals.id eq id
            }) {
                it[ch.nokillswit.goals.GoalService.Goals.dueDate] = dueDate
            }
        }
    }
}

// Reads the goal_events audit table directly (e.g. to assert events outlive a soft delete).
// Shares the dev-default cipher so encrypted progress-update comments round-trip.
object TestGoalEvents {
    val service: ch.nokillswit.goals.GoalEventService by lazy {
        ch.nokillswit.goals.GoalEventService(sharedTestDatabase, TestServices.cipher)
    }
}

// Reads the performance_review_events audit table directly (events outlive a soft delete).
object TestPerformanceReviewEvents {
    val service: ch.nokillswit.reviews.PerformanceReviewEventService by lazy {
        ch.nokillswit.reviews.PerformanceReviewEventService(sharedTestDatabase)
    }
}

// Days-off test support: the allowance is chain-manager-assignable via PUT /days-off/allowance
// (v2.32.0), but tests set it directly (no manager relationship needed for a fixture). Since
// v3.2.0/V74 an allowance is a per-user POOL grant (days_off_pools, one per pool kind): the
// helper upserts the active grant of [poolTypeId] (default = the seeded default kind, id 1),
// and `null` hard-deletes it — clearing is only possible here (the API archives instead).
// Direct service access rides TestServices.
object TestDaysOff {
    /** The V74-seeded default pool kind's id (the first row of a fresh registry). */
    const val DEFAULT_POOL_TYPE_ID: UInt = 1u

    val service: ch.nokillswit.daysoff.DaysOffService by lazy {
        ch.nokillswit.daysoff.DaysOffService(sharedTestDatabase, TestServices.cipher)
    }
    val holidays: ch.nokillswit.daysoff.PublicHolidayService by lazy {
        ch.nokillswit.daysoff.PublicHolidayService(sharedTestDatabase)
    }

    /** A fresh extra pool kind (unique name — the registry is suite-shared); returns its id. */
    suspend fun createPoolType(prefix: String, carriesOver: Boolean = true): UInt =
        service.createPoolType(
            ch.nokillswit.daysoff.DaysOffPoolTypeWrite(
                name = "$prefix ${java.util.UUID.randomUUID().toString().take(8)}",
                carriesOver = carriesOver,
            ),
        )

    suspend fun setAllowance(userId: UInt, days: Int?, poolTypeId: UInt = DEFAULT_POOL_TYPE_ID) {
        val pools = ch.nokillswit.daysoff.DaysOffService.Pools
        suspendTransaction(sharedTestDatabase) {
            val activeGrant = (pools.userId eq userId) and (pools.poolTypeId eq poolTypeId) and
                (pools.markedAsDeleted eq false)
            if (days == null) {
                pools.deleteWhere { activeGrant }
                return@suspendTransaction
            }
            val updated = pools.update({ activeGrant }) {
                it[pools.allowance] = days
                it[pools.lastModified] = System.currentTimeMillis()
            }
            if (updated == 0) {
                val now = System.currentTimeMillis()
                pools.insert {
                    it[pools.userId] = userId
                    it[pools.poolTypeId] = poolTypeId
                    it[pools.allowance] = days
                    it[pools.createdAt] = now
                    it[pools.lastModified] = now
                }
            }
        }
    }
}

// Pulse test support. The one-non-terminal-cycle invariant (V48's partial unique index) is
// GLOBAL shared state in the shared container — every test that schedules a cycle must start
// with [sweepNonTerminal] and leave the registry terminal (close/cancel what it created), or
// later tests' schedules 409. [forceStatus]/[addParticipants] bypass the real open/close
// transitions (the TestGoalMaintenance direct-update idiom) so results fixtures can build
// multi-cycle histories over a handful of test users WITHOUT snapshotting the container's
// whole accumulated user population (and spraying notifications at it) on every open.
object TestPulse {
    val cycles: ch.nokillswit.pulse.PulseCycleService by lazy {
        ch.nokillswit.pulse.PulseCycleService(sharedTestDatabase)
    }
    val responses: ch.nokillswit.pulse.PulseResponseService by lazy {
        ch.nokillswit.pulse.PulseResponseService(sharedTestDatabase, TestServices.cipher)
    }

    suspend fun sweepNonTerminal() {
        cycles.list()
            .filter {
                it.status == ch.nokillswit.pulse.PulseCycleStatus.SCHEDULED ||
                    it.status == ch.nokillswit.pulse.PulseCycleStatus.OPEN
            }
            .forEach { cycles.cancel(it.id) }
    }

    /**
     * A closedAt base strictly after EVERY existing cycle's — tests that build multi-cycle
     * timelines (previous-cycle deltas, trends) must anchor here, or an earlier test's
     * future-skewed closedAt can hijack the "immediately preceding closed cycle" lookup.
     */
    suspend fun closedAtAfterAll(): Long = maxOf(
        System.currentTimeMillis(),
        (cycles.list().mapNotNull { it.closedAt }.maxOrNull() ?: 0L) + 1,
    )

    suspend fun forceStatus(
        id: UInt,
        status: ch.nokillswit.pulse.PulseCycleStatus,
        openedAt: Long? = null,
        closedAt: Long? = null,
    ) {
        suspendTransaction(sharedTestDatabase) {
            val t = ch.nokillswit.pulse.PulseCycleService.PulseCycles
            t.update({ t.id eq id }) {
                it[t.status] = status
                if (openedAt != null) it[t.openedAt] = openedAt
                if (closedAt != null) it[t.closedAt] = closedAt
            }
        }
    }

    suspend fun addParticipants(cycleId: UInt, userIds: Collection<UInt>) {
        suspendTransaction(sharedTestDatabase) {
            val t = ch.nokillswit.pulse.PulseResponseService.PulseParticipants
            userIds.forEach { userId ->
                t.insert {
                    it[t.cycleId] = cycleId
                    it[t.userId] = userId
                }
            }
        }
    }

    /**
     * Schedules a cycle and forces it straight to CLOSED with exactly [respondents]' answers
     * (+[silentParticipants] who never answered) — one line of a results fixture's history.
     * [closedAt] orders the timeline explicitly. Returns the cycle row.
     */
    suspend fun closedCycleWith(
        respondents: Map<UInt, ch.nokillswit.pulse.PulseResponseSubmitRequest>,
        silentParticipants: Collection<UInt> = emptyList(),
        closedAt: Long = System.currentTimeMillis(),
    ): ch.nokillswit.pulse.PulseCycleRow {
        val id = cycles.schedule(
            ch.nokillswit.pulse.PulseCycleCreateRequest(
                plannedOpenDate = "2099-01-01",
                plannedCloseDate = "2099-01-08",
            ),
        )
        addParticipants(id, respondents.keys + silentParticipants)
        forceStatus(id, ch.nokillswit.pulse.PulseCycleStatus.OPEN, openedAt = closedAt - 1)
        respondents.forEach { (userId, answers) -> responses.upsert(id, userId, answers) }
        forceStatus(id, ch.nokillswit.pulse.PulseCycleStatus.CLOSED, closedAt = closedAt)
        return checkNotNull(cycles.read(id))
    }
}

// There is no create endpoint for notifications (they are minted as a side-effect of
// other activities), so tests seed rows by calling the service directly.
object TestNotifications {
    val service: ch.nokillswit.notifications.NotificationService by lazy {
        ch.nokillswit.notifications.NotificationService(sharedTestDatabase)
    }

    // Notifications are now typed + structured; tests only need distinguishable rows, so a fixed
    // type carries the caller's [label] as a param. `!!`: FEEDBACK_SENT_TO_SUBJECT is never
    // locked-on and this recipient has no preferences configured (v4.0.0), so the insert never
    // suppresses.
    suspend fun seed(recipientId: UInt, label: String = "Hello", link: String? = "/somewhere"): UInt =
        service.create(
            ch.nokillswit.notifications.Notification(
                recipientId = recipientId,
                type = ch.nokillswit.notifications.NotificationType.FEEDBACK_SENT_TO_SUBJECT,
                params = mapOf("subject" to label),
                link = link,
            )
        )!!

    /**
     * Inserts a row carrying an ARBITRARY stored type name, bypassing [NotificationType] — the
     * only way to reproduce what an upgrade leaves behind, since [service].create takes the
     * typed enum and so can never write a name this build does not know. Backs the
     * `NotificationService.knownType()` guard's test (v3.25.3).
     */
    suspend fun seedRawType(recipientId: UInt, storedType: String): UInt =
        suspendTransaction(sharedTestDatabase) {
            ch.nokillswit.notifications.NotificationService.Notifications.insert {
                it[this.recipientId] = recipientId
                it[timestamp] = System.currentTimeMillis()
                it[notificationType] = storedType
                it[params] = "{}"
                it[link] = "/days-off?tab=team"
                it[wasSeen] = false
            }[ch.nokillswit.notifications.NotificationService.Notifications.id].value
        }

    /**
     * A service wired with the email mirror (v2.3.0) for deterministic send tests: launch it
     * on a runBlocking scope and the fire-and-forget sends are joined before runBlocking
     * returns — no polling needed.
     */
    fun withEmailer(
        scope: kotlinx.coroutines.CoroutineScope,
        mailer: ch.nokillswit.infra.mail.Mailer?,
        appUrl: String?,
    ): ch.nokillswit.notifications.NotificationService =
        ch.nokillswit.notifications.NotificationService(
            sharedTestDatabase,
            listOf(
                ch.nokillswit.notifications.NotificationEmailer(
                    scope,
                    mailer,
                    appUrl,
                    TestServices.users,
                    TestServices.notificationPreferences,
                ),
            ),
        )

    /**
     * The [withEmailer] sibling for the Teams mirror (v4.5.0) — a service wired with ONLY the
     * given [teamsSender] (no email mirror), for deterministic delivery tests the same
     * launch-then-join way (see [NotificationTeamsDeliveryTest]).
     */
    fun withTeamsSender(
        teamsSender: ch.nokillswit.notifications.NotificationMirror,
    ): ch.nokillswit.notifications.NotificationService =
        ch.nokillswit.notifications.NotificationService(sharedTestDatabase, listOf(teamsSender))
}
