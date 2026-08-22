package ch.nokillswit.goals

import ch.nokillswit.infra.crypto.EncryptedAtRest
import ch.nokillswit.infra.crypto.FieldCipher
import ch.nokillswit.infra.crypto.reencryptRows
import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import io.ktor.util.AttributeKey
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val GoalEventServiceKey = AttributeKey<GoalEventService>("GoalEventService")

/**
 * The goal audit trail — a thin wrapper over the shared [EventLog] mechanics (the five
 * `*_events` tables are V15 clones; see infra/db/EventLog.kt). Only the typed DTO mapping
 * lives here — plus the optional per-event progress-update comment (V54): free text stays out
 * of the plaintext params by the house invariant, so it rides its own column, encrypted at
 * rest like the goal's description/summary (the cipher wraps every write and unwraps every
 * read; nothing above this service ever sees ciphertext).
 */
class GoalEventService(val database: R2dbcDatabase, private val cipher: FieldCipher) : EncryptedAtRest {
    override val encryptedRowLabel = "goal event"

    object GoalEvents : EventLogTable("goal_events", "goal_id", GoalService.Goals) {
        // Feature-named alias for direct DSL use (the same Column instance).
        val goalId get() = ownerId

        // The optional progress-update comment (V54) — encrypted at rest, never in params.
        val comment = text("comment").nullable()
        override val commentColumn: Column<String?> get() = comment
    }

    private val log = EventLog(database, GoalEvents)

    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(event: GoalEvent): UInt =
        log.create(
            event.goalId,
            event.userId,
            event.type.name,
            event.params,
            comment = event.comment?.let(cipher::encrypt),
        )

    /** The goal's history, newest first (id descending as the same-instant tiebreaker), with acting user names. */
    suspend fun listForGoal(goalId: UInt): List<GoalEventResponse> =
        log.listFor(goalId).map {
            GoalEventResponse(
                id = it.id,
                goalId = it.ownerId,
                userId = it.userId,
                userName = it.userName,
                timestamp = it.timestamp,
                type = GoalEventType.valueOf(it.type),
                params = it.params,
                comment = it.comment?.let(cipher::decrypt),
            )
        }

    /**
     * Startup backfill (see infra/db/Bootstrap.kt): encrypts comment rows still holding legacy
     * plaintext; with [reencryptAll] (key rotation) every commented row is rewritten under the
     * current key. Idempotent; returns the rewritten count. Params stay plaintext by design.
     */
    override suspend fun encryptLegacyRows(reencryptAll: Boolean): Int = suspendTransaction(database) {
        // All-nullable column list → the rotation pass touches commented rows only.
        cipher.reencryptRows(GoalEvents, listOf(GoalEvents.comment), reencryptAll)
    }
}
