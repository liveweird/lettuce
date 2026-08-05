package ch.nokillswit.daysoff

import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val PublicHolidayServiceKey = AttributeKey<PublicHolidayService>("PublicHolidayService")

/**
 * The global public-holiday registry (see V39): flat ADMIN-curated dates, hard-deleting (the
 * review-periods exception to the soft-delete convention — nothing references a holiday by FK,
 * and days-off costs are frozen at creation, so deletion never reprices history). The unique
 * `holiday_date` backstops racing creates (23505 → the central 409 mapping).
 */
class PublicHolidayService(val database: R2dbcDatabase) {
    object PublicHolidays : UIntIdTable("public_holidays") {
        val holidayDate = varchar("holiday_date", 10)
        val name = varchar("name", MAX_PUBLIC_HOLIDAY_NAME_LENGTH)
        val createdAt = long("created_at")
    }

    /** The whole registry, oldest date first (dates are unique, so the order is total). */
    suspend fun list(): List<PublicHolidayItem> = suspendTransaction(database) {
        PublicHolidays.selectAll()
            .orderBy(PublicHolidays.holidayDate to SortOrder.ASC)
            .map { it.toItem() }
            .toList()
    }

    suspend fun read(id: UInt): PublicHolidayItem? = suspendTransaction(database) {
        PublicHolidays.selectAll()
            .where { PublicHolidays.id eq id }
            .map { it.toItem() }
            .singleOrNull()
    }

    /** Inserts a holiday (shape pre-validated by the route). A duplicate date raises 23505 →
     * the central 409 mapping. Returns the new id. */
    suspend fun create(request: PublicHolidayCreateRequest): UInt = suspendTransaction(database) {
        PublicHolidays.insert {
            it[holidayDate] = request.date
            it[name] = request.name
            it[createdAt] = System.currentTimeMillis()
        }[PublicHolidays.id].value
    }

    /** Hard-deletes a holiday. Returns the affected-row count (0 → missing → 404 in the route). */
    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        PublicHolidays.deleteWhere { PublicHolidays.id eq id }
    }

    private fun org.jetbrains.exposed.v1.core.ResultRow.toItem() = PublicHolidayItem(
        id = this[PublicHolidays.id].value,
        date = this[PublicHolidays.holidayDate],
        name = this[PublicHolidays.name],
    )
}
