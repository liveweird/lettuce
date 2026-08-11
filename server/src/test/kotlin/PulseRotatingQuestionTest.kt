package ch.nokillswit

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.pulse.PulseCycleCreateRequest
import ch.nokillswit.pulse.PulseCycleStatus
import io.ktor.server.testing.testApplication
import java.util.UUID
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

/**
 * The "smart random" rotating-question pick (least-used active entry over non-cancelled
 * cycles): new-entry priority, cancelled-cycle exclusion, rename-proof snapshots, and the
 * empty-bank 409. The dictionary AND the cycle registry are global shared state — every test
 * sweeps non-terminal cycles first, appends its own uniquely-named entries, and drives every
 * cycle it schedules to a terminal status.
 */
class PulseRotatingQuestionTest {

    private fun request() = PulseCycleCreateRequest(plannedOpenDate = "2099-01-01", plannedCloseDate = "2099-01-08")

    /** Schedules and immediately force-closes, returning the picked entry id. */
    private suspend fun burnOne(): UInt {
        val id = TestPulse.cycles.schedule(request())
        val entry = checkNotNull(TestPulse.cycles.read(id)).rotatingQuestionEntryId
        TestPulse.forceStatus(id, PulseCycleStatus.CLOSED, closedAt = System.currentTimeMillis())
        return entry
    }

    @Test
    fun `a brand-new entry is the unique minimum and is picked next - pool-without-replacement`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        // Bring every currently active entry to usage >= 1 (each round burns a min-usage
        // entry, so at most one round per active entry).
        bringAllActiveToAtLeastOne()
        // Now a fresh entry (usage 0) must be the very next pick.
        val fresh = "Fresh statement ${UUID.randomUUID()}".take(100)
        val freshId = TestDictionaries.append(Dictionary.PULSE_ROTATING_QUESTION, fresh).single()
        assertEquals(freshId, burnOne())
    }

    @Test
    fun `a cancelled cycle returns its question to the pool`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        // Make a unique minimum, schedule (it gets picked), cancel — usage stays 0, so the
        // NEXT schedule must pick the very same entry again.
        bringAllActiveToAtLeastOne()
        val value = "Cancelled-pool statement ${UUID.randomUUID()}".take(100)
        val entryId = TestDictionaries.append(Dictionary.PULSE_ROTATING_QUESTION, value).single()
        val first = TestPulse.cycles.schedule(request())
        assertEquals(entryId, checkNotNull(TestPulse.cycles.read(first)).rotatingQuestionEntryId)
        checkNotNull(TestPulse.cycles.cancel(first))
        val second = TestPulse.cycles.schedule(request())
        assertEquals(entryId, checkNotNull(TestPulse.cycles.read(second)).rotatingQuestionEntryId)
        TestPulse.forceStatus(second, PulseCycleStatus.CLOSED, closedAt = System.currentTimeMillis())
    }

    @Test
    fun `the snapshot survives a rename - history is never rewritten`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        bringAllActiveToAtLeastOne()
        val original = "Snapshot statement ${UUID.randomUUID()}".take(100)
        val entryId = TestDictionaries.append(Dictionary.PULSE_ROTATING_QUESTION, original).single()
        val cycleId = TestPulse.cycles.schedule(request())
        val cycle = checkNotNull(TestPulse.cycles.read(cycleId))
        assertEquals(entryId, cycle.rotatingQuestionEntryId)
        assertEquals(original, cycle.rotatingQuestionTextEn)
        // The fixture writes PL = EN, and BOTH languages are frozen at schedule time.
        assertEquals(original, cycle.rotatingQuestionTextPl)

        TestDictionaries.rename(Dictionary.PULSE_ROTATING_QUESTION, entryId, "Renamed ${UUID.randomUUID()}".take(100))
        assertEquals(original, checkNotNull(TestPulse.cycles.read(cycleId)).rotatingQuestionTextEn)
        assertEquals(original, checkNotNull(TestPulse.cycles.read(cycleId)).rotatingQuestionTextPl)
        checkNotNull(TestPulse.cycles.cancel(cycleId))
    }

    @Test
    fun `an empty question bank refuses to schedule with 409`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        // Empty the bank (soft-deletes every active entry)...
        TestDictionaries.service.replace(
            Dictionary.PULSE_ROTATING_QUESTION,
            ch.nokillswit.dictionaries.DictionaryUpdateRequest(emptyList()),
        )
        try {
            assertFailsWith<ConflictException> { TestPulse.cycles.schedule(request()) }
        } finally {
            // ...and restore a working bank for later tests (values must be fresh — the old
            // ones are soft-deleted, not resurrectable).
            TestDictionaries.append(
                Dictionary.PULSE_ROTATING_QUESTION,
                "Restored statement ${UUID.randomUUID()}".take(100),
            )
        }
    }

    @Test
    fun `every pick is a minimum-usage active entry`() = testApplication {
        usePostgresTestcontainer()
        TestPulse.sweepNonTerminal()
        repeat(3) {
            val counts = usageCounts()
            val active = TestDictionaries.service.read(Dictionary.PULSE_ROTATING_QUESTION)
            assertTrue(active.isNotEmpty())
            val min = active.minOf { counts[it.id] ?: 0 }
            val picked = burnOne()
            assertEquals(min, counts[picked] ?: 0, "picked entry $picked was not minimum-usage")
        }
    }

    private suspend fun bringAllActiveToAtLeastOne() {
        val active = TestDictionaries.service.read(Dictionary.PULSE_ROTATING_QUESTION)
        repeat(active.size + 1) {
            val counts = usageCounts()
            if (TestDictionaries.service.read(Dictionary.PULSE_ROTATING_QUESTION).all { (counts[it.id] ?: 0) >= 1 }) return
            burnOne()
        }
    }

    /** Non-cancelled cycle count per rotating entry (the service's pool measure), from the registry. */
    private suspend fun usageCounts(): Map<UInt, Int> =
        TestPulse.cycles.list()
            .filter { it.status != PulseCycleStatus.CANCELLED }
            .groupingBy { it.rotatingQuestionEntryId }
            .eachCount()
}
