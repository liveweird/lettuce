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
)

class EventLog(private val database: R2dbcDatabase, private val table: EventLogTable) {
    /** Inserts an audit event. The timestamp is set here, never taken from a caller. */
    suspend fun create(
        ownerId: UInt,
        actingUserId: UInt,
        type: String,
        eventParams: Map<String, String>,
    ): UInt = suspendTransaction(database) {
        table.insert {
            it[table.ownerId] = ownerId
            it[table.userId] = actingUserId
            it[table.timestamp] = System.currentTimeMillis()
            it[table.eventType] = type
            it[table.params] = encodeParams(eventParams)
        }[table.id].value
    }

    /** The record's history, oldest first (id as a stable tiebreaker), with acting user names. */
    suspend fun listFor(ownerId: UInt): List<EventLogRow> = suspendTransaction(database) {
        (table innerJoin UserService.Users)
            .selectAll()
            .where { table.ownerId eq ownerId }
            .orderBy(table.timestamp to SortOrder.ASC, table.id to SortOrder.ASC)
            .map { row ->
                EventLogRow(
                    id = row[table.id].value,
                    ownerId = ownerId,
                    userId = row[table.userId].value,
                    userName = row[UserService.Users.name],
                    timestamp = row[table.timestamp],
                    type = row[table.eventType],
                    params = decodeParams(row[table.params]),
                )
            }
            .toList()
    }
}
