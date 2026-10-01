package ch.nokillswit.activity

import ch.nokillswit.feedbacks.FeedbackEventService.FeedbackEvents
import ch.nokillswit.feedbacks.FeedbackService.FeedbackSubjects
import ch.nokillswit.feedbacks.FeedbackService.Feedbacks
import ch.nokillswit.goals.GoalEventService.GoalEvents
import ch.nokillswit.goals.GoalService.Goals
import ch.nokillswit.impactlog.ImpactLogEventService.ImpactLogEvents
import ch.nokillswit.impactlog.ImpactLogService.Entries
import ch.nokillswit.infra.db.EventLogTable
import ch.nokillswit.infra.db.decodeParams
import ch.nokillswit.infra.paging.PageRequest
import ch.nokillswit.infra.paging.applyPaging
import ch.nokillswit.oneonones.OneOnOneEventService.OneOnOneEvents
import ch.nokillswit.oneonones.OneOnOneService.Meetings
import ch.nokillswit.reviews.PerformanceReviewEventService.ReviewEvents
import ch.nokillswit.reviews.PerformanceReviewService.Reviews
import ch.nokillswit.reviews.ReviewPeriodService.ReviewPeriods
import ch.nokillswit.sharing.ShareRegistry
import ch.nokillswit.succession.SuccessionEventService.SuccessionPlanEvents
import ch.nokillswit.succession.SuccessionPlanService.Plans
import ch.nokillswit.teamkpis.TeamKpiEventService.TeamKpiEvents
import ch.nokillswit.teamkpis.TeamKpiService.TeamKpis
import ch.nokillswit.teams.TeamService.Teams
import ch.nokillswit.teams.transitiveSubordinateIds
import ch.nokillswit.users.Feature
import ch.nokillswit.users.UserService.Users
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.toList
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.core.dao.id.EntityID
import org.jetbrains.exposed.v1.r2dbc.Query
import org.jetbrains.exposed.v1.r2dbc.R2dbcDatabase
import org.jetbrains.exposed.v1.r2dbc.SetOperation
import org.jetbrains.exposed.v1.r2dbc.select
import org.jetbrains.exposed.v1.r2dbc.transactions.suspendTransaction
import org.jetbrains.exposed.v1.r2dbc.unionAll

/**
 * How much of the target's log the VIEWER may see, decided by the route's guard
 * (`requireActivityRead`) and consumed here.
 *
 * - [OWN_RIGHT] — the self viewer: EVERY row of their own log is listed, but `details`/`link` are
 *   null when they can no longer read the document in their own right (the fact that they acted
 *   is theirs; the document's current title is not).
 * - [EVERYTHING] — the HR auditor (and HR reading their own log): every row, labels and links
 *   always present (a deleted document's link answers 404 — the share-list precedent).
 *
 * Step 2 adds the chain-viewer scope (rows hidden, never redacted, by SQL predicate).
 */
enum class ActivityScope { OWN_RIGHT, EVERYTHING }

/** The viewer: who they are (for the own-right projection), their disabled areas, and their scope. */
data class ActivityViewer(val userId: UInt, val disabledFeatures: Set<Feature>, val scope: ActivityScope)

/** The list filters — `area` equality and the inclusive epoch-millisecond bounds on `createdAt`. */
data class ActivityFilter(
    val area: ActivityArea? = null,
    val createdAtGte: Long? = null,
    val createdAtLte: Long? = null,
)

data class ActivityListResult(val items: List<ActivityEntry>, val total: Long)

/** The synthetic id's SOURCE component and the union's sort position (`createdAt DESC, area, source, eventId DESC`). */
private const val SOURCE_EVENT = "EVENT"

private val actorLabelUsers = Users.alias("act_user_a")
private val partnerLabelUsers = Users.alias("act_user_b")

/** One `*_events` table feeding the union, with the area its rows belong to. */
private class EventSource(val area: ActivityArea, val table: EventLogTable)

/** The seven document event trails — the rows of this step. Order is irrelevant (the union is sorted). */
private val EVENT_SOURCES = listOf(
    EventSource(ActivityArea.FEEDBACK, FeedbackEvents),
    EventSource(ActivityArea.ONE_ON_ONE, OneOnOneEvents),
    EventSource(ActivityArea.GOAL, GoalEvents),
    EventSource(ActivityArea.TEAM_KPI, TeamKpiEvents),
    EventSource(ActivityArea.PERFORMANCE_REVIEW, ReviewEvents),
    EventSource(ActivityArea.IMPACT_LOG_ENTRY, ImpactLogEvents),
    EventSource(ActivityArea.SUCCESSION_PLAN, SuccessionPlanEvents),
)

/** How the hydration phase decides `readable` for a document. */
private sealed interface Readability {
    data object Everything : Readability
    class OwnRight(val viewer: UInt, val chain: Set<UInt>) : Readability
}

/** What the hydration phase learned about one document. */
private class DocFacts(val details: Map<String, String>, val readable: Boolean)

/** The union's row, before hydration. */
private class UnionRow(
    val area: ActivityArea,
    val source: String,
    val eventId: UInt,
    val documentId: UInt,
    val createdAt: Long,
    val eventType: String,
    val params: String,
)

/**
 * The per-user activity log (v4.9.0): a chronological "what did this person do" read model built
 * at QUERY TIME as a `UNION ALL` over the seven per-document `*_events` tables, filtered on the
 * ACTING user — no new table, no dual write, nothing to drift (`.claude/docs/features/activity-log.md`).
 *
 * Two phases inside ONE transaction (so `total` and the rows agree — API-LIST-002): the ordered,
 * paged union of 7-column tuples (cheap — the V87 `(user_id, created_at)` indexes make each branch
 * a range scan), then a set-at-a-time hydration of the ≤100 page rows, one query per area present,
 * resolving the plaintext label snapshot (title/party columns only — never a decrypt) and, for the
 * self viewer, the own-right `readable` projection (`ActivityVisibility`). The viewer's disabled
 * areas are simply not added to the union, so `total` stays honest.
 *
 * The goal progress comment and every other encrypted column are NEVER read here: the union
 * carries only `eventType` + the content-free `params` map, like the document's own History tab.
 */
class ActivityService(
    private val database: R2dbcDatabase,
    private val registry: ShareRegistry,
) {
    suspend fun list(
        targetUserId: UInt,
        viewer: ActivityViewer,
        filter: ActivityFilter,
        paging: PageRequest,
    ): ActivityListResult {
        val sources = EVENT_SOURCES.filter { source ->
            (filter.area == null || filter.area == source.area) && source.area.feature !in viewer.disabledFeatures
        }
        if (sources.isEmpty()) return ActivityListResult(emptyList(), 0)
        return suspendTransaction(database) {
            val projection = Projection(branch(sources.first(), targetUserId, filter))
            val union = unionOf(sources, targetUserId, filter)
            val total = union.count()
            // The tiebreak flips WITH the createdAt direction, so ascending is the exact reverse of
            // the default order (the whole composite key reverses, not just its first component).
            val descending = paging.sort.firstOrNull { it.name == "createdAt" }?.descending ?: true
            val forward = if (descending) SortOrder.ASC else SortOrder.DESC
            val backward = if (descending) SortOrder.DESC else SortOrder.ASC
            val rows = union
                .applyPaging(
                    paging,
                    mapOf("createdAt" to projection.createdAt),
                    tiebreak = listOf(
                        projection.area to forward,
                        projection.source to forward,
                        projection.eventId to backward,
                    ),
                )
                .map { projection.read(it) }
                .toList()
            ActivityListResult(hydrate(rows, viewer), total)
        }
    }

    /** One `*_events` table → the 7-column tuple, restricted to the actor and the time window. */
    private fun branch(source: EventSource, targetUserId: UInt, filter: ActivityFilter, matching: Boolean = true): Query {
        val table = source.table
        return table.select(
            stringLiteral(source.area.name).alias("area"),
            stringLiteral(SOURCE_EVENT).alias("source"),
            table.id.alias("event_id"),
            table.ownerId.alias("document_id"),
            table.timestamp.alias("created_at"),
            table.eventType.alias("event_type"),
            table.params.alias("params"),
        ).where {
            var op: Op<Boolean> = if (matching) table.userId eq targetUserId else Op.FALSE
            filter.createdAtGte?.let { op = op and (table.timestamp greaterEq it) }
            filter.createdAtLte?.let { op = op and (table.timestamp lessEq it) }
            op
        }
    }

    /**
     * Left-folds the branches into one `UNION ALL`. Exposed has no one-branch set operation, so a
     * single source (an `area` filter, or every other area disabled for the viewer) is paired with
     * its own contradiction (`WHERE FALSE`) — the same rows, one code path.
     */
    private fun unionOf(sources: List<EventSource>, targetUserId: UInt, filter: ActivityFilter): SetOperation {
        val branches = sources.map { branch(it, targetUserId, filter) } +
            if (sources.size == 1) listOf(branch(sources.first(), targetUserId, filter, matching = false)) else emptyList()
        return branches.drop(2).fold<Query, SetOperation>(branches[0].unionAll(branches[1])) { acc, next ->
            acc.unionAll(next)
        }
    }

    /** The first branch's output aliases — the union's `ORDER BY` targets and the row reader. */
    private class Projection(first: Query) {
        private val fields = first.set.fields
        val area: Expression<*> = fields[0]
        val source: Expression<*> = fields[1]
        val eventId: Expression<*> = fields[2]
        val createdAt: Expression<*> = fields[4]
        private val documentId: Expression<*> = fields[3]
        private val eventType: Expression<*> = fields[5]
        private val params: Expression<*> = fields[6]

        // The id columns come back as EntityID<UInt> (or the raw UInt, depending on the alias wrapper).
        private fun idOf(value: Any?): UInt = ((value as? EntityID<*>)?.value ?: value) as UInt

        fun read(row: ResultRow): UnionRow = UnionRow(
            area = ActivityArea.valueOf(row[area].toString()),
            source = row[source].toString(),
            eventId = idOf(row[eventId]),
            documentId = idOf(row[documentId]),
            createdAt = row[createdAt] as Long,
            eventType = row[eventType].toString(),
            params = row[params].toString(),
        )
    }

    // ——— Phase 2: hydration ————————————————————————————————————————————————————————————————

    private suspend fun hydrate(rows: List<UnionRow>, viewer: ActivityViewer): List<ActivityEntry> {
        if (rows.isEmpty()) return emptyList()
        val readability = when (viewer.scope) {
            ActivityScope.EVERYTHING -> Readability.Everything
            // Computed once per request, in this transaction: the viewer's transitive subordinates.
            ActivityScope.OWN_RIGHT -> Readability.OwnRight(viewer.userId, transitiveSubordinateIds(viewer.userId))
        }
        val facts = rows.groupBy({ it.area }, { it.documentId }).mapValues { (area, ids) ->
            factsFor(area, ids.toSet(), readability)
        }
        return rows.map { row ->
            val fact = facts[row.area]?.get(row.documentId)
            val visible = fact?.readable ?: (readability is Readability.Everything)
            ActivityEntry(
                id = "${row.area.name}:${row.source}:${row.eventId}",
                createdAt = row.createdAt,
                area = row.area,
                eventType = row.eventType,
                params = decodeParams(row.params),
                documentId = row.documentId,
                link = if (visible) row.area.shareType?.let { registry.forType(it).viewPath(row.documentId) } else null,
                details = if (visible) fact?.details else null,
            )
        }
    }

    private suspend fun factsFor(area: ActivityArea, ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> =
        when (area) {
            ActivityArea.FEEDBACK -> feedbackFacts(ids, readability)
            ActivityArea.ONE_ON_ONE -> oneOnOneFacts(ids, readability)
            ActivityArea.GOAL -> goalFacts(ids, readability)
            ActivityArea.TEAM_KPI -> teamKpiFacts(ids, readability)
            ActivityArea.PERFORMANCE_REVIEW -> reviewFacts(ids, readability)
            ActivityArea.IMPACT_LOG_ENTRY -> impactFacts(ids, readability)
            ActivityArea.SUCCESSION_PLAN -> successionFacts(ids, readability)
            // No branch of the union produces these yet (their steps add them).
            ActivityArea.DAYS_OFF, ActivityArea.CAREER_POSITION, ActivityArea.ACCOUNT -> emptyMap()
        }

    /**
     * The own-right projection as a selectable boolean (a `CASE`, so it rides the same row as the
     * labels), or null when the viewer reads everything.
     */
    private fun readableExpr(area: ActivityArea, readability: Readability): Expression<Boolean>? =
        (readability as? Readability.OwnRight)?.let {
            case().When(ActivityVisibility.readable(area, it.viewer, it.chain), booleanLiteral(true))
                .Else(booleanLiteral(false))
        }

    /** Runs one area's label query over [from] (explicit joins) for [ids] and maps each row to its facts. */
    private suspend fun facts(
        area: ActivityArea,
        readability: Readability,
        idColumn: Column<EntityID<UInt>>,
        from: ColumnSet,
        ids: Set<UInt>,
        columns: List<Expression<*>>,
        label: (ResultRow) -> Map<String, String>,
    ): Map<UInt, DocFacts> {
        val readable = readableExpr(area, readability)
        return from.select(listOfNotNull(idColumn, *columns.toTypedArray(), readable))
            .where { idColumn inList ids }
            .map { row ->
                row[idColumn].value to DocFacts(label(row), readable?.let { row[it] } ?: true)
            }
            .toList()
            .toMap()
    }

    private suspend fun feedbackFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        // The recipients are position-ordered (the join table includes the anchor at position 0);
        // a legacy row without join rows falls back to the anchor column's name.
        val recipients = FeedbackSubjects
            .join(Users, JoinType.INNER, onColumn = FeedbackSubjects.userId, otherColumn = Users.id)
            .select(FeedbackSubjects.feedbackId, FeedbackSubjects.position, Users.name)
            .where { FeedbackSubjects.feedbackId inList ids }
            .orderBy(FeedbackSubjects.position to SortOrder.ASC)
            .map { it[FeedbackSubjects.feedbackId].value to it[Users.name] }
            .toList()
            .groupBy({ it.first }, { it.second })
        val from = Feedbacks
            .join(actorLabelUsers, JoinType.INNER, onColumn = Feedbacks.providerId, otherColumn = actorLabelUsers[Users.id])
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Feedbacks.subjectId, otherColumn = partnerLabelUsers[Users.id])
        return facts(
            ActivityArea.FEEDBACK, readability, Feedbacks.id, from, ids,
            listOf(actorLabelUsers[Users.name], partnerLabelUsers[Users.name]),
        ) { row ->
            val subjects = recipients[row[Feedbacks.id].value] ?: listOf(row[partnerLabelUsers[Users.name]])
            mapOf("provider" to row[actorLabelUsers[Users.name]], "subjects" to subjects.joinToString(", "))
        }
    }

    private suspend fun oneOnOneFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Meetings
            .join(actorLabelUsers, JoinType.INNER, onColumn = Meetings.managerId, otherColumn = actorLabelUsers[Users.id])
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Meetings.subordinateId, otherColumn = partnerLabelUsers[Users.id])
        return facts(
            ActivityArea.ONE_ON_ONE, readability, Meetings.id, from, ids,
            listOf(actorLabelUsers[Users.name], partnerLabelUsers[Users.name], Meetings.meetingDate),
        ) { row ->
            mapOf(
                "manager" to row[actorLabelUsers[Users.name]],
                "subordinate" to row[partnerLabelUsers[Users.name]],
                "meetingDate" to row[Meetings.meetingDate],
            )
        }
    }

    private suspend fun goalFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Goals
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Goals.subordinateId, otherColumn = partnerLabelUsers[Users.id])
        return facts(
            ActivityArea.GOAL, readability, Goals.id, from, ids,
            listOf(Goals.title, partnerLabelUsers[Users.name]),
        ) { row -> mapOf("title" to row[Goals.title], "subordinate" to row[partnerLabelUsers[Users.name]]) }
    }

    private suspend fun teamKpiFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = TeamKpis.join(Teams, JoinType.INNER, onColumn = TeamKpis.teamId, otherColumn = Teams.id)
        return facts(
            ActivityArea.TEAM_KPI, readability, TeamKpis.id, from, ids,
            listOf(TeamKpis.title, Teams.name, TeamKpis.type),
        ) { row ->
            mapOf("title" to row[TeamKpis.title], "team" to row[Teams.name], "type" to row[TeamKpis.type].name)
        }
    }

    private suspend fun reviewFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Reviews
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Reviews.subordinateId, otherColumn = partnerLabelUsers[Users.id])
            .join(ReviewPeriods, JoinType.INNER, onColumn = Reviews.periodId, otherColumn = ReviewPeriods.id)
        return facts(
            ActivityArea.PERFORMANCE_REVIEW, readability, Reviews.id, from, ids,
            listOf(partnerLabelUsers[Users.name], ReviewPeriods.startMonth, ReviewPeriods.endMonth),
        ) { row ->
            mapOf(
                "subordinate" to row[partnerLabelUsers[Users.name]],
                "startMonth" to row[ReviewPeriods.startMonth],
                "endMonth" to row[ReviewPeriods.endMonth],
            )
        }
    }

    private suspend fun impactFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Entries
            .join(actorLabelUsers, JoinType.INNER, onColumn = Entries.userId, otherColumn = actorLabelUsers[Users.id])
        return facts(
            ActivityArea.IMPACT_LOG_ENTRY, readability, Entries.id, from, ids,
            listOf(Entries.title, actorLabelUsers[Users.name], Entries.periodStart, Entries.periodEnd),
        ) { row ->
            mapOf(
                "title" to row[Entries.title],
                "author" to row[actorLabelUsers[Users.name]],
                "periodStart" to row[Entries.periodStart],
                "periodEnd" to row[Entries.periodEnd],
            )
        }
    }

    private suspend fun successionFacts(ids: Set<UInt>, readability: Readability): Map<UInt, DocFacts> {
        val from = Plans
            .join(partnerLabelUsers, JoinType.INNER, onColumn = Plans.userId, otherColumn = partnerLabelUsers[Users.id])
            .join(actorLabelUsers, JoinType.INNER, onColumn = Plans.managerId, otherColumn = actorLabelUsers[Users.id])
        return facts(
            ActivityArea.SUCCESSION_PLAN, readability, Plans.id, from, ids,
            listOf(partnerLabelUsers[Users.name], actorLabelUsers[Users.name]),
        ) { row ->
            mapOf("person" to row[partnerLabelUsers[Users.name]], "owner" to row[actorLabelUsers[Users.name]])
        }
    }
}
