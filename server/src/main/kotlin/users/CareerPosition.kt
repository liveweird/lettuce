package ch.nokillswit.users

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * Body of POST/PUT on the career-position sub-resource. The refs are a FULL replace of the
 * position's triple (null = that field is unset for this position — unlike the old users PUT,
 * where null meant leave-unchanged); at least one of the three must be set. Newly-assigned
 * ids must be ACTIVE entries of the matching dictionary; a PUT resubmitting the row's current
 * (possibly since-soft-deleted) id is not a change and is never validated.
 */
@Serializable
data class CareerPositionWrite(
    val startDate: String,
    val careerPathId: UInt? = null,
    val careerSpecializationId: UInt? = null,
    val seniorityLevelId: UInt? = null,
)

@Serializable
data class CareerPositionResponse(
    val id: UInt,
    val startDate: String,
    // Derived, never stored (the start-only model): the day before the user's NEXT active
    // position starts; null = the open-ended current position.
    val endDate: String?,
    // Resolved at read time like everywhere (renames propagate; soft-deleted entries keep
    // resolving to their retained values).
    val careerPath: DictionaryEntry?,
    val careerSpecialization: DictionaryEntry?,
    val seniorityLevel: DictionaryEntry?,
    val createdAt: Long,
    val lastModified: Long,
)

/** Unpaged (a person's positions are intrinsically few) — the corrections-list shape. */
@Serializable
data class CareerPositionList(val items: List<CareerPositionResponse>)

/**
 * Validates the start date: strict zero-padded ISO `YYYY-MM-DD` (anything else would break
 * the VARCHAR column's lexicographic == chronological ordering) and not in the future —
 * `== today` is allowed. No future starts means the user's latest position is always the
 * CURRENT one, which is what the whole read model (and the SPA's emphasis) keys on.
 */
internal fun validateCareerPositionStartDate(startDate: String, today: LocalDate = LocalDate.now()) {
    val parsed = try {
        if (startDate.length != 10) throw DateTimeParseException("wrong length", startDate, 0)
        LocalDate.parse(startDate)
    } catch (_: DateTimeParseException) {
        throw BadRequestException("Position start date must be an ISO date (YYYY-MM-DD)")
    }
    if (parsed > today) throw BadRequestException("Position start date must not be in the future")
}

/** A position with no career field at all would be an empty timeline entry — reject it. */
internal fun validateCareerPositionRefs(write: CareerPositionWrite) {
    if (write.careerPathId == null && write.careerSpecializationId == null && write.seniorityLevelId == null) {
        throw BadRequestException("A position must set at least one career profile field")
    }
}

/** Shared shape rule for create and correct: valid start date plus a non-empty triple. */
internal fun validateCareerPositionWrite(write: CareerPositionWrite, today: LocalDate = LocalDate.now()) {
    validateCareerPositionStartDate(write.startDate, today)
    validateCareerPositionRefs(write)
}

/**
 * New position started (create only — corrections and deletions stay silent, the
 * days-off-corrections precedent): the user hears that a chain manager recorded a new
 * position for them. Params carry the manager's name and the ISO start date only — the
 * position's values are one click away behind the link.
 */
internal fun careerPositionStartedNotification(
    userId: UInt,
    managerName: String,
    startDate: String,
): Notification = Notification(
    recipientId = userId,
    type = NotificationType.CAREER_POSITION_STARTED_TO_USER,
    params = mapOf("manager" to managerName, "startDate" to startDate),
    link = "/users/$userId/career",
)
