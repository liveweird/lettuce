package ch.nokillswit.notifications

import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.db.encodeParams
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

val NotificationServiceKey = AttributeKey<NotificationService>("NotificationService")

data class NotificationListFilter(
    val wasSeen: Boolean? = null,
)

data class NotificationListResult(
    val items: List<NotificationResponse>,
    val total: Long,
)

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to NotificationService.Notifications.id,
    "timestamp" to NotificationService.Notifications.timestamp,
)

class NotificationService(val database: R2dbcDatabase) {
    object Notifications : UIntIdTable("notifications") {
        val recipientId = reference("recipient_id", UserService.Users)
        val timestamp = long("created_at")
        val notificationType = varchar("notification_type", 60)
        val params = text("params")
        val link = text("link").nullable()
        val wasSeen = bool("was_seen")
        val markedAsDeleted = bool("marked_as_deleted").default(false)
    }

    private fun active(): Op<Boolean> = Notifications.markedAsDeleted eq false

    /**
     * Inserts a notification. The generation timestamp and the unseen flag are set here,
     * never taken from a caller. Invoked by the activities that trigger notifications
     * (no HTTP create endpoint exists).
     */
    suspend fun create(notification: Notification): UInt = suspendTransaction(database) {
        val newRecord = Notifications.insert {
            it[recipientId] = notification.recipientId
            it[timestamp] = System.currentTimeMillis()
            it[notificationType] = notification.type.name
            it[params] = encodeParams(notification.params)
            it[link] = notification.link
            it[wasSeen] = false
        }
        newRecord[Notifications.id].value
    }

    suspend fun read(id: UInt): NotificationResponse? = suspendTransaction(database) {
        Notifications.selectAll()
            .where { (Notifications.id eq id) and active() }
            .map { it.toResponse() }
            .singleOrNull()
    }

    suspend fun markSeen(id: UInt): Int = suspendTransaction(database) {
        Notifications.update({ (Notifications.id eq id) and (Notifications.markedAsDeleted eq false) }) {
            it[wasSeen] = true
        }
    }

    suspend fun markUnseen(id: UInt): Int = suspendTransaction(database) {
        Notifications.update({ (Notifications.id eq id) and (Notifications.markedAsDeleted eq false) }) {
            it[wasSeen] = false
        }
    }

    /** Marks every one of the recipient's still-unseen notifications as seen; returns the row count. */
    suspend fun markAllSeen(recipientId: UInt): Int = suspendTransaction(database) {
        Notifications.update({
            (Notifications.recipientId eq recipientId) and
                (Notifications.wasSeen eq false) and
                (Notifications.markedAsDeleted eq false)
        }) {
            it[wasSeen] = true
        }
    }

    suspend fun delete(id: UInt): Int = suspendTransaction(database) {
        Notifications.update({ (Notifications.id eq id) and (Notifications.markedAsDeleted eq false) }) {
            it[markedAsDeleted] = true
        }
    }

    suspend fun list(
        recipientId: UInt,
        filter: NotificationListFilter,
        paging: PageRequest,
    ): NotificationListResult = suspendTransaction(database) {
        val predicate = buildPredicate(recipientId, filter)
        val total = Notifications.selectAll().where { predicate }.count()
        val rows = Notifications.selectAll()
            .where { predicate }
            .applyPaging(paging, SORTABLE_COLUMNS)
            .map { it.toResponse() }
            .toList()
        NotificationListResult(items = rows, total = total)
    }

    private fun buildPredicate(recipientId: UInt, filter: NotificationListFilter): Op<Boolean> {
        var op: Op<Boolean> = (Notifications.recipientId eq recipientId) and active()
        filter.wasSeen?.let { op = op and (Notifications.wasSeen eq it) }
        return op
    }

    private fun ResultRow.toResponse() = NotificationResponse(
        id = this[Notifications.id].value,
        recipientId = this[Notifications.recipientId].value,
        timestamp = this[Notifications.timestamp],
        type = NotificationType.valueOf(this[Notifications.notificationType]),
        params = decodeParams(this[Notifications.params]),
        link = this[Notifications.link],
        wasSeen = this[Notifications.wasSeen],
    )
}
