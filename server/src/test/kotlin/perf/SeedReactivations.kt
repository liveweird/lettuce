package ch.nokillswit.perf

import ch.nokillswit.users.accountReactivatedNotification

/** Share of the managed people who were deactivated and reactivated again within the last [WINDOW_DAYS] days. */
private const val REACTIVATED_SHARE = 0.01
private const val WINDOW_DAYS = 29

/**
 * The account-reactivation notice (`ACCOUNT_REACTIVATED` — "Deactivated accounts" in
 * `.claude/docs/features/notifications.md`): ~1 % of the managed people were deactivated and
 * reactivated again by an administrator inside the 30-day retention window, so each holds the one
 * locked-on, param-less notice minted by the shared `accountReactivatedNotification` builder. Only the
 * notification is part of the dataset: the people end up ACTIVE (the deactivation itself, and the
 * career-position close/reopen that rides it, leave no row), and the generated accounts are otherwise
 * all active — no notification is ever generated for a deactivated recipient, matching the app's rule.
 */
fun seedReactivations(ctx: SeedContext, org: Org, mint: NotificationMint) {
    val rng = ctx.rng("reactivations")
    org.managed.forEach { person ->
        if (rng.chance(REACTIVATED_SHARE)) {
            val at = ctx.millis(ctx.config.anchor.minusDays(rng.int(1, WINDOW_DAYS).toLong()), rng.int(9, 16), rng.int(0, 59))
            mint.emit(accountReactivatedNotification(person.id), at)
        }
    }
}
