package ch.nokillswit.pulse

import ch.nokillswit.authz.CallerPrincipal
import ch.nokillswit.sharing.ShareableResource
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.teams.TeamService

/** The "document" behind a pulse-results share: the TEAM whose results it is (the resource id is the team id). */
class PulseTeam(val teamId: UInt, val name: String)

/**
 * The pulse-results document-sharing adapter (v4.12.0, see `.claude/docs/features/sharing.md`). The
 * shared unit is a TEAM's pulse results — every closed cycle, past and future, plus the trend — so
 * the resource id is the team id and [read] resolves the team: null for a soft-deleted one (the
 * route answers 404). [guard] is the RAW own-right rule [TeamService.requireResultsVisible] (the
 * team is in the principal's visible result tree; sharing always runs it role-stripped) — never a
 * share-aware preamble, which is what keeps sharing non-transitive. The per-cycle fill gate and the
 * k>=3 floor are CONTENT gates the results read applies to the SHARER (step 2), not part of this
 * guard. The author, who sees and may withdraw EVERY share of the team's results, is the team's
 * current manager or anyone in the chain above them (the team-KPI manage predicate,
 * [TeamService.managesTeamOrChain]). The label is the plaintext team name only.
 */
class PulseTeamResultsShareable(private val teamService: TeamService) : ShareableResource<PulseTeam, Unit> {
    override val type = ShareableResourceType.PULSE_TEAM_RESULTS

    override suspend fun read(id: UInt): PulseTeam? = teamService.readRef(id)?.let { PulseTeam(id, it.name) }

    override suspend fun guard(principal: CallerPrincipal, doc: PulseTeam) =
        teamService.requireResultsVisible(principal, doc.teamId)

    override suspend fun isAuthor(userId: UInt, doc: PulseTeam): Boolean =
        teamService.managesTeamOrChain(userId, doc.teamId)

    override suspend fun label(doc: PulseTeam): Map<String, String> = mapOf("team" to doc.name)

    override fun viewPath(id: UInt): String = "/pulse?tab=results&view=shared&team=$id"
}
