package ch.nokillswit.reviews

import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable
import java.time.YearMonth
import java.time.format.DateTimeParseException

/**
 * A review period: one entry of the global, ADMIN-curated timeline that performance reviews
 * attach to. Month bounds are inclusive ISO `YYYY-MM` strings (lexicographic == chronological —
 * the VARCHAR ISO idiom one level up from the date columns). The timeline is append-only and
 * gapless: see [ReviewPeriodService.create]/[ReviewPeriodService.delete] for the rules.
 */
@Serializable
data class ReviewPeriod(
    val id: UInt,
    val startMonth: String,
    val endMonth: String,
)

/** The unpaged registry read — the dictionaries/alerts-visible shape (intrinsically small). */
@Serializable
data class ReviewPeriodList(
    val items: List<ReviewPeriod>,
)

@Serializable
data class ReviewPeriodCreateRequest(
    val startMonth: String,
    val endMonth: String,
)

/**
 * Parses a strict zero-padded ISO `YYYY-MM` month (anything else would break the VARCHAR
 * column's lexicographic == chronological ordering) or throws [BadRequestException] (→ 400).
 */
internal fun parseReviewMonth(month: String, field: String): YearMonth = try {
    if (month.length != 7) throw DateTimeParseException("wrong length", month, 0)
    YearMonth.parse(month)
} catch (_: DateTimeParseException) {
    throw BadRequestException("$field must be an ISO month (YYYY-MM)")
}

/** Validates a period's shape: both months strict ISO, start not after end. Adjacency to the
 * existing timeline is a state rule checked in [ReviewPeriodService.create]. */
internal fun validateReviewPeriod(request: ReviewPeriodCreateRequest) {
    val start = parseReviewMonth(request.startMonth, "startMonth")
    val end = parseReviewMonth(request.endMonth, "endMonth")
    if (start > end) throw BadRequestException("startMonth must not be after endMonth")
}

/** The month right after [month] as a `YYYY-MM` string — the required start of the next period. */
internal fun monthAfter(month: String): String = YearMonth.parse(month).plusMonths(1).toString()
