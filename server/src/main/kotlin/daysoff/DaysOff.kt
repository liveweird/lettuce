package ch.nokillswit.daysoff

import ch.nokillswit.infra.paging.PageResponse
import ch.nokillswit.infra.parseIsoDateStrict
import io.ktor.server.plugins.BadRequestException
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeParseException
import kotlinx.serialization.Serializable

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
 * Body of `PUT /days-off/allowance` (v2.32.0 — the allowance moved off the ADMIN users PUT):
 * a chain manager sets [userId]'s annual paid allowance. Required and rangeless of history —
 * the CURRENT value applies to every calendar year (a change recomputes the closed-form
 * budget retroactively, documented on the budgets endpoint). Clearing stays inexpressible
 * (no null) — a set allowance is only ever overwritten.
 */
@Serializable
data class DaysOffAllowanceWrite(
    val userId: UInt,
    val allowance: Int,
)

/** Range rule for the allowance (whole days). Runs AFTER the chain guard — 403 wins over 400. */
internal fun validateDaysOffAllowance(write: DaysOffAllowanceWrite) {
    if (write.allowance !in 0..MAX_PAID_DAYS_OFF_ALLOWANCE) {
        throw BadRequestException("Paid days-off allowance must be between 0 and $MAX_PAID_DAYS_OFF_ALLOWANCE days")
    }
}

/**
 * Body of `POST /days-off` — the cost is computed server-side and the status is never settable.
 * Without [userId] the owner is the caller and the request enters REQUESTED; with [userId]
 * (v2.29.0) a current DIRECT MANAGER of that user records the entry on their behalf and it is
 * born ACCEPTED with the caller stamped as the resolver (the vacation-history population flow —
 * the caller holds the accept right, so a separate approval step would be theater).
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
    val userId: UInt? = null,
)

/** The mandatory reasoning for a cancellation (v2.31.0) — validated by [validateDaysOffCancel]. */
@Serializable
data class DaysOffCancelRequest(
    val reason: String,
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
    // The cancelling actor (v2.31.0 — owner OR a chain manager) and their mandatory reason
    // (decrypted; stored encrypted at rest). All null on rows cancelled before the rework,
    // and while not CANCELLED.
    val cancelledById: UInt?,
    val cancelledByName: String?,
    val cancelReason: String?,
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
    // The cancellation record (v2.31.0) — the reason popover's data; null unless CANCELLED
    // (and null on pre-rework cancellations, which carried no actor/reason).
    val cancelledAt: Long?,
    val cancelledByName: String?,
    val cancelReason: String?,
    // Server-computed capability (the team-KPI canManage precedent): the caller may cancel
    // this row — they own it or manage the owner (transitively) and it is REQUESTED/ACCEPTED.
    val canCancel: Boolean,
    // The caller may accept/reject this row — it is REQUESTED and they are a CURRENT DIRECT
    // manager of the owner (v2.32.0, with the managed view's includeIndirect widening: a
    // chain row must not render resolve buttons that would 403).
    val canResolve: Boolean,
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
 * `remaining = carriedOver + allowance + corrected - reserved - used` holds by construction ([remainingHalfDays]).
 */
@Serializable
data class DaysOffBudget(
    val userId: UInt,
    val userName: String,
    val userDeleted: Boolean,
    val year: Int,
    // Null = not configured by a chain manager (v2.32.0; ADMIN-set before) = zero paid budget.
    val allowance: Int?,
    val carriedOver: Double,
    // The year's net manager corrections in days (signed; 0 when none) — v1.43.0.
    val corrected: Double,
    // REQUESTED (pending) paid days in the year — reserved, not yet confirmed.
    val reserved: Double,
    // ACCEPTED paid days in the year.
    val used: Double,
    val remaining: Double,
    // Server-computed capability (the list rows' canCancel precedent): the caller may write
    // budget corrections for this user — i.e. is a CURRENT DIRECT manager (the resolve right).
    // False on view=own rows and on includeIndirect-only (chain) rows, whose viewer may still
    // edit the allowance (the wider chain right — its capability is the row's presence in
    // view=managed itself).
    val canCorrect: Boolean,
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
internal fun parseDaysOffDate(date: String, field: String): LocalDate = parseIsoDateStrict(date, field)

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
 * `A = min(earliest year holding a counting PAID request or a correction, year)`, the budget
 * accumulated over `A..year` is `2·allowance·(year − A + 1)` plus the signed corrections minus
 * everything used in those years. Anchoring at the earliest actual activity means the allowance
 * never phantom-accumulates over empty historical years (a user with no history simply has this
 * year's allowance). Deliberately unclamped: a retroactive allowance cut or a SUBTRACT
 * correction can push a year negative and the deficit carries forward — request creation
 * enforces `>= 0`, so a deficit only ever arises from admin/manager edits (documented).
 *
 * [usedByYear] maps year → summed half-day cost of the user's counting (REQUESTED/ACCEPTED)
 * PAID requests in that year; [correctionsByYear] maps year → the summed SIGNED half-day
 * amount of the manager corrections attributed to it (v1.43.0).
 */
internal fun remainingHalfDays(
    allowanceDays: Int?,
    year: Int,
    usedByYear: Map<Int, Int>,
    correctionsByYear: Map<Int, Int> = emptyMap(),
): Int {
    val allowanceH = 2 * (allowanceDays ?: 0)
    val earliest = (usedByYear.keys + correctionsByYear.keys).minOrNull() ?: year
    val anchor = minOf(earliest, year)
    val usedH = usedByYear.filterKeys { it in anchor..year }.values.sum()
    val correctedH = correctionsByYear.filterKeys { it in anchor..year }.values.sum()
    return allowanceH * (year - anchor + 1) + correctedH - usedH
}

/**
 * The half-day units carried into [year] from previous years: [remainingHalfDays] of `year − 1`,
 * or 0 when no counting usage or correction exists before [year] — the anchor rule again: with
 * no history the previous year contributes nothing, so a fresh user's budget is exactly the
 * allowance.
 */
internal fun carriedOverHalfDays(
    allowanceDays: Int?,
    year: Int,
    usedByYear: Map<Int, Int>,
    correctionsByYear: Map<Int, Int> = emptyMap(),
): Int {
    if ((usedByYear.keys + correctionsByYear.keys).none { it < year }) return 0
    return remainingHalfDays(allowanceDays, year - 1, usedByYear, correctionsByYear)
}

/** Formats half-day units as a days string for notification params: "3" for whole, "3.5" for halves. */
internal fun formatHalfDaysParam(halfDays: Int): String =
    if (halfDays % 2 == 0) (halfDays / 2).toString() else (halfDays / 2.0).toString()

// ── Budget corrections (v1.43.0) ────────────────────────────────────────────────────────────

@Serializable
enum class DaysOffCorrectionOperation { ADD, SUBTRACT }

const val MAX_CORRECTION_COMMENT_LENGTH = 1000
const val MAX_CANCEL_REASON_LENGTH = 1000

/**
 * Body of `POST /days-off/corrections` and (minus [userId], which is create-only and immutable)
 * `PUT /days-off/corrections/{id}`. The amount travels as a positive [days] value (0.5 steps)
 * plus the [operation]; storage is one signed half-day integer.
 */
@Serializable
data class DaysOffCorrectionWrite(
    val userId: UInt,
    val year: Int,
    val operation: DaysOffCorrectionOperation,
    val days: Double,
    val comment: String,
)

@Serializable
data class DaysOffCorrectionResponse(
    val id: UInt,
    val userId: UInt,
    // Who created the correction — display-only; edit rights follow the CURRENT direct
    // managers of the subordinate, not the author.
    val authorId: UInt,
    val authorName: String,
    val authorDeleted: Boolean,
    val year: Int,
    val operation: DaysOffCorrectionOperation,
    val days: Double,
    val comment: String,
    val createdAt: Long,
    val lastModified: Long,
)

@Serializable
data class DaysOffCorrectionList(
    val items: List<DaysOffCorrectionResponse>,
)

/** The signed half-day storage amount of a correction write. */
internal fun correctionHalfDays(write: DaysOffCorrectionWrite): Int {
    val units = (write.days * 2).toInt()
    return if (write.operation == DaysOffCorrectionOperation.ADD) units else -units
}

/**
 * Validates a correction's shape (400s): a sensible year, a positive half-day-stepped amount
 * of at most a year, and a non-blank bounded comment (the mandatory reasoning).
 */
/** Validates a cancellation's mandatory reason (400s) — the correction-comment rules. */
internal fun validateDaysOffCancel(request: DaysOffCancelRequest) {
    if (request.reason.isBlank()) throw BadRequestException("Cancellation reason must not be blank")
    if (request.reason.length > MAX_CANCEL_REASON_LENGTH) {
        throw BadRequestException("Cancellation reason must be at most $MAX_CANCEL_REASON_LENGTH characters")
    }
}

internal fun validateDaysOffCorrection(write: DaysOffCorrectionWrite) {
    if (write.year !in 2000..2100) {
        throw BadRequestException("Correction year must be between 2000 and 2100")
    }
    val units = write.days * 2
    if (!units.isFinite() || units <= 0 || units != Math.floor(units) || write.days > 365) {
        throw BadRequestException("Correction days must be a positive multiple of 0.5, at most 365")
    }
    if (write.comment.isBlank()) throw BadRequestException("Correction comment must not be blank")
    if (write.comment.length > MAX_CORRECTION_COMMENT_LENGTH) {
        throw BadRequestException("Correction comment must be at most $MAX_CORRECTION_COMMENT_LENGTH characters")
    }
}
