package ch.nokillswit.pulse

import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/**
 * The five-point agreement scale + "Not applicable" shared by every driver question (Q2-Q6).
 * The wire form IS the storage form ("1".."5" / "NA", pre-encryption); [score] is the numeric
 * value for aggregation (null = excluded from all driver math).
 */
@Serializable
enum class PulseScaleAnswer(val wire: String, val score: Int?) {
    @SerialName("1") STRONGLY_DISAGREE("1", 1),
    @SerialName("2") DISAGREE("2", 2),
    @SerialName("3") NEITHER("3", 3),
    @SerialName("4") AGREE("4", 4),
    @SerialName("5") STRONGLY_AGREE("5", 5),
    @SerialName("NA") NOT_APPLICABLE("NA", null);

    companion object {
        fun fromWire(wire: String): PulseScaleAnswer =
            entries.firstOrNull { it.wire == wire }
                ?: throw IllegalArgumentException("Unknown pulse scale answer: $wire")
    }
}

/**
 * Submit/edit payload (PUT, upsert semantics while the cycle is OPEN). All six scored answers
 * are required; the comment is optional (blank = absent). Q7's prompt varies client-side by
 * the eNPS band — the server stores only the text.
 */
@Serializable
data class PulseResponseSubmitRequest(
    val enps: Int,
    val q2: PulseScaleAnswer,
    val q3: PulseScaleAnswer,
    val q4: PulseScaleAnswer,
    val q5: PulseScaleAnswer,
    val rotating: PulseScaleAnswer,
    val comment: String? = null,
)

/**
 * The caller's OWN saved answers, served only while the cycle is OPEN (the edit form's
 * prefill). Once the cycle closes this shape is never served again — the anti-copy-paste
 * rule — and no endpoint ever serves anyone ELSE's answers in any shape.
 */
@Serializable
data class PulseMyResponse(
    val cycleId: UInt,
    val enps: Int,
    val q2: PulseScaleAnswer,
    val q3: PulseScaleAnswer,
    val q4: PulseScaleAnswer,
    val q5: PulseScaleAnswer,
    val rotating: PulseScaleAnswer,
    val comment: String? = null,
    val submittedAt: Long,
    val lastModified: Long,
)

/** One respondent's decrypted scored answers, stripped of any user linkage BY TYPE — the only
 *  shape aggregation ever sees. */
data class PulseAnswers(
    val enps: Int,
    val q2: PulseScaleAnswer,
    val q3: PulseScaleAnswer,
    val q4: PulseScaleAnswer,
    val q5: PulseScaleAnswer,
    val rotating: PulseScaleAnswer,
)

const val MAX_PULSE_COMMENT_LENGTH = 1000

/**
 * Payload shape rules (API-SEC-003): eNPS 0-10, comment <= 1000 chars. Returns the request
 * with the comment normalized (trimmed, blank -> null) — the stored form.
 */
fun validatePulseResponse(request: PulseResponseSubmitRequest): PulseResponseSubmitRequest {
    if (request.enps !in 0..10) {
        throw BadRequestException("enps must be between 0 and 10")
    }
    val comment = request.comment?.trim()?.takeIf { it.isNotEmpty() }
    if (comment != null && comment.length > MAX_PULSE_COMMENT_LENGTH) {
        throw BadRequestException("comment must be at most $MAX_PULSE_COMMENT_LENGTH characters")
    }
    return request.copy(comment = comment)
}
