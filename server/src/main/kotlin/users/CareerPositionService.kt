package ch.nokillswit.users

import ch.nokillswit.authz.ConflictException
import ch.nokillswit.notifications.Notification
import ch.nokillswit.teams.directSubordinateIds
import ch.nokillswit.teams.isInManagementChain
import ch.nokillswit.teams.transitiveSubordinateIds
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
 * the timeline is continuous and non-overlapping by construction. Rules that depend on the
 * user's OTHER rows — the ordering rules (append-after-latest, correct-between-neighbors) and
 * the adjacent-sameness rule (v2.15.2: no position may carry the exact same triple as its
 * neighbor — a repeat is not a step) — are enforced here, atomically with the write (the
 * ReviewPeriodService adjacency idiom) → [ConflictException] (409); pure shape rules (ISO
 * date, not-future, full triple) are the route's 400s.
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

    // Id-based, nullable-aware: a legacy partial row (unset refs) never equals a full-triple
    // write, so pre-v2.15.1 data can't block a write. (A DELETE may leave two equal adjacent
    // rows behind — deliberately unguarded; reads tolerate it like they tolerate partials.)
    private fun sameTriple(write: CareerPositionWrite, row: PositionRow): Boolean =
        write.careerPathId == row.careerPathId &&
            write.careerSpecializationId == row.careerSpecializationId &&
            write.seniorityLevelId == row.seniorityLevelId

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

    /** One team-pyramid row (refs unresolved — the route resolves entries, v2.16.0). */
    data class PyramidRow(
        val userId: UInt,
        val name: String,
        val careerPathId: UInt?,
        val careerSpecializationId: UInt?,
        val seniorityLevelId: UInt?,
        /** The current position's start — the "tenure at level" anchor; null = no positions. */
        val currentPositionStart: String?,
        /** The first recorded position's start — organization tenure AS RECORDED. */
        val organizationSince: String?,
    )

    /**
     * The caller's team pyramid (v2.16.0): one row per subordinate — direct reports, or the
     * whole transitive chain with [includeIndirect] (the /teams/members view=managed
     * semantics; caller-excluded and cycle-safe via the shared chain walk). Soft-deleted
     * users drop out; deactivated ones stay (the members-list rule). Rows with NO positions
     * keep all career fields null. Sorted by name (case-insensitive), then id.
     */
    suspend fun pyramidRows(callerId: UInt, includeIndirect: Boolean): List<PyramidRow> =
        suspendTransaction(database) {
            val subordinateIds =
                if (includeIndirect) transitiveSubordinateIds(callerId) else directSubordinateIds(callerId)
            if (subordinateIds.isEmpty()) return@suspendTransaction emptyList()
            val names = UserService.Users
                .select(UserService.Users.id, UserService.Users.name)
                .where {
                    (UserService.Users.id inList subordinateIds) and
                        (UserService.Users.markedAsDeleted eq false)
                }
                .toList()
                .associate { it[UserService.Users.id].value to it[UserService.Users.name] }
            if (names.isEmpty()) return@suspendTransaction emptyList()
            // Drained before grouping — a nested query inside a still-open flow would
            // deadlock the shared R2DBC connection.
            val positionsByUser = CareerPositions.selectAll()
                .where { (CareerPositions.userId inList names.keys) and active() }
                .orderBy(CareerPositions.startDate to SortOrder.ASC, CareerPositions.id to SortOrder.ASC)
                .map { it.toRow() }
                .toList()
                .groupBy { it.userId }
            names.entries
                .map { (id, name) ->
                    val rows = positionsByUser[id].orEmpty()
                    val current = rows.lastOrNull()
                    PyramidRow(
                        userId = id,
                        name = name,
                        careerPathId = current?.careerPathId,
                        careerSpecializationId = current?.careerSpecializationId,
                        seniorityLevelId = current?.seniorityLevelId,
                        currentPositionStart = current?.startDate,
                        organizationSince = rows.firstOrNull()?.startDate,
                    )
                }
                .sortedWith(compareBy({ it.name.lowercase() }, { it.userId }))
        }

    /**
     * Appends a position: the new start must be strictly after the latest existing one (409
     * otherwise — inserting a forgotten historical position is deliberately not a thing; the
     * timeline grows at the end and history is fixed via [update]/[delete]), and its triple
     * must differ from the latest position's (409 — a repeat is not a step). Returns the id
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
            if (latest != null && sameTriple(write, latest)) {
                throw ConflictException(
                    "A new position must differ from the previous one (same career path, specialization, and seniority)",
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
     * correction never reorders the sequence, it fixes values in place — and the corrected
     * triple must differ from BOTH neighbors' (409: equal-to-previous is the repeat-step the
     * append rule blocks; equal-to-next would make the NEXT row the repeat). 0 → missing → 404.
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
        if ((prev != null && sameTriple(write, prev)) || (next != null && sameTriple(write, next))) {
            throw ConflictException("The corrected position must differ from the neighboring positions")
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
