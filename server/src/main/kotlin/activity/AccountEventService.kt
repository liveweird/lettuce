package ch.nokillswit.activity

import ch.nokillswit.infra.catchingFailures
import ch.nokillswit.infra.db.EventLog
import ch.nokillswit.infra.db.EventLogTable
import ch.nokillswit.users.UserService
import io.ktor.util.AttributeKey
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch
import org.jetbrains.exposed.v1.core.less
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.deleteWhere
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.slf4j.LoggerFactory
import java.util.concurrent.atomic.AtomicLong

val AccountEventServiceKey = AttributeKey<AccountEventService>("AccountEventService")

/** The two account events (v4.9.0, V90): a COMPLETED sign-in and an explicit sign-out — nothing else. */
enum class AccountEventType { SIGNED_IN, SIGNED_OUT }

private val log = LoggerFactory.getLogger(AccountEventService::class.java)

/**
 * The sign-in history behind the activity log's `ACCOUNT` area (v4.9.0, V90): `SIGNED_IN {mfa}` is
 * minted where `users.last_login_at` is stamped (the non-MFA `/login` success and the `/login/mfa`
 * success — never `/refresh`, the MFA challenge step, a failure, a lockout or a deactivated 403) and
 * `SIGNED_OUT` by `/logout`. No IP, no user agent. The owner is the actor (the account itself).
 *
 * **Best-effort, never on the login's critical path (checkup correction 5):** [record] and the purge
 * it triggers catch every ordinary failure and log it at ERROR — a database hiccup while writing the
 * history must not turn a successful sign-in into a 500 (cancellation and JVM `Error`s still
 * propagate, see [catchingFailures]). The insert is awaited (so the row exists when the request
 * answers); the **purge is not**: with a [scope] it is launched fire-and-forget on the Application
 * scope (the `NotificationEmailer`/Teams-sender pattern), so a big DELETE never delays a login. A
 * purge still running at `ApplicationStopped` fails its next pooled call against the disposed pool,
 * which its catch logs at ERROR — nothing reaches a client and the next run simply repeats it. With
 * `scope = null` (service-level tests) the purge runs inline, the deterministic seam.
 *
 * **Retention — the registered hard-delete exception (the `NotificationService` precedent).**
 * Rows older than [retentionMillis] (`activity.accountRetentionDays`, default 90; 0 = keep forever)
 * are HARD-deleted on the write path after the insert commits, at most once per [purgeIntervalMillis]
 * per instance (`activity.accountPurgeIntervalSeconds`; 0 = every record, the test suite's setting)
 * through the same `compareAndSet` gate as the notification purge. Org-wide housekeeping: every
 * account's stale rows, not just the one just written.
 */
open class AccountEventService(
    val database: R2dbcDatabase,
    private val retentionMillis: Long = DEFAULT_RETENTION_MILLIS,
    private val purgeIntervalMillis: Long = 0,
    // Injectable for deterministic gate/boundary tests, the `NotificationService` idiom.
    private val clock: () -> Long = System::currentTimeMillis,
    // The Application scope the purge is launched on; null = run it inline (see the class doc).
    private val scope: CoroutineScope? = null,
) {
    private companion object {
        const val DEFAULT_RETENTION_MILLIS = 90L * 24 * 60 * 60 * 1000
    }

    object AccountEvents : EventLogTable("account_events", "owner_id", UserService.Users)

    private val eventLog = EventLog(database, AccountEvents)
    private val lastPurgeAtMillis = AtomicLong(0)

    /**
     * Records [type] for the account [userId] (owner = actor), then runs the gated purge. Never
     * throws an ordinary failure — see the class doc.
     */
    suspend fun record(userId: UInt, type: AccountEventType, params: Map<String, String> = emptyMap()) {
        catchingFailures({ insert(userId, type, params) }) { e ->
            log.error("Recording the {} account event failed for user {}", type, userId, e)
        }
        // The purge is housekeeping on the whole table — off the request path when a scope is given, and
        // its failure (the DELETE, the clock, anything ordinary) is logged and never reaches the sign-in.
        val purge: suspend () -> Unit = {
            catchingFailures({ purgeStale() }) { e -> log.error("Stale account-event purge failed", e) }
        }
        if (scope == null) purge() else scope.launch { purge() }
    }

    /** The write itself — `internal open` so a test can inject a failing insert (the route-level "never fails the login" seam). */
    internal open suspend fun insert(userId: UInt, type: AccountEventType, params: Map<String, String>) {
        eventLog.create(userId, userId, type.name, params)
    }

    /** Hard-deletes every row older than the retention (org-wide); [record] logs a failure at ERROR, never throws it. */
    private suspend fun purgeStale() {
        if (retentionMillis == 0L) return
        val now = clock()
        if (purgeIntervalMillis > 0) {
            val last = lastPurgeAtMillis.get()
            if (now - last < purgeIntervalMillis || !lastPurgeAtMillis.compareAndSet(last, now)) return
        }
        val deleted = suspendTransaction(database) {
            AccountEvents.deleteWhere { AccountEvents.timestamp less (now - retentionMillis) }
        }
        if (deleted > 0) log.info("Purged {} stale account events", deleted)
    }
}
