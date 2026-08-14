package ch.nokillswit.goals

import ch.nokillswit.infra.paging.PageResponse
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.format.DateTimeParseException

@Serializable
enum class GoalType { PLAN, NUMBER, PERCENTAGE }

@Serializable
enum class GoalStatus { DRAFT, ACTIVE, ARCHIVED }

const val MAX_GOAL_TITLE_LENGTH = 200
const val MAX_GOAL_TEXT_LENGTH = 4000
const val MAX_GOAL_MILESTONES = 100

/**
 * One milestone of a PLAN goal's definition (create and DRAFT edit): an [id] identifies an
 * existing row to keep (its done flag is preserved server-side — defining is not ticking);
 * an id-less entry is a new milestone, starting not-done. Payload order IS the order (the 1:1
 * items convention — positions never travel over the wire).
 */
@Serializable
data class GoalMilestoneInput(
    val id: UInt? = null,
    val description: String,
)

/**
 * One milestone's done state in a progress update. The update carries the COMPLETE list — one
 * entry per existing milestone, ids matching exactly (see GoalService.updateProgress).
 */
@Serializable
data class GoalMilestoneDone(
    val id: UInt,
    val done: Boolean,
)

@Serializable
data class GoalMilestoneResponse(
    val id: UInt,
    val description: String,
    val done: Boolean,
)

/**
 * Body of `POST /goals` — the manager comes from the JWT and the status is always DRAFT, so
 * neither is settable here. Value fields are type-specific: [targetValue] is required for
 * NUMBER/PERCENTAGE and must be absent for PLAN, whose [milestones] (id-less here — a create
 * carries no existing rows) are its whole progress model (see [validateGoalDefinition]); the
 * current value stays unrecorded (null / no milestone done) until the goal is ACTIVE.
 */
@Serializable
data class GoalCreateRequest(
    val subordinateId: UInt,
    val title: String,
    val description: String = "",
    val type: GoalType,
    val targetValue: Double? = null,
    val milestones: List<GoalMilestoneInput> = emptyList(),
    val dueDate: String,
)

/**
 * Body of `PUT /goals/{id}` — the editable representation of a DRAFT goal (title, description,
 * type, target, milestones for PLAN). [milestones] is a whole-list replace (the 1:1 items
 * pattern): id-matched rows are kept/edited with their done flags preserved, missing rows are
 * removed, id-less rows added. Parties, status, and the value/summary fields are NOT settable
 * here: status moves through the `POST /goals/{id}/{action}` endpoints, the current value and
 * milestone done flags through `PUT /goals/{id}/progress`, and the summary through the archive
 * action.
 */
@Serializable
data class GoalDefinitionUpdate(
    val title: String,
    val description: String = "",
    val type: GoalType,
    val targetValue: Double? = null,
    val milestones: List<GoalMilestoneInput> = emptyList(),
    val dueDate: String,
)

/**
 * Body of `PUT /goals/{id}/progress` — the only edit an ACTIVE goal accepts, open to BOTH
 * parties (manager and subordinate) since v2.8.0. Only the field matching the goal's type may
 * be set — [milestones] (the complete done-state, ids matching the goal's milestones exactly)
 * for PLAN, [currentValue] for NUMBER/PERCENTAGE — and it is optional (v2.8.1): absent leaves
 * the state untouched, but then [comment] must be non-blank (see [validateGoalProgress]).
 * [comment] is optional context for the update, recorded (encrypted) on the history event;
 * blank counts as absent.
 */
@Serializable
data class GoalProgressUpdate(
    val currentValue: Double? = null,
    val milestones: List<GoalMilestoneDone>? = null,
    val comment: String? = null,
)

/** Body of `POST /goals/{id}/archive` — archiving always records a non-blank summary. */
@Serializable
data class GoalArchiveRequest(
    val summary: String,
)

@Serializable
data class GoalResponse(
    val id: UInt,
    val managerId: UInt,
    val subordinateId: UInt,
    val createdAt: Long,
    // ISO YYYY-MM-DD; never earlier than its save day, editable only while DRAFT.
    val dueDate: String,
    val title: String,
    val description: String,
    val type: GoalType,
    val targetValue: Double?,
    val currentValue: Double?,
    // PLAN only (stored order; empty for the numeric types) — the goal's whole progress model.
    val milestones: List<GoalMilestoneResponse>,
    val status: GoalStatus,
    // Non-null once the goal has been closed at least once (kept on reopen, overwritten at the
    // next archiving).
    val summary: String?,
    val lastModified: Long,
    // Resolved party display names.
    val managerName: String,
    val subordinateName: String,
)

@Serializable
data class GoalListItem(
    val id: UInt,
    val managerId: UInt,
    val managerName: String,
    val managerDeleted: Boolean,
    val subordinateId: UInt,
    val subordinateName: String,
    val subordinateDeleted: Boolean,
    val title: String,
    val type: GoalType,
    val targetValue: Double?,
    val currentValue: Double?,
    // PLAN only (null for the numeric types): the row's milestone tally — descriptions never
    // ride list rows (they are encrypted; the tally is content-free).
    val milestonesDone: Int?,
    val milestonesTotal: Int?,
    val status: GoalStatus,
    val createdAt: Long,
    val dueDate: String,
    val lastModified: Long,
)

typealias GoalPageResponse = PageResponse<GoalListItem>

@Serializable
data class GoalEvent(
    val goalId: UInt,
    val userId: UInt,
    val type: GoalEventType,
    val params: Map<String, String> = emptyMap(),
    // Optional progress-update context (plaintext here; GoalEventService encrypts at rest).
    val comment: String? = null,
)

@Serializable
data class GoalEventResponse(
    val id: UInt,
    val goalId: UInt,
    val userId: UInt,
    val userName: String,
    val timestamp: Long,
    val type: GoalEventType,
    val params: Map<String, String> = emptyMap(),
    // The progress update's optional comment (decrypted); null on every other event kind.
    val comment: String? = null,
)

@Serializable
data class GoalEventListResponse(
    val items: List<GoalEventResponse>,
)

/**
 * Validates a goal's definition fields (create and DRAFT edit): title/description bounds plus the
 * type-specific rules — PLAN carries no target (its progress model is its [milestones]: each
 * description non-blank within the shared text bound, at most [MAX_GOAL_MILESTONES] of them,
 * and none at all for the numeric types), NUMBER requires a finite target, PERCENTAGE a target
 * within 0–100 — plus the due-date rule (see [validateGoalDueDate]). With [newMilestonesOnly]
 * (create) the payload must not reference existing milestone rows (the 1:1 forbid-ids rule).
 */
internal fun validateGoalDefinition(
    title: String,
    description: String,
    type: GoalType,
    targetValue: Double?,
    milestones: List<GoalMilestoneInput>,
    dueDate: String,
    newMilestonesOnly: Boolean = false,
    today: LocalDate = LocalDate.now(),
) {
    if (title.isBlank()) throw BadRequestException("Goal title must not be blank")
    if (title.length > MAX_GOAL_TITLE_LENGTH) {
        throw BadRequestException("Goal title must be at most $MAX_GOAL_TITLE_LENGTH characters")
    }
    if (description.length > MAX_GOAL_TEXT_LENGTH) {
        throw BadRequestException("Goal description must be at most $MAX_GOAL_TEXT_LENGTH characters")
    }
    when (type) {
        GoalType.PLAN -> {
            if (targetValue != null) throw BadRequestException("A PLAN goal must not have a target value")
            if (milestones.size > MAX_GOAL_MILESTONES) {
                throw BadRequestException("A PLAN goal may have at most $MAX_GOAL_MILESTONES milestones")
            }
            milestones.forEach { milestone ->
                if (milestone.description.isBlank()) {
                    throw BadRequestException("A milestone description must not be blank")
                }
                if (milestone.description.length > MAX_GOAL_TEXT_LENGTH) {
                    throw BadRequestException("A milestone description must be at most $MAX_GOAL_TEXT_LENGTH characters")
                }
            }
            if (newMilestonesOnly && milestones.any { it.id != null }) {
                throw BadRequestException("Milestones of a new goal must not carry ids")
            }
        }
        GoalType.NUMBER -> {
            if (targetValue == null) throw BadRequestException("A NUMBER goal requires a target value")
            if (!targetValue.isFinite()) throw BadRequestException("Target value must be a finite number")
        }
        GoalType.PERCENTAGE -> {
            if (targetValue == null) throw BadRequestException("A PERCENTAGE goal requires a target value")
            if (!targetValue.isFinite() || targetValue !in 0.0..100.0) {
                throw BadRequestException("A PERCENTAGE target value must be between 0 and 100")
            }
        }
    }
    if (type != GoalType.PLAN && milestones.isNotEmpty()) {
        throw BadRequestException("Only a PLAN goal has milestones")
    }
    validateGoalDueDate(dueDate, today)
}

/**
 * Validates the due date: strict zero-padded ISO `YYYY-MM-DD` (anything else would break the
 * VARCHAR column's lexicographic == chronological ordering) and not earlier than [today]
 * (`== today` is allowed). Runs on every definition save and again on the DRAFT→ACTIVE
 * transition (the route calls it directly — a stale draft must pick a fresh date to activate).
 */
internal fun validateGoalDueDate(dueDate: String, today: LocalDate = LocalDate.now()) {
    val parsed = try {
        if (dueDate.length != 10) throw DateTimeParseException("wrong length", dueDate, 0)
        LocalDate.parse(dueDate)
    } catch (_: DateTimeParseException) {
        throw BadRequestException("Goal due date must be an ISO date (YYYY-MM-DD)")
    }
    if (parsed < today) throw BadRequestException("Goal due date must not be in the past")
}

/**
 * Validates the archive action's summary: required non-blank, bounded like the description. The
 * single home of the rule — the service trusts the route to have run it (see transitionTo).
 */
internal fun validateGoalSummary(summary: String?) {
    if (summary.isNullOrBlank()) throw BadRequestException("Closing a goal requires a non-blank summary")
    if (summary.length > MAX_GOAL_TEXT_LENGTH) {
        throw BadRequestException("Goal summary must be at most $MAX_GOAL_TEXT_LENGTH characters")
    }
}

/**
 * Validates a progress update against the goal's type: only the matching field may be set —
 * [GoalProgressUpdate.milestones] for PLAN (the id-set match against the stored milestones
 * happens in the service, atomically with the write), [GoalProgressUpdate.currentValue] for
 * NUMBER/PERCENTAGE (0–100 for PERCENTAGE) — and it is OPTIONAL (v2.8.1: absent = leave the
 * state untouched), but a state-less update must carry a non-blank comment (else there is
 * nothing to record). The comment stays within the shared text bound.
 */
internal fun validateGoalProgress(type: GoalType, update: GoalProgressUpdate) {
    if ((update.comment?.length ?: 0) > MAX_GOAL_TEXT_LENGTH) {
        throw BadRequestException("Goal progress comment must be at most $MAX_GOAL_TEXT_LENGTH characters")
    }
    val hasValue = when (type) {
        GoalType.PLAN -> {
            if (update.currentValue != null) {
                throw BadRequestException("A PLAN goal tracks progress via 'milestones', not 'currentValue'")
            }
            update.milestones != null
        }
        GoalType.NUMBER, GoalType.PERCENTAGE -> {
            if (update.milestones != null) {
                throw BadRequestException("Only a PLAN goal tracks progress via 'milestones'")
            }
            val value = update.currentValue
            if (value != null) {
                if (!value.isFinite()) throw BadRequestException("Current value must be a finite number")
                if (type == GoalType.PERCENTAGE && value !in 0.0..100.0) {
                    throw BadRequestException("A PERCENTAGE current value must be between 0 and 100")
                }
            }
            value != null
        }
    }
    if (!hasValue && update.comment.isNullOrBlank()) {
        throw BadRequestException("A progress update requires a value or a comment")
    }
}
