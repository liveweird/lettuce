package ch.nokillswit.auth

import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Per-email throttle for the self-service password reset: at most one request per submitted
 * email per [minIntervalMillis] — uniformly, whether or not the account exists (so the 429
 * carries no enumeration signal). Sibling of [LoginThrottle].
 *
 * **DB-backed since v3.11.0/V81** (`password_reset_requests`): replicas share the throttle
 * and a restart no longer resets it. No background sweeper — [tryAcquire] opportunistically
 * prunes rows already outside the interval on every call.
 */
class PasswordResetThrottle(
    private val database: R2dbcDatabase,
    private val minIntervalMillis: Long,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    object PasswordResetRequests : Table("password_reset_requests") {
        val email = varchar("email", 254)
        val lastRequestAt = long("last_request_at")
        override val primaryKey = PrimaryKey(email)
    }

    private fun key(email: String) = email.trim().lowercase()

    /** Atomically claims a slot for this email; false while the previous one is still fresh.
     *  A rejected attempt does not extend the wait — the `where` clause only lets the update
     *  through once the interval has actually elapsed, so a blocked conflict leaves the stored
     *  timestamp (and the RETURNING row) untouched. */
    suspend fun tryAcquire(email: String): Boolean = suspendTransaction(database) {
        val now = clock()
        PasswordResetRequests.deleteWhere {
            PasswordResetRequests.lastRequestAt less (now - minIntervalMillis)
        }
        val k = key(email)
        val acquired = PasswordResetRequests.upsertReturning(
            returning = listOf(PasswordResetRequests.lastRequestAt),
            onUpdate = { it[PasswordResetRequests.lastRequestAt] = now },
            where = { PasswordResetRequests.lastRequestAt lessEq (now - minIntervalMillis) },
        ) {
            // Fully qualified — see the note in LoginThrottle.recordFailure: a local of the
            // same name (email) would otherwise shadow the receiver's column.
            it[PasswordResetRequests.email] = k
            it[PasswordResetRequests.lastRequestAt] = now
        }.toList()
        acquired.isNotEmpty()
    }
}
