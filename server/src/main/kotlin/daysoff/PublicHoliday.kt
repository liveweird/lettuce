package ch.nokillswit.daysoff

import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable

const val MAX_PUBLIC_HOLIDAY_NAME_LENGTH = 100

/**
 * One entry of the global, ADMIN-curated public-holiday registry: on this date everyone is off
 * and no paid budget is deducted. Days-off request costs are FROZEN at creation, so editing the
 * registry never reprices existing requests (see V39/V40).
 */
@Serializable
data class PublicHolidayItem(
    val id: UInt,
    val date: String,
    val name: String,
)

/** The unpaged registry read — the review-periods/dictionaries shape (intrinsically small). */
@Serializable
data class PublicHolidayList(
    val items: List<PublicHolidayItem>,
)

@Serializable
data class PublicHolidayCreateRequest(
    val date: String,
    val name: String,
)

/** Validates a holiday's shape: strict ISO date, non-blank bounded name. Uniqueness of the date
 * is the DB's `UNIQUE (holiday_date)` (23505 → the central 409 mapping — no pre-check by design). */
internal fun validatePublicHoliday(request: PublicHolidayCreateRequest) {
    parseDaysOffDate(request.date, "date")
    if (request.name.isBlank()) throw BadRequestException("Holiday name must not be blank")
    if (request.name.length > MAX_PUBLIC_HOLIDAY_NAME_LENGTH) {
        throw BadRequestException("Holiday name must be at most $MAX_PUBLIC_HOLIDAY_NAME_LENGTH characters")
    }
}
