package ch.nokillswit.auth

import ch.nokillswit.integration.apiKeyHash
import java.security.SecureRandom
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.r2dbc.*
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction

/**
 * Store of pending email-MFA challenges (v2.4.0): a login with correct credentials by an
 * MFA-enabled user mints a challenge — an opaque id handed to the client plus a 6-digit code
 * emailed to the account — and the pair must come back to POST /api/v1/login/mfa within
 * [ttlMillis] and [maxAttempts] guesses. A challenge is single-use: consumed on success, dropped
 * on expiry or when the attempt cap is exceeded.
 *
 * **DB-backed since v3.11.0/V81** (`mfa_challenges`): replicas share pending challenges and a
 * restart no longer invalidates them mid-flight. Multiple live challenges per account
 * (repeated logins) are accepted: the short TTL, the attempt cap, and the login rate bucket
 * bound the guessing surface (≤ maxAttempts·10⁻⁶ per challenge).
 *
 * The 6-digit code itself is stored only as a SHA-256 hash (reusing [apiKeyHash], the
 * integration API-key digest — same primitive, different secret shape): honest framing, not a
 * strong guarantee — a 6-digit space is brute-forceable from a raw dump in seconds regardless of
 * hashing. What the hash buys is keeping the plaintext OTP out of dumps/backups; the actual
 * controls against guessing are the 128-bit opaque challenge id, the TTL, and the attempt cap.
 * The comparison itself lives in SQL (an equality predicate on the hash column) rather than a
 * constant-time byte comparison in application code — the hash is single-use and short-lived, so
 * a timing side-channel on the comparison buys an attacker nothing they don't already get from
 * guessing the 6-digit code directly.
 */
class MfaChallenges(
    private val database: R2dbcDatabase,
    private val ttlMillis: Long,
    private val maxAttempts: Int,
    private val clock: () -> Long = System::currentTimeMillis,
) {
    object Challenges : Table("mfa_challenges") {
        val id = varchar("id", 32)
        val userId = long("user_id")
        val codeHash = varchar("code_hash", 64)
        val expiresAt = long("expires_at")
        val attempts = integer("attempts").default(0)
        override val primaryKey = PrimaryKey(id)
    }

    data class IssuedChallenge(val challengeId: String, val code: String, val expiresAt: Long)

    sealed interface Outcome {
        data class Success(val userId: UInt) : Outcome

        /** [reason] feeds the audit trail only — the HTTP answer stays a uniform 401. */
        data class Failure(val reason: String) : Outcome
    }

    private fun digestOf(challengeId: String, code: String): String = apiKeyHash("$challengeId:$code")

    suspend fun issue(userId: UInt): IssuedChallenge = suspendTransaction(database) {
        val now = clock()
        // No background sweeper: every issue prunes challenges that have already expired.
        Challenges.deleteWhere { Challenges.expiresAt lessEq now }
        val id = generateChallengeId()
        val code = generateMfaCode()
        val expiresAt = now + ttlMillis
        // Fully qualified throughout: several local names here (id/code/expiresAt) collide with
        // column names, and a local always shadows an implicit-receiver member of the same name
        // in Kotlin — the LoginThrottle.recordFailure note applies here too.
        Challenges.insert {
            it[Challenges.id] = id
            it[Challenges.userId] = userId.toLong()
            it[Challenges.codeHash] = digestOf(id, code)
            it[Challenges.expiresAt] = expiresAt
            it[Challenges.attempts] = 0
        }
        IssuedChallenge(id, code, expiresAt)
    }

    /**
     * Each step below is materialized (`.toList()`) before the next runs — the cursor rule for
     * chaining multiple statements on one connection inside a `suspendTransaction` (see
     * `FeedbackService.expireOverdueRequests`).
     */
    suspend fun verify(challengeId: String, code: String): Outcome = suspendTransaction(database) {
        val now = clock()

        // (1) Expired: delete it and say so — a later lookup on the same id must see "unknown",
        // never "expired" again (the drop is permanent).
        val expired = Challenges.deleteReturning(
            where = { (Challenges.id eq challengeId) and (Challenges.expiresAt lessEq now) },
        ).toList()
        if (expired.isNotEmpty()) return@suspendTransaction Outcome.Failure("expired")

        // (2) Correct code, not expired: single-use — delete on success.
        val hash = digestOf(challengeId, code)
        val success = Challenges.deleteReturning(
            returning = listOf(Challenges.userId),
            where = {
                (Challenges.id eq challengeId) and (Challenges.codeHash eq hash) and (Challenges.expiresAt greater now)
            },
        ).toList()
        if (success.isNotEmpty()) {
            return@suspendTransaction Outcome.Success(success.single()[Challenges.userId].toUInt())
        }

        // (3) Neither expired nor correct: atomically bump the attempt counter. An empty result
        // means the id never existed (or was consumed/expired by a concurrent call already).
        val updated = Challenges.updateReturning(
            returning = listOf(Challenges.attempts),
            where = { (Challenges.id eq challengeId) and (Challenges.expiresAt greater now) },
        ) {
            it[Challenges.attempts] = Challenges.attempts + 1
        }.toList()
        if (updated.isEmpty()) return@suspendTransaction Outcome.Failure("unknown_challenge")

        // (4) Cap exhausted: kill the challenge too, else it stays a wrong-code result.
        val newAttempts = updated.single()[Challenges.attempts]
        if (newAttempts >= maxAttempts) {
            Challenges.deleteWhere { Challenges.id eq challengeId }
            Outcome.Failure("too_many_attempts")
        } else {
            Outcome.Failure("wrong_code")
        }
    }

    private companion object {
        val secureRandom = SecureRandom()

        /** 128 bits of opaque, unguessable challenge identity. */
        fun generateChallengeId(): String {
            val bytes = ByteArray(16)
            secureRandom.nextBytes(bytes)
            return bytes.joinToString("") { "%02x".format(it) }
        }
    }
}
