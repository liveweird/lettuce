package ch.nokillswit.notifications

import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.db.encodeParams
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import java.util.concurrent.atomic.AtomicLong
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.singleOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.UIntIdTable
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.slf4j.LoggerFactory

val NotificationServiceKey = AttributeKey<NotificationService>("NotificationService")

data class NotificationListFilter(
    val wasSeen: Boolean? = null,
    /**
     * The caller's disabled features (V46): rows whose type belongs to one are excluded from
     * the rows AND the total — the SPA's unread badge is the total of a pageSize-1 unseen
     * query, so this one predicate keeps both honest. Empty = no exclusion.
     */
    val disabledFeatures: Set<Feature> = emptySet(),
)

data class NotificationListResult(
    val items: List<NotificationResponse>,
    val total: Long,
)

private val SORTABLE_COLUMNS: Map<String, Column<*>> = mapOf(
    "id" to NotificationService.Notifications.id,
    "timestamp" to NotificationService.Notifications.timestamp,
)

private val log = LoggerFactory.getLogger(NotificationService::class.java)

/**
 * **Auto-purge (v3.12.0, V82) — a registered, deliberate exception to the soft-delete
 * convention.** A notification that is seen (`wasSeen`) OR user-deleted (`markedAsDeleted`) AND
 * older than [retentionMillis] is HARD-deleted, not just flagged: notifications are ephemeral UX
 * (a bell dropdown, not a record of anything), and the actual trail already lives elsewhere —
 * `audit`/the feature-local `*_events` tables for security/business history, and the email
 * mirror ([NotificationEmailer]) already fired at mint time. An unseen, non-deleted row is never
 * purged regardless of age.
 *
 * **Trigger: on mint, not a scheduler.** There is no background job in this app (the
 * `FeedbackService.expireOverdueRequests` lazy-sweep precedent): garbage only appears when a row
 * is minted, so pruning at the END of [create]/[createAll] — after the insert transaction has
 * committed, so the DELETE never contends for the same rows/locks — bounds the table without a
 * dedicated process — the `LoginThrottle.reserveAttempt` opportunistic-prune-on-write idiom. The
 * purge is org-wide (every recipient's stale rows, not just the one minted for): housekeeping on
 * the whole table, so the freshly minted row — unseen by construction — is never a candidate.
 *
 * **Bounded per instance.** [purgeIntervalMillis] gates how often the purge actually runs a
 * DELETE (0 = every mint) via the same `compareAndSet` gate as
 * `FeedbackService.expireOverdueRequests` — a race among concurrent mints picks exactly one
 * winner per interval; every other caller inside the window skips the DB round-trip entirely.
 * The DELETE itself is naturally idempotent and safe across replicas — a row already gone from
 * an earlier purge (on this or another instance) simply matches nothing on a later run.
 */
class NotificationService(
    val database: R2dbcDatabase,
    // Mirrors every mint by email (v2.3.0) — null in service-level tests that don't care.
    private val emailer: NotificationEmailer? = null,
    // config `notifications.retentionDays`; 0 disables the purge entirely.
    private val retentionMillis: Long = DEFAULT_RETENTION_MILLIS,
    // config `notifications.purgeIntervalSeconds`; 0 = every mint (the test suite pins this).
    private val purgeIntervalMillis: Long = 0,
    // Injectable for deterministic gate tests, the `LoginThrottle`/`FeedbackService` idiom.
    private val clock: () -> Long = System::currentTimeMillis,
) {
    private companion object {
        const val DEFAULT_RETENTION_MILLIS = 30L * 24 * 60 * 60 * 1000
    }

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
     * A row whose stored type this build no longer knows is INVISIBLE, never fatal. The column
     * holds the enum's NAME, and rows outlive the release that minted them: after an upgrade
     * past a release that removed a type (v3.9.0 dropped seven days-off lifecycle kinds — see
     * `V83`), `NotificationType.valueOf` in [toResponse] would throw and 500 the caller's whole
     * list, badge included. Filtering in SQL rather than after the read is what keeps `total`
     * and the page rows in agreement, and it gives [read] the same 404 the soft-delete flag
     * gives. Deliberately no CHECK constraint on the column (the `V27` idiom — the application
     * enum is the whitelist). See "Removing a notification type" in
     * `.claude/docs/features/notifications.md`.
     */
    private fun knownType(): Op<Boolean> =
        Notifications.notificationType inList NotificationType.entries.map { it.name }

    // The per-instance purge gate: a compareAndSet winner is the one purger among concurrent
    // mints within the interval; a skipped purge just leaves the garbage for the next mint that
    // actually runs one — never a correctness issue, only a bound on DB round-trips.
    private val lastPurgeAtMillis = AtomicLong(0)

    /**
     * Inserts a notification. The generation timestamp and the unseen flag are set here,
     * never taken from a caller. Invoked by the activities that trigger notifications
     * (no HTTP create endpoint exists).
     */
    suspend fun create(notification: Notification): UInt {
        val id = suspendTransaction(database) {
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
        // Own transaction, after the insert commits — a big DELETE must not hold the mint's locks.
        purgeStale()
        // Email mirror AFTER the commit, fire-and-forget — see NotificationEmailer.
        emailer?.dispatch(listOf(notification))
        return id
    }

    /**
     * Batch [create] for wide fan-outs (the pulse cycle events notify the whole eligible org):
     * one transaction instead of N. Same server-managed timestamp/unseen semantics.
     */
    suspend fun createAll(notifications: List<Notification>) {
        suspendTransaction(database) {
            val now = System.currentTimeMillis()
            notifications.forEach { notification ->
                Notifications.insert {
                    it[recipientId] = notification.recipientId
                    it[timestamp] = now
                    it[notificationType] = notification.type.name
                    it[params] = encodeParams(notification.params)
                    it[link] = notification.link
                    it[wasSeen] = false
                }
            }
        }
        // Own transaction, after the insert commits — see create().
        purgeStale()
        // Email mirror AFTER the commit — one background loop for the whole batch.
        emailer?.dispatch(notifications)
    }

    /**
     * Hard-deletes every stale row (see the class doc) org-wide — not scoped to the recipient
     * just minted for, since the purge is housekeeping on the whole table, not a per-recipient
     * operation. An ordinary failure here must never fail the mint that triggered it (JVM
     * `Error`s and cancellation do propagate — see [purgeCatchingFailures]).
     */
    private suspend fun purgeStale() {
        if (retentionMillis == 0L) return
        val now = clock()
        if (purgeIntervalMillis > 0) {
            val last = lastPurgeAtMillis.get()
            if (now - last < purgeIntervalMillis || !lastPurgeAtMillis.compareAndSet(last, now)) {
                return
            }
        }
        purgeCatchingFailures {
            val deleted = suspendTransaction(database) {
                Notifications.deleteWhere {
                    (Notifications.timestamp less (now - retentionMillis)) and
                        ((Notifications.wasSeen eq true) or (Notifications.markedAsDeleted eq true))
                }
            }
            if (deleted > 0) log.info("Purged {} stale notifications", deleted)
        }
    }

    suspend fun read(id: UInt): NotificationResponse? = suspendTransaction(database) {
        Notifications.selectAll()
            .where { (Notifications.id eq id) and active() and knownType() }
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
        var op: Op<Boolean> = (Notifications.recipientId eq recipientId) and active() and knownType()
        filter.wasSeen?.let { op = op and (Notifications.wasSeen eq it) }
        if (filter.disabledFeatures.isNotEmpty()) {
            val hiddenTypes = NotificationType.entries
                .filter { it.feature in filter.disabledFeatures }
                .map { it.name }
            op = op and (Notifications.notificationType notInList hiddenTypes)
        }
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

/**
 * Runs [block], swallowing every other [Exception] into a WARN log — a purge is best-effort
 * housekeeping and an ordinary failure must never fail the mint that triggered it (a JVM
 * `Error` is deliberately NOT caught: never swallow those) — but rethrowing
 * [CancellationException] untouched (checkup #36, C4): catching a plain [Exception] here would
 * also catch it, since [CancellationException] extends [Exception], silently continuing (or
 * half-finishing) a purge whose owning request was itself cancelled instead of unwinding with
 * it — the standard coroutine idiom of never swallowing cancellation. Extracted as a standalone
 * `internal` top-level function so [NotificationPurgeTest] can pin the rethrow, and the WARN
 * path, without a live database.
 */
internal suspend fun purgeCatchingFailures(block: suspend () -> Unit) {
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        log.warn("Stale-notification purge failed", e)
    }
}
