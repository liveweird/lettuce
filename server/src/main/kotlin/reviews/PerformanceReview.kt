package ch.nokillswit.reviews

import ch.nokillswit.dictionaries.DictionaryEntry
import ch.nokillswit.infra.paging.PageResponse
import ch.nokillswit.teams.TeamRef
import ch.nokillswit.users.UserRef
import io.ktor.server.plugins.BadRequestException
import kotlinx.serialization.Serializable

@Serializable
enum class PerformanceReviewStatus { DRAFT, CALIBRATION, PUBLISHED }

/** The five assessed categories, in their canonical display/diff order. */
@Serializable
enum class ReviewCategory { ATTITUDE, DELIVERY, SKILLS, APTITUDE, OVERALL }

const val MIN_REVIEW_RATING = 1
const val MAX_REVIEW_RATING = 6
const val MAX_REVIEW_SUMMARY_LENGTH = 4000

/**
 * One category's assessment: a numeric rating on the fixed 1–6 scale plus a free-text summary.
 * The rating travels as its NUMBER (calculations run on it); the textual scale wording
 * ("meets expectations", …) is the SPA's localized rendering of that number, never stored or
 * transmitted. Both fields are null while unset — legal only in DRAFT (see
 * [requireCompleteAssessments]).
 */
@Serializable
data class CategoryAssessment(
    val rating: Int? = null,
    val summary: String? = null,
)

/**
 * Body of `POST /performance-reviews` — the manager comes from the JWT and the status is always
 * DRAFT, so neither is settable here. Assessments may be partial (a DRAFT is the manager's
 * scratch space); completeness is enforced by the DRAFT→CALIBRATION transition.
 */
@Serializable
data class PerformanceReviewCreateRequest(
    val subordinateId: UInt,
    val periodId: UInt,
    val attitude: CategoryAssessment = CategoryAssessment(),
    val delivery: CategoryAssessment = CategoryAssessment(),
    val skills: CategoryAssessment = CategoryAssessment(),
    val aptitude: CategoryAssessment = CategoryAssessment(),
    val overall: CategoryAssessment = CategoryAssessment(),
)

/**
 * Body of `PUT /performance-reviews/{id}` — a full replace of the ten assessment values.
 * Parties, period, and status are NOT settable (status moves through the action endpoints).
 * Accepted while DRAFT or CALIBRATION; in CALIBRATION the payload must be complete — a value may
 * change but never blank out (see [requireCompleteAssessments]). PUBLISHED is read-only (409).
 */
@Serializable
data class PerformanceReviewUpdateRequest(
    val attitude: CategoryAssessment = CategoryAssessment(),
    val delivery: CategoryAssessment = CategoryAssessment(),
    val skills: CategoryAssessment = CategoryAssessment(),
    val aptitude: CategoryAssessment = CategoryAssessment(),
    val overall: CategoryAssessment = CategoryAssessment(),
)

@Serializable
data class PerformanceReviewResponse(
    val id: UInt,
    val managerId: UInt,
    val subordinateId: UInt,
    val periodId: UInt,
    // The period's bounds, resolved for display (inclusive ISO YYYY-MM).
    val periodStartMonth: String,
    val periodEndMonth: String,
    val status: PerformanceReviewStatus,
    val attitude: CategoryAssessment,
    val delivery: CategoryAssessment,
    val skills: CategoryAssessment,
    val aptitude: CategoryAssessment,
    val overall: CategoryAssessment,
    val createdAt: Long,
    val lastModified: Long,
    // Resolved party display names.
    val managerName: String,
    val subordinateName: String,
    // Document sharing (v4.8.0): true when the caller can read this review in their OWN right,
    // independently of any share (the HR role alone does not count) — the share button's gate,
    // never `sharedBy`. Stamped by the route (`.copy`), false on every internal read.
    val canShare: Boolean = false,
    // The sharer's display name when the caller is reading through a share (the "Shared with you
    // by …" banner); null otherwise. Stamped by the route.
    val sharedBy: String? = null,
)

@Serializable
data class PerformanceReviewListItem(
    val id: UInt,
    val managerId: UInt,
    val managerName: String,
    val managerDeleted: Boolean,
    val subordinateId: UInt,
    val subordinateName: String,
    val subordinateDeleted: Boolean,
    val periodId: UInt,
    val periodStartMonth: String,
    val periodEndMonth: String,
    val status: PerformanceReviewStatus,
    // The numeric ratings only — summaries NEVER ride in list rows (no decryption in lists).
    val attitudeRating: Int?,
    val deliveryRating: Int?,
    val skillsRating: Int?,
    val aptitudeRating: Int?,
    val overallRating: Int?,
    val createdAt: Long,
    val lastModified: Long,
)

/**
 * Why a share candidate cannot be picked: [NO_REVIEW] (nothing exists for the period) or
 * [UNREADABLE_DRAFT] (another chain manager's DRAFT — the caller cannot read it in their own
 * right, so cannot share it). Null on a shareable row.
 */
@Serializable
enum class ShareCandidateReason { NO_REVIEW, UNREADABLE_DRAFT }

/**
 * The period's review of one share candidate (v4.10.0). When the caller cannot read it in their
 * own right (another chain manager's DRAFT — the registered API-ERR-006 disclosure, decision D1)
 * only [status] and the author's [managerName] are set: [id], [managerId] and every rating are null. Ratings
 * (decrypted) ride only on readable reviews — the same disclosure as the managed list rows.
 */
@Serializable
data class ShareCandidateReview(
    val id: UInt?,
    val status: PerformanceReviewStatus,
    val managerId: UInt?,
    val managerName: String,
    val attitudeRating: Int?,
    val deliveryRating: Int?,
    val skillsRating: Int?,
    val aptitudeRating: Int?,
    val overallRating: Int?,
)

/** One person in the caller's transitive chain, for the mass-share picker (v4.10.0). */
@Serializable
data class ShareCandidate(
    val userId: UInt,
    val name: String,
    val email: String,
    val deactivated: Boolean,
    val teams: List<TeamRef>,
    // Managers of the person's teams, minus the person themselves — the caller appears here as
    // themselves; the SPA's direct-manager facet keeps the subtree under a chosen manager.
    val directManagers: List<UserRef>,
    val careerPath: DictionaryEntry?,
    val careerSpecialization: DictionaryEntry?,
    // Always attached: every row is the caller's own chain (the seniority-visibility rule).
    val seniorityLevel: DictionaryEntry?,
    val review: ShareCandidateReview?,
    val shareable: Boolean,
    val reason: ShareCandidateReason?,
)

/** Unpaged, caller-relative picker dataset — see [PerformanceReviewService.shareCandidates]. */
@Serializable
data class ShareCandidateList(
    val periodId: UInt,
    val items: List<ShareCandidate>,
)

typealias PerformanceReviewPageResponse = PageResponse<PerformanceReviewListItem>

@Serializable
data class PerformanceReviewEvent(
    val reviewId: UInt,
    // Null = system-originated (no acting user) — see infra/db/EventLog.kt.
    val userId: UInt?,
    val type: PerformanceReviewEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class PerformanceReviewEventResponse(
    val id: UInt,
    val reviewId: UInt,
    // Null = system-originated (no acting user) — see infra/db/EventLog.kt.
    val userId: UInt?,
    val userName: String?,
    val timestamp: Long,
    val type: PerformanceReviewEventType,
    val params: Map<String, String> = emptyMap(),
)

@Serializable
data class PerformanceReviewEventListResponse(
    val items: List<PerformanceReviewEventResponse>,
)

/** The five assessments of a create/update payload, in the canonical category order. */
internal fun assessmentsOf(request: PerformanceReviewUpdateRequest): Map<ReviewCategory, CategoryAssessment> =
    mapOf(
        ReviewCategory.ATTITUDE to request.attitude,
        ReviewCategory.DELIVERY to request.delivery,
        ReviewCategory.SKILLS to request.skills,
        ReviewCategory.APTITUDE to request.aptitude,
        ReviewCategory.OVERALL to request.overall,
    )

internal fun assessmentsOf(request: PerformanceReviewCreateRequest): Map<ReviewCategory, CategoryAssessment> =
    mapOf(
        ReviewCategory.ATTITUDE to request.attitude,
        ReviewCategory.DELIVERY to request.delivery,
        ReviewCategory.SKILLS to request.skills,
        ReviewCategory.APTITUDE to request.aptitude,
        ReviewCategory.OVERALL to request.overall,
    )

internal fun assessmentsOf(response: PerformanceReviewResponse): Map<ReviewCategory, CategoryAssessment> =
    mapOf(
        ReviewCategory.ATTITUDE to response.attitude,
        ReviewCategory.DELIVERY to response.delivery,
        ReviewCategory.SKILLS to response.skills,
        ReviewCategory.APTITUDE to response.aptitude,
        ReviewCategory.OVERALL to response.overall,
    )

/**
 * Field-level validation of a payload's assessments (create and update alike): each set rating
 * must be on the 1–6 scale, each summary within bounds. Completeness is a separate, transition-
 * gated rule ([requireCompleteAssessments]) — a partial DRAFT is legal.
 */
internal fun validateAssessments(assessments: Map<ReviewCategory, CategoryAssessment>) {
    assessments.forEach { (category, assessment) ->
        val label = category.name.lowercase()
        assessment.rating?.let {
            if (it !in MIN_REVIEW_RATING..MAX_REVIEW_RATING) {
                throw BadRequestException(
                    "The $label rating must be between $MIN_REVIEW_RATING and $MAX_REVIEW_RATING",
                )
            }
        }
        assessment.summary?.let {
            if (it.length > MAX_REVIEW_SUMMARY_LENGTH) {
                throw BadRequestException(
                    "The $label summary must be at most $MAX_REVIEW_SUMMARY_LENGTH characters",
                )
            }
        }
    }
}

/**
 * The completeness rule: all five ratings set and all five summaries non-blank. Enforced by the
 * DRAFT→CALIBRATION transition (an incomplete review may not enter calibration) and by every PUT
 * against a CALIBRATION review (from calibration onward a value may change but never blank out).
 */
internal fun requireCompleteAssessments(assessments: Map<ReviewCategory, CategoryAssessment>) {
    assessments.forEach { (category, assessment) ->
        val label = category.name.lowercase()
        if (assessment.rating == null) {
            throw BadRequestException("The $label rating is required from calibration onward")
        }
        if (assessment.summary.isNullOrBlank()) {
            throw BadRequestException("The $label summary is required from calibration onward")
        }
    }
}
