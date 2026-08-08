package ch.nokillswit.pulse

import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable
import java.time.LocalDate
import java.time.format.DateTimeParseException

/**
 * The pulse-cycle status machine: SCHEDULED -> OPEN -> CLOSED, with terminal CANCELLED
 * reachable from ANY of the three (cancelling a CLOSED cycle retracts its results; stored
 * responses are kept for audit). Every transition is a manual ADMIN action — the planned
 * dates are advisory prefills, never acted on by the server (the app has no background jobs).
 */
@Serializable
enum class PulseCycleStatus { SCHEDULED, OPEN, CLOSED, CANCELLED }

/**
 * A cycle as served by the API. [rotatingQuestion] is visibility-controlled by the route:
 * ADMIN sees it at every status; everyone else only once the cycle is OPEN or CLOSED (an
 * unopened cycle's question stays unspoiled, and a cancelled cycle reveals nothing).
 * [participantCount]/[responseCount] are ADMIN-only enrichment (null for everyone else) —
 * the cycle-management table's counts; per-team numbers live in the results/participation
 * endpoints under their own rules.
 */
@Serializable
data class PulseCycleResponse(
    val id: UInt,
    val status: PulseCycleStatus,
    val plannedOpenDate: String,
    val plannedCloseDate: String,
    val rotatingQuestion: String? = null,
    val createdAt: Long,
    val openedAt: Long? = null,
    val closedAt: Long? = null,
    val cancelledAt: Long? = null,
    val lastModified: Long,
    val participantCount: Int? = null,
    val responseCount: Int? = null,
)

@Serializable
data class PulseCycleList(val items: List<PulseCycleResponse>)

@Serializable
data class PulseCycleCreateRequest(
    val plannedOpenDate: String,
    val plannedCloseDate: String,
)

/**
 * Date edit: while SCHEDULED both dates may change; while OPEN only the close date may
 * ("extend") — the open date is already history. Both fields are required (full-document
 * semantics for a two-field resource); an OPEN cycle's payload must carry the unchanged
 * open date back.
 */
@Serializable
data class PulseCycleUpdateRequest(
    val plannedOpenDate: String,
    val plannedCloseDate: String,
)

/** The service's row view — full fields, no visibility rules (those are the route's job). */
data class PulseCycleRow(
    val id: UInt,
    val status: PulseCycleStatus,
    val plannedOpenDate: String,
    val plannedCloseDate: String,
    val rotatingQuestionEntryId: UInt,
    val rotatingQuestionText: String,
    val createdAt: Long,
    val openedAt: Long?,
    val closedAt: Long?,
    val cancelledAt: Long?,
    val lastModified: Long,
)

private fun parseIsoDate(value: String, field: String): LocalDate =
    try {
        LocalDate.parse(value)
    } catch (e: DateTimeParseException) {
        throw BadRequestException("$field must be an ISO date (YYYY-MM-DD)")
    }

/** Shape rules only (strict zero-padded ISO, close strictly after open); state rules live in the service. */
fun validatePulseCycleDates(plannedOpenDate: String, plannedCloseDate: String) {
    val open = parseIsoDate(plannedOpenDate, "plannedOpenDate")
    val close = parseIsoDate(plannedCloseDate, "plannedCloseDate")
    if (!close.isAfter(open)) {
        throw BadRequestException("plannedCloseDate must be after plannedOpenDate")
    }
}
