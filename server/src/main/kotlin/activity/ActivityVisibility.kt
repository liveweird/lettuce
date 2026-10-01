package ch.nokillswit.activity

import ch.nokillswit.feedbacks.FeedbackService.FeedbackSubjects
import ch.nokillswit.feedbacks.FeedbackService.Feedbacks
import ch.nokillswit.feedbacks.FeedbackStatus
import ch.nokillswit.feedbacks.FeedbackVisibility
import ch.nokillswit.goals.GoalService.Goals
import ch.nokillswit.goals.GoalStatus
import ch.nokillswit.impactlog.ImpactLogService.Entries
import ch.nokillswit.oneonones.OneOnOneService.Meetings
import ch.nokillswit.reviews.PerformanceReviewService.Reviews
import ch.nokillswit.reviews.PerformanceReviewStatus
import ch.nokillswit.succession.SuccessionPlanService.Plans
import ch.nokillswit.teamkpis.TeamKpiService.TeamKpis
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teams.TeamService.TeamMembers
import ch.nokillswit.teams.TeamService.Teams
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.r2dbc.select

/**
 * "May [viewer] read this document in their OWN right" as a SQL predicate over the document's
 * parent table — one builder per area, each written next to (and mirroring) the `authz/Guards.kt`
 * read guard the feature's GET goes through, with the HR role stripped (the sharing "own right"
 * definition, `ShareAccess.holdsOwnRight`): the guard is the oracle, this is its set-at-a-time
 * twin. **Every future change of one of those guards must update the matching builder here**
 * (`.claude/docs/authorization.md`, "Activity log").
 *
 * [chain] is the viewer's TRANSITIVE subordinate set (`teams/ManagementChain.kt`
 * `transitiveSubordinateIds`), computed ONCE per request by the caller and bound as one array
 * parameter per use (`= ANY(?)`, never one placeholder per id — a large subtree must not approach
 * PostgreSQL's 65,535-bind cap). "Viewer manages X" == "X ∈ chain".
 *
 * Step 1 uses these to PROJECT a `readable` boolean for the self viewer's own rows; step 2 applies
 * the same builders as the WHERE of each union branch for chain viewers (hide, never redact).
 * Every builder includes "not soft-deleted" — a deleted document is never readable in own right.
 */
internal object ActivityVisibility {

    fun readable(area: ActivityArea, viewer: UInt, chain: Collection<UInt>): Op<Boolean> = when (area) {
        ActivityArea.FEEDBACK -> feedback(viewer, chain)
        ActivityArea.ONE_ON_ONE -> oneOnOne(viewer, chain)
        ActivityArea.GOAL -> goal(viewer, chain)
        ActivityArea.TEAM_KPI -> teamKpi(viewer, chain)
        ActivityArea.PERFORMANCE_REVIEW -> review(viewer, chain)
        ActivityArea.IMPACT_LOG_ENTRY -> impactEntry(viewer, chain)
        ActivityArea.SUCCESSION_PLAN -> successionPlan(viewer, chain)
        // The person-scoped areas have no document to read; their rules arrive with their steps.
        ActivityArea.DAYS_OFF, ActivityArea.CAREER_POSITION, ActivityArea.ACCOUNT -> Op.FALSE
    }

    /**
     * `canReadFeedback` + `requireFeedbackReadAllowingManager`: the provider; the requester under
     * PROVIDER_REQUESTER(_SUBJECT); PUBLIC + SENT for anyone; a recipient under
     * PROVIDER_SUBJECT/PROVIDER_REQUESTER_SUBJECT once delivered; a manager in ANY recipient's
     * chain once delivered (SENT/WITHDRAWN).
     */
    private fun feedback(viewer: UInt, chain: Collection<UInt>): Op<Boolean> {
        val delivered = Feedbacks.status inList listOf(FeedbackStatus.SENT, FeedbackStatus.WITHDRAWN)
        val subjectVisibility = Feedbacks.visibility inList
            listOf(FeedbackVisibility.PROVIDER_SUBJECT, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT)
        val requesterVisibility = Feedbacks.visibility inList
            listOf(FeedbackVisibility.PROVIDER_REQUESTER, FeedbackVisibility.PROVIDER_REQUESTER_SUBJECT)
        return (Feedbacks.markedAsDeleted eq false) and (
            (Feedbacks.providerId eq viewer) or
                ((Feedbacks.requesterId eq viewer) and requesterVisibility) or
                ((Feedbacks.visibility eq FeedbackVisibility.PUBLIC) and (Feedbacks.status eq FeedbackStatus.SENT)) or
                (isRecipient(listOf(viewer)) and subjectVisibility and delivered) or
                (isRecipientAmong(chain) and delivered)
            )
    }

    /** `canReadOneOnOne` + `requireOneOnOneReadAllowingManager`: either party, or the subordinate's chain. */
    private fun oneOnOne(viewer: UInt, chain: Collection<UInt>): Op<Boolean> =
        (Meetings.markedAsDeleted eq false) and (
            (Meetings.managerId eq viewer) or (Meetings.subordinateId eq viewer) or
                Meetings.subordinateId.anyOf(chain)
            )

    /** `canReadGoal` + `requireGoalReadAllowingManager`: either party at every status; the chain only past DRAFT. */
    private fun goal(viewer: UInt, chain: Collection<UInt>): Op<Boolean> =
        (Goals.markedAsDeleted eq false) and (
            (Goals.managerId eq viewer) or (Goals.subordinateId eq viewer) or
                ((Goals.status neq GoalStatus.DRAFT) and Goals.subordinateId.anyOf(chain))
            )

    /**
     * `canReadPerformanceReview` + `requirePerformanceReviewReadAllowingManager`: the authoring
     * manager at every status; the subordinate only once PUBLISHED; the chain once past DRAFT.
     */
    private fun review(viewer: UInt, chain: Collection<UInt>): Op<Boolean> =
        (Reviews.markedAsDeleted eq false) and (
            (Reviews.managerId eq viewer) or
                ((Reviews.subordinateId eq viewer) and (Reviews.status eq PerformanceReviewStatus.PUBLISHED)) or
                ((Reviews.status neq PerformanceReviewStatus.DRAFT) and Reviews.subordinateId.anyOf(chain))
            )

    /**
     * `requireTeamKpiReadAllowingChain` (the parent query must join `teams` — the KPI's current
     * manager is `teams.manager_id`, never stored on the KPI): the team's current manager; a
     * current member of the (non-deleted) team once past DRAFT; the chain ABOVE the team's
     * manager at every status (`created_by` grants nothing).
     */
    private fun teamKpi(viewer: UInt, chain: Collection<UInt>): Op<Boolean> {
        val memberTeams = TeamMembers.join(Teams, JoinType.INNER, onColumn = TeamMembers.teamId, otherColumn = Teams.id)
            .select(TeamMembers.teamId)
            .where { (TeamMembers.userId eq viewer) and (Teams.markedAsDeleted eq false) }
        return (TeamKpis.markedAsDeleted eq false) and (
            (Teams.managerId eq viewer) or
                ((TeamKpis.status neq TeamKpiStatus.DRAFT) and (TeamKpis.teamId inSubQuery memberTeams)) or
                Teams.managerId.anyOf(chain)
            )
    }

    /** `requireImpactEntryRead`: the owner, or any manager in the owner's chain — no status nuance. */
    private fun impactEntry(viewer: UInt, chain: Collection<UInt>): Op<Boolean> =
        (Entries.markedAsDeleted eq false) and ((Entries.userId eq viewer) or Entries.userId.anyOf(chain))

    /**
     * `requireSuccessionPlanRead`, keyed on the AUTHOR: the owner, or any manager in the OWNER's
     * chain. The seat's person and nominated candidates grant nothing.
     */
    private fun successionPlan(viewer: UInt, chain: Collection<UInt>): Op<Boolean> =
        (Plans.markedAsDeleted eq false) and ((Plans.managerId eq viewer) or Plans.managerId.anyOf(chain))

    /** The feedback's recipient set (anchor column OR the join table — `FeedbackService.subjectIn`). */
    private fun isRecipient(users: Collection<UInt>): Op<Boolean> =
        (Feedbacks.subjectId inList users) or
            (Feedbacks.id inSubQuery FeedbackSubjects.select(FeedbackSubjects.feedbackId)
                .where { FeedbackSubjects.userId inList users })

    private fun isRecipientAmong(chain: Collection<UInt>): Op<Boolean> =
        if (chain.isEmpty()) {
            Op.FALSE
        } else {
            Feedbacks.subjectId.anyOf(chain) or
                (Feedbacks.id inSubQuery FeedbackSubjects.select(FeedbackSubjects.feedbackId)
                    .where { FeedbackSubjects.userId.anyOf(chain) })
        }
}

/**
 * `column = ANY(?)` with the id set bound as ONE array parameter ([ids] empty = `FALSE`, no SQL).
 * Pinned against the Testcontainer by `ActivityUnionPinTest`.
 */
internal fun Column<EntityID<UInt>>.anyOf(ids: Collection<UInt>): Op<Boolean> =
    if (ids.isEmpty()) Op.FALSE else AnyOfIds(this, ids.map { it.toLong() })

private class AnyOfIds(private val column: Column<EntityID<UInt>>, private val ids: List<Long>) : Op<Boolean>() {
    override fun toQueryBuilder(queryBuilder: QueryBuilder) = queryBuilder {
        append(column)
        append(" = ANY(")
        registerArgument(ArrayColumnType<Long, List<Long>>(LongColumnType()), ids)
        append(")")
    }
}
