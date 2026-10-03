package ch.nokillswit.perf

import ch.nokillswit.activity.AccountEventService
import ch.nokillswit.activity.AccountEventType
import java.time.DayOfWeek

private const val RETENTION_DAYS = 90L

/**
 * The sign-in history (`account_events`, V90 — "Sign-in history" in `.claude/docs/features/activity-log.md`):
 * every account, the HR auditor included, signs in (`SIGNED_IN{mfa:"false"}` — the generated accounts have the
 * MFA opt-in off) in the morning and out (`SIGNED_OUT`) in the evening of every WORKDAY (Monday–Friday) of the
 * last 90 days — exactly the retention window the on-write purge keeps (`activity.accountRetentionDays`), so
 * ~512 accounts × ~64 workdays × 2 ≈ 65k rows. Owner = actor = the account, like `AccountEventService.insert`.
 * Public holidays are not special-cased (people sign in on them too, now and then).
 */
suspend fun seedAccountEvents(ctx: SeedContext, org: Org) {
    val rng = ctx.rng("account-events")
    val events = EventStream(ctx.db, AccountEventService.AccountEvents)
    events.init(ctx.db)
    val accounts = org.people + org.hr
    var day = ctx.config.anchor.minusDays(RETENTION_DAYS)
    while (day < ctx.config.anchor) {
        if (day.dayOfWeek != DayOfWeek.SATURDAY && day.dayOfWeek != DayOfWeek.SUNDAY) {
            accounts.forEach { person ->
                val signedIn = ctx.millis(day, 7 + rng.int(0, 3), rng.int(0, 59))
                val signedOut = ctx.millis(day, 15 + rng.int(0, 3), rng.int(0, 59))
                events.add(person.id, person.id, signedIn, AccountEventType.SIGNED_IN.name, mapOf("mfa" to "false"))
                events.add(person.id, person.id, signedOut, AccountEventType.SIGNED_OUT.name, emptyMap())
            }
            events.sink.flush()
        }
        day = day.plusDays(1)
    }
    advanceSequences(ctx.db, listOf(AccountEventService.AccountEvents))
}
