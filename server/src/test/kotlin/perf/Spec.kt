package ch.nokillswit.perf

import ch.nokillswit.infra.crypto.FieldCipher
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import java.nio.file.Path
import java.time.LocalDate
import java.time.ZoneOffset
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Bumped on EVERY generator change that alters the rows it writes (the Flow `generate.mjs` idiom):
 * snapshots, baselines and `perf/results/seed-<version>.json` are keyed on it, so two numbers are
 * only comparable when their dataset version matches.
 */
const val DATASET_VERSION = 2

/** The one shared sign-in password of every generated account (one bcrypt hash, computed once). */
const val PERF_PASSWORD = "perf-pass-2026"

/** Generated emails look like `perf-ic-0042@perf.lettuce.local` — never containing "e2e" (the residue sweep). */
const val PERF_EMAIL_DOMAIN = "perf.lettuce.local"

const val MILLIS_PER_DAY = 86_400_000L
const val NOTIFICATION_RETENTION_DAYS = 30L

/** Where and what the generator writes — everything `perfSeed` takes from `-Pperf.*`. */
data class SeedConfig(
    val r2dbcUrl: String,
    val jdbcUrl: String,
    val user: String,
    val password: String,
    /** The data-encryption key the generator encrypts with: it MUST be the key the app reads with. */
    val key: String,
    /** The frozen "now": first day of the month by default; every generated timestamp lies before it. */
    val anchor: LocalDate,
    val seed: Long,
    /** 1.0 = the full M1 capacity slice; smaller values shrink the org and the history for smoke runs. */
    val scale: Double,
    val outDir: Path,
    /** Skips ONLY the "database must be empty" occupancy check — never the host/port guard (`validateSeedTarget`). */
    val force: Boolean,
    /** Extra `host:port` targets the host/port guard accepts (the smoke test's Testcontainer; `-Pperf.allowTarget=`). */
    val allowedTargets: Set<String> = emptySet(),
)

/**
 * The capacity spec: 1 CEO → [directors] directors → [leads] leads → [ics] ICs over
 * [months] months of history. At `scale = 1.0`: 511 users, 81 teams, 260 weekly 1:1s per
 * manager–report pair, 60 monthly goals/feedbacks/impact entries per person, 10 half-year review
 * periods, 130 fortnightly pulse cycles, 4 KPIs per team, 5 days-off entries per person-year.
 */
class SeedSpec(private val scale: Double) {
    private fun scaled(base: Int, min: Int) = max(min, (base * scale).roundToInt())

    val directors = scaled(10, 1)
    private val leadsPerDirector = scaled(7, 2)
    val leads = directors * leadsPerDirector
    val ics = scaled(430, leads)
    val months = scaled(60, 3)
    val weeks = scaled(260, 8)

    /** One pulse cycle every two weeks over the history (130 at scale 1.0). */
    val pulseCycles = max(3, (130.0 * months / 60).roundToInt())

    /** Action items still unresolved when the next meeting is created (they carry over). */
    val actionItemUnresolvedRate = 0.075
}

/** What every seeder shares. */
class SeedContext(
    val db: R2dbcDatabase,
    val config: SeedConfig,
    val spec: SeedSpec,
    val cipher: FieldCipher,
) {
    val anchorMillis: Long = config.anchor.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()

    /** Epoch millis of [date] at [hour]:00 UTC, never later than the anchor. */
    fun millis(date: LocalDate, hour: Int = 10, minuteOffset: Int = 0): Long =
        minOf(
            date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() + hour * 3_600_000L + minuteOffset * 60_000L,
            anchorMillis - 1,
        )

    fun rng(stream: String) = Rng(config.seed, stream)
}
