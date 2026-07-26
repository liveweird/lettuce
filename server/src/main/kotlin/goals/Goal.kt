package ch.nokillswit.goals

import ch.nokillswit.infra.paging.PageResponse
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable

@Serializable
enum class GoalType { BINARY, NUMBER, PERCENTAGE }

@Serializable
enum class GoalStatus { DRAFT, ACTIVE, CLOSED }

const val MAX_GOAL_TITLE_LENGTH = 200
const val MAX_GOAL_TEXT_LENGTH = 4000

/**
 * Body of `POST /goals` — the manager comes from the JWT and the status is always DRAFT, so
 * neither is settable here. Value fields are type-specific: [targetValue] is required for
 * NUMBER/PERCENTAGE and must be absent for BINARY (see [validateGoalDefinition]); the current
 * value starts at its type's zero (`0.0` / not achieved) and is only editable once ACTIVE.
 */
@Serializable
data class GoalCreateRequest(
    val subordinateId: UInt,
    val title: String,
    val description: String = "",
    val type: GoalType,
    val targetValue: Double? = null,
)

/**
 * Body of `PUT /goals/{id}` — the editable representation of a DRAFT goal (title, description,
 * type, target). Parties, status, and the value/summary fields are NOT settable here: status
 * moves through the `POST /goals/{id}/{action}` endpoints, the current value through
 * `PUT /goals/{id}/progress`, and the summary through the close action.
 */
@Serializable
data class GoalDefinitionUpdate(
    val title: String,
    val description: String = "",
    val type: GoalType,
    val targetValue: Double? = null,
)

/**
 * Body of `PUT /goals/{id}/progress` — the only edit an ACTIVE goal accepts. Exactly the field
 * matching the goal's type must be set: [achieved] for BINARY, [currentValue] for
 * NUMBER/PERCENTAGE (see [validateGoalProgress]).
 */
@Serializable
data class GoalProgressUpdate(
    val currentValue: Double? = null,
    val achieved: Boolean? = null,
)

/** Body of `POST /goals/{id}/close` — closing always records a non-blank summary. */
@Serializable
data class GoalCloseRequest(
    val summary: String,
)

@Serializable
data class GoalResponse(
    val id: UInt,
    val managerId: UInt,
    val subordinateId: UInt,
    val createdAt: Long,
    val title: String,
    val description: String,
    val type: GoalType,
    val targetValue: Double?,
    val currentValue: Double?,
    val achieved: Boolean?,
    val status: GoalStatus,
    // Non-null once the goal has been closed at least once (kept on reopen, overwritten at the
    // next close).
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
    val achieved: Boolean?,
    val status: GoalStatus,
    val createdAt: Long,
    val lastModified: Long,
)

typealias GoalPageResponse = PageResponse<GoalListItem>

@Serializable
data class GoalEvent(
    val goalId: UInt,
    val userId: UInt,
    val type: GoalEventType,
    val params: Map<String, String> = emptyMap(),
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
)

@Serializable
data class GoalEventListResponse(
    val items: List<GoalEventResponse>,
)

/**
 * Validates a goal's definition fields (create and DRAFT edit): title/description bounds plus the
 * type-specific target rule — BINARY carries no target (its progress is the [GoalResponse.achieved]
 * flag), NUMBER requires a finite target, PERCENTAGE a target within 0–100.
 */
internal fun validateGoalDefinition(title: String, description: String, type: GoalType, targetValue: Double?) {
    if (title.isBlank()) throw BadRequestException("Goal title must not be blank")
    if (title.length > MAX_GOAL_TITLE_LENGTH) {
        throw BadRequestException("Goal title must be at most $MAX_GOAL_TITLE_LENGTH characters")
    }
    if (description.length > MAX_GOAL_TEXT_LENGTH) {
        throw BadRequestException("Goal description must be at most $MAX_GOAL_TEXT_LENGTH characters")
    }
    when (type) {
        GoalType.BINARY ->
            if (targetValue != null) throw BadRequestException("A BINARY goal must not have a target value")
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
}

/**
 * Validates a progress update against the goal's type: exactly the matching value field must be
 * set — [GoalProgressUpdate.achieved] for BINARY, [GoalProgressUpdate.currentValue] for
 * NUMBER/PERCENTAGE (0–100 for PERCENTAGE).
 */
/**
 * Validates the close action's summary: required non-blank, bounded like the description. The
 * single home of the rule — the service trusts the route to have run it (see transitionTo).
 */
internal fun validateGoalSummary(summary: String?) {
    if (summary.isNullOrBlank()) throw BadRequestException("Closing a goal requires a non-blank summary")
    if (summary.length > MAX_GOAL_TEXT_LENGTH) {
        throw BadRequestException("Goal summary must be at most $MAX_GOAL_TEXT_LENGTH characters")
    }
}

internal fun validateGoalProgress(type: GoalType, update: GoalProgressUpdate) {
    when (type) {
        GoalType.BINARY -> {
            if (update.currentValue != null) {
                throw BadRequestException("A BINARY goal tracks progress via 'achieved', not 'currentValue'")
            }
            if (update.achieved == null) throw BadRequestException("A BINARY goal progress update requires 'achieved'")
        }
        GoalType.NUMBER, GoalType.PERCENTAGE -> {
            if (update.achieved != null) {
                throw BadRequestException("Only a BINARY goal tracks progress via 'achieved'")
            }
            val value = update.currentValue
                ?: throw BadRequestException("A ${type.name} goal progress update requires 'currentValue'")
            if (!value.isFinite()) throw BadRequestException("Current value must be a finite number")
            if (type == GoalType.PERCENTAGE && value !in 0.0..100.0) {
                throw BadRequestException("A PERCENTAGE current value must be between 0 and 100")
            }
        }
    }
}
