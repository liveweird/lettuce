package ch.nokillswit

import ch.nokillswit.auth.MfaChallenges
import java.lang.management.ManagementFactory
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/** Unit tests for the in-memory email-MFA challenge store (deterministic via an injected clock). */
class MfaChallengesTest {

    private var now = 1_000_000L
    private fun store(ttlMillis: Long = 300_000, maxAttempts: Int = 5) =
        MfaChallenges(ttlMillis, maxAttempts) { now }

    @Test
    fun `a correct code succeeds exactly once - the challenge is single-use`() {
        val s = store()
        val issued = s.issue(42u)
        assertEquals(6, issued.code.length)
        assertTrue(issued.code.all { it.isDigit() })
        assertEquals(now + 300_000, issued.expiresAt)

        val outcome = s.verify(issued.challengeId, issued.code)
        assertIs<MfaChallenges.Outcome.Success>(outcome)
        assertEquals(42u, outcome.userId)

        // Replay of the consumed challenge is indistinguishable from an unknown one.
        val replay = s.verify(issued.challengeId, issued.code)
        assertIs<MfaChallenges.Outcome.Failure>(replay)
        assertEquals("unknown_challenge", replay.reason)
    }

    @Test
    fun `an expired challenge fails and is dropped`() {
        val s = store(ttlMillis = 60_000)
        val issued = s.issue(7u)
        now += 60_000
        val outcome = s.verify(issued.challengeId, issued.code)
        assertIs<MfaChallenges.Outcome.Failure>(outcome)
        assertEquals("expired", outcome.reason)
        // The drop is permanent — a later attempt sees unknown, not expired.
        assertEquals(
            "unknown_challenge",
            (s.verify(issued.challengeId, issued.code) as MfaChallenges.Outcome.Failure).reason,
        )
    }

    @Test
    fun `wrong codes count toward the attempt cap and exhausting it kills the challenge`() {
        val s = store(maxAttempts = 3)
        val issued = s.issue(7u)
        assertEquals("wrong_code", (s.verify(issued.challengeId, "x") as MfaChallenges.Outcome.Failure).reason)
        assertEquals("wrong_code", (s.verify(issued.challengeId, "x") as MfaChallenges.Outcome.Failure).reason)
        assertEquals(
            "too_many_attempts",
            (s.verify(issued.challengeId, "x") as MfaChallenges.Outcome.Failure).reason,
        )
        // Even the correct code no longer works — the challenge is gone.
        assertEquals(
            "unknown_challenge",
            (s.verify(issued.challengeId, issued.code) as MfaChallenges.Outcome.Failure).reason,
        )
    }

    @Test
    fun `competing correct guesses consume a challenge only once`() {
        val coordinatedClock = CoordinatedVerificationClock(now)
        val s = MfaChallenges(ttlMillis = 300_000, maxAttempts = 5, clock = coordinatedClock::read)
        val issued = s.issue(42u)
        coordinatedClock.coordinateNextRace()

        val outcomes = raceVerifications(
            clock = coordinatedClock,
            firstVerify = { s.verify(issued.challengeId, issued.code) },
        )

        assertEquals(1, outcomes.count { it is MfaChallenges.Outcome.Success })
        assertEquals(
            listOf("unknown_challenge"),
            outcomes.filterIsInstance<MfaChallenges.Outcome.Failure>().map { it.reason },
        )
    }

    @Test
    fun `concurrent wrong guesses atomically exhaust the attempt cap`() {
        val coordinatedClock = CoordinatedVerificationClock(now)
        val s = MfaChallenges(ttlMillis = 300_000, maxAttempts = 2, clock = coordinatedClock::read)
        val issued = s.issue(7u)
        coordinatedClock.coordinateNextRace()

        val outcomes = raceVerifications(
            clock = coordinatedClock,
            firstVerify = { s.verify(issued.challengeId, "wrong") },
        )

        assertEquals(
            listOf("too_many_attempts", "wrong_code"),
            outcomes.filterIsInstance<MfaChallenges.Outcome.Failure>().map { it.reason }.sorted(),
        )
        assertEquals(
            "unknown_challenge",
            (s.verify(issued.challengeId, issued.code) as MfaChallenges.Outcome.Failure).reason,
        )
    }

    @Test
    fun `a final wrong guess wins over a competing correct code`() {
        val coordinatedClock = CoordinatedVerificationClock(now)
        val s = MfaChallenges(ttlMillis = 300_000, maxAttempts = 1, clock = coordinatedClock::read)
        val issued = s.issue(7u)
        coordinatedClock.coordinateNextRace()

        val outcomes = raceVerifications(
            clock = coordinatedClock,
            firstVerify = { s.verify(issued.challengeId, "wrong") },
            competingVerify = { s.verify(issued.challengeId, issued.code) },
        )

        assertEquals(
            listOf("too_many_attempts", "unknown_challenge"),
            outcomes.map { (it as MfaChallenges.Outcome.Failure).reason },
        )
    }

    @Test
    fun `an unknown challenge id fails uniformly`() {
        val s = store()
        val outcome = s.verify("no-such-challenge", "123456")
        assertIs<MfaChallenges.Outcome.Failure>(outcome)
        assertEquals("unknown_challenge", outcome.reason)
    }

    @Test
    fun `challenge ids are unique and opaque`() {
        val s = store()
        val a = s.issue(1u)
        val b = s.issue(1u)
        assertNotEquals(a.challengeId, b.challengeId)
        assertEquals(32, a.challengeId.length)
        // Both stay independently verifiable (repeated logins may coexist within the TTL).
        assertIs<MfaChallenges.Outcome.Success>(s.verify(b.challengeId, b.code))
        assertIs<MfaChallenges.Outcome.Success>(s.verify(a.challengeId, a.code))
    }

    @Test
    fun `the store prunes expired entries once oversized instead of growing without bound`() {
        val s = store(ttlMillis = 1_000)
        val stale = (1..10_001).map { s.issue(it.toUInt()) }
        now += 2_000
        // The next issue triggers the prune; every stale entry is now unknown.
        val fresh = s.issue(99u)
        assertEquals(
            "unknown_challenge",
            (s.verify(stale.first().challengeId, stale.first().code) as MfaChallenges.Outcome.Failure).reason,
        )
        assertIs<MfaChallenges.Outcome.Success>(s.verify(fresh.challengeId, fresh.code))
    }

    private fun raceVerifications(
        clock: CoordinatedVerificationClock,
        firstVerify: () -> MfaChallenges.Outcome,
        competingVerify: () -> MfaChallenges.Outcome = firstVerify,
    ): List<MfaChallenges.Outcome> {
        val executor = Executors.newFixedThreadPool(2)
        val firstThreadId = AtomicLong()
        val competingThreadId = AtomicLong()
        val competitorStarted = CountDownLatch(1)
        try {
            val first = executor.submit<MfaChallenges.Outcome> {
                firstThreadId.set(Thread.currentThread().threadId())
                firstVerify()
            }
            assertTrue(clock.awaitFirstVerification(), "first verification did not reach the clock")
            val second = executor.submit<MfaChallenges.Outcome> {
                competingThreadId.set(Thread.currentThread().threadId())
                competitorStarted.countDown()
                competingVerify()
            }
            assertTrue(competitorStarted.await(5, TimeUnit.SECONDS), "competing verification did not start")
            assertTrue(
                clock.awaitCompetitorAtClockOrBlocked(firstThreadId.get(), competingThreadId.get()),
                "competitor neither reached the clock nor blocked on the atomic verification",
            )
            clock.release()
            return listOf(first.get(5, TimeUnit.SECONDS), second.get(5, TimeUnit.SECONDS))
        } finally {
            clock.release()
            executor.shutdownNow()
            assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS), "verification executor did not stop")
        }
    }

    /**
     * Holds the first verification after it has read the challenge. A racy implementation lets
     * the competitor reach the clock from the same snapshot; a per-key atomic implementation
     * blocks the competitor on the first thread's map lock. The harness observes either state
     * before release, and its bounded detection plus finally block guarantee cleanup on failure.
     */
    private class CoordinatedVerificationClock(private val currentTime: Long) {
        private val firstArrival = CountDownLatch(1)
        private val arrivals = CountDownLatch(2)
        private val release = CountDownLatch(1)

        @Volatile
        private var coordinate = false

        fun read(): Long {
            if (coordinate) {
                arrivals.countDown()
                firstArrival.countDown()
                release.await()
            }
            return currentTime
        }

        fun coordinateNextRace() {
            coordinate = true
        }

        fun awaitFirstVerification(): Boolean = firstArrival.await(5, TimeUnit.SECONDS)

        fun awaitCompetitorAtClockOrBlocked(firstThreadId: Long, competingThreadId: Long): Boolean {
            val threadMxBean = ManagementFactory.getThreadMXBean()
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (System.nanoTime() < deadline) {
                if (arrivals.count == 0L) return true
                val competitor = threadMxBean.getThreadInfo(competingThreadId)
                if (
                    competitor?.threadState == Thread.State.BLOCKED &&
                    competitor.lockOwnerId == firstThreadId
                ) {
                    return true
                }
                Thread.sleep(1)
            }
            return false
        }

        fun release() {
            coordinate = false
            release.countDown()
        }
    }
}
