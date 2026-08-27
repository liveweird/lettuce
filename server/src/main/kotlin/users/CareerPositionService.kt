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
 * the timeline is continuous and non-overlapping by construction. ONE exception (V58,
 * v2.17.0): account deactivation stamps a stored `end_date` on the user's final active
 * position (cleared again by reactivation) — only the final row ever carries it (a new
 * position cannot be recorded for a deactivated user, and [delete] transfers the stamp to
 * the surviving final row), so derived ends stay authoritative everywhere else. Rules that
 * depend on the user's OTHER rows — the ordering rules (create anywhere but never on an
 * existing start (v2.39.0 — past inserts backfill history), correct-between-neighbors) and
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
        // Stored end (V58) — deactivation-only, final row only; null everywhere else.
        val endDate = varchar("end_date", length = 10).nullable()
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
        /** The STORED end (deactivation) — reads fall back to the derived next-start − 1. */
        val endDate: String?,
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

    /**
     * Batch timelines for the integration API (v3.0.0 — unscoped by design, see integration/):
     * user id → active positions, chronological like [listRows]; users without positions are
     * absent from the map.
     */
    suspend fun listRowsByUserIds(userIds: Set<UInt>): Map<UInt, List<PositionRow>> =
        if (userIds.isEmpty()) emptyMap()
        else suspendTransaction(database) {
            CareerPositions.selectAll()
                .where { (CareerPositions.userId inList userIds) and active() }
                .orderBy(CareerPositions.startDate to SortOrder.ASC, CareerPositions.id to SortOrder.ASC)
                .map { it.toRow() }
                .toList()
                .groupBy { it.userId }
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

    /** One pyramid subordinate: full position history, refs unresolved (v2.17.0). */
    data class PyramidUser(
        val userId: UInt,
        val name: String,
        val deactivated: Boolean,
        /** Chronological (start ASC) — the client computes the as-of position itself. */
        val positions: List<PositionRow>,
    )

    /** The pyramid payload plus the org-wide time-slider anchor. */
    data class PyramidData(
        val users: List<PyramidUser>,
        /** Earliest start of ANY active position org-wide (even deactivated users' — the
         *  slider's lower bound, per spec); null = no positions recorded anywhere. */
        val earliestStartDate: String?,
    )

    /**
     * The caller's team pyramid (v2.16.0; full-history shape since v2.17.0): one entry per
     * subordinate — direct reports, or the whole transitive chain with [includeIndirect]
     * (the /teams/members view=managed semantics; caller-excluded and cycle-safe via the
     * shared chain walk). Soft-deleted users drop out; deactivated ones are INCLUDED with
     * their flag — the SPA drops them client-side for slider dates past their stored end
     * (v2.17.0 — a person shows only while they actively held a position). Subordinates with
     * NO positions come with an empty list. Sorted by name (case-insensitive), then id.
     */
    suspend fun pyramidRows(callerId: UInt, includeIndirect: Boolean): PyramidData =
        suspendTransaction(database) {
            val minStart = CareerPositions.startDate.min()
            val earliest = CareerPositions.select(minStart)
                .where { active() }
                .toList()
                .firstOrNull()
                ?.get(minStart)
            val subordinateIds =
                if (includeIndirect) transitiveSubordinateIds(callerId) else directSubordinateIds(callerId)
            if (subordinateIds.isEmpty()) return@suspendTransaction PyramidData(emptyList(), earliest)
            val users = UserService.Users
                .select(UserService.Users.id, UserService.Users.name, UserService.Users.deactivated)
                .where {
                    (UserService.Users.id inList subordinateIds) and
                        (UserService.Users.markedAsDeleted eq false)
                }
                .toList()
                .associate {
                    it[UserService.Users.id].value to
                        (it[UserService.Users.name] to it[UserService.Users.deactivated])
                }
            if (users.isEmpty()) return@suspendTransaction PyramidData(emptyList(), earliest)
            // Drained before grouping — a nested query inside a still-open flow would
            // deadlock the shared R2DBC connection.
            val positionsByUser = CareerPositions.selectAll()
                .where { (CareerPositions.userId inList users.keys) and active() }
                .orderBy(CareerPositions.startDate to SortOrder.ASC, CareerPositions.id to SortOrder.ASC)
                .map { it.toRow() }
                .toList()
                .groupBy { it.userId }
            PyramidData(
                users = users.entries
                    .map { (id, user) ->
                        PyramidUser(
                            userId = id,
                            name = user.first,
                            deactivated = user.second,
                            positions = positionsByUser[id].orEmpty(),
                        )
                    }
                    .sortedWith(compareBy({ it.name.lowercase() }, { it.userId })),
                earliestStartDate = earliest,
            )
        }

    /**
     * Inserts a position anywhere in the timeline (v2.39.0 — past inserts backfill forgotten
     * history; before that the timeline was append-only). The derived-end model does the rest:
     * a new earliest position ends the day before the previously-earliest start, and a start
     * landing mid-span of a past position splits it there — the new position takes over the
     * remainder until the next one begins. Two 409s guard the insert: an exact start-date
     * collision (the partial unique index stays the race backstop), and a triple equal to
     * either chronological neighbor's (the [update] rule — a repeat is not a step). Returns
     * the id plus the owner's notification descriptor (the createCorrection shape — the
     * route persists it after this transaction commits).
     */
    suspend fun create(authorId: UInt, targetUserId: UInt, write: CareerPositionWrite): Pair<UInt, Notification> =
        suspendTransaction(database) {
            val rows = rowsOf(targetUserId)
            if (rows.any { it.startDate == write.startDate }) {
                throw ConflictException("A position already starts on ${write.startDate}")
            }
            val prev = rows.lastOrNull { it.startDate < write.startDate }
            val next = rows.firstOrNull { it.startDate > write.startDate }
            if ((prev != null && sameTriple(write, prev)) || (next != null && sameTriple(write, next))) {
                throw ConflictException(
                    "A new position must differ from the neighboring positions " +
                        "(same career path, specialization, and seniority)",
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
        // A deactivation-stamped final row must not be pushed past its own stored end.
        if (existing.endDate != null && write.startDate > existing.endDate) {
            throw ConflictException(
                "The corrected position must not start after its end date (ended ${existing.endDate})",
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

    /**
     * Soft delete; the neighbors merge implicitly (the previous position absorbs the span).
     * If the deleted row carried the stored deactivation end (it is then the final row by
     * invariant), the stamp transfers to the surviving final row — a deactivated user's
     * timeline stays closed no matter which rows a manager prunes.
     */
    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        val existing = CareerPositions.selectAll()
            .where { (CareerPositions.id eq id) and active() }
            .map { it.toRow() }
            .toList()
            .singleOrNull()
            ?: return@suspendTransaction 0
        val updated = CareerPositions.update({ (CareerPositions.id eq id) and (CareerPositions.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
        if (updated > 0 && existing.endDate != null) {
            rowsOf(existing.userId).lastOrNull()?.let { survivor ->
                CareerPositions.update({ (CareerPositions.id eq survivor.id) and active() }) {
                    it[endDate] = existing.endDate
                    it[lastModified] = System.currentTimeMillis()
                }
            }
        }
        updated
    }

    /**
     * Deactivation side effect (v2.17.0): stamp [endDateIso] on the user's final active
     * position — only when it is still open. Returns the stamped position's id (for the
     * audit event), or null when the user has no positions or the final row is already
     * closed (a legacy pre-V58 deactivation re-run).
     */
    suspend fun closeFinalPosition(userId: UInt, endDateIso: String): UInt? = suspendTransaction(database) {
        val latest = rowsOf(userId).lastOrNull() ?: return@suspendTransaction null
        if (latest.endDate != null) return@suspendTransaction null
        CareerPositions.update({ (CareerPositions.id eq latest.id) and active() }) {
            it[endDate] = endDateIso
            it[lastModified] = System.currentTimeMillis()
        }
        latest.id
    }

    /** Reactivation clears the stamp — the final position resumes as the open-ended current one. */
    suspend fun reopenFinalPosition(userId: UInt): UInt? = suspendTransaction(database) {
        val latest = rowsOf(userId).lastOrNull() ?: return@suspendTransaction null
        if (latest.endDate == null) return@suspendTransaction null
        CareerPositions.update({ (CareerPositions.id eq latest.id) and active() }) {
            it[endDate] = null
            it[lastModified] = System.currentTimeMillis()
        }
        latest.id
    }

    /** Must run inside a transaction. Chronological; same-start impossible among active rows. */
    private suspend fun rowsOf(userId: UInt): List<PositionRow> =
        CareerPositions.selectAll()
            .where { (CareerPositions.userId eq userId) and active() }
            .orderBy(CareerPositions.startDate to SortOrder.ASC, CareerPositions.id to SortOrder.ASC)
            .map { it.toRow() }
            .toList()

    private suspend fun userName(id: UInt): String = userNameOf(id) ?: "?"

    private fun ResultRow.toRow() = PositionRow(
        id = this[CareerPositions.id].value,
        userId = this[CareerPositions.userId].value,
        startDate = this[CareerPositions.startDate],
        endDate = this[CareerPositions.endDate],
        careerPathId = this[CareerPositions.careerPathId],
        careerSpecializationId = this[CareerPositions.careerSpecializationId],
        seniorityLevelId = this[CareerPositions.seniorityLevelId],
        createdAt = this[CareerPositions.createdAt],
        lastModified = this[CareerPositions.lastModified],
    )
}
