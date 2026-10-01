package ch.nokillswit.teamkpis

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.authz.requireTeamKpiReadAllowingChain
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType

/**
 * The team-KPI read matrix for [principal] — the ONE call site of `requireTeamKpiReadAllowingChain`
 * with the member and manager-chain lambdas bound to the principal, shared by the read preamble
 * (`TeamKpiRoutes.kt`) and the sharing adapter below. Throws `ForbiddenException` on a denial.
 */
internal suspend fun TeamKpiService.requireReadable(principal: CallerPrincipal, kpi: TeamKpiResponse) {
    requireTeamKpiReadAllowingChain(
        principal,
        kpi,
        isTeamMember = { isTeamMember(principal.userId, kpi.teamId) },
        managesTeamManager = { managesManagerOf(principal.userId, kpi.managerId) },
    )
}

/**
 * Team KPIs' document-sharing adapter (v4.8.0, see `.claude/docs/features/sharing.md`). [guard] is
 * the RAW read guard — never the share-aware route preamble (that would allow re-sharing). The
 * author (who sees and may withdraw every share) is whoever passes the MANAGE predicate — the
 * team's CURRENT manager or a manager in the chain above them (`created_by` grants nothing, the
 * v2.26.0 decision) — hence the suspend [isAuthor]. Status nuances come from the guard: a team
 * member reads, so can share, only a non-DRAFT KPI (and their share lapses if it returns to
 * DRAFT or they leave the team); a manager reassignment lapses the old manager's shares unless
 * they are still in the chain above. Labels are the plaintext title and the team's name only —
 * never the encrypted description/summary.
 */
class TeamKpiShareable(private val teamKpiService: TeamKpiService) : ShareableResource<TeamKpiResponse, Unit> {
    override val type = ShareableResourceType.TEAM_KPI

    override suspend fun read(id: UInt): TeamKpiResponse? = teamKpiService.read(id)

    override suspend fun guard(principal: CallerPrincipal, doc: TeamKpiResponse) =
        teamKpiService.requireReadable(principal, doc)

    override suspend fun isAuthor(userId: UInt, doc: TeamKpiResponse): Boolean =
        userId == doc.managerId || teamKpiService.managesManagerOf(userId, doc.managerId)

    override suspend fun label(doc: TeamKpiResponse): Map<String, String> =
        mapOf("title" to doc.title, "team" to doc.teamName)

    override fun viewPath(id: UInt): String = "/team-kpis/$id/view"
}
