package ch.nokillswit.goals

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.requireGoalReadAllowingManager
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType

/**
 * The goal read matrix for [principal] — the ONE call site of `requireGoalReadAllowingManager` with
 * the manager-chain lambda bound to the principal, shared by the read preamble (`GoalRoutes.kt`)
 * and the sharing adapter below. Throws `ForbiddenException` on a denial.
 */
internal suspend fun GoalService.requireReadable(principal: CallerPrincipal, goal: GoalResponse) {
    requireGoalReadAllowingManager(principal, goal) { managesSubordinate(principal.userId, goal.subordinateId) }
}

/**
 * Goals' document-sharing adapter (v4.8.0, see `.claude/docs/features/sharing.md`). [guard] is the
 * RAW read guard — never the share-aware route preamble (that would allow re-sharing). The author
 * (who sees and may withdraw every share of the goal) is the stored manager. Draft privacy falls
 * out of the guard itself: a chain manager cannot read a DRAFT, so cannot share one, and a share
 * they made while the goal was ACTIVE lapses when it goes back to DRAFT. Labels are the plaintext
 * title and the subordinate's name only — never the encrypted description/summary.
 */
class GoalShareable(private val goalService: GoalService) : ShareableResource<GoalResponse, Unit> {
    override val type = ShareableResourceType.GOAL

    override suspend fun read(id: UInt): GoalResponse? = goalService.read(id)

    override suspend fun guard(principal: CallerPrincipal, doc: GoalResponse) =
        goalService.requireReadable(principal, doc)

    override suspend fun isAuthor(userId: UInt, doc: GoalResponse): Boolean = userId == doc.managerId

    override suspend fun label(doc: GoalResponse): Map<String, String> =
        mapOf("title" to doc.title, "subordinate" to doc.subordinateName)

    override fun viewPath(id: UInt): String = "/goals/$id/view"
}
