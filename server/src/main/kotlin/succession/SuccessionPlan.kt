package ch.nokillswit.succession

import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.goals.GoalType
import ch.nokillswit.infra.paging.PageResponse
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable

// Bounds shared by the two ordered short-text lists (loss impact / competency gaps).
const val MAX_SUCCESSION_LIST_ITEMS = 20
const val MAX_SUCCESSION_ITEM_LENGTH = 200
const val MAX_SUCCESSION_GOAL_LINKS = 100
const val MIN_BENCH_DEPTH = 1
const val MAX_BENCH_DEPTH = 10
const val DEFAULT_BENCH_DEPTH = 2

/** How critical the seat is to the organization — a planning label, no behavior attached. */
enum class RoleCriticality { CRITICAL, CORE, STANDARD }

/** How likely the seat's person is to leave — a planning label, no behavior attached. */
enum class RetentionRisk { HIGH, MEDIUM, LOW }

/** OPEN is the working state; CLOSED is terminal and read-only (delete stays available). */
enum class SuccessionPlanStatus { OPEN, CLOSED }

/** The candidate's readiness window for taking the seat over. */
enum class SuccessorReadiness { READY_NOW, READY_SOON, FUTURE_PIPELINE, EMERGENCY_INTERIM }

/** PRIMARY/SECONDARY successors from the seat's own orbit, CROSS_TEAM for lateral candidates. */
enum class NominationType { PRIMARY, SECONDARY, CROSS_TEAM }

/**
 * Whether the candidate knows about the nomination — pure metadata for the planning manager:
 * whatever the value, the candidate is never notified and never granted any read.
 */
enum class CandidateAwareness { TRANSPARENT, IMPLICIT, CONFIDENTIAL }

/**
 * Body of `POST /succession-plans`. The caller becomes the owner (manager_id); [userId] — the
 * seat's person — must be in the caller's transitive management chain and is immutable after
 * creation (planning for someone else means a new plan).
 */
@Serializable
data class SuccessionPlanCreateRequest(
    val userId: UInt,
    val roleCriticality: RoleCriticality,
    val retentionRisk: RetentionRisk,
    // Ordered short texts describing what is lost if the seat empties; order is meaningful.
    val lossImpact: List<String> = emptyList(),
    val targetBenchDepth: Int = DEFAULT_BENCH_DEPTH,
)

/** Body of `PUT /succession-plans/{id}` — everything editable but the seat's person. */
@Serializable
data class SuccessionPlanUpdate(
    val roleCriticality: RoleCriticality,
    val retentionRisk: RetentionRisk,
    val lossImpact: List<String> = emptyList(),
    val targetBenchDepth: Int = DEFAULT_BENCH_DEPTH,
)

/**
 * A light reference to a linked development goal — id plus the plaintext identity fields the
 * SPA renders as a chip (title/status/type are never secret; the goal document itself stays
 * behind the ordinary goal read rules).
 */
@Serializable
data class SuccessionGoalRef(
    val id: UInt,
    val title: String,
    val status: GoalStatus,
    val type: GoalType,
)

/**
 * Body of `POST /succession-plans/{id}/nominations` and the nomination PUT (one shape — the
 * impact-log convention). [goalIds] are the linked development action items, wholesale-replaced
 * on every save, payload order preserved; each must be an existing goal OF THE CANDIDATE that
 * the owner may read under the goal rules.
 */
@Serializable
data class SuccessionNominationRequest(
    val candidateId: UInt,
    val readiness: SuccessorReadiness,
    val nominationType: NominationType,
    // Ordered gaps naming what the candidate still lacks for the seat (v2.45.0: objects).
    val competencyGaps: List<SuccessionCompetencyGap> = emptyList(),
    val awareness: CandidateAwareness,
    val goalIds: List<UInt> = emptyList(),
)

/**
 * One competency gap (v2.45.0): a short text plus the [filled] progress flag — the goal
 * milestones' `done` shape without row identity (gaps live positionally inside ONE encrypted
 * JSON array column; a legacy plain-string element decodes as `filled = false`).
 */
@Serializable
data class SuccessionCompetencyGap(
    val text: String,
    val filled: Boolean = false,
)

@Serializable
data class SuccessionNominationResponse(
    val id: UInt,
    val planId: UInt,
    val candidateId: UInt,
    // Resolved candidate display name.
    val candidateName: String,
    val readiness: SuccessorReadiness,
    val nominationType: NominationType,
    val competencyGaps: List<SuccessionCompetencyGap>,
    val awareness: CandidateAwareness,
    // Linked development goals in stored order; soft-deleted goals drop out silently.
    val goals: List<SuccessionGoalRef>,
    val createdAt: Long,
    val lastModified: Long,
)

/** The whole plan document — the SPA detail screen reads once, nominations embedded. */
@Serializable
data class SuccessionPlanResponse(
    val id: UInt,
    val managerId: UInt,
    // Resolved owner display name.
    val managerName: String,
    val userId: UInt,
    // Resolved seat-person display name.
    val userName: String,
    val roleCriticality: RoleCriticality,
    val retentionRisk: RetentionRisk,
    val lossImpact: List<String>,
    val targetBenchDepth: Int,
    val status: SuccessionPlanStatus,
    // ALL active nominations count toward the bench (emergency interims included — user call).
    val benchCount: Int,
    val nominations: List<SuccessionNominationResponse>,
    val createdAt: Long,
    val lastReviewedAt: Long,
)

@Serializable
data class SuccessionPlanListItem(
    val id: UInt,
    val managerId: UInt,
    val managerName: String,
    val userId: UInt,
    val userName: String,
    val userDeleted: Boolean,
    val roleCriticality: RoleCriticality,
    val retentionRisk: RetentionRisk,
    val targetBenchDepth: Int,
    // One grouped count query per page (the goals milestone-tally idiom).
    val benchCount: Int,
    val status: SuccessionPlanStatus,
    val createdAt: Long,
    val lastReviewedAt: Long,
)

typealias SuccessionPlanPageResponse = PageResponse<SuccessionPlanListItem>

/** The write DTO the routes hand to [SuccessionEventService] (the ImpactEntryEvent shape). */
@Serializable
data class SuccessionPlanEvent(
    val planId: UInt,
    val userId: UInt,
    val type: SuccessionEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class SuccessionPlanEventResponse(
    val id: UInt,
    val planId: UInt,
    val userId: UInt,
    val userName: String,
    val timestamp: Long,
    val type: SuccessionEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class SuccessionPlanEventListResponse(
    val items: List<SuccessionPlanEventResponse>,
)

/** Shared by create and update — the definition fields minus the person. */
internal fun validateSuccessionPlanFields(
    lossImpact: List<String>,
    targetBenchDepth: Int,
) {
    validateShortTextList(lossImpact, "Loss impact")
    if (targetBenchDepth < MIN_BENCH_DEPTH || targetBenchDepth > MAX_BENCH_DEPTH) {
        throw BadRequestException(
            "Target bench depth must be between $MIN_BENCH_DEPTH and $MAX_BENCH_DEPTH",
        )
    }
}

/**
 * Validates a nomination payload (create and update share the shape). [seatUserId] is the
 * plan's person — nominating them as their own successor makes no sense. Goal-link EXISTENCE
 * and readability are checked inside the service transaction; only the payload-local rules
 * live here.
 */
internal fun validateNomination(request: SuccessionNominationRequest, seatUserId: UInt) {
    if (request.candidateId == seatUserId) {
        throw BadRequestException("The seat's own person cannot be nominated as their successor")
    }
    if (request.competencyGaps.size > MAX_SUCCESSION_LIST_ITEMS) {
        throw BadRequestException("Competency gaps must have at most $MAX_SUCCESSION_LIST_ITEMS items")
    }
    request.competencyGaps.forEach { validateShortText(it.text, "Competency gaps") }
    if (request.goalIds.size > MAX_SUCCESSION_GOAL_LINKS) {
        throw BadRequestException("At most $MAX_SUCCESSION_GOAL_LINKS goals can be linked to a nomination")
    }
    if (request.goalIds.size != request.goalIds.distinct().size) {
        throw BadRequestException("Duplicate goal id in payload")
    }
}

private fun validateShortTextList(items: List<String>, label: String) {
    if (items.size > MAX_SUCCESSION_LIST_ITEMS) {
        throw BadRequestException("$label must have at most $MAX_SUCCESSION_LIST_ITEMS items")
    }
    items.forEach { validateShortText(it, label) }
}

private fun validateShortText(text: String, label: String) {
    if (text.isBlank()) throw BadRequestException("$label items must not be blank")
    if (text.length > MAX_SUCCESSION_ITEM_LENGTH) {
        throw BadRequestException(
            "$label items must be at most $MAX_SUCCESSION_ITEM_LENGTH characters",
        )
    }
}
