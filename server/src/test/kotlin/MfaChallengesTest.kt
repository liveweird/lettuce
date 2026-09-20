package ch.nokillswit

import ch.nokillswit.auth.MfaChallenges
import kotlinx.coroutines.CompletableDeferred
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

    // maxPendingChallenges defaults generously high (100) so it never interferes with tests that
    // are not exercising the cap itself — the per-account pending-challenge cap is exercised
    // explicitly below.
    private fun store(ttlMillis: Long = 300_000, maxAttempts: Int = 5, maxPendingChallenges: Int = 100) =
        MfaChallenges(TestServices.database, ttlMillis, maxAttempts, maxPendingChallenges) { now }

    /** Unwraps a successful [MfaChallenges.issue] — fails loudly if the cap throttled it. */
    private suspend fun MfaChallenges.issued(userId: UInt): MfaChallenges.IssuedChallenge =
        (issue(userId) as MfaChallenges.IssueOutcome.Issued).challenge

    @Test
    fun `a correct code succeeds exactly once - the challenge is single-use`(): Unit = runBlocking {
        val s = store()
        val issued = s.issued(42u)
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
        val issued = s.issued(7u)
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
        // cap ≠ 3 on purpose (see the concurrent-wrong-guesses case): a cap of 3 could not tell the
        // store's setting from Exposed's Transaction.maxAttempts default that shadowed it.
        val s = store(maxAttempts = 2)
        val issued = s.issued(7u)
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
        val a = s.issued(1u)
        val b = s.issued(1u)
        assertNotEquals(a.challengeId, b.challengeId)
        assertEquals(32, a.challengeId.length)
        // Both stay independently verifiable (repeated logins may coexist within the TTL).
        assertIs<MfaChallenges.Outcome.Success>(s.verify(b.challengeId, b.code))
        assertIs<MfaChallenges.Outcome.Success>(s.verify(a.challengeId, a.code))
    }

    @Test
    fun `issuing prunes challenges that have already expired`(): Unit = runBlocking {
        val s = store(ttlMillis = 1_000)
        val stale = (1..3).map { s.issued(it.toUInt()) }
        now += 2_000
        // The next issue triggers the prune; every stale entry is now gone from the table.
        val fresh = s.issued(99u)
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
        val issued = s.issued(42u)
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
        // cap ≠ 3 on purpose: 3 is Exposed's Transaction.maxAttempts default, which shadowed the
        // store's cap inside suspendTransaction until v3.12.2 — a cap of 3 could never tell.
        val cap = 4
        val n = 8
        val s = store(maxAttempts = cap)
        val issued = s.issued(7u)
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
    fun `the configured cap is honoured - under a cap of one a single wrong guess kills the challenge`(): Unit =
        runBlocking {
            // Regression pin for the shadowing bug (v3.11.0 until v3.12.2) (Transaction.maxAttempts = 3 won
            // over the store's property, so every challenge silently allowed 3 guesses).
            val s = store(maxAttempts = 1)
            val issued = s.issued(7u)
            assertEquals("too_many_attempts", (s.verify(issued.challengeId, "wrong") as MfaChallenges.Outcome.Failure).reason)
            assertEquals("unknown_challenge", (s.verify(issued.challengeId, issued.code) as MfaChallenges.Outcome.Failure).reason)
        }

    @Test
    fun `a final wrong guess can beat a concurrent correct code under a cap of one`(): Unit = runBlocking {
        val s = store(maxAttempts = 1)
        val issued = s.issued(7u)
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

    @Test
    fun `the (cap+1)-th issue is throttled while cap live challenges exist`(): Unit = runBlocking {
        val s = store(maxPendingChallenges = 3)
        repeat(3) { assertIs<MfaChallenges.IssueOutcome.Issued>(s.issue(11u)) }
        assertEquals(MfaChallenges.IssueOutcome.Throttled, s.issue(11u))
        // Another account is unaffected — the cap is per-account.
        assertIs<MfaChallenges.IssueOutcome.Issued>(s.issue(12u))
    }

    @Test
    fun `an expired challenge does not count toward the pending-challenge cap`(): Unit = runBlocking {
        val s = store(ttlMillis = 60_000, maxPendingChallenges = 2)
        repeat(2) { assertIs<MfaChallenges.IssueOutcome.Issued>(s.issue(21u)) }
        assertEquals(MfaChallenges.IssueOutcome.Throttled, s.issue(21u))
        // The two live challenges expire; the next issue prunes them before counting, so it
        // is no longer throttled.
        now += 60_000
        assertIs<MfaChallenges.IssueOutcome.Issued>(s.issue(21u))
    }

    @Test
    fun `a consumed challenge frees a pending-challenge slot`(): Unit = runBlocking {
        val s = store(maxPendingChallenges = 2)
        val first = s.issued(31u)
        assertIs<MfaChallenges.IssueOutcome.Issued>(s.issue(31u))
        assertEquals(MfaChallenges.IssueOutcome.Throttled, s.issue(31u))
        // Successfully verifying (consuming) one challenge frees its slot.
        assertIs<MfaChallenges.Outcome.Success>(s.verify(first.challengeId, first.code))
        assertIs<MfaChallenges.IssueOutcome.Issued>(s.issue(31u))
    }

    @Test
    fun `N concurrent issues for one account are atomically bounded by the pending-challenge cap`(): Unit =
        runBlocking {
            // Real-concurrency pin for the per-account advisory lock in issue() (review finding):
            // without serialization, N concurrent transactions would all read the same pre-insert
            // COUNT under READ COMMITTED and all pass the cap check — the same race class
            // LoginThrottle.reserveAttempt closed in v3.13.1 (the LoginLockoutTest
            // `a concurrent burst...` idiom).
            val cap = 3
            val n = 10
            val s = store(maxPendingChallenges = cap)
            val gate = CompletableDeferred<Unit>()
            val outcomes = coroutineScope {
                val jobs = List(n) {
                    async(Dispatchers.IO) {
                        gate.await()
                        s.issue(41u)
                    }
                }
                gate.complete(Unit)
                jobs.awaitAll()
            }
            assertEquals(cap, outcomes.count { it is MfaChallenges.IssueOutcome.Issued })
            assertEquals(n - cap, outcomes.count { it is MfaChallenges.IssueOutcome.Throttled })

            val liveRows = suspendTransaction(TestServices.database) {
                MfaChallenges.Challenges.selectAll()
                    .where { MfaChallenges.Challenges.userId eq 41L }
                    .toList()
            }
            assertEquals(cap, liveRows.size, "exactly $cap live rows should exist for the account")
        }
}
