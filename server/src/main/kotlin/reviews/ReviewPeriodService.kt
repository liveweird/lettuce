package ch.nokillswit.reviews

import ch.nokillswit.authz.ConflictException
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val ReviewPeriodServiceKey = AttributeKey<ReviewPeriodService>("ReviewPeriodService")

/**
 * The append-only, gapless review-period timeline (see V34): a new period must start the month
 * right after the latest existing one ends (the first period is free); periods are immutable;
 * only the LATEST period may be deleted, and only while no performance review references it —
 * which is why deletion is a HARD delete (the deliberate exception to the soft-delete
 * convention: a soft-deleted period would poison the adjacency rule, and a deletable period
 * never had dependents).
 */
class ReviewPeriodService(val database: R2dbcDatabase) {
    object ReviewPeriods : UIntIdTable("review_periods") {
        val startMonth = varchar("start_month", 7)
        val endMonth = varchar("end_month", 7)
        val createdAt = long("created_at")
    }

    /** The whole timeline, oldest first (start month is unique, so the order is total). */
    suspend fun list(): List<ReviewPeriod> = suspendTransaction(database) {
        ReviewPeriods.selectAll()
            .orderBy(ReviewPeriods.startMonth to SortOrder.ASC)
            .map { it.toPeriod() }
            .toList()
    }

    suspend fun read(id: UInt): ReviewPeriod? = suspendTransaction(database) {
        ReviewPeriods.selectAll()
            .where { ReviewPeriods.id eq id }
            .map { it.toPeriod() }
            .singleOrNull()
    }

    /**
     * Appends a period to the timeline. The shape was validated by the route
     * ([validateReviewPeriod]); the adjacency rule is checked here, atomically with the insert:
     * when a latest period exists, the new one must start exactly the month after it ends —
     * anything else (gap and overlap alike) is [ConflictException] (→ 409). The unique
     * start_month index backstops a racing concurrent create (23505 → the central 409 mapping).
     * Returns the new id.
     */
    suspend fun create(request: ReviewPeriodCreateRequest): UInt = suspendTransaction(database) {
        val latest = latestRow()
        if (latest != null && request.startMonth != monthAfter(latest.endMonth)) {
            throw ConflictException(
                "A new period must start the month after the latest period ends " +
                    "(expected ${monthAfter(latest.endMonth)}, got ${request.startMonth})",
            )
        }
        ReviewPeriods.insert {
            it[startMonth] = request.startMonth
            it[endMonth] = request.endMonth
            it[createdAt] = System.currentTimeMillis()
        }[ReviewPeriods.id].value
    }

    /**
     * Hard-deletes a period. Returns the affected-row count (0 → missing → 404 in the route);
     * throws [ConflictException] (→ 409) when the period is not the latest, or when any
     * performance review — active or soft-deleted — references it (a soft-deleted review keeps
     * its FK, and resurrect-by-recreate must stay possible).
     */
    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        val target = ReviewPeriods.selectAll()
            .where { ReviewPeriods.id eq id }
            .map { it.toPeriod() }
            .singleOrNull()
            ?: return@suspendTransaction 0
        val latest = latestRow()
        if (latest == null || latest.id != target.id) {
            throw ConflictException("Only the latest period may be deleted")
        }
        val referenced = PerformanceReviewService.Reviews
            .select(PerformanceReviewService.Reviews.id)
            .where { PerformanceReviewService.Reviews.periodId eq id }
            .count()
        if (referenced > 0) {
            throw ConflictException("The period is referenced by existing performance reviews")
        }
        // Local capture: inside deleteWhere the table receiver's `id` column would shadow the
        // parameter (the TeamKpiService idiom).
        val targetId = target.id
        ReviewPeriods.deleteWhere { ReviewPeriods.id eq targetId }
    }

    // The row with the greatest start month — runs inside the caller's transaction.
    private suspend fun latestRow(): ReviewPeriod? =
        ReviewPeriods.selectAll()
            .orderBy(ReviewPeriods.startMonth to SortOrder.DESC)
            .limit(1)
            .map { it.toPeriod() }
            .singleOrNull()

    private fun ResultRow.toPeriod() = ReviewPeriod(
        id = this[ReviewPeriods.id].value,
        startMonth = this[ReviewPeriods.startMonth],
        endMonth = this[ReviewPeriods.endMonth],
    )
}
