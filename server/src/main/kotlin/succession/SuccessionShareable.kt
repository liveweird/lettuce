package ch.nokillswit.succession

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.requireSuccessionPlanRead
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType

/**
 * The succession-plan read matrix for [principal] — the ONE call site of
 * `requireSuccessionPlanRead` with the OWNER-chain lambda bound to the principal, shared by the
 * read preamble (`SuccessionRoutes.kt`) and the sharing adapter below. Throws
 * `ForbiddenException` on a denial. (The seat's person and the candidates never pass — their
 * status grants no access.)
 */
internal suspend fun SuccessionPlanService.requireReadable(principal: CallerPrincipal, plan: SuccessionPlanResponse) {
    requireSuccessionPlanRead(principal, plan) { managesUser(principal.userId, plan.managerId) }
}

/**
 * Succession plans' document-sharing adapter (v4.8.0, see `.claude/docs/features/sharing.md`) —
 * the most confidential feature, so deliberately minimal. [guard] is the RAW read guard, never
 * the share-aware route preamble (that would allow re-sharing). The author (who sees and may
 * withdraw every share) is the OWNER (`manager_id`), NOT the seat's person. The label snapshot
 * is `{person, owner}` ONLY — no criticality, retention risk, loss impact, candidates or gaps.
 */
class SuccessionShareable(
    private val successionService: SuccessionPlanService,
) : ShareableResource<SuccessionPlanResponse, Unit> {
    override val type = ShareableResourceType.SUCCESSION_PLAN

    override suspend fun read(id: UInt): SuccessionPlanResponse? = successionService.read(id)

    override suspend fun guard(principal: CallerPrincipal, doc: SuccessionPlanResponse) =
        successionService.requireReadable(principal, doc)

    override suspend fun isAuthor(userId: UInt, doc: SuccessionPlanResponse): Boolean = userId == doc.managerId

    override suspend fun label(doc: SuccessionPlanResponse): Map<String, String> =
        mapOf("person" to doc.userName, "owner" to doc.managerName)

    override fun viewPath(id: UInt): String = "/succession/$id/view"
}

/**
 * A sharee sees the shared plan, never facts about SIBLING documents. The plan embeds, per
 * nomination, light refs to the candidate's linked development GOALS (`{id, title, status,
 * type}`) — other documents, which a sharee could not read under the goal rules. So on a read
 * through a share every nomination's `goals` list is emptied: the candidate, readiness, type,
 * gaps and awareness are plan content (as the sharer sees them), the goals' identities are not.
 */
internal fun SuccessionPlanResponse.forSharee(): SuccessionPlanResponse =
    copy(nominations = nominations.map { it.copy(goals = emptyList()) })

/**
 * The history counterpart of [forSharee]: a NOMINATION_UPDATED event's `changed` list may name
 * `goals` (the linked-goal set was edited) — which would let a sharee infer goal links the plan
 * response hides. So on a share read `goals` is dropped from every `changed` list, and an event
 * that changed ONLY the goal links is dropped altogether (the less surprising choice: an update
 * event with nothing left to say would read as an empty edit). Done at read time — storage is
 * untouched, the owner and every own-right reader still see the full history.
 */
internal fun List<SuccessionPlanEventResponse>.forSharee(): List<SuccessionPlanEventResponse> = mapNotNull { event ->
    val changed = event.params["changed"]
    if (event.type != SuccessionEventType.NOMINATION_UPDATED || changed == null) return@mapNotNull event
    val kept = changed.split(",").filter { it != "goals" }
    when {
        kept.size == changed.split(",").size -> event
        kept.isEmpty() -> null
        else -> event.copy(params = event.params + ("changed" to kept.joinToString(",")))
    }
}
