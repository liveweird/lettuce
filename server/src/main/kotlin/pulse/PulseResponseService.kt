package ch.nokillswit.pulse

import ch.nokillswit.infra.crypto.EncryptedAtRest
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.crypto.reencryptRows
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val PulseResponseServiceKey = AttributeKey<PulseResponseService>("PulseResponseService")

/**
 * Pulse participation snapshots + survey responses. `user_id` on a response is AUDIT LINKAGE
 * ONLY: the only per-user read is [myResponse] (the owner's own edit-form prefill, OPEN-gated
 * by the route); everything else leaves this service either as the id-free [PulseAnswers]
 * shape, an author-free shuffled comment list, or a bare responded-id set — never a
 * (user -> answers) pair. All six scored answers and the comment are encrypted at rest
 * (values "0".."10" / "1".."5" / "NA" as strings — the V45 review-ratings precedent); no SQL
 * ever filters/sorts/aggregates the encrypted columns — scope rows are loaded and computed on
 * in Kotlin (see PulseAggregation.kt).
 */
class PulseResponseService(val database: R2dbcDatabase, private val cipher: FieldCipher) : EncryptedAtRest {
    override val encryptedRowLabel = "pulse response"

    object PulseParticipants : Table("pulse_participants") {
        val cycleId = reference("cycle_id", PulseCycleService.PulseCycles)
        val userId = reference("user_id", UserService.Users)
        override val primaryKey = PrimaryKey(cycleId, userId)
    }

    object PulseResponses : UIntIdTable("pulse_responses") {
        val cycleId = reference("cycle_id", PulseCycleService.PulseCycles)
        val userId = reference("user_id", UserService.Users)
        val enps = text("enps")
        val driver1 = text("driver1")
        val driver2 = text("driver2")
        val driver3 = text("driver3")
        val driver4 = text("driver4")
        val rotating = text("rotating")
        val comment = text("comment").nullable()
        val submittedAt = long("submitted_at")
        val lastModified = long("last_modified")
    }

    suspend fun isParticipant(cycleId: UInt, userId: UInt): Boolean = suspendTransaction(database) {
        PulseParticipants.selectAll()
            .where { (PulseParticipants.cycleId eq cycleId) and (PulseParticipants.userId eq userId) }
            .count() > 0
    }

    suspend fun hasResponded(cycleId: UInt, userId: UInt): Boolean = suspendTransaction(database) {
        PulseResponses.selectAll()
            .where { (PulseResponses.cycleId eq cycleId) and (PulseResponses.userId eq userId) }
            .count() > 0
    }

    /**
     * Creates or fully replaces the caller's response ([request] pre-validated/normalized by
     * the route, which also enforced participant + OPEN). submitted_at is set once, on the
     * first submission; every scored answer re-encrypts under a fresh nonce.
     */
    suspend fun upsert(cycleId: UInt, userId: UInt, request: PulseResponseSubmitRequest): Unit =
        suspendTransaction(database) {
            val now = System.currentTimeMillis()
            val updated = PulseResponses.update({
                (PulseResponses.cycleId eq cycleId) and (PulseResponses.userId eq userId)
            }) {
                it[enps] = cipher.encrypt(request.enps.toString())
                it[driver1] = cipher.encrypt(request.q2.wire)
                it[driver2] = cipher.encrypt(request.q3.wire)
                it[driver3] = cipher.encrypt(request.q4.wire)
                it[driver4] = cipher.encrypt(request.q5.wire)
                it[rotating] = cipher.encrypt(request.rotating.wire)
                it[comment] = request.comment?.let(cipher::encrypt)
                it[lastModified] = now
            }
            if (updated == 0) {
                PulseResponses.insert {
                    it[this.cycleId] = cycleId
                    it[this.userId] = userId
                    it[enps] = cipher.encrypt(request.enps.toString())
                    it[driver1] = cipher.encrypt(request.q2.wire)
                    it[driver2] = cipher.encrypt(request.q3.wire)
                    it[driver3] = cipher.encrypt(request.q4.wire)
                    it[driver4] = cipher.encrypt(request.q5.wire)
                    it[rotating] = cipher.encrypt(request.rotating.wire)
                    it[comment] = request.comment?.let(cipher::encrypt)
                    it[submittedAt] = now
                    it[lastModified] = now
                }
            }
        }

    /** The caller's own saved answers (edit-form prefill); the route enforces owner + OPEN. */
    suspend fun myResponse(cycleId: UInt, userId: UInt): PulseMyResponse? = suspendTransaction(database) {
        PulseResponses.selectAll()
            .where { (PulseResponses.cycleId eq cycleId) and (PulseResponses.userId eq userId) }
            .map { row ->
                PulseMyResponse(
                    cycleId = cycleId,
                    enps = cipher.decrypt(row[PulseResponses.enps]).toInt(),
                    q2 = PulseScaleAnswer.fromWire(cipher.decrypt(row[PulseResponses.driver1])),
                    q3 = PulseScaleAnswer.fromWire(cipher.decrypt(row[PulseResponses.driver2])),
                    q4 = PulseScaleAnswer.fromWire(cipher.decrypt(row[PulseResponses.driver3])),
                    q5 = PulseScaleAnswer.fromWire(cipher.decrypt(row[PulseResponses.driver4])),
                    rotating = PulseScaleAnswer.fromWire(cipher.decrypt(row[PulseResponses.rotating])),
                    comment = row[PulseResponses.comment]?.let(cipher::decrypt),
                    submittedAt = row[PulseResponses.submittedAt],
                    lastModified = row[PulseResponses.lastModified],
                )
            }
            .singleOrNull()
    }

    /** Which of [scope] responded in [cycleId] — participation monitoring's yes/no, ids only. */
    suspend fun respondedUserIds(cycleId: UInt, scope: Set<UInt>): Set<UInt> = suspendTransaction(database) {
        if (scope.isEmpty()) return@suspendTransaction emptySet()
        PulseResponses.select(PulseResponses.userId)
            .where { (PulseResponses.cycleId eq cycleId) and (PulseResponses.userId inList scope) }
            .map { it[PulseResponses.userId].value }
            .toList()
            .toSet()
    }

    /** Which of [scope] were snapshotted as participants of [cycleId] — the monitoring rows' base. */
    suspend fun participantUserIds(cycleId: UInt, scope: Set<UInt>): Set<UInt> = suspendTransaction(database) {
        if (scope.isEmpty()) return@suspendTransaction emptySet()
        PulseParticipants.select(PulseParticipants.userId)
            .where { (PulseParticipants.cycleId eq cycleId) and (PulseParticipants.userId inList scope) }
            .map { it[PulseParticipants.userId].value }
            .toList()
            .toSet()
    }

    /** Every cycle [userId] has responded in — the trend/results fill gate, one query. */
    suspend fun respondedCycleIds(userId: UInt): Set<UInt> = suspendTransaction(database) {
        PulseResponses.select(PulseResponses.cycleId)
            .where { PulseResponses.userId eq userId }
            .map { it[PulseResponses.cycleId].value }
            .toList()
            .toSet()
    }

    /** How many of [scope] were snapshotted as participants of [cycleId]. */
    suspend fun participantCountForScope(cycleId: UInt, scope: Set<UInt>): Int = suspendTransaction(database) {
        if (scope.isEmpty()) return@suspendTransaction 0
        PulseParticipants.selectAll()
            .where { (PulseParticipants.cycleId eq cycleId) and (PulseParticipants.userId inList scope) }
            .count()
            .toInt()
    }

    /**
     * The scope's decrypted scored answers as the user-id-free [PulseAnswers] shape — the only
     * form aggregation ever sees (anonymity by construction).
     */
    suspend fun answersForScope(cycleId: UInt, scope: Set<UInt>): List<PulseAnswers> = suspendTransaction(database) {
        if (scope.isEmpty()) return@suspendTransaction emptyList()
        PulseResponses.selectAll()
            .where { (PulseResponses.cycleId eq cycleId) and (PulseResponses.userId inList scope) }
            .map { it.toAnswers() }
            .toList()
    }

    /**
     * The scope's non-empty comments, decrypted, author-free, and SHUFFLED per call — no
     * stable order a reader could correlate across requests or with participation lists.
     */
    suspend fun commentsForScope(cycleId: UInt, scope: Set<UInt>): List<String> = suspendTransaction(database) {
        if (scope.isEmpty()) return@suspendTransaction emptyList()
        PulseResponses.select(PulseResponses.comment)
            .where {
                (PulseResponses.cycleId eq cycleId) and
                    (PulseResponses.userId inList scope) and
                    PulseResponses.comment.isNotNull()
            }
            .map { it[PulseResponses.comment]?.let(cipher::decrypt) }
            .toList()
            .filterNotNull()
            .shuffled()
    }

    /**
     * Startup backfill (see infra/db/Bootstrap.kt): encrypts rows still holding legacy
     * plaintext; with [reencryptAll] (key rotation) every row is rewritten under the current
     * key. Idempotent; returns the rewritten count.
     */
    override suspend fun encryptLegacyRows(reencryptAll: Boolean): Int = suspendTransaction(database) {
        cipher.reencryptRows(
            PulseResponses,
            listOf(
                PulseResponses.enps,
                PulseResponses.driver1, PulseResponses.driver2,
                PulseResponses.driver3, PulseResponses.driver4,
                PulseResponses.rotating,
                PulseResponses.comment,
            ),
            reencryptAll,
        )
    }

    private fun ResultRow.toAnswers() = PulseAnswers(
        enps = cipher.decrypt(this[PulseResponses.enps]).toInt(),
        q2 = PulseScaleAnswer.fromWire(cipher.decrypt(this[PulseResponses.driver1])),
        q3 = PulseScaleAnswer.fromWire(cipher.decrypt(this[PulseResponses.driver2])),
        q4 = PulseScaleAnswer.fromWire(cipher.decrypt(this[PulseResponses.driver3])),
        q5 = PulseScaleAnswer.fromWire(cipher.decrypt(this[PulseResponses.driver4])),
        rotating = PulseScaleAnswer.fromWire(cipher.decrypt(this[PulseResponses.rotating])),
    )
}
