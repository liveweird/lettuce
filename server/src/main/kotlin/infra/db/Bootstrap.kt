package ch.nokillswit.infra.db

import ch.nokillswit.auth.hashPassword
import ch.nokillswit.infra.crypto.EncryptedAtRest
import ch.nokillswit.daysoff.DaysOffServiceKey
import ch.nokillswit.feedbacks.FeedbackServiceKey
import ch.nokillswit.goals.GoalEventServiceKey
import ch.nokillswit.goals.GoalServiceKey
import ch.nokillswit.impactlog.ImpactLogServiceKey
import ch.nokillswit.oneonones.OneOnOneServiceKey
import ch.nokillswit.pulse.PulseResponseServiceKey
import ch.nokillswit.reviews.PerformanceReviewServiceKey
import ch.nokillswit.succession.SuccessionPlanServiceKey
import ch.nokillswit.teamkpis.TeamKpiServiceKey
import ch.nokillswit.users.UserServiceKey
import io.ktor.server.application.*

/** The V6/V9 seed accounts' well-known bcrypt hash (plaintext "changeme"). */
internal const val SEED_PASSWORD_HASH = "\$2y\$12\$VD60LjzPo00G5MtaWE3h9OrqYUid.MVxc5D7oHsM8oErnD9wuIvya"

internal const val SEED_ADMIN_EMAIL = "admin@lettuce.local"

/** The demo-org accounts seeded by V9 (all with [SEED_PASSWORD_HASH], role USER). */
internal val DEMO_SEED_EMAILS = listOf(
    "aaa-one@lettuce.local", "aaa-two@lettuce.local", "aaa-three@lettuce.local",
    "bbb-one@lettuce.local", "bbb-two@lettuce.local", "bbb-three@lettuce.local",
    "manager-aaa@lettuce.local", "manager-bbb@lettuce.local", "manager-ccc@lettuce.local",
)

/**
 * Post-migration bootstrap that neutralizes the template seed credentials outside development.
 * Runs after [configureDatabase] (needs [UserServiceKey]); registered in application.yaml.
 *
 * - `ADMIN_INITIAL_PASSWORD` (config `bootstrap.adminInitialPassword`), when set, rotates the V6
 *   bootstrap admin's password — but only while it still carries the well-known seed hash, so a
 *   password the admin chose later is never overwritten.
 * - Outside development mode the V9 demo users are soft-deleted, and startup **fails closed**
 *   (mirroring the JWT-secret check in plugins/Security.kt) if any active account still carries
 *   the well-known seed hash — a deployment cannot boot with the `changeme` backdoor present.
 * - Runs the encryption-at-rest backfills — feedback content, 1:1 notes/action items, and goal
 *   description/summary (legacy plaintext rows, and a full re-encrypt while a rotation
 *   previousKey is configured).
 */
suspend fun Application.configureBootstrap() {
    val userService = attributes[UserServiceKey]

    val adminInitialPassword = environment.config
        .propertyOrNull("bootstrap.adminInitialPassword")?.getString()?.takeIf { it.isNotBlank() }
    if (adminInitialPassword != null) {
        val rotated = userService.rotatePasswordIfHashMatches(
            email = SEED_ADMIN_EMAIL,
            expectedHash = SEED_PASSWORD_HASH,
            newHash = hashPassword(adminInitialPassword),
        )
        if (rotated > 0) log.info("Bootstrap: rotated the seed admin password from ADMIN_INITIAL_PASSWORD")
    }

    if (!developmentMode) {
        val purged = userService.softDeleteByEmails(DEMO_SEED_EMAILS)
        if (purged > 0) log.info("Bootstrap: soft-deleted $purged demo seed user(s)")

        val remaining = userService.countActiveWithPasswordHash(SEED_PASSWORD_HASH)
        if (remaining > 0) {
            error(
                "$remaining active account(s) still use the well-known seed password 'changeme' — " +
                    "set ADMIN_INITIAL_PASSWORD (or rotate them manually) before starting outside development."
            )
        }
    }

    // Encryption-at-rest backfill: rows written before the field cipher existed still hold
    // plaintext — encrypt them once. While a rotation previousKey is configured, every row is
    // re-encrypted under the current key instead. THE list of encrypted-at-rest services —
    // adding a newly encrypted feature registers it here (see infra/crypto/EncryptedAtRest.kt);
    // removing an entry would strand that feature's rows under a rotated-away key.
    val rotating = environment.config
        .propertyOrNull("security.encryption.previousKey")?.getString()?.isNotBlank() == true
    val encryptedAtRest: List<EncryptedAtRest> = listOf(
        attributes[FeedbackServiceKey],
        attributes[OneOnOneServiceKey],
        attributes[GoalServiceKey],
        attributes[GoalEventServiceKey],
        attributes[TeamKpiServiceKey],
        attributes[PerformanceReviewServiceKey],
        attributes[DaysOffServiceKey],
        attributes[PulseResponseServiceKey],
        attributes[ImpactLogServiceKey],
        attributes[SuccessionPlanServiceKey],
    )
    encryptedAtRest.forEach { service ->
        val encrypted = service.encryptLegacyRows(reencryptAll = rotating)
        if (encrypted > 0) {
            log.info(
                "Bootstrap: ${if (rotating) "re-" else ""}encrypted $encrypted ${service.encryptedRowLabel} row(s) at rest",
            )
        }
    }
}
