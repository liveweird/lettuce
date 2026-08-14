package ch.nokillswit.users

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.isInManagementChain
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val CareerPositionServiceKey = AttributeKey<CareerPositionService>("CareerPositionService")

/**
 * The per-user career position timeline (V57) — the start-only model: rows store only their
 * start date; a position's end is the day before the user's next active position starts, so
 * the timeline is continuous and non-overlapping by construction. Ordering rules that depend
 * on the user's OTHER rows (append-after-latest, correct-between-neighbors) are enforced here,
 * atomically with the write (the ReviewPeriodService adjacency idiom) → [ConflictException]
 * (409); pure shape rules (ISO date, not-future, ≥1 ref) are the route's 400s.
 */
class CareerPositionService(val database: R2dbcDatabase) {
    object CareerPositions : UIntIdTable("user_career_positions") {
        val userId = reference("user_id", UserService.Users)
        // Strict zero-padded ISO YYYY-MM-DD — lexicographic == chronological (the V34 idiom).
        val startDate = varchar("start_date", length = 10)
        val careerPathId = uinteger("career_path_id").nullable()
        val careerSpecializationId = uinteger("career_specialization_id").nullable()
        val seniorityLevelId = uinteger("seniority_level_id").nullable()
        val createdAt = long("created_at")
        val lastModified = long("last_modified")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    /** Raw row (refs unresolved) — the route resolves entries and derives end dates. */
    data class PositionRow(
        val id: UInt,
        val userId: UInt,
        val startDate: String,
        val careerPathId: UInt?,
        val careerSpecializationId: UInt?,
        val seniorityLevelId: UInt?,
        val createdAt: Long,
        val lastModified: Long,
    )

    private fun active(): Op<Boolean> = CareerPositions.markedAsDeleted eq false

    /** The user's active positions, chronological (start ASC — end derivation reads i+1). */
    suspend fun listRows(userId: UInt): List<PositionRow> = suspendTransaction(database) {
        rowsOf(userId)
    }

    suspend fun readRow(id: UInt): PositionRow? = suspendTransaction(database) {
        CareerPositions.selectAll()
            .where { (CareerPositions.id eq id) and active() }
            .map { it.toRow() }
            .toList()
            .singleOrNull()
    }

    /** Write right: the caller is in the target's transitive management chain (own transaction). */
    suspend fun managesUser(callerId: UInt, targetUserId: UInt): Boolean =
        suspendTransaction(database) { isInManagementChain(callerId, targetUserId) }

    /**
     * Appends a position: the new start must be strictly after the latest existing one (409
     * otherwise — inserting a forgotten historical position is deliberately not a thing; the
     * timeline grows at the end and history is fixed via [update]/[delete]). Returns the id
     * plus the owner's notification descriptor (the createCorrection shape — the route
     * persists it after this transaction commits).
     */
    suspend fun create(authorId: UInt, targetUserId: UInt, write: CareerPositionWrite): Pair<UInt, Notification> =
        suspendTransaction(database) {
            val latest = rowsOf(targetUserId).lastOrNull()
            if (latest != null && write.startDate <= latest.startDate) {
                throw ConflictException(
                    "A new position must start after the current one (started ${latest.startDate})",
                )
            }
            val now = System.currentTimeMillis()
            val id = CareerPositions.insert {
                it[userId] = targetUserId
                it[startDate] = write.startDate
                it[careerPathId] = write.careerPathId
                it[careerSpecializationId] = write.careerSpecializationId
                it[seniorityLevelId] = write.seniorityLevelId
                it[createdAt] = now
                it[lastModified] = now
            }[CareerPositions.id].value
            id to careerPositionStartedNotification(
                userId = targetUserId,
                managerName = userName(authorId),
                startDate = write.startDate,
            )
        }

    /**
     * Corrects a position's start date and/or triple. The new start must keep the row in its
     * place: strictly between the starts of its current neighbors (409 otherwise) — a
     * correction never reorders the sequence, it fixes values in place. 0 → missing → 404.
     */
    suspend fun update(id: UInt, write: CareerPositionWrite): Int = suspendTransaction(database) {
        val existing = CareerPositions.selectAll()
            .where { (CareerPositions.id eq id) and active() }
            .map { it.toRow() }
            .toList()
            .singleOrNull()
            ?: return@suspendTransaction 0
        val others = rowsOf(existing.userId).filter { it.id != id }
        val prev = others.lastOrNull { it.startDate < existing.startDate }
        val next = others.firstOrNull { it.startDate > existing.startDate }
        if ((prev != null && write.startDate <= prev.startDate) ||
            (next != null && write.startDate >= next.startDate)
        ) {
            throw ConflictException(
                "The corrected start date must stay between the neighboring positions" +
                    listOfNotNull(prev?.let { " (after ${it.startDate})" }, next?.let { " (before ${it.startDate})" })
                        .joinToString(""),
            )
        }
        CareerPositions.update({ (CareerPositions.id eq id) and (CareerPositions.markedAsDeleted eq false) }) {
            it[startDate] = write.startDate
            it[careerPathId] = write.careerPathId
            it[careerSpecializationId] = write.careerSpecializationId
            it[seniorityLevelId] = write.seniorityLevelId
            it[lastModified] = System.currentTimeMillis()
        }
    }

    /** Soft delete; the neighbors merge implicitly (the previous position absorbs the span). */
    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        CareerPositions.update({ (CareerPositions.id eq id) and (CareerPositions.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    /** Must run inside a transaction. Chronological; same-start impossible among active rows. */
    private suspend fun rowsOf(userId: UInt): List<PositionRow> =
        CareerPositions.selectAll()
            .where { (CareerPositions.userId eq userId) and active() }
            .orderBy(CareerPositions.startDate to SortOrder.ASC, CareerPositions.id to SortOrder.ASC)
            .map { it.toRow() }
            .toList()

    /** Must run inside a transaction. */
    private suspend fun userName(id: UInt): String =
        UserService.Users.select(UserService.Users.name)
            .where { UserService.Users.id eq id }
            .toList()
            .singleOrNull()
            ?.get(UserService.Users.name)
            ?: "?"

    private fun ResultRow.toRow() = PositionRow(
        id = this[CareerPositions.id].value,
        userId = this[CareerPositions.userId].value,
        startDate = this[CareerPositions.startDate],
        careerPathId = this[CareerPositions.careerPathId],
        careerSpecializationId = this[CareerPositions.careerSpecializationId],
        seniorityLevelId = this[CareerPositions.seniorityLevelId],
        createdAt = this[CareerPositions.createdAt],
        lastModified = this[CareerPositions.lastModified],
    )
}
