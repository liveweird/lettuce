package ch.nokillswit.teamkpis

import ch.nokillswit.infra.paging.PageResponse
import io.ktor.server.plugins.BadRequestException
import java.time.LocalDate
import java.time.format.DateTimeParseException
import kotlinx.serialization.Serializable

// No BINARY on purpose: a team KPI is always a measured value, so target/current are non-null
// and there is no `achieved` flag (the goals machinery it drops).
@Serializable
enum class TeamKpiType { NUMBER, PERCENTAGE }

// DRAFT <-> ACTIVE <-> ARCHIVED — the goals machine with the terminal state renamed (a KPI is
// archived, not closed). Distinct strings from GoalStatus, so the SPA has its own status badge.
@Serializable
enum class TeamKpiStatus { DRAFT, ACTIVE, ARCHIVED }

const val MAX_TEAM_KPI_TITLE_LENGTH = 200
const val MAX_TEAM_KPI_TEXT_LENGTH = 4000

/**
 * Body of `POST /team-kpis` — the status is always DRAFT, so it is not settable here. The caller
 * must be [teamId]'s current manager (route-checked); [targetValue] stays nullable in the request
 * so a missing target is a validated 400, not a deserialization error (see
 * [validateTeamKpiDefinition]). Data points are only recordable once ACTIVE.
 */
@Serializable
data class TeamKpiCreateRequest(
    val teamId: UInt,
    val title: String,
    val description: String = "",
    val type: TeamKpiType,
    val targetValue: Double? = null,
)

/**
 * Body of `PUT /team-kpis/{id}` — the editable representation of a DRAFT KPI (title, description,
 * type, target). The team, status, and the value/summary fields are NOT settable here: status
 * moves through the `POST /team-kpis/{id}/{action}` endpoints, the data points through the
 * `…/{id}/values` sub-resource, and the summary through the archive action.
 */
@Serializable
data class TeamKpiDefinitionUpdate(
    val title: String,
    val description: String = "",
    val type: TeamKpiType,
    val targetValue: Double? = null,
)

/**
 * Body of `POST /team-kpis/{id}/values` and `PUT /team-kpis/{id}/values/{valueId}` — one data
 * point. [date] is the user-supplied date the value was measured (ISO `YYYY-MM-DD`, today or
 * earlier — never the future); both fields stay nullable in the request so a missing one is a
 * validated 400, not a deserialization error (see [validateTeamKpiValue]). At most one value per
 * date per KPI — a duplicate date is a 409 (unique constraint).
 */
@Serializable
data class TeamKpiValueWrite(
    val date: String? = null,
    val value: Double? = null,
)

/** One collected data point of a team KPI. */
@Serializable
data class TeamKpiValueResponse(
    val id: UInt,
    val date: String,
    val value: Double,
)

@Serializable
data class TeamKpiValueListResponse(
    val items: List<TeamKpiValueResponse>,
)

/** Body of `POST /team-kpis/{id}/archive` — archiving always records a non-blank summary. */
@Serializable
data class TeamKpiArchiveRequest(
    val summary: String,
)

@Serializable
data class TeamKpiResponse(
    val id: UInt,
    val teamId: UInt,
    // Resolved team display fields; a soft-deleted team keeps its KPIs readable as history for
    // whoever teams.manager_id still names, flagged via teamDeleted.
    val teamName: String,
    val teamDeleted: Boolean,
    // The team's CURRENT manager, resolved from teams.manager_id at read time — never stored on
    // the row. Write access and the SPA's edit affordances key on it.
    val managerId: UInt,
    val managerName: String,
    val createdAt: Long,
    val title: String,
    val description: String,
    val type: TeamKpiType,
    val targetValue: Double,
    // Denormalized from the data points: the max-dated value (0.0 when there are none) and its
    // date (null when there are none) — recomputed inside every values-mutation transaction.
    val currentValue: Double,
    val currentValueDate: String?,
    val status: TeamKpiStatus,
    // Non-null once the KPI has been archived at least once (kept on reopen, overwritten at the
    // next archive).
    val summary: String?,
    val lastModified: Long,
)

@Serializable
data class TeamKpiListItem(
    val id: UInt,
    val teamId: UInt,
    val teamName: String,
    val teamDeleted: Boolean,
    val managerId: UInt,
    val managerName: String,
    val managerDeleted: Boolean,
    val title: String,
    val type: TeamKpiType,
    val targetValue: Double,
    val currentValue: Double,
    val status: TeamKpiStatus,
    val createdAt: Long,
    val lastModified: Long,
)

typealias TeamKpiPageResponse = PageResponse<TeamKpiListItem>

@Serializable
data class TeamKpiEvent(
    val kpiId: UInt,
    val userId: UInt,
    val type: TeamKpiEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class TeamKpiEventResponse(
    val id: UInt,
    val kpiId: UInt,
    val userId: UInt,
    val userName: String,
    val timestamp: Long,
    val type: TeamKpiEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class TeamKpiEventListResponse(
    val items: List<TeamKpiEventResponse>,
)

/**
 * Validates a KPI's definition fields (create and DRAFT edit): title/description bounds plus the
 * type-specific target rule — a finite target is always required (there is no BINARY), and a
 * PERCENTAGE target must be within 0–100.
 */
internal fun validateTeamKpiDefinition(
    title: String,
    description: String,
    type: TeamKpiType,
    targetValue: Double?,
) {
    if (title.isBlank()) throw BadRequestException("Team KPI title must not be blank")
    if (title.length > MAX_TEAM_KPI_TITLE_LENGTH) {
        throw BadRequestException("Team KPI title must be at most $MAX_TEAM_KPI_TITLE_LENGTH characters")
    }
    if (description.length > MAX_TEAM_KPI_TEXT_LENGTH) {
        throw BadRequestException("Team KPI description must be at most $MAX_TEAM_KPI_TEXT_LENGTH characters")
    }
    if (targetValue == null) throw BadRequestException("A team KPI requires a target value")
    if (!targetValue.isFinite()) throw BadRequestException("Target value must be a finite number")
    if (type == TeamKpiType.PERCENTAGE && targetValue !in 0.0..100.0) {
        throw BadRequestException("A PERCENTAGE target value must be between 0 and 100")
    }
}

/**
 * Validates a data point (add and correct): [TeamKpiValueWrite.value] is always required (there is
 * no BINARY flavor), finite, and 0–100 for a PERCENTAGE KPI; [TeamKpiValueWrite.date] is
 * required, strict zero-padded ISO `YYYY-MM-DD` (anything else would break the VARCHAR column's
 * lexicographic == chronological ordering), and not after [today] (`== today` is allowed — the
 * value was measured then, so it can never be in the future). [today] is injectable for tests,
 * the validateGoalDueDate idiom.
 */
internal fun validateTeamKpiValue(
    type: TeamKpiType,
    write: TeamKpiValueWrite,
    today: LocalDate = LocalDate.now(),
) {
    val value = write.value
        ?: throw BadRequestException("A team KPI data point requires 'value'")
    if (!value.isFinite()) throw BadRequestException("Value must be a finite number")
    if (type == TeamKpiType.PERCENTAGE && value !in 0.0..100.0) {
        throw BadRequestException("A PERCENTAGE value must be between 0 and 100")
    }
    val date = write.date
        ?: throw BadRequestException("A team KPI data point requires 'date'")
    val parsed = try {
        if (date.length != 10) throw DateTimeParseException("wrong length", date, 0)
        LocalDate.parse(date)
    } catch (_: DateTimeParseException) {
        throw BadRequestException("Data point date must be an ISO date (YYYY-MM-DD)")
    }
    if (parsed > today) throw BadRequestException("Data point date must not be in the future")
}

/**
 * Validates the archive action's summary: required non-blank, bounded like the description. The
 * single home of the rule — the service trusts the route to have run it (see transitionTo).
 */
internal fun validateTeamKpiSummary(summary: String?) {
    if (summary.isNullOrBlank()) throw BadRequestException("Archiving a team KPI requires a non-blank summary")
    if (summary.length > MAX_TEAM_KPI_TEXT_LENGTH) {
        throw BadRequestException("Team KPI summary must be at most $MAX_TEAM_KPI_TEXT_LENGTH characters")
    }
}
