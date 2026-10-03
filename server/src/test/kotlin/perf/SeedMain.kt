package ch.nokillswit.perf

import ch.nokillswit.infra.crypto.DEV_DATA_ENCRYPTION_KEY
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.reviews.PerformanceReviewService
import ch.nokillswit.reviews.ReviewPeriodService
import ch.nokillswit.oneonones.OneOnOneService
import ch.nokillswit.goals.GoalService
import ch.nokillswit.feedbacks.FeedbackService
import ch.nokillswit.notifications.NotificationService
import ch.nokillswit.users.CareerPositionService
import ch.nokillswit.users.UserService
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.flywaydb.core.Flyway
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.like
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.nio.file.Files
import java.nio.file.Path
import java.time.LocalDate
import kotlin.system.exitProcess

private fun property(name: String, default: String): String = System.getProperty(name)?.takeIf { it.isNotBlank() } ?: default

/** Secrets prefer the environment (never on a command line / in `ps`), then `-Pperf.<name>`, then the perf-stack default. */
private fun secret(env: String, name: String, default: String): String =
    System.getenv(env)?.takeIf { it.isNotBlank() } ?: property(name, default)

private fun loadConfig(): SeedConfig {
    val today = LocalDate.now()
    return SeedConfig(
        r2dbcUrl = property("perf.r2dbcUrl", "r2dbc:postgresql://127.0.0.1:15432/lettuce"),
        jdbcUrl = property("perf.jdbcUrl", "jdbc:postgresql://127.0.0.1:15432/lettuce"),
        user = property("perf.user", "lettuce"),
        password = secret("PERF_SEED_PASSWORD", "perf.password", "lettuce"),
        key = secret("PERF_SEED_KEY", "perf.key", DEV_DATA_ENCRYPTION_KEY),
        anchor = LocalDate.parse(property("perf.anchor", today.withDayOfMonth(1).toString())),
        seed = property("perf.seed", "1").toLong(),
        scale = property("perf.scale", "1.0").toDouble(),
        outDir = Path.of(property("perf.out", "perf/results")),
        force = property("perf.force", "false").toBoolean(),
        allowedTargets = property("perf.allowTarget", "").split(',').map { it.trim() }.filter { it.isNotEmpty() }.toSet(),
    )
}

/**
 * Occupancy guard (after [validateSeedTarget] has accepted the host/port): a database that already holds
 * generated feature data is refused (the generator allocates explicit ids and a second run would collide —
 * re-seed on a fresh volume instead). `force` skips this check only.
 */
private suspend fun guardTarget(db: R2dbcDatabase, config: SeedConfig) {
    if (config.force) return
    val occupied = suspendTransaction(db) {
        listOf<Table>(
            PerformanceReviewService.Reviews, ReviewPeriodService.ReviewPeriods, OneOnOneService.Meetings,
            GoalService.Goals, FeedbackService.Feedbacks, NotificationService.Notifications,
            CareerPositionService.CareerPositions,
        ).filter { it.selectAll().count() > 0 }.map { it.tableName } +
            listOfNotNull(
                "users@$PERF_EMAIL_DOMAIN".takeIf {
                    UserService.Users.selectAll().where { UserService.Users.email like "%@$PERF_EMAIL_DOMAIN" }.count() > 0
                },
            )
    }
    require(occupied.isEmpty()) {
        "The target database already holds data the generator writes ($occupied) — seed a fresh perf volume " +
            "(perf/run.sh down --wipe, then up postgres)."
    }
}

private fun migrate(config: SeedConfig) {
    Flyway.configure().dataSource(config.jdbcUrl, config.user, config.password)
        .locations("classpath:db/migration").load().migrate()
}

private suspend fun rowCounts(db: R2dbcDatabase): Map<String, Long> = suspendTransaction(db) {
    Seeded.tables.associate { it.tableName.lowercase() to it.selectAll().count() }
}

private fun writeResults(config: SeedConfig, result: SeedResult) {
    Files.createDirectories(config.outDir)
    val json = buildJsonObject {
        put("datasetVersion", DATASET_VERSION)
        put("anchor", config.anchor.toString())
        put("seed", config.seed)
        put("scale", config.scale)
        put("months", result.spec.months)
        put("weeks", result.spec.weeks)
        put("generationSeconds", result.seconds)
        put("notificationsMinted", result.mint.minted)
        put("notificationsKept", result.mint.kept)
        put("rows", buildJsonObject { result.counts.forEach { (table, n) -> put(table, JsonPrimitive(n)) } })
    }
    val file = config.outDir.resolve("seed-$DATASET_VERSION.json")
    Files.writeString(file, Json { prettyPrint = true }.encodeToString(JsonObject.serializer(), json) + "\n")
    println("wrote $file")
}

private suspend fun step(label: String, started: Long, log: (String) -> Unit, block: suspend () -> Unit) {
    val t0 = System.nanoTime()
    block()
    log("%-14s %6.1fs (total %.1fs)".format(label, (System.nanoTime() - t0) / 1e9, (System.nanoTime() - started) / 1e9))
}

/** What one generator run produced. */
class SeedResult(val spec: SeedSpec, val counts: Map<String, Long>, val mint: NotificationMint, val seconds: Long)

/**
 * Runs the whole generator against [config]'s database (Flyway first). Throws [IllegalArgumentException]
 * when the target fails the guards. Shared by [main] and `PerfSeedSmokeTest`.
 */
suspend fun runSeed(config: SeedConfig, log: (String) -> Unit = ::println): SeedResult {
    val spec = SeedSpec(config.scale)
    validateSeedTarget(config) // BEFORE any connection: Flyway must never touch a database the guard would refuse
    log("perf seed v$DATASET_VERSION anchor=${config.anchor} seed=${config.seed} scale=${config.scale}")
    migrate(config)
    val db = R2dbcDatabase.connect(url = config.r2dbcUrl, user = config.user, password = config.password)
    val ctx = SeedContext(db, config, spec, FieldCipher(config.key))
    guardTarget(db, config)
    val started = System.nanoTime()
    val mint = NotificationMint(ctx)
    lateinit var org: Org
    step("users+teams", started, log) { org = seedOrg(ctx) }
    step("careers", started, log) { seedCareers(ctx, org) }
    lateinit var periods: List<GeneratedPeriod>
    step("periods", started, log) { periods = seedReviewPeriods(ctx) }
    mint.start()
    step("reviews", started, log) { seedReviews(ctx, org, periods, mint) }
    step("one-on-ones", started, log) { seedOneOnOnes(ctx, org, mint) }
    step("goals", started, log) { seedGoals(ctx, org, mint) }
    step("feedbacks", started, log) { seedFeedbacks(ctx, org, mint) }
    step("notifications", started, log) { mint.finish() }
    return SeedResult(spec, rowCounts(db), mint, (System.nanoTime() - started) / 1_000_000_000)
}

/** The perf dataset generator CLI (`./gradlew :server:perfSeed`, `.claude/docs/performance.md`). */
fun main() = runBlocking {
    val config = loadConfig()
    val result = try {
        runSeed(config)
    } catch (e: IllegalArgumentException) {
        System.err.println(e.message)
        exitProcess(2)
    }
    result.counts.forEach { (table, n) -> println("  %-34s %10d".format(table, n)) }
    println("notifications minted=${result.mint.minted} kept=${result.mint.kept}")
    writeResults(config, result)
}
