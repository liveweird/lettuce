package ch.nokillswit.users

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.infra.parseIsoDateStrict
import ch.nokillswit.notifications.Notification
import ch.nokillswit.notifications.NotificationType
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import kotlinx.serialization.Serializable

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
    // Derived (the start-only model): the day before the user's NEXT active position starts —
    // EXCEPT the final row, which since V58 may carry the stored deactivation end date.
    // null = the open-ended current position.
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
 * One position in a pyramid item's history (v2.17.0): the resolved triple plus the interval.
 * [endDate] follows the CareerPositionResponse rule — derived from the next position's start,
 * or the stored deactivation end on the final row; null = open-ended.
 */
@Serializable
data class CareerPyramidPosition(
    val startDate: String,
    val endDate: String?,
    val careerPath: DictionaryEntry?,
    val careerSpecialization: DictionaryEntry?,
    val seniorityLevel: DictionaryEntry?,
)

/**
 * One subordinate in the caller's team pyramid — since v2.17.0 the FULL chronological
 * position history (the SPA's time slider computes the as-of position client-side; "tenure
 * at level" anchors on the as-of position's start, organization tenure on the first
 * position's start — AS RECORDED, V57 seeded no history). [positions] is empty for a
 * subordinate with no recorded positions — such entries are deliberately included so the
 * manager sees who still needs one, EXCEPT client-side when the person is [deactivated]:
 * the SPA lists a person only while they actively held a position at the slider date.
 */
@Serializable
data class CareerPyramidItem(
    val userId: UInt,
    val name: String,
    val deactivated: Boolean,
    val positions: List<CareerPyramidPosition>,
)

/** Unpaged (bounded by the caller's subordinate count) — the CareerPositionList shape. */
@Serializable
data class CareerPyramidList(
    val items: List<CareerPyramidItem>,
    /** Earliest start of ANY active position org-wide — the time slider's lower bound;
     *  null = none recorded anywhere. */
    val earliestStartDate: String?,
)

/**
 * Validates the start date: strict zero-padded ISO `YYYY-MM-DD` (anything else would break
 * the VARCHAR column's lexicographic == chronological ordering) and not in the future —
 * `== today` is allowed, **plus one day of timezone tolerance** (v2.26.1: the SPA submits the
 * BROWSER-local date while the server runs UTC, so a user ahead of UTC legitimately sends
 * "tomorrow" between local and UTC midnight). No future starts means the user's latest
 * position is always the CURRENT one, which is what the whole read model (and the SPA's
 * emphasis) keys on — the one-day slack narrows that only briefly (the pyramid's as-of view
 * may show the person positionless for at most that day, self-healing at UTC midnight).
 */
internal fun validateCareerPositionStartDate(startDate: String, today: LocalDate = LocalDate.now()) {
    val parsed = parseIsoDateStrict(startDate, "Position start date")
    if (parsed > today.plusDays(1)) throw BadRequestException("Position start date must not be in the future")
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
