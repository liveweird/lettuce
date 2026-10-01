package ch.nokillswit.impactlog

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.requireImpactEntryRead
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType

/**
 * The impact-log read matrix for [principal] — the ONE call site of `requireImpactEntryRead` with
 * the manager-chain lambda bound to the principal, shared by the read preamble
 * (`ImpactLogRoutes.kt`) and the sharing adapter below. Throws `ForbiddenException` on a denial.
 */
internal suspend fun ImpactLogService.requireReadable(principal: CallerPrincipal, entry: ImpactEntryResponse) {
    requireImpactEntryRead(principal, entry) { managesOwner(principal.userId, entry.userId) }
}

/**
 * Impact-log entries' document-sharing adapter (v4.8.0, see `.claude/docs/features/sharing.md`).
 * [guard] is the RAW read guard — never the share-aware route preamble (that would allow
 * re-sharing). The author (who sees and may withdraw every share of the entry) is the OWNER.
 * Labels are the plaintext title, the owner's name and the period bounds only — never the four
 * encrypted sections.
 */
class ImpactLogShareable(private val impactLogService: ImpactLogService) : ShareableResource<ImpactEntryResponse, Unit> {
    override val type = ShareableResourceType.IMPACT_LOG_ENTRY

    override suspend fun read(id: UInt): ImpactEntryResponse? = impactLogService.read(id)

    override suspend fun guard(principal: CallerPrincipal, doc: ImpactEntryResponse) =
        impactLogService.requireReadable(principal, doc)

    override suspend fun isAuthor(userId: UInt, doc: ImpactEntryResponse): Boolean = userId == doc.userId

    override suspend fun label(doc: ImpactEntryResponse): Map<String, String> = mapOf(
        "title" to doc.title,
        "author" to doc.userName,
        "periodStart" to doc.periodStart,
        "periodEnd" to doc.periodEnd,
    )

    override fun viewPath(id: UInt): String = "/impact-log/$id/view"
}
