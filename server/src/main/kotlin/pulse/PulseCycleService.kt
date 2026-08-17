package ch.nokillswit.pulse

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.dictionaries.DEFAULT_LANGUAGE
import ch.nokillswit.dictionaries.Dictionary
import ch.nokillswit.dictionaries.DictionaryService
import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.db.encodeParams
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserService
import io.ktor.server.plugins.BadRequestException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import kotlin.random.Random

val PulseCycleServiceKey = AttributeKey<PulseCycleService>("PulseCycleService")

/** open(): who got snapshotted (the "opened" notification audience). */
data class PulseOpenResult(val participantIds: Set<UInt>)

/** close(): who responded (the "results available" notification audience). */
data class PulseCloseResult(val respondentIds: Set<UInt>)

/** cancel(): the status left behind (audit) + the audience to notify (participants, OPEN only). */
data class PulseCancelResult(val fromStatus: PulseCycleStatus, val participantIds: Set<UInt>)

/**
 * Pulse cycles: the admin-managed status machine (SCHEDULED -> OPEN -> CLOSED, CANCELLED from
 * anywhere). Follows the GoalService transition idiom — null return = 404 (route responds),
 * [ConflictException] = 409 (StatusPages maps) — with the review-periods "one global registry"
 * posture: at most ONE non-terminal cycle exists at a time (pre-checked here, backstopped by
 * V48's partial unique index -> 23505 -> central 409). The rotating question (Q6) is picked at
 * schedule time — least-used-first over non-cancelled cycles, random among ties via the
 * injectable [random] (the injectable-now test idiom) — and snapshotted as text.
 */
class PulseCycleService(
    val database: R2dbcDatabase,
    private val random: Random = Random.Default,
) {
    object PulseCycles : UIntIdTable("pulse_cycles") {
        val status = enumerationByName("status", 20, PulseCycleStatus::class)
        val plannedOpenDate = varchar("planned_open_date", 10)
        val plannedCloseDate = varchar("planned_close_date", 10)
        val rotatingQuestionEntryId = reference("rotating_question_entry_id", DictionaryService.Entries)
        val rotatingQuestionTextEn = varchar("rotating_question_text_en", 100)

        // JSON {lang -> value} map of the snapshotted NON-EN texts (V60, the dictionary
        // `translations` shape); '{}' when none. Frozen at schedule time like the EN column.
        val rotatingQuestionTranslations = text("rotating_question_translations")
        val createdAt = long("created_at")
        val openedAt = long("opened_at").nullable()
        val closedAt = long("closed_at").nullable()
        val cancelledAt = long("cancelled_at").nullable()
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = PulseCycles.markedAsDeleted eq false

    /**
     * Schedules a cycle: 409 when a SCHEDULED/OPEN cycle already exists or the rotating-question
     * dictionary has no active entries; otherwise picks + snapshots the rotating question and
     * inserts at SCHEDULED. Returns the new id. Dates were shape-validated by the route.
     */
    suspend fun schedule(request: PulseCycleCreateRequest): UInt = suspendTransaction(database) {
        val nonTerminal = PulseCycles.selectAll()
            .where {
                (PulseCycles.status neq PulseCycleStatus.CLOSED) and
                    (PulseCycles.status neq PulseCycleStatus.CANCELLED) and active()
            }
            .count()
        if (nonTerminal > 0) {
            throw ConflictException("A scheduled or open pulse cycle already exists")
        }
        val question = pickRotatingQuestion()
        val now = System.currentTimeMillis()
        PulseCycles.insert {
            it[status] = PulseCycleStatus.SCHEDULED
            it[plannedOpenDate] = request.plannedOpenDate
            it[plannedCloseDate] = request.plannedCloseDate
            it[rotatingQuestionEntryId] = question.entryId
            it[rotatingQuestionTextEn] = question.values.getValue(DEFAULT_LANGUAGE)
            it[rotatingQuestionTranslations] = encodeParams(question.values - DEFAULT_LANGUAGE)
            it[createdAt] = now
            it[lastModified] = now
        }[PulseCycles.id].value
    }

    suspend fun read(id: UInt): PulseCycleRow? = suspendTransaction(database) {
        PulseCycles.selectAll()
            .where { (PulseCycles.id eq id) and active() }
            .map { it.toRow() }
            .singleOrNull()
    }

    /** All cycles, newest first (unpaged registry shape — a cadence of weeks caps the volume). */
    suspend fun list(): List<PulseCycleRow> = suspendTransaction(database) {
        PulseCycles.selectAll()
            .where { active() }
            .orderBy(PulseCycles.id, SortOrder.DESC)
            .map { it.toRow() }
            .toList()
    }

    /** The single OPEN cycle, if any (the survey tab's and the dashboard tile's anchor). */
    suspend fun currentOpenCycle(): PulseCycleRow? = suspendTransaction(database) {
        PulseCycles.selectAll()
            .where { (PulseCycles.status eq PulseCycleStatus.OPEN) and active() }
            .map { it.toRow() }
            .singleOrNull()
    }

    /** Non-cancelled CLOSED cycles, oldest first (the trend series / previous-cycle source). */
    suspend fun closedCyclesAsc(): List<PulseCycleRow> = suspendTransaction(database) {
        PulseCycles.selectAll()
            .where { (PulseCycles.status eq PulseCycleStatus.CLOSED) and active() }
            .map { it.toRow() }
            .toList()
            .sortedBy { it.closedAt }
    }

    /**
     * Edits the planned dates: SCHEDULED = both editable; OPEN = close date only (the payload
     * must carry the unchanged open date back, else 400); CLOSED/CANCELLED = 409. Returns the
     * affected-row count (0 -> 404).
     */
    suspend fun updateDates(id: UInt, request: PulseCycleUpdateRequest): Int = suspendTransaction(database) {
        val current = PulseCycles.selectAll()
            .where { (PulseCycles.id eq id) and active() }
            .map { it.toRow() }
            .singleOrNull()
            ?: return@suspendTransaction 0
        when (current.status) {
            PulseCycleStatus.SCHEDULED -> Unit
            PulseCycleStatus.OPEN ->
                if (request.plannedOpenDate != current.plannedOpenDate) {
                    throw BadRequestException("An open cycle's open date cannot be changed")
                }
            PulseCycleStatus.CLOSED, PulseCycleStatus.CANCELLED ->
                throw ConflictException("A ${current.status} cycle's dates cannot be changed")
        }
        validatePulseCycleDates(request.plannedOpenDate, request.plannedCloseDate)
        PulseCycles.update({ (PulseCycles.id eq id) and (PulseCycles.markedAsDeleted eq false) }) {
            it[plannedOpenDate] = request.plannedOpenDate
            it[plannedCloseDate] = request.plannedCloseDate
            it[lastModified] = System.currentTimeMillis()
        }
    }

    /**
     * SCHEDULED -> OPEN: stamps openedAt and SNAPSHOTS eligibility into pulse_participants —
     * active, not deactivated, PULSE_SURVEYS enabled, evaluated NOW (later churn never touches
     * this cycle). Returns the participant set (the notification audience), null -> 404,
     * [ConflictException] -> 409.
     */
    suspend fun open(id: UInt): PulseOpenResult? = suspendTransaction(database) {
        val current = readForTransition(id) ?: return@suspendTransaction null
        if (current.status != PulseCycleStatus.SCHEDULED) {
            throw ConflictException("Invalid status transition: ${current.status} -> OPEN")
        }
        val now = System.currentTimeMillis()
        PulseCycles.update({ (PulseCycles.id eq id) and (PulseCycles.markedAsDeleted eq false) }) {
            it[status] = PulseCycleStatus.OPEN
            it[openedAt] = now
            it[lastModified] = now
        }
        val participants = eligibleUserIdsInTransaction()
        participants.forEach { userId ->
            PulseResponseService.PulseParticipants.insert {
                it[cycleId] = id
                it[this.userId] = userId
            }
        }
        PulseOpenResult(participantIds = participants)
    }

    /** OPEN -> CLOSED: stamps closedAt; returns the respondents (the results-notification audience). */
    suspend fun close(id: UInt): PulseCloseResult? = suspendTransaction(database) {
        val current = readForTransition(id) ?: return@suspendTransaction null
        if (current.status != PulseCycleStatus.OPEN) {
            throw ConflictException("Invalid status transition: ${current.status} -> CLOSED")
        }
        val now = System.currentTimeMillis()
        PulseCycles.update({ (PulseCycles.id eq id) and (PulseCycles.markedAsDeleted eq false) }) {
            it[status] = PulseCycleStatus.CLOSED
            it[closedAt] = now
            it[lastModified] = now
        }
        PulseCloseResult(respondentIds = respondentIdsInTransaction(id))
    }

    /**
     * Any non-CANCELLED status -> CANCELLED. Cancelling a CLOSED cycle retracts its results;
     * responses are kept for audit in every case. Only an OPEN cycle's cancellation notifies
     * (its participants were mid-survey); a scheduled or closed one goes quietly.
     */
    suspend fun cancel(id: UInt): PulseCancelResult? = suspendTransaction(database) {
        val current = readForTransition(id) ?: return@suspendTransaction null
        if (current.status == PulseCycleStatus.CANCELLED) {
            throw ConflictException("The cycle is already cancelled")
        }
        val now = System.currentTimeMillis()
        PulseCycles.update({ (PulseCycles.id eq id) and (PulseCycles.markedAsDeleted eq false) }) {
            it[status] = PulseCycleStatus.CANCELLED
            it[cancelledAt] = now
            it[lastModified] = now
        }
        PulseCancelResult(
            fromStatus = current.status,
            participantIds = if (current.status == PulseCycleStatus.OPEN) {
                PulseResponseService.PulseParticipants
                    .select(PulseResponseService.PulseParticipants.userId)
                    .where { PulseResponseService.PulseParticipants.cycleId eq id }
                    .map { it[PulseResponseService.PulseParticipants.userId].value }
                    .toList()
                    .toSet()
            } else {
                emptySet()
            },
        )
    }

    /**
     * Who would participate if a cycle opened right now — the "scheduled" notification audience
     * (deliberately un-stored: the OPEN snapshot is taken later and may differ).
     */
    suspend fun eligibleUserIds(): Set<UInt> = suspendTransaction(database) {
        eligibleUserIdsInTransaction()
    }

    /** (participants, responses) per cycle — the ADMIN list/participation counts. */
    suspend fun participationCounts(cycleIds: Set<UInt>): Map<UInt, Pair<Int, Int>> =
        suspendTransaction(database) {
            if (cycleIds.isEmpty()) return@suspendTransaction emptyMap()
            val participantCount = PulseResponseService.PulseParticipants.userId.count()
            val participants = PulseResponseService.PulseParticipants
                .select(PulseResponseService.PulseParticipants.cycleId, participantCount)
                .where { PulseResponseService.PulseParticipants.cycleId inList cycleIds }
                .groupBy(PulseResponseService.PulseParticipants.cycleId)
                .map { it[PulseResponseService.PulseParticipants.cycleId].value to it[participantCount].toInt() }
                .toList()
                .toMap()
            val responseCount = PulseResponseService.PulseResponses.id.count()
            val responses = PulseResponseService.PulseResponses
                .select(PulseResponseService.PulseResponses.cycleId, responseCount)
                .where { PulseResponseService.PulseResponses.cycleId inList cycleIds }
                .groupBy(PulseResponseService.PulseResponses.cycleId)
                .map { it[PulseResponseService.PulseResponses.cycleId].value to it[responseCount].toInt() }
                .toList()
                .toMap()
            cycleIds.associateWith { (participants[it] ?: 0) to (responses[it] ?: 0) }
        }

    private suspend fun readForTransition(id: UInt): PulseCycleRow? =
        PulseCycles.selectAll()
            .where { (PulseCycles.id eq id) and active() }
            .map { it.toRow() }
            .singleOrNull()

    private suspend fun respondentIdsInTransaction(cycleId: UInt): Set<UInt> =
        PulseResponseService.PulseResponses
            .select(PulseResponseService.PulseResponses.userId)
            .where { PulseResponseService.PulseResponses.cycleId eq cycleId }
            .map { it[PulseResponseService.PulseResponses.userId].value }
            .toList()
            .toSet()

    private suspend fun eligibleUserIdsInTransaction(): Set<UInt> {
        val disabled = UserService.UserDisabledFeatures
            .select(UserService.UserDisabledFeatures.userId)
            .where { UserService.UserDisabledFeatures.feature eq Feature.PULSE_SURVEYS.name }
        return UserService.Users
            .select(UserService.Users.id)
            .where {
                (UserService.Users.markedAsDeleted eq false) and
                    (UserService.Users.deactivated eq false) and
                    (UserService.Users.id notInSubQuery disabled)
            }
            .map { it[UserService.Users.id].value }
            .toList()
            .toSet()
    }

    /**
     * "Smart random" pool-without-replacement: candidates are the ACTIVE dictionary entries
     * with the LOWEST usage count over non-cancelled cycles (a cancelled cycle returns its
     * question to the pool), picked uniformly at random. Nothing reaches usage n+1 until every
     * active entry reached n — the reset is implicit when counts equalize — and a newly added
     * entry (usage 0) is automatically next in line. Returns the entry id + the trimmed
     * language->text map (EN always present).
     */
    private data class RotatingPick(val entryId: UInt, val values: Map<String, String>)

    private suspend fun pickRotatingQuestion(): RotatingPick {
        val entries = DictionaryService.Entries
            .select(
                DictionaryService.Entries.id,
                DictionaryService.Entries.valueEn,
                DictionaryService.Entries.translations,
            )
            .where {
                (DictionaryService.Entries.dictionary eq Dictionary.PULSE_ROTATING_QUESTION.name) and
                    (DictionaryService.Entries.markedAsDeleted eq false)
            }
            .map {
                RotatingPick(
                    entryId = it[DictionaryService.Entries.id].value,
                    values = (
                        mapOf(DEFAULT_LANGUAGE to it[DictionaryService.Entries.valueEn]) +
                            decodeParams(it[DictionaryService.Entries.translations])
                        ).mapValues { (_, value) -> value.trim() },
                )
            }
            .toList()
        if (entries.isEmpty()) {
            throw ConflictException("The pulse rotating-question dictionary has no active entries")
        }
        val countColumn = PulseCycles.id.count()
        val usage = PulseCycles
            .select(PulseCycles.rotatingQuestionEntryId, countColumn)
            .where { (PulseCycles.status neq PulseCycleStatus.CANCELLED) and active() }
            .groupBy(PulseCycles.rotatingQuestionEntryId)
            .map { it[PulseCycles.rotatingQuestionEntryId].value to it[countColumn] }
            .toList()
            .toMap()
        val minUsage = entries.minOf { usage[it.entryId] ?: 0L }
        val candidates = entries.filter { (usage[it.entryId] ?: 0L) == minUsage }
        return candidates[random.nextInt(candidates.size)]
    }

    private fun ResultRow.toRow() = PulseCycleRow(
        id = this[PulseCycles.id].value,
        status = this[PulseCycles.status],
        plannedOpenDate = this[PulseCycles.plannedOpenDate],
        plannedCloseDate = this[PulseCycles.plannedCloseDate],
        rotatingQuestionEntryId = this[PulseCycles.rotatingQuestionEntryId].value,
        rotatingQuestion = mapOf(DEFAULT_LANGUAGE to this[PulseCycles.rotatingQuestionTextEn]) +
            decodeParams(this[PulseCycles.rotatingQuestionTranslations]),
        createdAt = this[PulseCycles.createdAt],
        openedAt = this[PulseCycles.openedAt],
        closedAt = this[PulseCycles.closedAt],
        cancelledAt = this[PulseCycles.cancelledAt],
        lastModified = this[PulseCycles.lastModified],
    )
}
