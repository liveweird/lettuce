package ch.nokillswit.perf

import ch.nokillswit.activity.AccountEventService
import ch.nokillswit.activity.AccountEventType
import ch.nokillswit.users.UserService
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.update
import java.time.DayOfWeek

private const val RETENTION_DAYS = 90L

/**
 * The sign-in history (`account_events`, V90 — "Sign-in history" in `.claude/docs/features/activity-log.md`):
 * every account, the HR auditor included, signs in (`SIGNED_IN{mfa:"false"}` — the generated accounts have the
 * MFA opt-in off) in the morning and out (`SIGNED_OUT`) in the evening of every WORKDAY (Monday–Friday) of the
 * last 90 days — exactly the retention window the on-write purge keeps (`activity.accountRetentionDays`), so
 * ~512 accounts × ~64 workdays × 2 ≈ 65k rows. Owner = actor = the account, like `AccountEventService.insert`.
 * Public holidays are not special-cased (people sign in on them too, now and then). The ~10 % of accounts that
 * never signed in ([Org.neverSignedIn], `users.last_login_at = 0`) get no rows at all, and every other account's
 * `users.last_login_at` is set to its newest SIGNED_IN, so the history and the column never disagree.
 */
suspend fun seedAccountEvents(ctx: SeedContext, org: Org) {
    val rng = ctx.rng("account-events")
    val events = EventStream(ctx.db, AccountEventService.AccountEvents)
    events.init(ctx.db)
    val accounts = (org.people + org.hr).filter { it.id !in org.neverSignedIn }
    val lastSignIn = HashMap<UInt, Long>()
    var day = ctx.config.anchor.minusDays(RETENTION_DAYS)
    while (day < ctx.config.anchor) {
        if (day.dayOfWeek != DayOfWeek.SATURDAY && day.dayOfWeek != DayOfWeek.SUNDAY) {
            accounts.forEach { person ->
                val signedIn = ctx.millis(day, 7 + rng.int(0, 3), rng.int(0, 59))
                val signedOut = ctx.millis(day, 15 + rng.int(0, 3), rng.int(0, 59))
                events.add(person.id, person.id, signedIn, AccountEventType.SIGNED_IN.name, mapOf("mfa" to "false"))
                lastSignIn[person.id] = signedIn // days ascend, so the last write is the newest
                events.add(person.id, person.id, signedOut, AccountEventType.SIGNED_OUT.name, emptyMap())
            }
            events.sink.flush()
        }
        day = day.plusDays(1)
    }
    suspendTransaction(ctx.db) {
        val users = UserService.Users
        lastSignIn.forEach { (id, at) -> users.update({ users.id eq id }) { it[users.lastLoginAt] = at } }
    }
    advanceSequences(ctx.db, listOf(AccountEventService.AccountEvents))
}
