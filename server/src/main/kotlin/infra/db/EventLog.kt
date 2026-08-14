package ch.nokillswit.infra.db

import ch.nokillswit.users.UserService
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.Column
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.core.dao.id.IdTable
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.innerJoin
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.insert
import org.jetbrains.exposed.v1.r2dbc.selectAll
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * The shared shape of the five per-record audit-event tables (feedback/1:1/goal/team-KPI/
 * performance-review `*_events` — all V15 clones): an FK to the owning record, the acting
 * user, a creation timestamp, and a structured (type + JSON params) event the SPA localizes.
 * Feature packages declare `object XEvents : EventLogTable("x_events", "x_id", XTable)` and
 * keep their typed create/list wrappers; the mechanics live once in [EventLog].
 */
abstract class EventLogTable(
    name: String,
    ownerColumn: String,
    ownerTable: IdTable<UInt>,
) : UIntIdTable(name) {
    val ownerId: Column<EntityID<UInt>> = reference(ownerColumn, ownerTable)
    val userId = reference("user_id", UserService.Users)
    val timestamp = long("created_at")
    // Structured event so the SPA can localize it: the kind plus a JSON params map.
    val eventType = varchar("event_type", 40)
    val params = text("params")

    // Opt-in free-text column (V54, goal_events only so far): params stay content-free by the
    // house invariant, so an event's free text lives in its own column — encrypted at rest by
    // the OWNING feature service (EventLog itself stays cipher-free). A table without the
    // column simply leaves this null.
    open val commentColumn: Column<String?>? = null
}

/** One raw event row with the acting user's name resolved — feature wrappers map it to their typed response. */
data class EventLogRow(
    val id: UInt,
    val ownerId: UInt,
    val userId: UInt,
    val userName: String,
    val timestamp: Long,
    val type: String,
    val params: Map<String, String>,
    // Raw column value — encrypted when the owning service encrypts it; null without the column.
    val comment: String? = null,
)

class EventLog(private val database: R2dbcDatabase, private val table: EventLogTable) {
    /**
     * Inserts an audit event. The timestamp is set here, never taken from a caller. [comment]
     * (already encrypted by the owning service) requires the table to declare
     * [EventLogTable.commentColumn].
     */
    suspend fun create(
        ownerId: UInt,
        actingUserId: UInt,
        type: String,
        eventParams: Map<String, String>,
        comment: String? = null,
    ): UInt = suspendTransaction(database) {
        val commentColumn = table.commentColumn
        require(comment == null || commentColumn != null) {
            "${table.tableName} has no comment column but a comment was supplied"
        }
        table.insert {
            it[table.ownerId] = ownerId
            it[table.userId] = actingUserId
            it[table.timestamp] = System.currentTimeMillis()
            it[table.eventType] = type
            it[table.params] = encodeParams(eventParams)
            if (commentColumn != null) it[commentColumn] = comment
        }[table.id].value
    }

    /**
     * The record's history, newest first, with acting user names. The id tiebreaker is descending
     * too: one mutation mints several events in the same millisecond, and they must read as a true
     * reversal of mint order — not the notifications list's always-ascending-id quirk.
     */
    suspend fun listFor(ownerId: UInt): List<EventLogRow> = suspendTransaction(database) {
        (table innerJoin UserService.Users)
            .selectAll()
            .where { table.ownerId eq ownerId }
            .orderBy(table.timestamp to SortOrder.DESC, table.id to SortOrder.DESC)
            .map { row ->
                EventLogRow(
                    id = row[table.id].value,
                    ownerId = ownerId,
                    userId = row[table.userId].value,
                    userName = row[UserService.Users.name],
                    timestamp = row[table.timestamp],
                    type = row[table.eventType],
                    params = decodeParams(row[table.params]),
                    comment = table.commentColumn?.let { row[it] },
                )
            }
            .toList()
    }
}
