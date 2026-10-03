package ch.nokillswit.perf

import ch.nokillswit.infra.db.EventLogTable
import ch.nokillswit.infra.db.encodeParams
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.core.dao.id.IdTable
import org.jetbrains.exposed.v1.core.max
import org.jetbrains.exposed.v1.core.statements.BatchInsertStatement
import org.jetbrains.exposed.v1.core.statements.StatementType
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.batchInsert
import org.jetbrains.exposed.v1.r2dbc.select
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

const val BATCH_SIZE = 1_000

/**
 * A buffered writer for one table: rows are added in memory and written by [flush] through Exposed's
 * `batchInsert` (the table objects ARE the schema — a renamed column breaks this file's compile),
 * [BATCH_SIZE] rows per statement. Ids are allocated by the generator (explicit, ordered, so a fresh
 * database always gets the same ids) and the sequences are advanced at the end ([advanceSequences]).
 *
 * There is deliberately NO auto-flush: a child table's rows may only reach the database after their
 * parents', so callers flush [SinkGroup]s in dependency order at iteration boundaries.
 */
class RowSink<E>(
    private val db: R2dbcDatabase,
    val table: Table,
    private val bind: BatchInsertStatement.(E) -> Unit,
) {
    private val buffer = ArrayList<E>()
    var written = 0L
        private set

    fun add(row: E) {
        buffer.add(row)
    }

    suspend fun flush() {
        if (buffer.isEmpty()) return
        val rows = buffer.toList()
        buffer.clear()
        suspendTransaction(db) {
            rows.chunked(BATCH_SIZE).forEach { chunk ->
                table.batchInsert(chunk, shouldReturnGeneratedValues = false, body = bind)
            }
        }
        written += rows.size
    }
}

/** Sinks flushed in the order given — parents first. */
class SinkGroup(private vararg val sinks: RowSink<*>) {
    suspend fun flush() = sinks.forEach { it.flush() }
}

/** `max(id) + 1` of [table] — the first id a generator may allocate on this database. */
suspend fun nextFreeId(db: R2dbcDatabase, table: IdTable<UInt>): UInt = suspendTransaction(db) {
    val highest = table.select(table.id.max()).toList().single()[table.id.max()]?.value
    (highest ?: 0u) + 1u
}

/**
 * Moves each table's serial sequence to its highest id, so the app's next INSERT does not collide
 * with the explicitly-allocated generated ids.
 */
suspend fun advanceSequences(db: R2dbcDatabase, tables: List<IdTable<UInt>>) = suspendTransaction(db) {
    tables.forEach { table ->
        val name = table.tableName
        exec(
            "SELECT setval(pg_get_serial_sequence('$name', 'id'), (SELECT COALESCE(MAX(id), 1) FROM $name))",
            emptyList(),
            StatementType.SELECT,
        ) { 1 }?.toList()
    }
}

/** One audit-event row, as written by [eventSink]. */
class EventRow(
    val id: UInt,
    val ownerId: UInt,
    val actorId: UInt?,
    val timestamp: Long,
    val type: String,
    val params: Map<String, String>,
    /** The already-encrypted `comment` envelope (goal events only). */
    val comment: String? = null,
)

/** A sink for any `*_events` table; params are content-free by the house rule — callers pass enum names/numbers only. */
fun eventSink(db: R2dbcDatabase, table: EventLogTable): RowSink<EventRow> = RowSink(db, table) { row ->
    this[table.id] = row.id
    this[table.ownerId] = row.ownerId
    this[table.userId] = row.actorId
    this[table.timestamp] = row.timestamp
    this[table.eventType] = row.type
    this[table.params] = encodeParams(row.params)
    table.commentColumn?.let { this[it] = row.comment }
}

/** Hands out ids from [start] — the generator's explicit-id counter. */
class IdCounter(start: UInt) {
    private var next = start

    fun take(): UInt = next++

    fun reset(start: UInt) {
        next = start
    }
}
