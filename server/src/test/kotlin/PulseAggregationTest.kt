package ch.nokillswit

import ch.nokillswit.pulse.PulseAggregationMode
import ch.nokillswit.pulse.PulseAnswers
import ch.nokillswit.pulse.PulseDriverQuestion
import ch.nokillswit.pulse.PulsePreviousCycleData
import ch.nokillswit.pulse.PulseScaleAnswer
import ch.nokillswit.pulse.aggregateDriver
import ch.nokillswit.pulse.aggregateEnps
import ch.nokillswit.pulse.buildTeamResults
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
            rotatingText = "Q",
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
            rotatingText = "The rotating question",
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
        assertEquals("The rotating question", drivers.last().rotatingText)
        assertTrue(drivers.dropLast(1).all { it.rotatingText == null })
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
            rotatingText = "Q",
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
            rotatingText = "Q",
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
}
