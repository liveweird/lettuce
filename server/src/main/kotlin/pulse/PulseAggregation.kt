package ch.nokillswit.pulse

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlin.math.roundToInt

/**
 * Pure, DB-free pulse aggregation math. Everything here operates on [PulseAnswers] — the
 * user-id-free record type — so no aggregate can leak an individual by construction. The
 * k-anonymity floor ([MIN_PULSE_RESPONSES]) is applied HERE, to the current scope, to the
 * previous scope (no deltas against a withheld baseline), and by the routes to every trend
 * point and comment list. Results never carry any notion of statistical significance —
 * consumers display deltas with the response count, nothing more.
 */

/** Aggregates and comments are withheld below this many responses in the scope (k-anonymity). */
const val MIN_PULSE_RESPONSES = 3

/** The two team-scope flavors: current members only, or members + their full report subtree. */
@Serializable
enum class PulseAggregationMode {
    @SerialName("direct") DIRECT,
    @SerialName("subtree") SUBTREE;

    companion object {
        fun fromWire(value: String): PulseAggregationMode? = when (value) {
            "direct" -> DIRECT
            "subtree" -> SUBTREE
            else -> null
        }
    }
}

@Serializable
enum class PulseDriverQuestion { Q2, Q3, Q4, Q5, ROTATING }

@Serializable
data class PulseEnpsAggregate(
    /** promoter% − detractor% computed in one drift-free expression (v2.6.2), rounded to a whole point (−100..+100). */
    val score: Int,
    val promoterPct: Double,
    val passivePct: Double,
    val detractorPct: Double,
)

@Serializable
data class PulseDriverResult(
    val question: PulseDriverQuestion,
    /** The cycle's snapshotted question text (language->value map, EN always present) — set on the ROTATING row only. */
    val rotatingText: Map<String, String>? = null,
    /** 1dp mean over valid (non-NA) answers; null when no valid answers exist. */
    val mean: Double? = null,
    val favorablePct: Double? = null,
    val unfavorablePct: Double? = null,
    val validCount: Int,
    /** Deltas vs the comparable previous cycle; null when there is none (see [PulseTeamResults.previous]). */
    val meanDelta: Double? = null,
    val favorableDeltaPp: Double? = null,
)

@Serializable
data class PulsePreviousComparison(
    val cycleId: UInt,
    val enpsDelta: Int,
)

@Serializable
data class PulseTeamResults(
    val cycleId: UInt,
    val teamId: UInt,
    val teamName: String,
    val mode: PulseAggregationMode,
    val participantCount: Int,
    val responseCount: Int,
    /** responses / participants in this scope, 1dp percent (0.0 when the scope has no participants). */
    val responseRate: Double,
    /** True when responseCount < [MIN_PULSE_RESPONSES]: every aggregate field below is null. */
    val insufficientResponses: Boolean,
    val enps: PulseEnpsAggregate? = null,
    val drivers: List<PulseDriverResult>? = null,
    val previous: PulsePreviousComparison? = null,
)

/** The previous-cycle inputs the builder compares against (already scope-filtered by the caller). */
data class PulsePreviousCycleData(
    val cycleId: UInt,
    val answers: List<PulseAnswers>,
    /** True when the previous cycle asked the SAME rotating dictionary entry (else no rotating deltas). */
    val sameRotatingEntry: Boolean,
)

private fun round1(value: Double): Double = (value * 10).roundToInt() / 10.0

private fun pct(part: Int, whole: Int): Double = part.toDouble() / whole * 100

/** responses / participants as a 1dp percent; 0.0 for an empty participant set. */
fun pulseResponseRate(responseCount: Int, participantCount: Int): Double =
    if (participantCount == 0) 0.0 else round1(pct(responseCount, participantCount))

/** eNPS banding + score over the scope's eNPS answers. Callers guarantee a non-empty list. */
fun aggregateEnps(scores: List<Int>): PulseEnpsAggregate {
    require(scores.isNotEmpty()) { "aggregateEnps requires at least one response" }
    val promoters = scores.count { it >= 9 }
    val passives = scores.count { it in 7..8 }
    val detractors = scores.count { it <= 6 }
    return PulseEnpsAggregate(
        // Whole-point score, promoterPct − detractorPct computed in ONE expression (v2.6.2):
        // differencing two separately-computed percentages let float drift flip exact .5
        // ties either way for some scope sizes (n=24: 12.4999… vs 12.5000…4). This form is
        // mathematically identical and drift-free; ties round half-up like every other
        // rounding here (12.5 → 13, and −12.5 → −12 — roundToInt is half-toward-+∞).
        score = ((promoters - detractors) * 100.0 / scores.size).roundToInt(),
        promoterPct = round1(pct(promoters, scores.size)),
        passivePct = round1(pct(passives, scores.size)),
        detractorPct = round1(pct(detractors, scores.size)),
    )
}

/** Mean/favorable/unfavorable over one driver question's answers; "Not applicable" is excluded everywhere. */
fun aggregateDriver(answers: List<PulseScaleAnswer>): PulseDriverResult {
    val valid = answers.mapNotNull { it.score }
    if (valid.isEmpty()) {
        return PulseDriverResult(question = PulseDriverQuestion.Q2, validCount = 0)
    }
    return PulseDriverResult(
        question = PulseDriverQuestion.Q2, // caller re-keys
        mean = round1(valid.sum().toDouble() / valid.size),
        favorablePct = round1(pct(valid.count { it >= 4 }, valid.size)),
        unfavorablePct = round1(pct(valid.count { it <= 2 }, valid.size)),
        validCount = valid.size,
    )
}

/**
 * Favorable share (4–5 among valid, 1dp percent) of one driver over a scope's answers;
 * null when no valid (non-NA) answers exist. Backs the trend points' per-driver fields.
 */
fun driverFavorablePct(answers: List<PulseAnswers>, question: PulseDriverQuestion): Double? =
    aggregateDriver(driverAnswers(answers, question)).favorablePct

private fun driverAnswers(answers: List<PulseAnswers>, question: PulseDriverQuestion): List<PulseScaleAnswer> =
    answers.map {
        when (question) {
            PulseDriverQuestion.Q2 -> it.q2
            PulseDriverQuestion.Q3 -> it.q3
            PulseDriverQuestion.Q4 -> it.q4
            PulseDriverQuestion.Q5 -> it.q5
            PulseDriverQuestion.ROTATING -> it.rotating
        }
    }

/**
 * Builds one (cycle, team, mode) result block. [previous] is the immediately preceding
 * non-cancelled CLOSED cycle's data over the SAME scope, or null; deltas appear only when
 * both scopes pass the k-floor, and the rotating row's deltas additionally require the same
 * dictionary entry ([PulsePreviousCycleData.sameRotatingEntry]).
 */
fun buildTeamResults(
    cycleId: UInt,
    teamId: UInt,
    teamName: String,
    mode: PulseAggregationMode,
    participantCount: Int,
    answers: List<PulseAnswers>,
    rotatingText: Map<String, String>,
    previous: PulsePreviousCycleData?,
): PulseTeamResults {
    val responseCount = answers.size
    val responseRate = pulseResponseRate(responseCount, participantCount)
    if (responseCount < MIN_PULSE_RESPONSES) {
        return PulseTeamResults(
            cycleId = cycleId,
            teamId = teamId,
            teamName = teamName,
            mode = mode,
            participantCount = participantCount,
            responseCount = responseCount,
            responseRate = responseRate,
            insufficientResponses = true,
        )
    }
    val comparable = previous != null && previous.answers.size >= MIN_PULSE_RESPONSES
    val drivers = PulseDriverQuestion.entries.map { question ->
        val current = aggregateDriver(driverAnswers(answers, question)).copy(
            question = question,
            rotatingText = if (question == PulseDriverQuestion.ROTATING) rotatingText else null,
        )
        val comparableForQuestion = comparable &&
            (question != PulseDriverQuestion.ROTATING || previous!!.sameRotatingEntry)
        if (!comparableForQuestion) return@map current
        val prev = aggregateDriver(driverAnswers(previous!!.answers, question))
        current.copy(
            meanDelta = if (current.mean != null && prev.mean != null) round1(current.mean - prev.mean) else null,
            favorableDeltaPp = if (current.favorablePct != null && prev.favorablePct != null) {
                round1(current.favorablePct - prev.favorablePct)
            } else {
                null
            },
        )
    }
    return PulseTeamResults(
        cycleId = cycleId,
        teamId = teamId,
        teamName = teamName,
        mode = mode,
        participantCount = participantCount,
        responseCount = responseCount,
        responseRate = responseRate,
        insufficientResponses = false,
        enps = aggregateEnps(answers.map { it.enps }),
        drivers = drivers,
        previous = if (comparable) {
            PulsePreviousComparison(
                cycleId = previous!!.cycleId,
                enpsDelta = aggregateEnps(answers.map { it.enps }).score -
                    aggregateEnps(previous.answers.map { it.enps }).score,
            )
        } else {
            null
        },
    )
}
