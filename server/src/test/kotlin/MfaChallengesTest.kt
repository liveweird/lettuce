package ch.nokillswit

import ch.nokillswit.auth.MfaChallenges
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.toList
import kotlinx.coroutines.runBlocking
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertNotEquals
import kotlin.test.assertTrue

/**
 * Tests for the DB-backed email-MFA challenge store (V81, `mfa_challenges` over the shared
 * Testcontainers Postgres; deterministic via an injected clock, except the real-concurrency
 * races below). Every test issues its own challenge(s) — the table is shared, live,
 * container-wide state.
 */
class MfaChallengesTest {

    private var now = 1_000_000L
    private fun store(ttlMillis: Long = 300_000, maxAttempts: Int = 5) =
        MfaChallenges(TestServices.database, ttlMillis, maxAttempts) { now }

    @Test
    fun `a correct code succeeds exactly once - the challenge is single-use`(): Unit = runBlocking {
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
    fun `an expired challenge fails and is dropped`(): Unit = runBlocking {
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
    fun `wrong codes count toward the attempt cap and exhausting it kills the challenge`(): Unit = runBlocking {
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
    fun `an unknown challenge id fails uniformly`(): Unit = runBlocking {
        val s = store()
        val outcome = s.verify("no-such-challenge", "123456")
        assertIs<MfaChallenges.Outcome.Failure>(outcome)
        assertEquals("unknown_challenge", outcome.reason)
    }

    @Test
    fun `challenge ids are unique and opaque`(): Unit = runBlocking {
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
    fun `issuing prunes challenges that have already expired`(): Unit = runBlocking {
        val s = store(ttlMillis = 1_000)
        val stale = (1..3).map { s.issue(it.toUInt()) }
        now += 2_000
        // The next issue triggers the prune; every stale entry is now gone from the table.
        val fresh = s.issue(99u)
        val remaining = suspendTransaction(TestServices.database) {
            MfaChallenges.Challenges.selectAll()
                .where { MfaChallenges.Challenges.id inList stale.map { it.challengeId } }
                .toList()
        }
        assertTrue(remaining.isEmpty(), "the stale challenges should have been pruned")
        assertEquals(
            "unknown_challenge",
            (s.verify(stale.first().challengeId, stale.first().code) as MfaChallenges.Outcome.Failure).reason,
        )
        assertIs<MfaChallenges.Outcome.Success>(s.verify(fresh.challengeId, fresh.code))
    }

    @Test
    fun `N concurrent correct guesses consume the challenge exactly once`(): Unit = runBlocking {
        val s = store(maxAttempts = 5)
        val issued = s.issue(42u)
        val outcomes = coroutineScope {
            List(8) { async(Dispatchers.IO) { s.verify(issued.challengeId, issued.code) } }.awaitAll()
        }
        assertEquals(1, outcomes.count { it is MfaChallenges.Outcome.Success })
        val failures = outcomes.filterIsInstance<MfaChallenges.Outcome.Failure>()
        assertEquals(7, failures.size)
        assertTrue(failures.all { it.reason == "unknown_challenge" })
    }

    @Test
    fun `N concurrent wrong guesses atomically exhaust the attempt cap`(): Unit = runBlocking {
        val cap = 3
        val n = 8
        val s = store(maxAttempts = cap)
        val issued = s.issue(7u)
        val outcomes = coroutineScope {
            List(n) { async(Dispatchers.IO) { s.verify(issued.challengeId, "wrong") } }.awaitAll()
        }
        val reasons = outcomes.filterIsInstance<MfaChallenges.Outcome.Failure>().map { it.reason }
        assertEquals(n, reasons.size, "every concurrent guess must resolve to a failure")
        assertEquals(cap - 1, reasons.count { it == "wrong_code" })
        assertEquals(1, reasons.count { it == "too_many_attempts" })
        assertEquals(n - cap, reasons.count { it == "unknown_challenge" })
        // Even the correct code no longer works — the challenge is gone.
        assertEquals(
            "unknown_challenge",
            (s.verify(issued.challengeId, issued.code) as MfaChallenges.Outcome.Failure).reason,
        )
    }

    @Test
    fun `a final wrong guess can beat a concurrent correct code under a cap of one`(): Unit = runBlocking {
        val s = store(maxAttempts = 1)
        val issued = s.issue(7u)
        val outcomes = coroutineScope {
            listOf(
                async(Dispatchers.IO) { s.verify(issued.challengeId, "wrong") },
                async(Dispatchers.IO) { s.verify(issued.challengeId, issued.code) },
            ).awaitAll()
        }
        val reasons = outcomes.map {
            when (it) {
                is MfaChallenges.Outcome.Success -> "success"
                is MfaChallenges.Outcome.Failure -> it.reason
            }
        }.sorted()
        // Whichever mutation (the correct-code delete or the wrong-code cap trip) commits
        // first wins the row; the loser always sees it already gone (unknown_challenge). A
        // Success can therefore never coexist with a "real" failure (too_many_attempts /
        // wrong_code) — only with unknown_challenge.
        assertTrue(
            reasons == listOf("success", "unknown_challenge") ||
                reasons == listOf("too_many_attempts", "unknown_challenge"),
            "unexpected outcome combination: $reasons",
        )
    }
}
