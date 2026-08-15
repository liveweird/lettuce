package ch.nokillswit.users

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * Body of POST/PUT on the career-position sub-resource. ALL THREE refs are required
 * (v2.15.1 — a position IS the full triple; the fields are nullable here only so the route
 * can answer a clean 400 instead of a decode error, and so legacy partial rows can still be
 * read). Newly-assigned ids must be ACTIVE entries of the matching dictionary; a PUT
 * resubmitting the row's current (possibly since-soft-deleted) id is not a change and is
 * never validated — so correcting a legacy partial row just means completing the triple.
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
 * One subordinate in the caller's team pyramid (v2.16.0): the CURRENT position's resolved
 * triple plus the two tenure anchors — the current position's start ("tenure at level"
 * counts from here; any recorded position change resets it, a deliberate product decision)
 * and the FIRST recorded position's start (tenure in the organization AS RECORDED — V57
 * seeded no history, so this is not necessarily the true hire date). All career fields are
 * null for a subordinate with no recorded positions — such rows are deliberately included
 * so the manager sees who still needs one.
 */
@Serializable
data class CareerPyramidItem(
    val userId: UInt,
    val name: String,
    val careerPath: DictionaryEntry?,
    val careerSpecialization: DictionaryEntry?,
    val seniorityLevel: DictionaryEntry?,
    val currentPositionStart: String?,
    val organizationSince: String?,
)

/** Unpaged (bounded by the caller's subordinate count) — the CareerPositionList shape. */
@Serializable
data class CareerPyramidList(val items: List<CareerPyramidItem>)

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

/** A position IS the full triple (v2.15.1) — every field is required on create and correct. */
internal fun validateCareerPositionRefs(write: CareerPositionWrite) {
    if (write.careerPathId == null || write.careerSpecializationId == null || write.seniorityLevelId == null) {
        throw BadRequestException("A position must set all three career profile fields")
    }
}

/** Shared shape rule for create and correct: valid start date plus the complete triple. */
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
