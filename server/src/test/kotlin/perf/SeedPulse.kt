package ch.nokillswit.perf

import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryService
import ch.nokillswit.pulse.PulseCycleService
import ch.nokillswit.pulse.PulseCycleStatus
import ch.nokillswit.pulse.PulseResponseService
import ch.nokillswit.pulse.pulseOpenedNotifications
import ch.nokillswit.pulse.pulseResultsNotifications
import ch.nokillswit.pulse.pulseScheduledNotifications
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import java.time.LocalDate

/** The ADMIN seed account (V6) — the actor of every cycle transition; never a recipient. */
private const val ADMIN_ID = 1u

private const val CADENCE_DAYS = 14L
private const val OPEN_DAYS = 7L
private const val RESPONSE_RATE_MIN = 80
private const val OPEN_CYCLE_RATE_PERCENT = 50

private class Question(val entryId: UInt, val textEn: String, val translations: String)

private class CycleRow(
    val id: UInt,
    val status: PulseCycleStatus,
    val openDate: LocalDate,
    val closeDate: LocalDate,
    val question: Question,
    val createdAt: Long,
    val openedAt: Long,
    val closedAt: Long?,
    val lastModified: Long,
)

private class ResponseRow(val id: UInt, val cycleId: UInt, val userId: UInt, val answers: List<String>, val comment: String?, val at: Long)

private suspend fun loadQuestions(ctx: SeedContext): List<Question> = suspendTransaction(ctx.db) {
    val e = DictionaryService.Entries
    e.selectAll().where { (e.dictionary eq Dictionary.PULSE_ROTATING_QUESTION.name) and (e.markedAsDeleted eq false) }
        .map { Question(it[e.id].value, it[e.valueEn], it[e.translations]) }.toList().sortedBy { it.entryId }
}

/** A scale answer "1".."5", "NA" for ~5 % (excluded from the driver maths). */
private fun scale(rng: Rng, mean: Double): String = if (rng.chance(0.05)) "NA" else rng.bell(mean, 2.2, 1, 5).toString()

/**
 * Pulse surveys (`.claude/docs/features/pulse-surveys.md`): one cycle every two weeks over the history
 * (130 at scale 1.0), oldest first, every cycle CLOSED except the newest, which is OPEN (opened 3 days
 * before the anchor, the "at most one non-terminal cycle" rule) with ~50 % of the participants answered
 * so far. Q6 (the rotating question) cycles through the dictionary bank, snapshotted onto the cycle like
 * `PulseCycleService.pickRotatingQuestion` does. The eligibility snapshot (`pulse_participants`) is every
 * teamed person — the generator's users all have PULSE_SURVEYS enabled. A closed cycle holds responses
 * from 80–100 % of its participants; each carries the six scored answers (eNPS "0".."10", four drivers and
 * the rotating question "1".."5"/"NA") and a ~30 % optional comment, all seven columns encrypted. Notifications
 * by the table in the pulse doc via the pure builders `pulseScheduled/Opened/ResultsNotifications`
 * (admin = actor): scheduled → every eligible person at the scheduling time, opened → participants at the
 * open, results available → the respondents at the close (retention-shaped by [NotificationMint]).
 */
suspend fun seedPulse(ctx: SeedContext, org: Org, mint: NotificationMint) {
    val db = ctx.db
    val rng = ctx.rng("pulse")
    val questions = loadQuestions(ctx)
    val cycles = RowSink<CycleRow>(db, PulseCycleService.PulseCycles) { c ->
        val t = PulseCycleService.PulseCycles
        this[t.id] = c.id
        this[t.status] = c.status
        this[t.plannedOpenDate] = c.openDate.toString()
        this[t.plannedCloseDate] = c.closeDate.toString()
        this[t.rotatingQuestionEntryId] = c.question.entryId
        this[t.rotatingQuestionTextEn] = c.question.textEn
        this[t.rotatingQuestionTranslations] = c.question.translations
        this[t.createdAt] = c.createdAt
        this[t.openedAt] = c.openedAt
        this[t.closedAt] = c.closedAt
        this[t.lastModified] = c.lastModified
    }
    val participants = RowSink<Pair<UInt, UInt>>(db, PulseResponseService.PulseParticipants) { (cycleId, userId) ->
        this[PulseResponseService.PulseParticipants.cycleId] = cycleId
        this[PulseResponseService.PulseParticipants.userId] = userId
    }
    val responses = RowSink<ResponseRow>(db, PulseResponseService.PulseResponses) { r ->
        val t = PulseResponseService.PulseResponses
        this[t.id] = r.id
        this[t.cycleId] = r.cycleId
        this[t.userId] = r.userId
        this[t.enps] = ctx.cipher.encrypt(r.answers[0])
        this[t.driver1] = ctx.cipher.encrypt(r.answers[1])
        this[t.driver2] = ctx.cipher.encrypt(r.answers[2])
        this[t.driver3] = ctx.cipher.encrypt(r.answers[3])
        this[t.driver4] = ctx.cipher.encrypt(r.answers[4])
        this[t.rotating] = ctx.cipher.encrypt(r.answers[5])
        this[t.comment] = r.comment?.let(ctx.cipher::encrypt)
        this[t.submittedAt] = r.at
        this[t.lastModified] = r.at
    }
    val group = SinkGroup(cycles, participants, responses)
    val cycleIds = IdCounter(nextFreeId(db, PulseCycleService.PulseCycles))
    val responseIds = IdCounter(nextFreeId(db, PulseResponseService.PulseResponses))
    val eligible = org.managed.map { it.id }.toSet()
    val count = ctx.spec.pulseCycles
    for (j in 0 until count) {
        val age = count - 1 - j // 0 = the newest cycle
        val open = ctx.config.anchor.minusDays(3 + CADENCE_DAYS * age)
        val close = open.plusDays(OPEN_DAYS)
        val isOpen = age == 0
        val createdAt = ctx.millis(open.minusDays(7), 9)
        val openedAt = ctx.millis(open, 9)
        val closedAt = if (isOpen) null else ctx.millis(close, 17)
        val question = questions[j % questions.size]
        val cycle = CycleRow(
            cycleIds.take(), if (isOpen) PulseCycleStatus.OPEN else PulseCycleStatus.CLOSED, open, close, question,
            createdAt, openedAt, closedAt, closedAt ?: openedAt,
        )
        cycles.add(cycle)
        eligible.forEach { participants.add(cycle.id to it) }
        val rate = if (isOpen) OPEN_CYCLE_RATE_PERCENT else rng.int(RESPONSE_RATE_MIN, 100)
        val respondents = eligible.filter { rng.int(1, 100) <= rate }
        respondents.forEach { userId ->
            val at = openedAt + (rng.double() * ((closedAt ?: ctx.anchorMillis - 1) - openedAt)).toLong()
            val answers = listOf(rng.bell(7.3, 4.0, 0, 10).toString()) + List(4) { scale(rng, 3.7) } + scale(rng, 3.5)
            val comment = if (rng.chance(0.3)) Text.paragraph(rng, 20, 300) else null
            responses.add(ResponseRow(responseIds.take(), cycle.id, userId, answers, comment, at))
        }
        mint.emitAll(pulseScheduledNotifications(eligible, ADMIN_ID, open.toString(), close.toString()), createdAt)
        mint.emitAll(pulseOpenedNotifications(eligible, ADMIN_ID, close.toString()), openedAt)
        if (closedAt != null) {
            mint.emitAll(pulseResultsNotifications(respondents.toSet(), ADMIN_ID, cycle.id, close.toString()), closedAt)
        }
        group.flush()
        mint.sinkGroup.flush()
    }
    advanceSequences(db, listOf(PulseCycleService.PulseCycles, PulseResponseService.PulseResponses))
}
