package ch.nokillswit.alerts

import ch.nokillswit.infra.db.containsNormalized
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val AlertServiceKey = AttributeKey<AlertService>("AlertService")

data class AlertListFilter(
    val title: String? = null,
    val isActive: Boolean? = null,
)

data class AlertListResult(
    val items: List<AlertResponse>,
    val total: Long,
)

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to AlertService.Alerts.id,
    "title" to AlertService.Alerts.title,
    "startsAt" to AlertService.Alerts.startsAt,
    "endsAt" to AlertService.Alerts.endsAt,
)

class AlertService(val database: R2dbcDatabase) {
    object Alerts : UIntIdTable("alerts") {
        val title = varchar("title", length = 150)
        val content = text("content")
        val isActive = bool("is_active").default(true)
        val startsAt = long("starts_at").nullable()
        val endsAt = long("ends_at").nullable()
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Alerts.markedAsDeleted eq false

    suspend fun create(alert: Alert): UInt = suspendTransaction(database) {
        validate(alert)
        val newRecord = Alerts.insert {
            it[title] = alert.title
            it[content] = alert.content
            it[isActive] = alert.isActive
            it[startsAt] = alert.startsAt
            it[endsAt] = alert.endsAt
        }
        newRecord[Alerts.id].value
    }

    suspend fun read(id: UInt): Alert? = suspendTransaction(database) {
        Alerts.selectAll()
            .where { (Alerts.id eq id) and active() }
            .map { it.toAlert() }
            .singleOrNull()
    }

    suspend fun update(id: UInt, alert: Alert): Int = suspendTransaction(database) {
        validate(alert)
        Alerts.update({ (Alerts.id eq id) and (Alerts.markedAsDeleted eq false) }) {
            it[title] = alert.title
            it[content] = alert.content
            it[isActive] = alert.isActive
            it[startsAt] = alert.startsAt
            it[endsAt] = alert.endsAt
        }
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Alerts.update({ (Alerts.id eq id) and (Alerts.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    suspend fun list(filter: AlertListFilter, paging: PageRequest): AlertListResult =
        suspendTransaction(database) {
            val predicate: Op<Boolean> = buildPredicate(filter) and active()
            val total = Alerts.selectAll().where { predicate }.count()
            val rows = Alerts.selectAll()
                .where { predicate }
                .applyPaging(paging, SORTABLE_COLUMNS)
                .map { it.toAlert().toResponse(it[Alerts.id].value) }
                .toList()
            AlertListResult(items = rows, total = total)
        }

    /**
     * The alerts every user currently sees: not soft-deleted, active, and `now` (epoch millis,
     * evaluated server-side) inside the optional [startsAt, endsAt] window — both bounds inclusive.
     * Unpaged on purpose: the set of concurrently visible alerts is intrinsically tiny.
     */
    suspend fun visible(now: Long = System.currentTimeMillis()): List<VisibleAlert> =
        suspendTransaction(database) {
            Alerts.selectAll()
                .where {
                    active() and
                        (Alerts.isActive eq true) and
                        (Alerts.startsAt.isNull() or (Alerts.startsAt lessEq now)) and
                        (Alerts.endsAt.isNull() or (Alerts.endsAt greaterEq now))
                }
                .orderBy(Alerts.id to SortOrder.ASC)
                .map { row ->
                    VisibleAlert(
                        id = row[Alerts.id].value,
                        title = row[Alerts.title],
                        content = row[Alerts.content],
                    )
                }
                .toList()
        }

    private fun ResultRow.toAlert() = Alert(
        title = this[Alerts.title],
        content = this[Alerts.content],
        isActive = this[Alerts.isActive],
        startsAt = this[Alerts.startsAt],
        endsAt = this[Alerts.endsAt],
    )

    private fun buildPredicate(filter: AlertListFilter): Op<Boolean> {
        var op: Op<Boolean> = Op.TRUE
        filter.title?.takeIf { it.isNotBlank() }?.let {
            op = op and (Alerts.title.containsNormalized(it))
        }
        filter.isActive?.let {
            op = op and (Alerts.isActive eq it)
        }
        return op
    }

    // Same rules the route enforces (single source in Alert.kt) — re-checked here so direct
    // service callers stay guarded too.
    private fun validate(alert: Alert) = validateAlert(alert)
}
