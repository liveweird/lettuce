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

/** How far before the anchor [SeedContext.spreadMillis] scatters a timestamp that would otherwise lie after it. */
const val SPREAD_DAYS = 30L
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

    private val jitter = Rng(config.seed, "millis-jitter")

    /**
     * Epoch millis of [date] at [hour]:[minuteOffset] UTC plus a sub-minute jitter (0..59.999 s), NOT clamped (may lie
     * after the anchor). The jitter keeps the many rows a seeder places at the same date/hour/minute — every weekly 1:1,
     * every monthly goal — from sharing one millisecond, while staying below the one-minute step the story seeders
     * advance by (`minute++`), so a story's steps remain strictly ordered. Each call draws from one shared stream.
     */
    fun rawMillis(date: LocalDate, hour: Int = 10, minuteOffset: Int = 0): Long =
        date.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() + hour * 3_600_000L + minuteOffset * 60_000L +
            jitter.int(0, 59_999)

    /** Epoch millis of [date] at [hour]:00 UTC, never later than the anchor (late values PILE UP at `anchor - 1`, see [spreadMillis]). */
    fun millis(date: LocalDate, hour: Int = 10, minuteOffset: Int = 0): Long =
        minOf(rawMillis(date, hour, minuteOffset), anchorMillis - 1)

    /**
     * [raw] when it lies before the anchor; otherwise a uniformly drawn moment in the last [SPREAD_DAYS] days
     * before the anchor and never before [floor] (so a story's later step cannot precede its earlier one).
     * Booking-ahead and other "would be in the future" timestamps use this instead of the [millis] clamp, which
     * would stack thousands of rows on the single millisecond `anchor - 1`. The draw consumes [rng] only when it clamps.
     */
    fun spreadMillis(rng: Rng, raw: Long, floor: Long = 0L): Long {
        if (raw < anchorMillis) return raw
        val lo = minOf(maxOf(floor, anchorMillis - SPREAD_DAYS * MILLIS_PER_DAY), anchorMillis - 1)
        return rng.long(lo, anchorMillis - 1)
    }

    /** [spreadMillis] of a calendar [date] at [hour]:[minuteOffset]. */
    fun spreadMillis(rng: Rng, date: LocalDate, hour: Int = 10, minuteOffset: Int = 0, floor: Long = 0L): Long =
        spreadMillis(rng, rawMillis(date, hour, minuteOffset), floor)

    fun rng(stream: String) = Rng(config.seed, stream)
}
