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
import ch.nokillswit.sharing.ShareService.DocumentShares
import ch.nokillswit.sharing.ShareableResourceType
import ch.nokillswit.succession.SuccessionPlanService.Plans
import ch.nokillswit.teamkpis.TeamKpiService.TeamKpis
import ch.nokillswit.teamkpis.TeamKpiStatus
import ch.nokillswit.teams.TeamService.TeamMembers
import ch.nokillswit.teams.TeamService.Teams
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.r2dbc.Query
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
 * Two uses of the same builders: the SELF viewer gets them PROJECTED as a `readable` boolean on
 * their own rows (every row listed, `details`/`link` nulled when false), a CHAIN viewer gets them as
 * the WHERE of each union branch (hide, never redact — `total` stays exact). The parent document
 * table (joined to `teams` for KPIs) must be in the FROM of whichever query applies them.
 * `ActivityVisibilityParityTest` pins each builder against the real guard through the sharing
 * adapters, for both uses.
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
        // The person-scoped areas have no document to read (their chain rule is `personScoped`).
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

    /**
     * Which SHARE rows a chain viewer may see: only those of a document the viewer AUTHORS — the
     * `GET /shares?view=document` rule (so the document's subject, and a non-author chain manager,
     * never learn of a share), AND the document is not soft-deleted (the adapter's `read` answers
     * null for one). Mirrors each adapter's `isAuthor`: feedback → the provider; 1:1/goal/review →
     * the stored `manager_id`; impact log → the owner; succession plan → the plan's owner; team KPI →
     * whoever passes the manage predicate (the team's CURRENT manager `teams.manager_id`, or the
     * chain above them). One `resource_type`-guarded sub-select per type, OR-ed.
     */
    fun authoredShares(viewer: UInt, chain: Collection<UInt>): Op<Boolean> {
        fun ofType(type: ShareableResourceType, ids: Query): Op<Boolean> =
            (DocumentShares.resourceType eq type.name) and (DocumentShares.resourceId inSubQuery ids)
        val kpiAuthored = TeamKpis.join(Teams, JoinType.INNER, onColumn = TeamKpis.teamId, otherColumn = Teams.id)
            .select(TeamKpis.id)
            .where {
                (TeamKpis.markedAsDeleted eq false) and ((Teams.managerId eq viewer) or Teams.managerId.anyOf(chain))
            }
        return ShareableResourceType.entries.map { type ->
            // Exhaustive: a new shareable type without an author predicate does not compile.
            when (type) {
                ShareableResourceType.FEEDBACK -> ofType(
                    type,
                    Feedbacks.select(Feedbacks.id)
                        .where { (Feedbacks.providerId eq viewer) and (Feedbacks.markedAsDeleted eq false) },
                )
                ShareableResourceType.ONE_ON_ONE -> ofType(
                    type,
                    Meetings.select(Meetings.id)
                        .where { (Meetings.managerId eq viewer) and (Meetings.markedAsDeleted eq false) },
                )
                ShareableResourceType.GOAL -> ofType(
                    type,
                    Goals.select(Goals.id).where { (Goals.managerId eq viewer) and (Goals.markedAsDeleted eq false) },
                )
                ShareableResourceType.TEAM_KPI -> ofType(type, kpiAuthored)
                ShareableResourceType.PERFORMANCE_REVIEW -> ofType(
                    type,
                    Reviews.select(Reviews.id)
                        .where { (Reviews.managerId eq viewer) and (Reviews.markedAsDeleted eq false) },
                )
                ShareableResourceType.IMPACT_LOG_ENTRY -> ofType(
                    type,
                    Entries.select(Entries.id).where { (Entries.userId eq viewer) and (Entries.markedAsDeleted eq false) },
                )
                ShareableResourceType.SUCCESSION_PLAN -> ofType(
                    type,
                    Plans.select(Plans.id).where { (Plans.managerId eq viewer) and (Plans.markedAsDeleted eq false) },
                )
            }
        }.reduce { acc, op -> acc or op }
    }

    /**
     * Chain visibility of a PERSON-scoped event (days-off V88, career positions V89): the person the action concerns
     * ([ownerColumn] — `owner_id`) is the viewer or in the viewer's transitive chain. No parent
     * document, no status rule, no soft-delete rule: the trail is a person-scoped record, so the
     * events of a since-deleted entry or correction are still listed. (A days-off entry is also
     * readable by teammates and HR in the live product — the teammate grant is calendar parity for
     * one entry and is deliberately not a reason to list a colleague's actions; HR is not chain mode.)
     */
    fun personScoped(ownerColumn: Column<EntityID<UInt>>, viewer: UInt, chain: Collection<UInt>): Op<Boolean> =
        (ownerColumn eq viewer) or ownerColumn.anyOf(chain)

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
