package ch.nokillswit.daysoff

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.requireDaysOffCalendarRead
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.users.UserService

/** The "document" behind a calendar share: the PERSON whose calendar it is (the resource id is their user id). */
class CalendarPerson(val userId: UInt, val name: String)

/**
 * The days-off CALENDAR's document-sharing adapter (v4.11.0, see `.claude/docs/features/sharing.md`).
 * The shared unit is a person's whole calendar — never a days-off entry — so the resource id is the
 * PERSON's user id and [read] resolves the user: null for a soft-deleted one (the route answers 404),
 * a deactivated one stays shareable (historical data reads like an active user's). [guard] is the RAW
 * own-right rule [requireDaysOffCalendarRead] (the person themselves or a manager in their
 * transitive chain; there is no HR branch and teammates never qualify) — never a
 * share-aware preamble, which is what keeps sharing non-transitive. The author, who sees and may
 * withdraw EVERY share of the calendar, is the person themselves (the impact-log owner precedent) —
 * a chain manager who did not share learns nothing about it. The label is the plaintext display
 * name only.
 */
class DaysOffCalendarShareable(
    private val userService: UserService,
    private val daysOffService: DaysOffService,
) : ShareableResource<CalendarPerson, Unit> {
    override val type = ShareableResourceType.DAYS_OFF_CALENDAR

    override suspend fun read(id: UInt): CalendarPerson? = userService.read(id)?.let { CalendarPerson(id, it.name) }

    override suspend fun guard(principal: CallerPrincipal, doc: CalendarPerson) =
        requireDaysOffCalendarRead(principal, doc.userId) { daysOffService.managesOwner(principal.userId, doc.userId) }

    override suspend fun isAuthor(userId: UInt, doc: CalendarPerson): Boolean = userId == doc.userId

    override suspend fun label(doc: CalendarPerson): Map<String, String> = mapOf("person" to doc.name)

    override fun viewPath(id: UInt): String = "/days-off?tab=calendar&scope=shared&user=$id"
}
