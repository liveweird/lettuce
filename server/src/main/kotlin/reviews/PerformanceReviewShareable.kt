package ch.nokillswit.reviews

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.requirePerformanceReviewReadAllowingManager
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType

/**
 * The review read matrix for [principal] — the ONE call site of
 * `requirePerformanceReviewReadAllowingManager` with the manager-chain lambda bound to the
 * principal, shared by the read preamble (`PerformanceReviewRoutes.kt`) and the sharing adapter
 * below. Throws `ForbiddenException` on a denial.
 */
internal suspend fun PerformanceReviewService.requireReadable(principal: CallerPrincipal, review: PerformanceReviewResponse) {
    requirePerformanceReviewReadAllowingManager(principal, review) {
        managesSubordinate(principal.userId, review.subordinateId)
    }
}

/**
 * Performance reviews' document-sharing adapter (v4.8.0, see `.claude/docs/features/sharing.md`).
 * [guard] is the RAW read guard — never the share-aware route preamble (that would allow
 * re-sharing). The author (who sees and may withdraw every share of the review) is the stored
 * manager. Status nuances fall out of the guard itself: the subordinate reads — so can share —
 * only a PUBLISHED review (and the share lapses if it is un-published), a chain manager cannot
 * read a DRAFT so cannot share it (a share they made in CALIBRATION lapses if it returns to
 * DRAFT). Labels are the subordinate's name and the period bounds only — never a rating or summary.
 */
class PerformanceReviewShareable(
    private val reviewService: PerformanceReviewService,
) : ShareableResource<PerformanceReviewResponse, Unit> {
    override val type = ShareableResourceType.PERFORMANCE_REVIEW

    override suspend fun read(id: UInt): PerformanceReviewResponse? = reviewService.read(id)

    override suspend fun guard(principal: CallerPrincipal, doc: PerformanceReviewResponse) =
        reviewService.requireReadable(principal, doc)

    override suspend fun isAuthor(userId: UInt, doc: PerformanceReviewResponse): Boolean = userId == doc.managerId

    override suspend fun label(doc: PerformanceReviewResponse): Map<String, String> = mapOf(
        "subordinate" to doc.subordinateName,
        "startMonth" to doc.periodStartMonth,
        "endMonth" to doc.periodEndMonth,
    )

    override fun viewPath(id: UInt): String = "/performance-reviews/$id/view"
}
