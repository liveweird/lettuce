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
import ch.nokillswit.goals.GoalEventService
import ch.nokillswit.goals.GoalEventServiceKey
import ch.nokillswit.goals.GoalService
import ch.nokillswit.goals.GoalServiceKey
import ch.nokillswit.impactlog.ImpactLogEventService
import ch.nokillswit.impactlog.ImpactLogEventServiceKey
import ch.nokillswit.impactlog.ImpactLogService
import ch.nokillswit.impactlog.ImpactLogServiceKey
import ch.nokillswit.infra.config.requireConfigInt
import ch.nokillswit.infra.config.requireConfigLong
import ch.nokillswit.infra.crypto.FieldCipherKey
import ch.nokillswit.infra.mail.mailAppUrl
import ch.nokillswit.infra.mail.mailer
import ch.nokillswit.integration.IntegrationClientService
import ch.nokillswit.integration.IntegrationClientServiceKey
import ch.nokillswit.notifications.NotificationEmailer
import ch.nokillswit.notifications.NotificationPreferenceService
import ch.nokillswit.notifications.NotificationPreferenceServiceKey
import ch.nokillswit.notifications.NotificationService
import ch.nokillswit.notifications.NotificationServiceKey
import ch.nokillswit.oneonones.OneOnOneEventService
import ch.nokillswit.oneonones.OneOnOneEventServiceKey
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.oneonones.OneOnOneServiceKey
import ch.nokillswit.pulse.PulseCycleService
import ch.nokillswit.pulse.PulseCycleServiceKey
import ch.nokillswit.pulse.PulseResponseService
import ch.nokillswit.pulse.PulseResponseServiceKey
import ch.nokillswit.reviews.PerformanceReviewEventService
import ch.nokillswit.reviews.PerformanceReviewEventServiceKey
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.PerformanceReviewServiceKey
import ch.nokillswit.reviews.ReviewPeriodService
import ch.nokillswit.reviews.ReviewPeriodServiceKey
import ch.nokillswit.settings.AppSettingsService
import ch.nokillswit.settings.AppSettingsServiceKey
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
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabaseConfig
import java.time.Duration

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
    val applicationName: String,
)

private fun readPoolBounds(config: ApplicationConfig): PoolBounds {
    val maxSize = requireConfigInt(config, "postgres.pool.maxSize", min = 1, max = 1000)
    val initialSize = requireConfigInt(config, "postgres.pool.initialSize", min = 0, max = maxSize)
    val maxAcquireTimeSeconds = requireConfigLong(config, "postgres.pool.maxAcquireTimeSeconds", min = 1, max = 600)
    val maxIdleTimeSeconds = requireConfigLong(config, "postgres.pool.maxIdleTimeSeconds", min = 1, max = 86400)
    // application_name = lettuce on every pooled connection by default (deliberate — ops can
    // count Lettuce's own connections in pg_stat_activity, and ConnectionPoolTest relies on
    // it); overridable per test application instance so overlapping test apps sharing the
    // Testcontainer never share one count.
    val applicationName = config.propertyOrNull("postgres.pool.applicationName")?.getString() ?: "lettuce"
    return PoolBounds(maxSize, initialSize, maxAcquireTimeSeconds, maxIdleTimeSeconds, applicationName)
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
        .build()
    val rawFactory = ConnectionFactories.get(options)
    val pool = ConnectionPool(
        ConnectionPoolConfiguration.builder(rawFactory)
            .maxSize(bounds.maxSize)
            .initialSize(bounds.initialSize)
            .maxAcquireTime(Duration.ofSeconds(bounds.maxAcquireTimeSeconds))
            .maxIdleTime(Duration.ofSeconds(bounds.maxIdleTimeSeconds))
            .build(),
    )
    monitor.subscribe(ApplicationStopped) { pool.dispose() }
    val databaseConfig = R2dbcDatabaseConfig.Builder().apply {
        connectionFactoryOptions = options
        // ONE attempt per suspendTransaction: Exposed's default of three retries any
        // R2dbcException, and the pool's acquire timeout is one — retrying a saturated pool
        // three times would turn the 10-second acquire budget into 30 s of queueing per request
        // exactly when the pool is already full. Lettuce has no path relying on Exposed's
        // retry: its writes serialize on the atomic `reserveAttempt` upsert
        // (`auth/LoginThrottle.kt`) and `pg_advisory_xact_lock` (`auth/MfaChallenges.kt`), never
        // on serialization failures — and the MfaChallenges `attemptCap` note already documents
        // the `R2dbcTransaction.maxAttempts` shadowing trap this same property name invites.
        defaultMaxAttempts = 1
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
    val sweepIntervalMillis = environment.config.property("feedbacks.expirySweepIntervalSeconds").getString().toLong() * 1000
    attributes.put(FeedbackServiceKey, FeedbackService(database, attributes[FieldCipherKey], sweepIntervalMillis))
    attributes.put(FeedbackEventServiceKey, FeedbackEventService(database))
    attributes.put(OneOnOneServiceKey, OneOnOneService(database, attributes[FieldCipherKey]))
    attributes.put(OneOnOneEventServiceKey, OneOnOneEventService(database))
    attributes.put(GoalServiceKey, GoalService(database, attributes[FieldCipherKey]))
    // The goal event trail carries the encrypted progress-update comment (V54), hence the cipher.
    attributes.put(GoalEventServiceKey, GoalEventService(database, attributes[FieldCipherKey]))
    attributes.put(TeamKpiServiceKey, TeamKpiService(database, attributes[FieldCipherKey]))
    attributes.put(TeamKpiEventServiceKey, TeamKpiEventService(database))
    attributes.put(ReviewPeriodServiceKey, ReviewPeriodService(database))
    attributes.put(PerformanceReviewServiceKey, PerformanceReviewService(database, attributes[FieldCipherKey]))
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
    val notificationRetentionMillis =
        environment.config.property("notifications.retentionDays").getString().toLong() * 24 * 60 * 60 * 1000
    val notificationPurgeIntervalMillis =
        environment.config.property("notifications.purgeIntervalSeconds").getString().toLong() * 1000
    attributes.put(
        NotificationServiceKey,
        NotificationService(database, notificationEmailer, notificationRetentionMillis, notificationPurgeIntervalMillis),
    )
    attributes.put(AlertServiceKey, AlertService(database))
    attributes.put(TokenBlocklistServiceKey, TokenBlocklistService(database))
}
