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
 * ([reserveAttempt]) opportunistically prunes rows whose lock has expired AND that have gone
 * untouched for a week (far longer than a lockout window, so a sub-threshold counter cannot be
 * waited out between guesses), so an abandoned key eventually disappears without a dedicated job.
 * A successful login clears the account's counter.
 *
 * **Reservation shape (v3.13.1, checkup #36 M1):** the login route reserves an attempt
 * ([reserveAttempt]) BEFORE password verification, not after — see [reserveAttempt] for why.
 */
class LoginThrottle(
    private val database: R2dbcDatabase,
    /** Readable by the login route so it can decide, once a reserved attempt turns out to be a
     *  wrong password, whether THIS attempt is the one that trips the lock (see [lock]). */
    val threshold: Int,
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

    /** The outcome of [reserveAttempt]: either the attempt is locked out already (`failures` is
     *  meaningless then), or it is allowed with the freshly incremented failure count. */
    data class Reservation(val locked: Boolean, val failures: Int, val tripped: Boolean = false)

    private fun key(email: String) = email.trim().lowercase()

    private companion object {
        /** How long an idle, unlocked failure counter is kept before the write-path prune drops it. */
        const val COUNTER_RETENTION_MILLIS = 7L * 24 * 60 * 60 * 1000
    }

    /** True while the account is locked out. A pure read — pruning only happens on the write
     *  path ([reserveAttempt]), so an expired-but-untouched lock is simply no longer `> now`. */
    suspend fun isLocked(email: String): Boolean = suspendTransaction(database) {
        LoginLockouts.selectAll()
            .where { LoginLockouts.email eq key(email) }
            .firstOrNull()
            ?.get(LoginLockouts.lockedUntil)
            ?.let { it > clock() } ?: false
    }

    /**
     * Atomically reserves one login attempt for [email] — called BEFORE password verification
     * (checkup #36 M1: a burst of concurrent wrong-password attempts that all read "not locked
     * yet" before any of them finishes bcrypt used to all get verified, so the per-window bound
     * was "threshold + in-flight burst" rather than [threshold]). One `suspendTransaction`:
     *  - already locked → [Reservation.locked] `true`, no further write;
     *  - otherwise the counter is incremented (unless the row is locked, handled above — an
     *    attempt arriving while locked must never move the counter, so it "starts fresh" once
     *    the window ends) and, if the incremented count now EXCEEDS [threshold], this is itself
     *    the (threshold + 1)-th or later concurrent reservation in the burst: trip the lock right
     *    here — the backstop that bounds the burst even though the threshold-th attempt's own
     *    [lock] call (from the route, once its bcrypt result is known) hasn't run yet;
     *  - else → `locked = false` with the incremented failure count, for the caller to decide
     *    (after verifying the password) whether this is the attempt that trips the lock.
     */
    suspend fun reserveAttempt(email: String): Reservation = suspendTransaction(database) {
        val now = clock()
        // Opportunistic prune: a row that is not currently locked and has gone untouched for
        // COUNTER_RETENTION_MILLIS will never be read as locked again, so it is safe to drop.
        // The retention is deliberately much longer than the lockout window: pruning idle
        // sub-threshold counters after one window would let a low-and-slow attacker stay
        // under the threshold forever by spacing guesses a window apart (the in-memory map
        // never decayed a counter; this keeps that property to within a week).
        LoginLockouts.deleteWhere {
            (LoginLockouts.lastTouched less (now - COUNTER_RETENTION_MILLIS)) and (LoginLockouts.lockedUntil lessEq now)
        }
        val k = key(email)
        val row = LoginLockouts.upsertReturning(
            returning = listOf(LoginLockouts.failures, LoginLockouts.lockedUntil),
            onUpdate = {
                it[LoginLockouts.failures] = Case()
                    .When(LoginLockouts.lockedUntil greater now, LoginLockouts.failures)
                    .Else(LoginLockouts.failures + 1)
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
        }.toList().single()

        val lockedUntil = row[LoginLockouts.lockedUntil]
        if (lockedUntil > now) {
            return@suspendTransaction Reservation(locked = true, failures = row[LoginLockouts.failures])
        }
        val failures = row[LoginLockouts.failures]
        if (failures > threshold) {
            LoginLockouts.update({ LoginLockouts.email eq k }) {
                it[LoginLockouts.failures] = 0
                it[LoginLockouts.lockedUntil] = now + lockoutMillis
            }
            // `tripped`: THIS reservation turned the lock on — the route audits `login.lockout`
            // for it, so a burst (or a correct-password attempt racing one) still leaves exactly
            // one lockout record; the threshold-th attempt's own [lock] then finds it set.
            return@suspendTransaction Reservation(locked = true, failures = failures, tripped = true)
        }
        Reservation(locked = false, failures = failures)
    }

    /** Trips the lock after a verified wrong-password attempt (the sequential, non-burst case —
     *  [reserveAttempt]'s own backstop covers the concurrent-burst case). Returns true when THIS
     *  call turned the lock on; false when the row was already locked (the backstop got there
     *  first), so the caller audits `login.lockout` exactly once per trip. */
    suspend fun lock(email: String): Boolean = suspendTransaction(database) {
        val now = clock()
        LoginLockouts.update({ (LoginLockouts.email eq key(email)) and (LoginLockouts.lockedUntil lessEq now) }) {
            it[LoginLockouts.failures] = 0
            it[LoginLockouts.lockedUntil] = now + lockoutMillis
        } > 0
    }

    /** Undoes one [reserveAttempt] without resetting the counter — used by the
     *  correct-password-but-deactivated 403 path, so correct credentials never feed the lockout
     *  while the reservation taken before bcrypt still gets released. */
    suspend fun release(email: String) {
        suspendTransaction(database) {
            LoginLockouts.update({ LoginLockouts.email eq key(email) }) {
                // No portable GREATEST() in Exposed core — a CASE does the same clamp.
                it[LoginLockouts.failures] = Case()
                    .When(LoginLockouts.failures greater 0, LoginLockouts.failures - 1)
                    .Else(intLiteral(0))
            }
        }
    }

    suspend fun recordSuccess(email: String) {
        suspendTransaction(database) {
            LoginLockouts.deleteWhere { LoginLockouts.email eq key(email) }
        }
    }
}
