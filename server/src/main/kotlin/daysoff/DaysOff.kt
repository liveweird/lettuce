package ch.nokillswit.daysoff

import ch.nokillswit.infra.paging.PageResponse
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeParseException

@Serializable
enum class DaysOffType { PAID, UNPAID }

/**
 * The request lifecycle: REQUESTED -> ACCEPTED | REJECTED (resolved by a current direct manager
 * of the owner), plus terminal CANCELLED (the owner — from REQUESTED anytime, from ACCEPTED only
 * strictly before the start date). REQUESTED and ACCEPTED both reserve paid budget ("counting"
 * statuses); REJECTED and CANCELLED free it.
 */
@Serializable
enum class DaysOffStatus { REQUESTED, ACCEPTED, REJECTED, CANCELLED }

/** The budget-reserving statuses — the working set for overlap and budget checks. */
internal val COUNTING_STATUSES = listOf(DaysOffStatus.REQUESTED, DaysOffStatus.ACCEPTED)

const val MAX_PAID_DAYS_OFF_ALLOWANCE = 365

/**
 * Body of `POST /days-off` — the owner is always the caller (no create-on-behalf), the status
 * always enters REQUESTED, and the cost is computed server-side, so none of those are settable.
 * Edge half-days: [startHalf]/[endHalf] mark the first/last day of the period as half days; a
 * single-day request uses [startHalf] alone ([endHalf] must stay false — see
 * [validateDaysOffCreate]).
 */
@Serializable
data class DaysOffCreateRequest(
    val type: DaysOffType,
    val startDate: String,
    val endDate: String,
    val startHalf: Boolean = false,
    val endHalf: Boolean = false,
)

@Serializable
data class DaysOffResponse(
    val id: UInt,
    val userId: UInt,
    val userName: String,
    val type: DaysOffType,
    val status: DaysOffStatus,
    // ISO YYYY-MM-DD, immutable after create; startDate <= endDate, same calendar year.
    val startDate: String,
    val endDate: String,
    val startHalf: Boolean,
    val endHalf: Boolean,
    // The frozen working-day cost in days (0.5 steps) — weekends and public holidays inside the
    // period cost nothing; computed against the holiday registry at creation, never repriced.
    val days: Double,
    val createdAt: Long,
    // The accepting/rejecting manager — null while REQUESTED (and forever on a REQUESTED-time
    // cancellation).
    val resolvedById: UInt?,
    val resolvedByName: String?,
    val resolvedAt: Long?,
    val cancelledAt: Long?,
    val lastModified: Long,
)

@Serializable
data class DaysOffListItem(
    val id: UInt,
    val userId: UInt,
    val userName: String,
    val userDeleted: Boolean,
    val type: DaysOffType,
    val status: DaysOffStatus,
    val startDate: String,
    val endDate: String,
    val startHalf: Boolean,
    val endHalf: Boolean,
    val days: Double,
    val createdAt: Long,
    val lastModified: Long,
)

typealias DaysOffPageResponse = PageResponse<DaysOffListItem>

/** One marked day of the calendar payload; [half] is true on a half-day edge day. */
@Serializable
data class DaysOffCalendarEntry(
    val requestId: UInt,
    val date: String,
    val type: DaysOffType,
    val status: DaysOffStatus,
    val half: Boolean,
)

@Serializable
data class DaysOffCalendarUser(
    val userId: UInt,
    val userName: String,
    val userDeleted: Boolean,
    val entries: List<DaysOffCalendarEntry>,
)

/**
 * The month calendar payload: every user in the scope (entries or not — rows must render),
 * their REQUESTED/ACCEPTED days clipped to the month, plus the month's public holidays.
 * Bounded by (scope users × ≤31 days), so unpaged by construction.
 */
@Serializable
data class DaysOffCalendarResponse(
    val month: String,
    val holidays: List<PublicHolidayItem>,
    val users: List<DaysOffCalendarUser>,
)

/**
 * One user's paid-days budget for one calendar year. All day values are in days (0.5 steps);
 * `remaining = carriedOver + allowance - reserved - used` holds by construction ([remainingHalfDays]).
 */
@Serializable
data class DaysOffBudget(
    val userId: UInt,
    val userName: String,
    val userDeleted: Boolean,
    val year: Int,
    // Null = not configured by an admin = zero paid budget.
    val allowance: Int?,
    val carriedOver: Double,
    // REQUESTED (pending) paid days in the year — reserved, not yet confirmed.
    val reserved: Double,
    // ACCEPTED paid days in the year.
    val used: Double,
    val remaining: Double,
)

@Serializable
data class DaysOffBudgetList(
    val items: List<DaysOffBudget>,
)

/**
 * Parses a strict zero-padded ISO `YYYY-MM-DD` date (anything else would break the VARCHAR
 * column's lexicographic == chronological ordering — and the overlap/range SQL that relies on
 * it) or throws [BadRequestException] (→ 400).
 */
internal fun parseDaysOffDate(date: String, field: String): LocalDate = try {
    if (date.length != 10) throw DateTimeParseException("wrong length", date, 0)
    LocalDate.parse(date)
} catch (_: DateTimeParseException) {
    throw BadRequestException("$field must be an ISO date (YYYY-MM-DD)")
}

/**
 * Validates a create payload's shape (400s): strict ISO dates, start not after end, both dates
 * in the same calendar year (a New-Year-spanning wish is two requests — this pins the frozen
 * cost to exactly one budget year), and the single-day half rule ([DaysOffCreateRequest]).
 * The zero-cost and overlap/budget rules need the DB and live in [DaysOffService.create].
 */
internal fun validateDaysOffCreate(request: DaysOffCreateRequest) {
    val start = parseDaysOffDate(request.startDate, "startDate")
    val end = parseDaysOffDate(request.endDate, "endDate")
    if (start > end) throw BadRequestException("startDate must not be after endDate")
    if (start.year != end.year) {
        throw BadRequestException("A days-off request must not span calendar years — split it into two requests")
    }
    if (start == end && request.endHalf) {
        throw BadRequestException("A single-day request expresses a half day via startHalf only")
    }
}

/**
 * Parses a strict zero-padded ISO `YYYY-MM` month (the calendar endpoint's window) or throws
 * [BadRequestException] (→ 400) — the review-periods month idiom.
 */
internal fun parseDaysOffMonth(month: String): java.time.YearMonth = try {
    if (month.length != 7) throw DateTimeParseException("wrong length", month, 0)
    java.time.YearMonth.parse(month)
} catch (_: DateTimeParseException) {
    throw BadRequestException("month must be an ISO month (YYYY-MM)")
}

/**
 * The working-day cost of a period in half-day integer units. A day counts iff it is not a
 * Saturday/Sunday and not a public holiday; a counted day costs 2 half-units, minus 1 when it is
 * the period's first day and [startHalf], minus 1 when it is the last day and [endHalf] — a half
 * toggle on a NON-counted edge day subtracts nothing (the day already costs 0). Integer units
 * keep the budget math exact; the API converts to days via `/ 2.0` (halves are exact in IEEE754).
 */
internal fun daysOffCostHalfDays(
    startDate: LocalDate,
    endDate: LocalDate,
    startHalf: Boolean,
    endHalf: Boolean,
    holidays: Set<LocalDate>,
): Int {
    var cost = 0
    var day = startDate
    while (day <= endDate) {
        val counted = day.dayOfWeek != DayOfWeek.SATURDAY &&
            day.dayOfWeek != DayOfWeek.SUNDAY &&
            day !in holidays
        if (counted) {
            var units = 2
            if (day == startDate && startHalf) units -= 1
            if (day == endDate && endHalf) units -= 1
            cost += units
        }
        day = day.plusDays(1)
    }
    return cost
}

/**
 * The remaining paid budget for [year] in half-day units — the closed form of the carry-over
 * recursion ("unused budget transfers to the next year"): with the anchor
 * `A = min(earliest year holding a counting PAID request, year)`, the budget accumulated over
 * `A..year` is `2·allowance·(year − A + 1)` minus everything used in those years. Anchoring at
 * the earliest actual usage means the allowance never phantom-accumulates over empty historical
 * years (a user with no history simply has this year's allowance). Deliberately unclamped: a
 * retroactive allowance cut can push a year negative and the deficit carries forward — creation
 * enforces `>= 0`, so a deficit only ever arises from admin edits (documented).
 *
 * [usedByYear] maps year → summed half-day cost of the user's counting (REQUESTED/ACCEPTED)
 * PAID requests in that year.
 */
internal fun remainingHalfDays(allowanceDays: Int?, year: Int, usedByYear: Map<Int, Int>): Int {
    val allowanceH = 2 * (allowanceDays ?: 0)
    val anchor = minOf(usedByYear.keys.minOrNull() ?: year, year)
    val usedH = usedByYear.filterKeys { it in anchor..year }.values.sum()
    return allowanceH * (year - anchor + 1) - usedH
}

/**
 * The half-day units carried into [year] from previous years: [remainingHalfDays] of `year − 1`,
 * or 0 when no counting usage exists before [year] — the anchor rule again: with no history the
 * previous year contributes nothing, so a fresh user's budget is exactly the allowance.
 */
internal fun carriedOverHalfDays(allowanceDays: Int?, year: Int, usedByYear: Map<Int, Int>): Int {
    if (usedByYear.keys.none { it < year }) return 0
    return remainingHalfDays(allowanceDays, year - 1, usedByYear)
}

/** Formats half-day units as a days string for notification params: "3" for whole, "3.5" for halves. */
internal fun formatHalfDaysParam(halfDays: Int): String =
    if (halfDays % 2 == 0) (halfDays / 2).toString() else (halfDays / 2.0).toString()
