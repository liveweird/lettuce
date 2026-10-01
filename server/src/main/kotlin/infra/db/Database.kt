package ch.nokillswit.infra.db

import ch.nokillswit.alerts.AlertService
import ch.nokillswit.alerts.AlertServiceKey
import ch.nokillswit.auth.TokenBlocklistService
import ch.nokillswit.auth.TokenBlocklistServiceKey
import ch.nokillswit.daysoff.DaysOffService
import ch.nokillswit.daysoff.DaysOffServiceKey
import ch.nokillswit.daysoff.PublicHolidayService
import ch.nokillswit.daysoff.PublicHolidayServiceKey
import ch.nokillswit.dictionaries.DictionaryService
import ch.nokillswit.dictionaries.DictionaryServiceKey
import ch.nokillswit.feedbacks.FeedbackEventService
import ch.nokillswit.feedbacks.FeedbackEventServiceKey
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.feedbacks.FeedbackServiceKey
import ch.nokillswit.feedbacks.FeedbackShareable
import ch.nokillswit.goals.GoalEventService
import ch.nokillswit.goals.GoalEventServiceKey
import ch.nokillswit.goals.GoalService
import ch.nokillswit.goals.GoalServiceKey
import ch.nokillswit.goals.GoalShareable
import ch.nokillswit.impactlog.ImpactLogEventService
import ch.nokillswit.impactlog.ImpactLogEventServiceKey
import ch.nokillswit.impactlog.ImpactLogService
import ch.nokillswit.impactlog.ImpactLogServiceKey
import ch.nokillswit.infra.config.requireConfigInt
import ch.nokillswit.infra.config.requireConfigLong
import ch.nokillswit.infra.crypto.FieldCipherKey
import ch.nokillswit.infra.mail.mailAppUrl
import ch.nokillswit.infra.mail.mailer
import ch.nokillswit.infra.teams.TeamsUnreachableRetryHoursKey
import ch.nokillswit.infra.teams.teamsMessenger
import ch.nokillswit.integration.IntegrationClientService
import ch.nokillswit.integration.IntegrationClientServiceKey
import ch.nokillswit.notifications.NotificationEmailer
import ch.nokillswit.notifications.NotificationPreferenceService
import ch.nokillswit.notifications.NotificationPreferenceServiceKey
import ch.nokillswit.notifications.NotificationService
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.notifications.NotificationTeamsSender
import ch.nokillswit.oneonones.OneOnOneEventService
import ch.nokillswit.oneonones.OneOnOneEventServiceKey
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.oneonones.OneOnOneServiceKey
import ch.nokillswit.oneonones.OneOnOneShareable
import ch.nokillswit.pulse.PulseCycleService
import ch.nokillswit.pulse.PulseCycleServiceKey
import ch.nokillswit.pulse.PulseResponseService
import ch.nokillswit.pulse.PulseResponseServiceKey
import ch.nokillswit.reviews.PerformanceReviewEventService
import ch.nokillswit.reviews.PerformanceReviewEventServiceKey
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.PerformanceReviewServiceKey
import ch.nokillswit.reviews.PerformanceReviewShareable
import ch.nokillswit.reviews.ReviewPeriodService
import ch.nokillswit.reviews.ReviewPeriodServiceKey
import ch.nokillswit.settings.AppSettingsService
import ch.nokillswit.settings.AppSettingsServiceKey
import ch.nokillswit.sharing.ShareAccess
import ch.nokillswit.sharing.ShareAccessKey
import ch.nokillswit.sharing.ShareRegistry
import ch.nokillswit.sharing.ShareRegistryKey
import ch.nokillswit.sharing.ShareService
import ch.nokillswit.sharing.ShareServiceKey
import ch.nokillswit.succession.SuccessionEventService
import ch.nokillswit.succession.SuccessionEventServiceKey
import ch.nokillswit.succession.SuccessionPlanService
import ch.nokillswit.succession.SuccessionPlanServiceKey
import ch.nokillswit.teamkpis.TeamKpiEventService
import ch.nokillswit.teamkpis.TeamKpiEventServiceKey
import ch.nokillswit.teamkpis.TeamKpiService
import ch.nokillswit.teamkpis.TeamKpiServiceKey
import ch.nokillswit.teams.TeamService
import ch.nokillswit.teams.TeamServiceKey
import ch.nokillswit.templates.TemplateService
import ch.nokillswit.templates.TemplateServiceKey
import ch.nokillswit.users.CareerPositionService
import ch.nokillswit.users.CareerPositionServiceKey
import ch.nokillswit.users.UserService
import ch.nokillswit.users.UserServiceKey
import io.ktor.server.application.*
import io.ktor.server.config.ApplicationConfig
import io.ktor.util.AttributeKey
import io.r2dbc.pool.ConnectionPool
import io.r2dbc.pool.ConnectionPoolConfiguration
import io.r2dbc.postgresql.PostgresqlConnectionFactoryProvider
import io.r2dbc.spi.ConnectionFactories
import io.r2dbc.spi.ConnectionFactoryOptions
import io.r2dbc.spi.ValidationDepth
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabaseConfig
import java.time.Duration

/** Upper bounds for the maintenance knobs below (v4.5.2): a day between sweeps, ten years kept. */
private const val MAX_SWEEP_INTERVAL_SECONDS = 86_400L
private const val MAX_RETENTION_DAYS = 3_650L

/** Published so a later module (e.g. `configureAuthRoutes`, whose DB-backed auth-state stores
 *  — login lockout/password-reset throttle/MFA challenges, V81 — need a handle) can reuse the
 *  same connected [R2dbcDatabase] without opening a second connection, and `ConnectionPoolTest`,
 *  which opens transactions directly against the SAME pool the app's services use to observe
 *  `pg_stat_activity` bounded by `postgres.pool.maxSize`. */
val R2dbcDatabaseKey = AttributeKey<R2dbcDatabase>("R2dbcDatabase")

/**
 * The bounded pool sizing read from `postgres.pool.*` (`.claude/docs/persistence.md`
 * "Connection pool") — boot-validated through the shared [requireConfigInt]/[requireConfigLong]
 * (`infra/config/`), so a malformed or out-of-range bound refuses startup with a config-error
 * message naming the key, before any connection is attempted.
 */
private data class PoolBounds(
    val maxSize: Int,
    val initialSize: Int,
    val maxAcquireTimeSeconds: Long,
    val maxIdleTimeSeconds: Long,
    val maxValidationTimeSeconds: Long,
    val maxCreateConnectionTimeSeconds: Long,
    val connectTimeoutSeconds: Long,
    val statementTimeoutSeconds: Long,
    val applicationName: String,
)

private fun readPoolBounds(config: ApplicationConfig): PoolBounds {
    val maxSize = requireConfigInt(config, "postgres.pool.maxSize", min = 1, max = 1000)
    val initialSize = requireConfigInt(config, "postgres.pool.initialSize", min = 0, max = maxSize)
    val maxAcquireTimeSeconds = requireConfigLong(config, "postgres.pool.maxAcquireTimeSeconds", min = 1, max = 600)
    val maxIdleTimeSeconds = requireConfigLong(config, "postgres.pool.maxIdleTimeSeconds", min = 1, max = 86400)
    // v4.7.1 — the hung-database bounds (application.yaml explains each).
    val maxValidationTimeSeconds = requireConfigLong(config, "postgres.pool.maxValidationTimeSeconds", min = 1, max = 60)
    val maxCreateConnectionTimeSeconds =
        requireConfigLong(config, "postgres.pool.maxCreateConnectionTimeSeconds", min = 1, max = 600)
    val connectTimeoutSeconds = requireConfigLong(config, "postgres.connectTimeoutSeconds", min = 1, max = 600)
    val statementTimeoutSeconds = requireConfigLong(config, "postgres.statementTimeoutSeconds", min = 0, max = 3600)
    // application_name = lettuce on every pooled connection by default (deliberate — ops can
    // count Lettuce's own connections in pg_stat_activity, and ConnectionPoolTest relies on
    // it); overridable per test application instance so overlapping test apps sharing the
    // Testcontainer never share one count.
    val applicationName = config.propertyOrNull("postgres.pool.applicationName")?.getString() ?: "lettuce"
    return PoolBounds(
        maxSize, initialSize, maxAcquireTimeSeconds, maxIdleTimeSeconds,
        maxValidationTimeSeconds, maxCreateConnectionTimeSeconds, connectTimeoutSeconds, statementTimeoutSeconds,
        applicationName,
    )
}

/**
 * Connects Exposed to a bounded R2DBC [ConnectionPool] instead of a raw per-transaction
 * connection factory (`.claude/docs/persistence.md` "Connection pool"): a plain
 * `r2dbc:postgresql://` connect opens one PostgreSQL backend per `suspendTransaction` with
 * nothing capping how many run at once — measured against the compose stack (2026-09-20), 120
 * parallel `GET /api/v1/teams/members?view=managed&includeIndirect=true` took ALL 100 backends of
 * PostgreSQL's default `max_connections` (6 × 500 "too many clients", 7 × 401 because the JWT
 * validation's blocklist read failed too); pooled, the same burst peaks at `maxSize` = 20.
 *
 * [ConnectionFactoryOptions.parse] plus the user/password/application-name mutations produce
 * [options], from which [ConnectionFactories.get] resolves the PLAIN (unpooled) PostgreSQL
 * factory that [ConnectionPool] then wraps. Exposed's
 * `R2dbcDatabase.connect(connectionFactory, databaseConfig, ...)` overload derives its SQL
 * dialect and reported URL from `databaseConfig.connectionFactoryOptions` alone — it only calls
 * `ConnectionFactories.get(options)` itself when the `connectionFactory` argument is null, and
 * otherwise reads `getDialectName`/`getUrlString` straight off `options` — so [options] (still
 * carrying `driver=postgresql`) is threaded into `databaseConfig` unchanged even though actual
 * traffic goes through the pool. The pool is disposed on [ApplicationStopped] so the hundreds
 * of `testApplication`s the suite boots each release their connections.
 */
private fun Application.connectPooled(): R2dbcDatabase {
    val config = environment.config
    val bounds = readPoolBounds(config)
    val options = ConnectionFactoryOptions.parse(config.property("postgres.r2dbcUrl").getString())
        .mutate()
        .option(ConnectionFactoryOptions.USER, config.property("postgres.user").getString())
        .option(ConnectionFactoryOptions.PASSWORD, config.property("postgres.password").getString())
        .option(PostgresqlConnectionFactoryProvider.APPLICATION_NAME, bounds.applicationName)
        // v4.7.1 — the driver bounds it CAN offer: the TCP connect and TCP keepalive (a dead
        // peer on an idle connection is eventually detected). It has no socket READ timeout, so
        // a hung database is bounded at acquire time by the pool below. The statement timeout is
        // NOT a driver option here — see defaultQueryTimeout in the Exposed config below.
        .option(ConnectionFactoryOptions.CONNECT_TIMEOUT, Duration.ofSeconds(bounds.connectTimeoutSeconds))
        .option(PostgresqlConnectionFactoryProvider.TCP_KEEPALIVE, true)
        .build()
    val rawFactory = ConnectionFactories.get(options)
    val pool = ConnectionPool(
        ConnectionPoolConfiguration.builder(rawFactory)
            .maxSize(bounds.maxSize)
            .initialSize(bounds.initialSize)
            .maxAcquireTime(Duration.ofSeconds(bounds.maxAcquireTimeSeconds))
            .maxIdleTime(Duration.ofSeconds(bounds.maxIdleTimeSeconds))
            // v4.7.1: every acquire validates with a round trip, bounded — a frozen or
            // server-killed connection fails validation and is discarded (the pool then creates
            // a new one, itself bounded by maxCreateConnectionTime). r2dbc-pool retries a failed
            // timed acquire once (acquireRetry = 1, its default), so a request waits at most about
            // 2 × maxAcquireTime for a hung database instead of forever. Each acquire gets two
            // validation attempts: ONE dropped connection is replaced transparently, but after a
            // PostgreSQL restart (every idle connection dead at once) a request whose two picks
            // are both dead still fails fast until the pool has refreshed. Costs one round trip
            // (SELECT 1) per acquire; a query ALREADY in flight when the network black-holes
            // still waits until TCP gives up — the driver exposes no read timeout.
            .validationDepth(ValidationDepth.REMOTE)
            .maxValidationTime(Duration.ofSeconds(bounds.maxValidationTimeSeconds))
            .maxCreateConnectionTime(Duration.ofSeconds(bounds.maxCreateConnectionTimeSeconds))
            .build(),
    )
    monitor.subscribe(ApplicationStopped) { pool.dispose() }
    val databaseConfig = R2dbcDatabaseConfig.Builder().apply {
        connectionFactoryOptions = options
        // ONE attempt per suspendTransaction: Exposed's default of three retries any
        // R2dbcException, and the pool's acquire timeout is one — retrying a saturated pool
        // three times would multiply the acquire budget (already 2 × maxAcquireTime per attempt,
        // r2dbc-pool's own acquireRetry) into minutes of queueing per request
        // exactly when the pool is already full. Lettuce has no path relying on Exposed's
        // retry: its writes serialize on the atomic `reserveAttempt` upsert
        // (`auth/LoginThrottle.kt`) and `pg_advisory_xact_lock` (`auth/MfaChallenges.kt`), never
        // on serialization failures — and the MfaChallenges `attemptCap` note already documents
        // the `R2dbcTransaction.maxAttempts` shadowing trap this same property name invites.
        defaultMaxAttempts = 1
        // PostgreSQL's server-side statement_timeout (v4.7.1): a statement a LIVE but stuck
        // server runs longer — a lock wait, a runaway query — is cancelled. It MUST be set here:
        // Exposed's statement executor calls `connection.setStatementTimeout(queryTimeout)` on
        // every statement, from this default (0 = no limit), so a driver option or a
        // post-allocate SET is silently overwritten with 0 (ConnectionPoolTest pins the value
        // the server actually sees). Seconds, as Exposed takes them.
        defaultQueryTimeout = bounds.statementTimeoutSeconds.toInt()
    }
    return R2dbcDatabase.connect(connectionFactory = pool, databaseConfig = databaseConfig)
}

suspend fun Application.configureDatabase() {
    val database = connectPooled()
    attributes.put(R2dbcDatabaseKey, database)
    val userService = UserService(database)
    attributes.put(UserServiceKey, userService)
    attributes.put(CareerPositionServiceKey, CareerPositionService(database))
    attributes.put(TeamServiceKey, TeamService(database))
    // configureCrypto runs before this module (application.yaml order), so the cipher is present.
    // Range-checked like every duration (v4.5.2); 0 = every call, the test suite's setting.
    val sweepIntervalMillis = requireConfigLong(
        environment.config, "feedbacks.expirySweepIntervalSeconds", min = 0, max = MAX_SWEEP_INTERVAL_SECONDS,
    ) * 1000
    val feedbackService = FeedbackService(database, attributes[FieldCipherKey], sweepIntervalMillis)
    attributes.put(FeedbackServiceKey, feedbackService)
    attributes.put(FeedbackEventServiceKey, FeedbackEventService(database))
    val oneOnOneService = OneOnOneService(database, attributes[FieldCipherKey])
    attributes.put(OneOnOneServiceKey, oneOnOneService)
    attributes.put(OneOnOneEventServiceKey, OneOnOneEventService(database))
    val goalService = GoalService(database, attributes[FieldCipherKey])
    attributes.put(GoalServiceKey, goalService)
    // The goal event trail carries the encrypted progress-update comment (V54), hence the cipher.
    attributes.put(GoalEventServiceKey, GoalEventService(database, attributes[FieldCipherKey]))
    attributes.put(TeamKpiServiceKey, TeamKpiService(database, attributes[FieldCipherKey]))
    attributes.put(TeamKpiEventServiceKey, TeamKpiEventService(database))
    attributes.put(ReviewPeriodServiceKey, ReviewPeriodService(database))
    val performanceReviewService = PerformanceReviewService(database, attributes[FieldCipherKey])
    attributes.put(PerformanceReviewServiceKey, performanceReviewService)
    attributes.put(PerformanceReviewEventServiceKey, PerformanceReviewEventService(database))
    attributes.put(PublicHolidayServiceKey, PublicHolidayService(database))
    attributes.put(DaysOffServiceKey, DaysOffService(database, attributes[FieldCipherKey]))
    attributes.put(TemplateServiceKey, TemplateService(database))
    attributes.put(DictionaryServiceKey, DictionaryService(database))
    attributes.put(AppSettingsServiceKey, AppSettingsService(database))
    attributes.put(PulseCycleServiceKey, PulseCycleService(database))
    attributes.put(PulseResponseServiceKey, PulseResponseService(database, attributes[FieldCipherKey]))
    attributes.put(ImpactLogServiceKey, ImpactLogService(database, attributes[FieldCipherKey]))
    attributes.put(ImpactLogEventServiceKey, ImpactLogEventService(database))
    attributes.put(SuccessionPlanServiceKey, SuccessionPlanService(database, attributes[FieldCipherKey]))
    attributes.put(SuccessionEventServiceKey, SuccessionEventService(database))
    attributes.put(IntegrationClientServiceKey, IntegrationClientService(database))
    // Per-user notification preferences (v4.0.0, V84) — constructed before the emailer, which
    // reads it per send for the EMAIL-channel per-type check.
    val notificationPreferenceService = NotificationPreferenceService(database)
    attributes.put(NotificationPreferenceServiceKey, notificationPreferenceService)
    // The email mirror (v2.3.0): configureMail runs before this module, so the transport and
    // appUrl are readable; the Application is the CoroutineScope its fire-and-forget sends
    // ride on (the password-reset launch precedent).
    val notificationEmailer = NotificationEmailer(
        scope = this,
        mailer = mailer(),
        appUrl = mailAppUrl(),
        userService = userService,
        notificationPreferenceService = notificationPreferenceService,
    )
    // The Teams DM mirror (v4.5.0) — configureTeams runs before this module (application.yaml
    // order), so the messenger and the unreachable-retry bound are readable. Same fire-and-forget
    // Application-scope shape as the email mirror above; dispatch() itself no-ops when the
    // messenger is null (teams.transport=disabled).
    val notificationTeamsSender = NotificationTeamsSender(
        scope = this,
        database = database,
        messenger = teamsMessenger(),
        appUrl = mailAppUrl(),
        userService = userService,
        notificationPreferenceService = notificationPreferenceService,
        unreachableRetryMillis = attributes[TeamsUnreachableRetryHoursKey].toLong() * 60 * 60 * 1000,
    )
    // Range-checked (v4.5.2): a NEGATIVE retention (or one overflowing into milliseconds) put the
    // purge cutoff in the future, so purgeStale hard-deleted every seen/user-deleted notification
    // whatever its age. 0 still disables the purge.
    val notificationRetentionMillis =
        requireConfigLong(environment.config, "notifications.retentionDays", min = 0, max = MAX_RETENTION_DAYS) *
            24 * 60 * 60 * 1000
    val notificationPurgeIntervalMillis = requireConfigLong(
        environment.config, "notifications.purgeIntervalSeconds", min = 0, max = MAX_SWEEP_INTERVAL_SECONDS,
    ) * 1000
    attributes.put(
        NotificationServiceKey,
        NotificationService(
            database,
            listOf(notificationEmailer, notificationTeamsSender),
            notificationRetentionMillis,
            notificationPurgeIntervalMillis,
        ),
    )
    // Document sharing (v4.8.0, V86). Each shareable feature's adapter is registered here, next to
    // the services it wraps, as it lands — a type with no adapter is simply not shareable (the
    // routes answer 404).
    val shareService = ShareService(database)
    attributes.put(ShareServiceKey, shareService)
    attributes.put(
        ShareRegistryKey,
        ShareRegistry().apply {
            register(FeedbackShareable(feedbackService))
            register(GoalShareable(goalService))
            register(OneOnOneShareable(oneOnOneService))
            register(PerformanceReviewShareable(performanceReviewService))
        },
    )
    attributes.put(ShareAccessKey, ShareAccess(shareService, userService))
    attributes.put(AlertServiceKey, AlertService(database))
    attributes.put(TokenBlocklistServiceKey, TokenBlocklistService(database))
}
