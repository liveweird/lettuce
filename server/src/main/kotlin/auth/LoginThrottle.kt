package ch.nokillswit.auth

import kotlinx.coroutines.flow.firstOrNull
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Per-account login throttle: after [threshold] consecutive failures for the same submitted
 * email, further attempts are rejected for [lockoutMillis] — regardless of whether the account
 * exists (so it leaks nothing), and independent of the per-IP rate limit (which an attacker can
 * sidestep by rotating hosts).
 *
 * **DB-backed since v3.11.0/V81** (`login_lockouts`): replicas share the counters and a
 * restart no longer resets them. There is no background sweeper — every write
 * ([recordFailure]) opportunistically prunes rows whose lock has both expired AND gone
 * untouched for a full [lockoutMillis] window, so an abandoned key eventually disappears
 * without a dedicated job. A successful login clears the account's counter.
 */
class LoginThrottle(
    private val database: R2dbcDatabase,
    private val threshold: Int,
    private val lockoutMillis: Long,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    object LoginLockouts : Table("login_lockouts") {
        val email = varchar("email", 254)
        val failures = integer("failures").default(0)
        val lockedUntil = long("locked_until").default(0)
        val lastTouched = long("last_touched")
        override val primaryKey = PrimaryKey(email)
    }

    private fun key(email: String) = email.trim().lowercase()

    /** True while the account is locked out. A pure read — pruning only happens on the write
     *  path ([recordFailure]), so an expired-but-untouched lock is simply no longer `> now`. */
    suspend fun isLocked(email: String): Boolean = suspendTransaction(database) {
        LoginLockouts.selectAll()
            .where { LoginLockouts.email eq key(email) }
            .firstOrNull()
            ?.get(LoginLockouts.lockedUntil)
            ?.let { it > clock() } ?: false
    }

    /** Record a failed attempt; returns true when this failure trips the lockout. */
    suspend fun recordFailure(email: String): Boolean = suspendTransaction(database) {
        val now = clock()
        // Opportunistic prune: a row that is both stale (untouched for a full lockout window)
        // and not currently locked will never be read as locked again, so it is safe to drop.
        LoginLockouts.deleteWhere {
            (LoginLockouts.lastTouched less (now - lockoutMillis)) and (LoginLockouts.lockedUntil lessEq now)
        }
        val k = key(email)
        val newFailures = LoginLockouts.upsertReturning(
            returning = listOf(LoginLockouts.failures),
            onUpdate = {
                it[LoginLockouts.failures] = LoginLockouts.failures + 1
                it[LoginLockouts.lastTouched] = now
            },
        ) {
            // Fully qualified: the insert body's implicit LoginLockouts receiver would otherwise
            // lose to this function's own same-named parameters/locals (email/now) in Kotlin's
            // name resolution — a local always shadows a receiver member of the same name.
            it[LoginLockouts.email] = k
            it[LoginLockouts.failures] = 1
            it[LoginLockouts.lockedUntil] = 0
            it[LoginLockouts.lastTouched] = now
        }.toList().single()[LoginLockouts.failures]

        if (newFailures >= threshold) {
            LoginLockouts.update({ LoginLockouts.email eq k }) {
                it[LoginLockouts.failures] = 0
                it[LoginLockouts.lockedUntil] = now + lockoutMillis
            }
            true
        } else {
            false
        }
    }

    suspend fun recordSuccess(email: String) {
        suspendTransaction(database) {
            LoginLockouts.deleteWhere { LoginLockouts.email eq key(email) }
        }
    }
}
