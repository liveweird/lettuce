package ch.nokillswit.perf

import kotlin.random.Random

/**
 * Deterministic randomness for the perf dataset generator: one independent stream per
 * `(seed, stream name)`, so adding a draw to one feature never shifts another feature's data and a
 * given `(DATASET_VERSION, seed, anchor, scale)` always yields the same rows. Backed by
 * `kotlin.random.Random(seed)` (a specified algorithm) and `String.hashCode()` (specified by the
 * JLS), so the stream is stable across JVMs and Kotlin patch versions.
 */
class Rng(seed: Long, stream: String) {
    private val random = Random(seed * STREAM_PRIME + stream.hashCode())

    /** Uniform in `[from, toInclusive]`. */
    fun int(from: Int, toInclusive: Int): Int = random.nextInt(from, toInclusive + 1)

    /** Uniform in `[from, toInclusive]`. */
    fun long(from: Long, toInclusive: Long): Long = random.nextLong(from, toInclusive + 1)

    fun double(): Double = random.nextDouble()

    fun chance(probability: Double): Boolean = random.nextDouble() < probability

    fun <T> pick(items: List<T>): T = items[random.nextInt(items.size)]

    /** [items] in a random order (deterministic for the stream's state). */
    fun <T> shuffled(items: List<T>): List<T> = items.shuffled(random)

    /** A rough bell curve: the mean of three uniform draws, scaled to [mean] ± ~[spread], clamped. */
    fun bell(mean: Double, spread: Double, min: Int, max: Int): Int {
        val unit = (random.nextDouble() + random.nextDouble() + random.nextDouble()) / 3.0 - 0.5
        return (mean + unit * 2 * spread).let { Math.round(it).toInt() }.coerceIn(min, max)
    }

    private companion object {
        const val STREAM_PRIME = 1_000_003L
    }
}

/** Synthetic prose: deterministic filler of a requested size, never real content. */
object Text {
    private val words = (
        "alignment backlog baseline capacity cadence delivery estimate feedback focus forecast growth " +
            "handover impact incident ownership planning priority quality release review risk roadmap " +
            "scope stakeholder standard support sprint target team testing tooling trade-off velocity " +
            "workload quarter customer platform migration reliability onboarding mentoring documentation " +
            "architecture dependency milestone retrospective escalation budget hiring process"
        ).split(' ')

    /** Between [minChars] and [maxChars] characters of space-separated filler words. */
    fun paragraph(rng: Rng, minChars: Int, maxChars: Int): String {
        val target = rng.int(minChars, maxChars)
        val sb = StringBuilder()
        while (sb.length < target) {
            if (sb.isNotEmpty()) sb.append(' ')
            sb.append(rng.pick(words))
        }
        return sb.toString().take(maxChars).trimEnd()
    }

    /** A capitalised phrase of [count] words. */
    fun title(rng: Rng, count: Int): String =
        List(count) { rng.pick(words) }.joinToString(" ").replaceFirstChar { it.uppercase() }
}
