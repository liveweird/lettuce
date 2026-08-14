package ch.nokillswit

import ch.nokillswit.pulse.PulseAggregationMode
import ch.nokillswit.pulse.PulseAnswers
import ch.nokillswit.pulse.PulseDriverQuestion
import ch.nokillswit.pulse.PulsePreviousCycleData
import ch.nokillswit.pulse.PulseScaleAnswer
import ch.nokillswit.pulse.aggregateDriver
import ch.nokillswit.pulse.aggregateEnps
import ch.nokillswit.pulse.buildTeamResults
import ch.nokillswit.pulse.driverFavorablePct
import ch.nokillswit.pulse.pulseResponseRate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/** The pure pulse math: eNPS banding/rounding, NA exclusion, k-anonymity, and delta rules. */
class PulseAggregationTest {

    private fun answers(
        enps: Int,
        q2: PulseScaleAnswer = PulseScaleAnswer.AGREE,
        rotating: PulseScaleAnswer = PulseScaleAnswer.AGREE,
    ) = PulseAnswers(enps = enps, q2 = q2, q3 = q2, q4 = q2, q5 = q2, rotating = rotating)

    @Test
    fun `driverFavorablePct - favorable is 4-5 among valid answers, all-NA is null, thirds land on 1dp`() {
        // Q2 per row: 5, 4, 3, 2, NA -> favorable 2 of 4 valid = 50.0 (the NA leaves the denominator).
        val rows = listOf(
            answers(10, q2 = PulseScaleAnswer.STRONGLY_AGREE),
            answers(10, q2 = PulseScaleAnswer.AGREE),
            answers(10, q2 = PulseScaleAnswer.NEITHER),
            answers(10, q2 = PulseScaleAnswer.DISAGREE),
            answers(10, q2 = PulseScaleAnswer.NOT_APPLICABLE),
        )
        assertEquals(50.0, driverFavorablePct(rows, PulseDriverQuestion.Q2))
        // An all-NA driver has no valid answers at all -> null, not 0.
        assertNull(
            driverFavorablePct(
                listOf(answers(10, q2 = PulseScaleAnswer.NOT_APPLICABLE)),
                PulseDriverQuestion.Q3,
            ),
        )
        // A thirds share rounds to one decimal place: 1 favorable of 3 -> 33.3.
        val thirds = listOf(
            answers(10, q2 = PulseScaleAnswer.AGREE),
            answers(10, q2 = PulseScaleAnswer.NEITHER),
            answers(10, q2 = PulseScaleAnswer.DISAGREE),
        )
        assertEquals(33.3, driverFavorablePct(thirds, PulseDriverQuestion.Q4))
    }

    @Test
    fun `the spec's worked example - 14 promoters, 18 passives, 8 detractors is +15`() {
        val scores = List(14) { 10 } + List(18) { 7 } + List(8) { 3 }
        val enps = aggregateEnps(scores)
        assertEquals(35.0, enps.promoterPct)
        assertEquals(45.0, enps.passivePct)
        assertEquals(20.0, enps.detractorPct)
        assertEquals(15, enps.score)
    }

    @Test
    fun `band boundaries - 6 is a detractor, 7 a passive, 8 a passive, 9 a promoter`() {
        assertEquals(-100, aggregateEnps(listOf(6)).score)
        assertEquals(0, aggregateEnps(listOf(7)).score)
        assertEquals(0, aggregateEnps(listOf(8)).score)
        assertEquals(100, aggregateEnps(listOf(9)).score)
        assertEquals(-100, aggregateEnps(listOf(0)).score)
        assertEquals(100, aggregateEnps(listOf(10)).score)
    }

    @Test
    fun `the score comes from unrounded percentages and can be negative`() {
        // 1 promoter, 1 passive, 4 detractors of 6: 16.667% - 66.667% = -50.0 exactly.
        val enps = aggregateEnps(listOf(9, 7, 1, 2, 3, 4))
        assertEquals(-50, enps.score)
        // Displayed percentages are 1dp-rounded independently of the score.
        assertEquals(16.7, enps.promoterPct)
        assertEquals(66.7, enps.detractorPct)
    }

    @Test
    fun `driver math - NA excluded everywhere, favorable is 4-5, unfavorable is 1-2, mean is 1dp`() {
        val result = aggregateDriver(
            listOf(
                PulseScaleAnswer.STRONGLY_AGREE, // 5
                PulseScaleAnswer.AGREE, // 4
                PulseScaleAnswer.NEITHER, // 3
                PulseScaleAnswer.DISAGREE, // 2
                PulseScaleAnswer.NOT_APPLICABLE,
                PulseScaleAnswer.NOT_APPLICABLE,
            ),
        )
        assertEquals(4, result.validCount)
        assertEquals(3.5, result.mean)
        assertEquals(50.0, result.favorablePct)
        assertEquals(25.0, result.unfavorablePct)
    }

    @Test
    fun `an all-NA driver has zero valid answers and null aggregates`() {
        val result = aggregateDriver(listOf(PulseScaleAnswer.NOT_APPLICABLE, PulseScaleAnswer.NOT_APPLICABLE))
        assertEquals(0, result.validCount)
        assertNull(result.mean)
        assertNull(result.favorablePct)
        assertNull(result.unfavorablePct)
    }

    @Test
    fun `response rate is a 1dp percent and an empty participant set reads as zero`() {
        assertEquals(0.0, pulseResponseRate(0, 0))
        assertEquals(66.7, pulseResponseRate(2, 3))
        assertEquals(100.0, pulseResponseRate(5, 5))
    }

    @Test
    fun `fewer than three responses withholds every aggregate - the k-anonymity floor`() {
        val result = buildTeamResults(
            cycleId = 1u,
            teamId = 2u,
            teamName = "AAA",
            mode = PulseAggregationMode.DIRECT,
            participantCount = 4,
            answers = listOf(answers(10), answers(0)),
            rotatingTextEn = "Q",
            rotatingTextPl = "Q",
            previous = null,
        )
        assertTrue(result.insufficientResponses)
        assertEquals(2, result.responseCount)
        assertEquals(50.0, result.responseRate)
        assertNull(result.enps)
        assertNull(result.drivers)
        assertNull(result.previous)
    }

    @Test
    fun `three responses pass the floor and produce the full block`() {
        val result = buildTeamResults(
            cycleId = 1u,
            teamId = 2u,
            teamName = "AAA",
            mode = PulseAggregationMode.SUBTREE,
            participantCount = 3,
            answers = listOf(answers(10), answers(9), answers(2)),
            rotatingTextEn = "The rotating question",
            rotatingTextPl = "The rotating question",
            previous = null,
        )
        assertFalse(result.insufficientResponses)
        // 2 promoters, 1 detractor of 3: 66.667 - 33.333 = 33.333 -> 33.
        assertEquals(33, result.enps!!.score)
        val drivers = result.drivers!!
        assertEquals(
            listOf(
                PulseDriverQuestion.Q2, PulseDriverQuestion.Q3, PulseDriverQuestion.Q4,
                PulseDriverQuestion.Q5, PulseDriverQuestion.ROTATING,
            ),
            drivers.map { it.question },
        )
        // The snapshotted text rides the ROTATING row only.
        assertEquals("The rotating question", drivers.last().rotatingTextEn)
        assertTrue(drivers.dropLast(1).all { it.rotatingTextEn == null })
        // No previous cycle: no deltas anywhere.
        assertTrue(drivers.all { it.meanDelta == null && it.favorableDeltaPp == null })
        assertNull(result.previous)
    }

    @Test
    fun `deltas appear against a comparable previous cycle - rotating only for the same entry`() {
        val current = listOf(
            answers(10, q2 = PulseScaleAnswer.STRONGLY_AGREE, rotating = PulseScaleAnswer.STRONGLY_AGREE),
            answers(9, q2 = PulseScaleAnswer.STRONGLY_AGREE, rotating = PulseScaleAnswer.STRONGLY_AGREE),
            answers(8, q2 = PulseScaleAnswer.AGREE, rotating = PulseScaleAnswer.AGREE),
        )
        val previousAnswers = listOf(
            answers(7, q2 = PulseScaleAnswer.NEITHER, rotating = PulseScaleAnswer.NEITHER),
            answers(3, q2 = PulseScaleAnswer.NEITHER, rotating = PulseScaleAnswer.NEITHER),
            answers(2, q2 = PulseScaleAnswer.DISAGREE, rotating = PulseScaleAnswer.DISAGREE),
        )
        fun build(sameRotating: Boolean) = buildTeamResults(
            cycleId = 5u,
            teamId = 2u,
            teamName = "AAA",
            mode = PulseAggregationMode.DIRECT,
            participantCount = 3,
            answers = current,
            rotatingTextEn = "Q",
            rotatingTextPl = "Q",
            previous = PulsePreviousCycleData(cycleId = 4u, answers = previousAnswers, sameRotatingEntry = sameRotating),
        )

        val same = build(sameRotating = true)
        // Current eNPS: 2 promoters, 1 passive -> 66.667 -> 67; previous: 2 detractors, 1 passive -> -67.
        assertEquals(67, same.enps!!.score)
        assertEquals(4u, same.previous!!.cycleId)
        assertEquals(134, same.previous!!.enpsDelta)
        val q2 = same.drivers!!.first()
        // mean 4.7 vs 2.7; favorable 100% vs 0%.
        assertEquals(2.0, q2.meanDelta)
        assertEquals(100.0, q2.favorableDeltaPp)
        assertNotNull(same.drivers!!.last().meanDelta)

        val different = build(sameRotating = false)
        // Fixed drivers still compare; the rotating row does not.
        assertNotNull(different.drivers!!.first().meanDelta)
        assertNull(different.drivers!!.last().meanDelta)
        assertNull(different.drivers!!.last().favorableDeltaPp)
    }

    @Test
    fun `a previous cycle under the k-floor produces no deltas at all`() {
        val result = buildTeamResults(
            cycleId = 5u,
            teamId = 2u,
            teamName = "AAA",
            mode = PulseAggregationMode.DIRECT,
            participantCount = 3,
            answers = listOf(answers(10), answers(9), answers(8)),
            rotatingTextEn = "Q",
            rotatingTextPl = "Q",
            previous = PulsePreviousCycleData(
                cycleId = 4u,
                answers = listOf(answers(0), answers(1)),
                sameRotatingEntry = true,
            ),
        )
        assertFalse(result.insufficientResponses)
        assertNull(result.previous)
        assertTrue(result.drivers!!.all { it.meanDelta == null && it.favorableDeltaPp == null })
    }

    // --- v2.6.2 audit hardening: ties, drift, negatives, all-NA through the pipeline ---

    @Test
    fun `eNPS half-point ties round half-up deterministically - the drift fix`() {
        // n=8, exact arithmetic: 3 promoters − 2 detractors = +12.5 → 13; mirrored → −12.5 → −12
        // (roundToInt is half-toward-+∞ — the documented asymmetry).
        assertEquals(13, aggregateEnps(listOf(10, 9, 9, 7, 7, 7, 2, 3)).score)
        assertEquals(-12, aggregateEnps(listOf(2, 3, 3, 7, 7, 7, 10, 9)).score)
        // n=24, exact score 12.5: the old two-percentage difference drifted to 12.4999… → 12,
        // while an equivalent scope could drift to 12.5000…4 → 13. The single-expression form
        // is drift-free and lands on the tie rule: 13.
        assertEquals(13, aggregateEnps(List(4) { 10 } + List(19) { 7 } + listOf(2)).score)
    }

    @Test
    fun `eNPS zero and all-detractor scopes at the k-floor size`() {
        // 1 promoter, 1 passive, 1 detractor: 33.3 − 33.3 = 0.
        val zero = aggregateEnps(listOf(10, 8, 2))
        assertEquals(0, zero.score)
        assertEquals(33.3, zero.promoterPct)
        assertEquals(33.3, zero.passivePct)
        assertEquals(33.3, zero.detractorPct)
        assertEquals(-100, aggregateEnps(listOf(0, 0, 0)).score)
    }

    @Test
    fun `driver rounding - a 3_25 mean rounds half-up and thirds land on 1dp`() {
        // Scores 5,4,2,2: mean 3.25 → 3.3 (half-toward-+∞, like the eNPS tie).
        val mean = aggregateDriver(
            listOf(
                PulseScaleAnswer.STRONGLY_AGREE,
                PulseScaleAnswer.AGREE,
                PulseScaleAnswer.DISAGREE,
                PulseScaleAnswer.DISAGREE,
            ),
        )
        assertEquals(3.3, mean.mean)
        // 1 favorable and 2 unfavorable of 3: 33.3 / 66.7.
        val thirds = aggregateDriver(
            listOf(PulseScaleAnswer.STRONGLY_AGREE, PulseScaleAnswer.DISAGREE, PulseScaleAnswer.STRONGLY_DISAGREE),
        )
        assertEquals(33.3, thirds.favorablePct)
        assertEquals(66.7, thirds.unfavorablePct)
    }

    @Test
    fun `negative deltas - a decline mirrors the improvement case sign-for-sign`() {
        // The existing positive-delta fixtures, swapped: previous good, current bad.
        val current = listOf(
            answers(7, q2 = PulseScaleAnswer.NEITHER, rotating = PulseScaleAnswer.NEITHER),
            answers(3, q2 = PulseScaleAnswer.NEITHER, rotating = PulseScaleAnswer.NEITHER),
            answers(2, q2 = PulseScaleAnswer.DISAGREE, rotating = PulseScaleAnswer.DISAGREE),
        )
        val previousAnswers = listOf(
            answers(10, q2 = PulseScaleAnswer.STRONGLY_AGREE, rotating = PulseScaleAnswer.STRONGLY_AGREE),
            answers(9, q2 = PulseScaleAnswer.STRONGLY_AGREE, rotating = PulseScaleAnswer.STRONGLY_AGREE),
            answers(8, q2 = PulseScaleAnswer.AGREE, rotating = PulseScaleAnswer.AGREE),
        )
        val result = buildTeamResults(
            cycleId = 5u,
            teamId = 2u,
            teamName = "AAA",
            mode = PulseAggregationMode.DIRECT,
            participantCount = 3,
            answers = current,
            rotatingTextEn = "Q",
            rotatingTextPl = "Q",
            previous = PulsePreviousCycleData(cycleId = 4u, answers = previousAnswers, sameRotatingEntry = true),
        )
        assertEquals(-67, result.enps!!.score)
        assertEquals(-134, result.previous!!.enpsDelta)
        val q2 = result.drivers!!.first()
        // mean 2.7 vs 4.7; favorable 0% vs 100%.
        assertEquals(-2.0, q2.meanDelta)
        assertEquals(-100.0, q2.favorableDeltaPp)
    }

    @Test
    fun `an all-NA driver flows through buildTeamResults with nulls and suppresses its deltas both ways`() {
        fun withQ5(q5: PulseScaleAnswer, enps: Int) =
            PulseAnswers(
                enps = enps,
                q2 = PulseScaleAnswer.AGREE,
                q3 = PulseScaleAnswer.AGREE,
                q4 = PulseScaleAnswer.AGREE,
                q5 = q5,
                rotating = PulseScaleAnswer.AGREE,
            )
        val allNa = listOf(
            withQ5(PulseScaleAnswer.NOT_APPLICABLE, 10),
            withQ5(PulseScaleAnswer.NOT_APPLICABLE, 9),
            withQ5(PulseScaleAnswer.NOT_APPLICABLE, 8),
        )
        val allValid = listOf(withQ5(PulseScaleAnswer.AGREE, 10), withQ5(PulseScaleAnswer.AGREE, 9), withQ5(PulseScaleAnswer.AGREE, 8))
        fun build(current: List<PulseAnswers>, previous: List<PulseAnswers>) = buildTeamResults(
            cycleId = 5u,
            teamId = 2u,
            teamName = "AAA",
            mode = PulseAggregationMode.DIRECT,
            participantCount = 3,
            answers = current,
            rotatingTextEn = "Q",
            rotatingTextPl = "Q",
            previous = PulsePreviousCycleData(cycleId = 4u, answers = previous, sameRotatingEntry = true),
        )

        // Current all-NA: the Q5 row still ships, all-null with validCount 0, deltas null.
        val naNow = build(allNa, allValid).drivers!!.first { it.question == PulseDriverQuestion.Q5 }
        assertEquals(0, naNow.validCount)
        assertNull(naNow.mean)
        assertNull(naNow.favorablePct)
        assertNull(naNow.unfavorablePct)
        assertNull(naNow.meanDelta)
        assertNull(naNow.favorableDeltaPp)
        // Previous all-NA: the current side has numbers but nothing to compare against.
        val naBefore = build(allValid, allNa).drivers!!.first { it.question == PulseDriverQuestion.Q5 }
        assertEquals(3, naBefore.validCount)
        assertNotNull(naBefore.mean)
        assertNull(naBefore.meanDelta)
        assertNull(naBefore.favorableDeltaPp)
        // The other drivers of the same build DO compare.
        assertNotNull(build(allValid, allNa).drivers!!.first { it.question == PulseDriverQuestion.Q2 }.meanDelta)
    }

    @Test
    fun `zero responses withhold with a zero rate - and a zero participant count never divides`() {
        // Nobody responded (but people were eligible): withheld, rate 0.0.
        val empty = buildTeamResults(
            cycleId = 5u,
            teamId = 2u,
            teamName = "AAA",
            mode = PulseAggregationMode.DIRECT,
            participantCount = 4,
            answers = emptyList(),
            rotatingTextEn = "Q",
            rotatingTextPl = "Q",
            previous = null,
        )
        assertTrue(empty.insufficientResponses)
        assertEquals(0, empty.responseCount)
        assertEquals(0.0, empty.responseRate)
        assertNull(empty.enps)

        // The inconsistent shape (responses without participant rows) still computes: rate
        // reads 0.0 (the guarded division) while the aggregates are full — pinned so a future
        // "fix" is a conscious choice.
        val orphan = buildTeamResults(
            cycleId = 5u,
            teamId = 2u,
            teamName = "AAA",
            mode = PulseAggregationMode.DIRECT,
            participantCount = 0,
            answers = listOf(answers(10), answers(9), answers(8)),
            rotatingTextEn = "Q",
            rotatingTextPl = "Q",
            previous = null,
        )
        assertFalse(orphan.insufficientResponses)
        assertEquals(0.0, orphan.responseRate)
        assertEquals(67, orphan.enps!!.score)
    }
}
